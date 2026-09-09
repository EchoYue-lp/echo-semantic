#!/usr/bin/env node

import { appendFileSync, existsSync, readFileSync, unlinkSync } from "node:fs";
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

const pluginRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const verifier = resolve(
  pluginRoot,
  "skills/semantic-contract/scripts/verify_semantic.py",
);
const pluginId = "echo-semantic";

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
  const value = git(root, [
    "rev-parse",
    "--git-path",
    `${pluginId}/preflight.json`,
  ]);
  if (!value) return null;
  return isAbsolute(value) ? resolve(value) : resolve(root, value);
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

function validState(root) {
  const state = loadState(root);
  if (!state) return null;
  if (state.repositoryRoot !== root) return null;
  const head = git(root, ["rev-parse", "HEAD"]);
  if (!head || state.baseRevision !== head) return null;
  const recordedAt = Date.parse(state.recordedAt);
  if (
    !Number.isFinite(recordedAt) ||
    Date.now() - recordedAt > 24 * 60 * 60 * 1000
  ) {
    return null;
  }
  if (typeof state.taskId !== "string" || !state.taskId) return null;
  return state;
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
    "已有 semantic/ 时在首个差异后调用 semantic-diff，完成前调用 semantic-verify。" +
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

function deny(reason) {
  process.stderr.write(`[${pluginId}] ${reason}\n`);
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

function checkEditScope(root, input) {
  if (!existsSync(resolve(root, "semantic/baseline.md"))) {
    emit();
    return;
  }
  const edited = findEditedPath(input);
  if (!edited) {
    emit();
    return;
  }
  const relativePath = normalizeEditedPath(root, edited);
  if (!relativePath) {
    deny(`编辑路径不在当前仓库：${edited}`);
    return;
  }
  const state = validState(root);
  if (!state) {
    deny(`修改 ${relativePath} 前没有当前任务的有效 semantic-preflight 记录`);
    return;
  }
  if (!pathAllowed(relativePath, state.allowedPaths)) {
    deny(`修改路径超出 semantic-preflight 允许范围：${relativePath}`);
    return;
  }
  emit();
}

function stop(root, input) {
  if (!existsSync(resolve(root, "semantic/baseline.md"))) {
    clearState(root);
    clearContinuation(root);
    emit();
    return;
  }
  if (!hasChanges(root)) {
    clearState(root);
    clearContinuation(root);
    emit();
    return;
  }
  const state = validState(root);
  if (!state || typeof state.baseRevision !== "string") {
    deny("仓库已有变化但没有有效 semantic-preflight 记录");
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
    { encoding: "utf8", timeout: 110_000 },
  );
  if (result.status !== 0) {
    const detail = (result.stderr || result.stdout || "校验器不可用").trim();
    deny(`语义完成门禁未通过：${detail}`);
    return;
  }
  clearState(root);
  clearContinuation(root);
  emit();
}

function checkpoint(root, host, input) {
  const state = validState(root);
  if (state) {
    try {
      const route = computeRoute(root, host || "unknown", "pre-compact");
      checkpointFromPreflight(root, state, route);
    } catch (error) {
      process.stderr.write(
        `[${pluginId}] 无法保存任务继续包：${error.message}\n`,
      );
    }
  }
  emit();
}

const [host, event] = process.argv.slice(2);
const input = readInput();
probe(host ?? "unknown", event ?? "unknown", input);
const root = repositoryRoot(input.cwd || process.cwd());

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
      );
      continuation = readContinuation(root, taskIdFromInput(input));
    } catch (error) {
      process.stderr.write(
        `[${pluginId}] 无法计算当前语义路由：${error.message}\n`,
      );
    }
  }
  emit(sessionContext(host, route, continuation));
} else if (event === "pre-compact") {
  if (!root) emit();
  else checkpoint(root, host, input);
} else if (!root) {
  emit();
} else if (event === "pre-edit") {
  checkEditScope(root, input);
} else if (event === "stop") {
  stop(root, input);
} else {
  emit();
}
