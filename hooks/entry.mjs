#!/usr/bin/env node

import {
  appendFileSync,
  existsSync,
  lstatSync,
  readFileSync,
  readdirSync,
  unlinkSync,
} from "node:fs";
import { createHash } from "node:crypto";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { computeRoute } from "../runtime/route.mjs";
import {
  checkpointFromPreflight,
  clearContinuation,
  formatContinuation,
  readContinuation,
  taskIdFromInput,
} from "../runtime/continuation.mjs";
import {
  projectStatePath,
  writeVisibleStatus,
} from "../runtime/project-state.mjs";

const pluginRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const verifier = resolve(
  pluginRoot,
  "skills/semantic-contract/scripts/verify_semantic.py",
);
const pluginId = "echo-semantic";
const preflightKinds = new Set([
  "bugfix",
  "feature",
  "refactor",
  "contract",
  "style",
]);
const preflightRisks = new Set(["low", "medium", "high"]);
const preflightSignals = [
  "publicApi",
  "newStateAuthority",
  "newProtocol",
  "crossServiceMigration",
  "architectureChange",
  "unknownProductionCode",
];
const architecturalSignals = new Set([
  "newStateAuthority",
  "newProtocol",
  "crossServiceMigration",
  "architectureChange",
]);

function readInput() {
  try {
    const raw = readFileSync(0, "utf8");
    return raw.trim() ? JSON.parse(raw) : {};
  } catch (error) {
    process.stderr.write(
      `[${pluginId}] 无法解析 Hook 输入：${error.message}\n`,
    );
    return {};
  }
}

function git(cwd, args) {
  const result = spawnSync("git", ["-C", cwd, ...args], {
    encoding: "utf8",
    timeout: 10_000,
  });
  if (result.status !== 0) return null;
  return result.stdout.trim();
}

function repositoryRoot(cwd) {
  const value = git(cwd, ["rev-parse", "--show-toplevel"]);
  return value ? resolve(value) : null;
}

function statePath(root) {
  return projectStatePath(root, "preflight.json");
}

function loadState(root) {
  const path = statePath(root);
  if (!path || !existsSync(path)) return null;
  try {
    const data = JSON.parse(readFileSync(path, "utf8"));
    return data?.schemaVersion === 1 ? data : null;
  } catch (error) {
    process.stderr.write(`[${pluginId}] 无法读取预检状态：${error.message}\n`);
    return null;
  }
}

function clearState(root) {
  const path = statePath(root);
  if (!path || !existsSync(path)) return;
  try {
    unlinkSync(path);
  } catch (error) {
    process.stderr.write(
      `[${pluginId}] 无法清除已消费的预检状态：${error.message}\n`,
    );
  }
}

function nonEmptyStringList(value, required = false) {
  return (
    Array.isArray(value) &&
    (!required || value.length > 0) &&
    value.every((item) => typeof item === "string" && item.trim())
  );
}

function validAllowedPath(value) {
  if (typeof value !== "string" || !value || value === ".") return false;
  if (isAbsolute(value)) return false;
  return !value.split(/[\\/]/).includes("..");
}

export function validPreflightShape(state) {
  if (state.pluginId !== pluginId) return false;
  if (
    typeof state.taskId !== "string" ||
    !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(state.taskId)
  )
    return false;
  if (!preflightKinds.has(state.kind) || !preflightRisks.has(state.risk))
    return false;
  if (!nonEmptyStringList(state.allowedPaths, true)) return false;
  if (state.allowedPaths.some((path) => !validAllowedPath(path))) return false;
  if (!nonEmptyStringList(state.reuse, true)) return false;
  if (!nonEmptyStringList(state.verifications, true)) return false;
  if (!nonEmptyStringList(state.basis)) return false;
  if (!nonEmptyStringList(state.semanticRefs)) return false;
  if (!Array.isArray(state.designAuthorities)) return false;
  if (
    state.designAuthorities.some(
      (authority) =>
        !authority ||
        typeof authority !== "object" ||
        Object.keys(authority).sort().join(",") !== "contentDigest,kind,path" ||
        !["design", "adr"].includes(authority.kind) ||
        typeof authority.path !== "string" ||
        !authority.path.trim() ||
        typeof authority.contentDigest !== "string" ||
        !/^[a-f0-9]{64}$/.test(authority.contentDigest),
    )
  )
    return false;
  if (
    !state.boundaryDecision ||
    typeof state.boundaryDecision !== "object" ||
    typeof state.boundaryDecision.createsNew !== "boolean" ||
    typeof state.boundaryDecision.reason !== "string" ||
    !state.boundaryDecision.reason.trim()
  )
    return false;
  if (
    !state.signals ||
    typeof state.signals !== "object" ||
    Array.isArray(state.signals) ||
    Object.keys(state.signals).length !== preflightSignals.length ||
    preflightSignals.some((name) => typeof state.signals[name] !== "boolean")
  )
    return false;
  const highRisk = preflightSignals.some((name) => state.signals[name]);
  if (
    highRisk &&
    (state.risk !== "high" ||
      state.basis.length === 0 ||
      state.semanticRefs.length === 0)
  )
    return false;
  if (
    preflightSignals.some(
      (name) => architecturalSignals.has(name) && state.signals[name],
    ) &&
    state.designAuthorities.length === 0
  )
    return false;
  return true;
}

function semanticObjectIds(root) {
  const objects = new Set();
  for (const directory of [
    "maps",
    "behaviors",
    "rules",
    "evidence",
    "findings",
    "audits",
    "discovery",
  ]) {
    const path = resolve(root, ".echo-semantic", directory);
    if (!existsSync(path)) continue;
    for (const entry of readdirSync(path, { withFileTypes: true })) {
      if (!entry.isFile() || !entry.name.endsWith(".md")) continue;
      const text = readFileSync(resolve(path, entry.name), "utf8");
      const frontmatter = text.match(/^---\s*\n([\s\S]*?)\n---\s*\n/);
      const identifier = frontmatter?.[1]?.match(
        /^id:\s*['"]?([^'"\s]+)['"]?\s*$/m,
      )?.[1];
      if (identifier) objects.add(identifier);
    }
  }
  return objects;
}

function currentAuthority(root, authority) {
  if (!validAllowedPath(authority.path) || !authority.path.endsWith(".md"))
    return false;
  const path = resolve(root, authority.path);
  const candidate = relative(root, path).split(sep).join("/");
  if (!candidate || candidate.startsWith("../")) return false;
  try {
    const stat = lstatSync(path);
    if (!stat.isFile() || stat.isSymbolicLink()) return false;
    const parts = candidate.toLowerCase().split("/");
    const name = parts.at(-1);
    const kind = parts.includes("adr")
      ? "adr"
      : name === "design.md" ||
          parts.some((part) => ["design", "designs"].includes(part))
        ? "design"
        : null;
    if (kind !== authority.kind) return false;
    const text = readFileSync(path, "utf8");
    if (!/^#\s+\S/m.test(text)) return false;
    const headings = [...text.matchAll(/^#{1,6}\s+(.+?)\s*$/gm)].map((match) =>
      match[1].trim().toLowerCase(),
    );
    const groups =
      kind === "adr"
        ? [
            ["状态", "status"],
            ["背景", "context", "problem"],
            ["候选", "方案", "options", "alternatives"],
            ["决策", "decision"],
            ["影响", "consequences"],
          ]
        : [
            ["目标", "problem", "goal"],
            ["范围", "边界", "scope", "boundary"],
            ["方案", "设计", "决策", "design", "decision"],
            ["验收", "验证", "acceptance", "verification"],
          ];
    if (
      groups.some(
        (alternatives) =>
          !headings.some((heading) =>
            alternatives.some((term) => heading.includes(term)),
          ),
      )
    )
      return false;
    const digest = createHash("sha256").update(text).digest("hex");
    return digest === authority.contentDigest;
  } catch {
    return false;
  }
}

export function validPreflightRecord(
  state,
  root,
  { currentHead, currentTime = Date.now() } = {},
) {
  if (!state || state.schemaVersion !== 1) return false;
  if (!validPreflightShape(state)) return false;
  if (state.repositoryRoot !== root) return false;
  if (!currentHead || state.baseRevision !== currentHead) return false;
  const recordedAt = Date.parse(state.recordedAt);
  const age = currentTime - recordedAt;
  if (
    !Number.isFinite(recordedAt) ||
    age < -5 * 60 * 1000 ||
    age > 24 * 60 * 60 * 1000
  ) {
    return false;
  }
  const objects = semanticObjectIds(root);
  if (state.semanticRefs.some((reference) => !objects.has(reference)))
    return false;
  if (
    state.designAuthorities.some(
      (authority) => !currentAuthority(root, authority),
    )
  )
    return false;
  return true;
}

function validState(root) {
  const state = loadState(root);
  if (!state) return null;
  const head = git(root, ["rev-parse", "HEAD"]);
  return validPreflightRecord(state, root, { currentHead: head })
    ? state
    : null;
}

function shouldResetPreflight(input) {
  const source = input.source || input.hook_event_source;
  return ["startup", "clear", "fork"].includes(source);
}

function probe(host, event, input) {
  const destination = process.env.ECHO_SEMANTIC_GOVERNANCE_PROBE_FILE;
  if (!destination) return;
  try {
    appendFileSync(
      destination,
      `${JSON.stringify({
        host,
        event,
        at: new Date().toISOString(),
        sessionId: input.session_id || input.sessionId || null,
        turnId: input.turn_id || input.turnId || null,
        parentProcessId: process.ppid,
        workingDirectory: input.cwd || process.cwd(),
        inputKeys: Object.keys(input).sort(),
      })}\n`,
      "utf8",
    );
  } catch (error) {
    process.stderr.write(`[${pluginId}] 无法写入验收探针：${error.message}\n`);
  }
}

function emit(value = {}) {
  process.stdout.write(`${JSON.stringify(value)}\n`);
}

function sessionContext(host, route, continuation) {
  const text =
    "已启用 Echo Semantic。修改代码前调用 semantic-preflight；" +
    "已有 .echo-semantic/ 基线时在首个差异后调用 semantic-diff，完成前调用 semantic-verify。" +
    "Skill 不替代 formatter、Lint、类型、测试、契约和集成门禁。" +
    (route
      ? ` 当前路由：${route.route}；建议入口：${route.skills.join("、")}。`
      : "") +
    (continuation ? `\n\n${formatContinuation(continuation)}` : "");
  if (host === "cursor") return { additional_context: text };
  return {
    hookSpecificOutput: {
      hookEventName: "SessionStart",
      additionalContext: text,
    },
  };
}

function findEditedPath(input) {
  const candidates = [
    input.file_path,
    input.path,
    input.tool_input?.file_path,
    input.tool_input?.path,
    input.toolInput?.filePath,
    input.toolInput?.path,
  ];
  return (
    candidates.find((item) => typeof item === "string" && item.trim()) ?? null
  );
}

function normalizeEditedPath(root, value) {
  const absolute = isAbsolute(value) ? resolve(value) : resolve(root, value);
  const candidate = relative(root, absolute).split(sep).join("/");
  if (!candidate || candidate === ".." || candidate.startsWith("../"))
    return null;
  return candidate;
}

function pathAllowed(relativePath, allowedPaths) {
  return (
    Array.isArray(allowedPaths) &&
    allowedPaths.some(
      (item) =>
        typeof item === "string" &&
        (relativePath === item ||
          relativePath.startsWith(`${item.replace(/\/$/, "")}/`)),
    )
  );
}

function deny(reason, root, host = "unknown", event = "unknown") {
  process.stderr.write(`[${pluginId}] ${reason}\n`);
  if (root) {
    try {
      writeVisibleStatus(root, {
        state: "blocked",
        event,
        host,
        message: reason,
      });
    } catch (error) {
      process.stderr.write(
        `[${pluginId}] 无法写入可见状态：${error.message}\n`,
      );
    }
  }
  emit({ decision: "block", reason });
  process.exitCode = 2;
}

function hasChanges(root) {
  const status = git(root, [
    "status",
    "--porcelain=v1",
    "--untracked-files=all",
  ]);
  return status === null || status.length > 0;
}

function checkEditScope(root, input, host) {
  if (!existsSync(resolve(root, ".echo-semantic/baseline.md"))) {
    writeVisibleStatus(root, {
      state: "idle",
      event: "pre-edit",
      host,
      message: "项目尚未采用 .echo-semantic/ 基线",
    });
    emit();
    return;
  }
  try {
    computeRoute(root, host || "unknown", "pre-edit", {
      observedEvent: "pre-edit",
    });
  } catch (error) {
    deny(`无法记录编辑前 Hook 证据：${error.message}`, root, host, "pre-edit");
    return;
  }
  const edited = findEditedPath(input);
  if (!edited) {
    writeVisibleStatus(root, {
      state: "ready",
      event: "pre-edit",
      host,
      message: "当前工具没有可检查的编辑路径",
    });
    emit();
    return;
  }
  const relativePath = normalizeEditedPath(root, edited);
  if (!relativePath) {
    deny(`编辑路径不在当前仓库：${edited}`, root, host, "pre-edit");
    return;
  }
  const state = validState(root);
  if (!state) {
    deny(
      `修改 ${relativePath} 前没有当前任务的有效 semantic-preflight 记录`,
      root,
      host,
      "pre-edit",
    );
    return;
  }
  if (!pathAllowed(relativePath, state.allowedPaths)) {
    deny(
      `修改路径超出 semantic-preflight 允许范围：${relativePath}`,
      root,
      host,
      "pre-edit",
    );
    return;
  }
  writeVisibleStatus(root, {
    state: "ready",
    event: "pre-edit",
    host,
    message: `允许路径：${relativePath}`,
  });
  emit();
}

function stop(root, input, host) {
  if (!existsSync(resolve(root, ".echo-semantic/baseline.md"))) {
    clearState(root);
    clearContinuation(root);
    writeVisibleStatus(root, {
      state: "idle",
      event: "stop",
      host,
      message: "项目尚未采用 .echo-semantic/ 基线",
    });
    emit();
    return;
  }
  try {
    computeRoute(root, host || "unknown", "stop", { observedEvent: "stop" });
  } catch (error) {
    deny(`无法记录停止 Hook 证据：${error.message}`, root, host, "stop");
    return;
  }
  if (!hasChanges(root)) {
    clearState(root);
    clearContinuation(root);
    writeVisibleStatus(root, {
      state: "idle",
      event: "stop",
      host,
      message: "没有待验证的工作树变化",
    });
    emit();
    return;
  }
  const state = validState(root);
  if (!state || typeof state.baseRevision !== "string") {
    deny("仓库已有变化但没有有效 semantic-preflight 记录", root, host, "stop");
    return;
  }
  const result = spawnSync(
    "uv",
    [
      "run",
      verifier,
      "--root",
      root,
      "--strict-snapshot",
      "--base",
      state.baseRevision,
      "--require-change-evidence",
    ],
    {
      encoding: "utf8",
      timeout: 110_000,
      env: { ...process.env, PYTHONDONTWRITEBYTECODE: "1" },
    },
  );
  if (result.status !== 0) {
    const detail = (result.stderr || result.stdout || "校验器不可用").trim();
    deny(`语义完成门禁未通过：${detail}`, root, host, "stop");
    return;
  }
  clearState(root);
  clearContinuation(root);
  writeVisibleStatus(root, {
    state: "idle",
    event: "stop",
    host,
    message: "语义完成门禁通过",
  });
  emit();
}

function checkpoint(root, host, input) {
  const state = validState(root);
  if (state) {
    try {
      const route = computeRoute(root, host || "unknown", "pre-compact", {
        observedEvent: "pre-compact",
      });
      checkpointFromPreflight(root, state, route);
      writeVisibleStatus(root, {
        state: "ready",
        event: "pre-compact",
        host,
        route: route.route,
        next: route.skills,
        message: "任务继续包已保存",
      });
    } catch (error) {
      process.stderr.write(
        `[${pluginId}] 无法保存任务继续包：${error.message}\n`,
      );
      writeVisibleStatus(root, {
        state: "blocked",
        event: "pre-compact",
        host,
        message: `无法保存任务继续包：${error.message}`,
      });
    }
  } else {
    writeVisibleStatus(root, {
      state: "stale",
      event: "pre-compact",
      host,
      next: ["semantic-preflight"],
      message: "没有可用于恢复的有效预检",
    });
  }
  emit();
}

export function main() {
  const [host, event] = process.argv.slice(2);
  const input = readInput();
  probe(host ?? "unknown", event ?? "unknown", input);
  const root = repositoryRoot(input.cwd || process.cwd());

  if (
    root &&
    ["session-start", "pre-edit", "pre-compact", "stop"].includes(event)
  ) {
    try {
      writeVisibleStatus(root, {
        state: "working",
        event,
        host: host || "unknown",
        message: "Hook 正在处理",
      });
    } catch (error) {
      process.stderr.write(
        `[${pluginId}] 无法写入可见状态：${error.message}\n`,
      );
    }
  }

  if (event === "session-start") {
    if (root && shouldResetPreflight(input)) {
      clearState(root);
      clearContinuation(root);
    }
    let route = null;
    let continuation = null;
    if (root) {
      try {
        route = computeRoute(
          root,
          host || "unknown",
          input.source || "session-start",
          { observedEvent: "session-start" },
        );
        continuation = readContinuation(root, taskIdFromInput(input));
      } catch (error) {
        process.stderr.write(
          `[${pluginId}] 无法计算当前语义路由：${error.message}\n`,
        );
        writeVisibleStatus(root, {
          state: "blocked",
          event: "session-start",
          host,
          message: `无法计算当前语义路由：${error.message}`,
        });
      }
    }
    emit(sessionContext(host, route, continuation));
  } else if (event === "pre-compact") {
    if (!root) emit();
    else checkpoint(root, host, input);
  } else if (!root) {
    emit();
  } else if (event === "pre-edit") {
    checkEditScope(root, input, host);
  } else if (event === "stop") {
    stop(root, input, host);
  } else {
    emit();
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
