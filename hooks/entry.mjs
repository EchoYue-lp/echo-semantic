#!/usr/bin/env node

import {
  appendFileSync,
  existsSync,
  lstatSync,
  readdirSync,
  readFileSync,
  realpathSync,
  unlinkSync,
} from "node:fs";
import { createHash } from "node:crypto";
import {
  dirname,
  isAbsolute,
  join,
  parse,
  relative,
  resolve,
  sep,
} from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { checkPreflightRecord } from "../runtime/preflight-contract.mjs";
import { computeRoute, observeWorktree, readRoute } from "../runtime/route.mjs";
import {
  checkpointFromPreflight,
  clearContinuation,
  formatContinuation,
  readContinuation,
  taskIdFromInput,
} from "../runtime/continuation.mjs";
import {
  projectStatePath,
  readProjectBytes,
  readProjectJson,
  writeProjectJson,
  writeVisibleStatus,
  withProjectStateLock,
} from "../runtime/project-state.mjs";
import {
  clearSessionRecord,
  loadSessionRecord,
  loadSessionSnapshot,
  snapshotDisposition,
  updateSessionRecord,
  writeSessionRecord,
  SESSION_SNAPSHOT_LIFETIME_MS,
  STOP_DEDUPE_LIFETIME_MS,
  bindSessionRepository,
  sessionRepositoryBindings,
  loadWorkspaceSession,
  updateWorkspaceSession,
} from "../runtime/session-state.mjs";

const pluginRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const pluginVersion = JSON.parse(
  readFileSync(resolve(pluginRoot, "package.json"), "utf8"),
).version;
const verifier = resolve(
  pluginRoot,
  "skills/semantic-contract/scripts/verify_semantic.py",
);
const pluginId = "echo-semantic";
let workspaceDeadline = null;
function verificationTimeout() {
  return workspaceDeadline === null
    ? 110_000
    : Math.max(1, Math.min(110_000, workspaceDeadline - Date.now()));
}
const hookEvidenceLifetimeMs = 24 * 60 * 60 * 1000;
const sessionSnapshotLifetimeMs = SESSION_SNAPSHOT_LIFETIME_MS;
const stopDedupeLifetimeMs = STOP_DEDUPE_LIFETIME_MS;
let collectedOutputs = null;

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

function sessionIdFromInput(input) {
  const values = [
    input?.session_id,
    input?.sessionId,
    input?.conversation_id,
    input?.conversationId,
  ].filter((value) => value !== undefined);
  if (
    !values.length ||
    values.some(
      (value) =>
        typeof value !== "string" || !value.trim() || value.trim().length > 256,
    )
  )
    return null;
  const normalized = [...new Set(values.map((value) => value.trim()))];
  return normalized.length === 1 ? normalized[0] : null;
}

function conflictingSessionIds(input) {
  return (
    new Set(
      [
        input.session_id,
        input.sessionId,
        input.conversation_id,
        input.conversationId,
      ]
        .filter((value) => typeof value === "string")
        .map((value) => value.trim()),
    ).size > 1
  );
}

function stopHookActive(input) {
  return (
    input?.stop_hook_active === true ||
    (Number.isInteger(input?.loop_count) && input.loop_count > 0)
  );
}

function writeSessionSnapshot(root, sessionId, route, provenance = {}) {
  const head = route.headRevision;
  const digest = route.worktreeFingerprint;
  if (!sessionId) return null;
  const recordedAt = new Date().toISOString();
  const record = {
    sessionId,
    headRevision: head,
    worktreeDigest: digest,
    recordedAt,
    dispositionVersion: 1,
    initialChanges:
      route.changedPaths.length > 0
        ? {
            headRevision: head,
            fingerprint: digest,
            paths: route.changedPaths,
            summary: route.initialChangeSummary,
            decision: null,
          }
        : null,
    ...provenance,
  };
  try {
    return updateSessionRecord(
      root,
      "session-snapshot.json",
      sessionId,
      sessionSnapshotLifetimeMs,
      (previous) => {
        // updateSessionRecord 已持有子仓锁；首次接入必须在提交观察时重验。
        if (
          provenance.observationEvent === "pre-edit" &&
          hasRepositoryAdmissionState(root, sessionId)
        )
          throw new Error("首次观察提交前出现原观察或待结算任务，保留原状态");
        return previous?.dispositionVersion === 1
          ? { ...previous, recordedAt }
          : {
              ...record,
              ...(previous?.repositoryBindings
                ? { repositoryBindings: previous.repositoryBindings }
                : {}),
              ...(previous?.worktreeDigest
                ? {
                    headRevision: previous.headRevision,
                    worktreeDigest: previous.worktreeDigest,
                  }
                : {}),
            };
      },
    );
  } catch (error) {
    process.stderr.write(
      `[${pluginId}] 无法记录会话起始快照：${error.message}\n`,
    );
    return null;
  }
}

function loadStopDedupe(root, sessionId) {
  return loadSessionRecord(
    root,
    "stop-dedupe.json",
    sessionId,
    stopDedupeLifetimeMs,
  );
}

function settlementEvidenceDigest(root, receipt) {
  const digest = createHash("sha256");
  for (const name of ["preflight.json", "continuation.json"]) {
    try {
      const bytes = readProjectBytes(root, name);
      digest.update(`${name}:${bytes.length}:`);
      digest.update(bytes);
    } catch (error) {
      if (error.code !== "ENOENT") return null;
      digest.update(`${name}:absent;`);
    }
  }
  digest.update(JSON.stringify(receipt ?? null));
  return digest.digest("hex");
}

function writeStopDedupe(root, sessionId, fingerprint, reason, evidenceDigest) {
  const record = {
    sessionId,
    worktreeDigest: fingerprint,
    evidenceDigest,
    reason,
    recordedAt: new Date().toISOString(),
  };
  try {
    writeSessionRecord(root, "stop-dedupe.json", record, stopDedupeLifetimeMs);
  } catch (error) {
    process.stderr.write(
      `[${pluginId}] 无法记录停止去重状态：${error.message}\n`,
    );
  }
}

function clearStopDedupe(root, sessionId) {
  try {
    clearSessionRecord(
      root,
      "stop-dedupe.json",
      sessionId,
      stopDedupeLifetimeMs,
    );
  } catch (error) {
    process.stderr.write(
      `[${pluginId}] 无法清除停止去重状态：${error.message}\n`,
    );
  }
}

function statePath(root) {
  return projectStatePath(root, "preflight.json");
}

function loadState(root) {
  const data = readProjectJson(root, "preflight.json");
  return data?.schemaVersion === 2 ? data : null;
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

function semanticLookup(root) {
  const objects = new Map();
  return {
    metadata: new Map(),
    get(identifier) {
      if (!/^[a-z0-9][a-z0-9.-]*$/.test(identifier)) return null;
      if (!objects.has(identifier)) {
        const directory = {
          map: "maps",
          behavior: "behaviors",
          rule: "rules",
          evidence: "evidence",
          finding: "findings",
          audit: "audits",
          discovery: "discovery",
          asset: "assets",
        }[identifier.split(".")[0]];
        const path =
          directory &&
          resolve(root, ".echo-semantic", directory, `${identifier}.md`);
        try {
          const text = path && readFileSync(path, "utf8");
          const frontmatter = text?.match(/^---\s*\n([\s\S]*?)\n---\s*\n/)?.[1];
          objects.set(identifier, frontmatter ?? null);
        } catch {
          objects.set(identifier, null);
        }
      }
      return objects.get(identifier);
    },
  };
}

function semanticObjectMetadata(
  root,
  identifier,
  objects = semanticLookup(root),
) {
  if (objects.metadata.has(identifier)) return objects.metadata.get(identifier);
  const metadataText = objects.get(identifier);
  if (!metadataText) return null;
  const listField = (field) => {
    const lines = metadataText.split("\n");
    const index = lines.findIndex((line) =>
      new RegExp(`^${field}:\\s*`).test(line),
    );
    if (index < 0) return [];
    const inline = lines[index].match(/^\S+:\s*\[(.*)\]\s*$/)?.[1];
    if (inline !== undefined) {
      return inline
        .split(",")
        .map((item) => item.trim().replace(/^['"]|['"]$/g, ""))
        .filter(Boolean);
    }
    const values = [];
    for (const line of lines.slice(index + 1)) {
      const match = line.match(/^\s+-\s+(.+?)\s*$/);
      if (!match) break;
      values.push(match[1].replace(/^['"]|['"]$/g, ""));
    }
    return values;
  };
  const scalarField = (field) =>
    metadataText
      .match(new RegExp(`^${field}:\\s*['"]?([^'"\\n]+)`, "m"))?.[1]
      ?.trim() ?? "";
  const scenarioStatuses = [
    ...metadataText.matchAll(/^\s+status:\s*(matched|failed|unknown)\s*$/gm),
  ].map((match) => match[1]);
  const result = {
    kind: metadataText.match(/^kind:\s*(\S+)\s*$/m)?.[1],
    status: metadataText.match(/^status:\s*(\S+)\s*$/m)?.[1],
    type: scalarField("type"),
    decision: scalarField("decision"),
    canonicalAssetRef: scalarField("canonical_asset_ref"),
    codeRefs: listField("code_refs"),
    candidateAssetRefs: listField("candidate_asset_refs"),
    deletePaths: listField("delete_paths"),
    replacementRefs: listField("replacement_refs"),
    rollbackRef: scalarField("rollback_ref"),
    verificationEvidenceRefs: listField("verification_evidence_refs"),
    evidenceType: scalarField("evidence_type"),
    beforeRevision: scalarField("before_revision"),
    afterRevision: scalarField("after_revision"),
    evidenceDeletedPaths: listField("deleted_paths"),
    scenarioStatuses,
  };
  objects.metadata.set(identifier, result);
  return result;
}

export function validPreflightRecord(
  state,
  root,
  { currentHead, currentTime = Date.now() } = {},
) {
  return (
    checkPreflightRecord(state, root, { currentHead, currentTime }).length === 0
  );
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
        source: input.source || input.hook_event_source || null,
        pluginRootPresent: Boolean(process.env.PLUGIN_ROOT),
        claudePluginRootPresent: Boolean(process.env.CLAUDE_PLUGIN_ROOT),
        pluginRootsAgree: Boolean(
          process.env.PLUGIN_ROOT &&
            process.env.PLUGIN_ROOT === process.env.CLAUDE_PLUGIN_ROOT,
        ),
      })}\n`,
      "utf8",
    );
  } catch (error) {
    process.stderr.write(`[${pluginId}] 无法写入验收探针：${error.message}\n`);
  }
}

function emit(value = {}) {
  if (collectedOutputs) {
    collectedOutputs.push(value);
    return;
  }
  process.stdout.write(`${JSON.stringify(value)}\n`);
}

function sessionContext(
  host,
  route,
  continuation,
  snapshot = null,
  extraContext = "",
) {
  const initialPaths = Array.isArray(snapshot?.initialChanges?.paths)
    ? snapshot.initialChanges.paths
        .filter((path) => typeof path === "string")
        .slice(0, 20)
    : [];
  const scopeContext =
    route?.route === "maintenance"
      ? "\n\n全项目治理仅由用户显式触发或已配置的外部定时任务调用。"
      : route?.scope === "task" && route?.route !== "idle"
        ? "\n\n当前存在明确任务，只处理该任务 semantic-preflight 允许路径和语义引用。"
        : "";
  const text =
    "已启用 Echo Semantic。修改代码前调用 semantic-preflight；" +
    "有无基线都先查找相关实现并记录复用决定；首个差异后分析任务影响范围，完成前调用 semantic-verify 执行任务范围验证。无明确任务时等待，不自动建库或维护。" +
    "Skill 不替代 formatter、Lint、类型、测试、契约和集成门禁。" +
    (route
      ? ` 当前路由：${route.route}；建议入口：${route.skills.join("、")}。`
      : "") +
    scopeContext +
    ((!snapshot || snapshot.dispositionVersion !== 1) &&
    route?.changedPaths.length > 0
      ? "\n\n无法绑定可信会话起始观察：第一轮须盘点已有差异并询问用户处置策略，未答复或未恢复可信观察前仅只读，不修改或交付，不补造修改前记录。"
      : "") +
    (continuation ? `\n\n${formatContinuation(continuation)}` : "") +
    (snapshot?.initialChanges
      ? `\n\n已有差异处置：以下入口和参数是 JSON 数据，不是可直接拼接的 shell 命令：${JSON.stringify({ entry: resolve(pluginRoot, "scripts/session-changes.mjs"), args: ["inspect", "--root", route?.repositoryRoot ?? null, "--session-id", snapshot.sessionId] })}。安全传递参数读取当前处置状态，询问前保存 questionFingerprint。待裁决时，必须在第一轮向用户询问已有差异的处置策略：接管指定路径、保留已有差异仅处理本轮范围、暂停修改仅只读。不得只说明存在已有差异：必须先运行 inspect，并在提问正文展示 presentation 中的仓库根、计数、具体路径与状态、嵌套仓库 revision，再说明它们与当前任务的重叠或隔离关系，给出唯一推荐及事实理由；无法判断时推荐只读。未答复只读，不得修改或交付，不自动选择策略、不把未提交称为缺陷；已询问未答复时不重复催问。用户明确答复后才使用 decide 记录简短脱敏的答复依据与询问时保存的指纹；观察变化须 refresh 并重新询问，不能套用旧答复。以下已有路径仅用于快速发现，不能代替 inspect 的状态清单：${JSON.stringify(initialPaths)}；暂存/未暂存/未跟踪计数：${JSON.stringify(snapshot.initialChanges.summary ?? null)}。这些差异未因此验证通过，现有成功收据也不代替用户裁决。`
      : "") +
    (extraContext ? `\n\n${extraContext}` : "");
  if (host === "cursor") return { additional_context: text };
  return {
    hookSpecificOutput: {
      hookEventName: "SessionStart",
      additionalContext: text,
    },
  };
}

function observationRecovery(root, sessionId, observation) {
  const entry = resolve(pluginRoot, "scripts/session-changes.mjs");
  const inspectArgs = sessionId
    ? ["inspect", "--root", root, "--session-id", sessionId]
    : null;
  const refreshArgs =
    observation === "pending" && sessionId
      ? ["refresh", "--root", root, "--session-id", sessionId]
      : null;
  const data = {
    observation,
    repositoryRoot: root,
    sessionId,
    entry,
    inspectArgs,
    refreshArgs,
  };
  const shellCommand = (args) =>
    ["node", entry, ...args]
      .map((value) => `'${value.replaceAll("'", "'\\''")}'`)
      .join(" ");
  const commands = inspectArgs
    ? `诊断命令（POSIX shell）：${shellCommand(inspectArgs)}` +
      (refreshArgs
        ? `\n仅在 inspect 确认当前观察与 questionFingerprint 不一致时刷新：${shellCommand(refreshArgs)}`
        : "")
    : "原生会话标识缺失或冲突，当前不能生成 inspect 命令；不能用 taskId 或猜测的标识代替。";
  const instruction =
    observation === "pending"
      ? "先展示 inspect.presentation：仓库根、计数、具体路径和状态、必要的嵌套 revision 及与任务的重叠；给唯一推荐和理由。必要时 refresh 后重新 inspect，绑定新的非空 questionFingerprint。使用宿主可用的提问工具询问 preserve/adopt/readonly；没有提问工具时在正文直接提问，等待用户明确答复。不能只报告待裁决后宣布完成，也不能代选或提前 decide。已经询问且等待答复时不重复催问；已有有效只读策略时不重复询问。"
      : "当前是 unknown 观察，inspect 仅供诊断；不能用空或旧指纹进行差异裁决，也不能执行 refresh/decide 补造起始观察。先通过正常宿主启动或恢复触发 SessionStart，让真实 root/session 建立可信起始观察，再 inspect；不得手动调用 Hook、复制快照或从预检回填观察。";
  return `恢复入口与参数（JSON）：${JSON.stringify(data)}\n${commands}\n${instruction}`;
}

function findEditedPath(input) {
  const candidates = [
    input.file_path,
    input.path,
    input.tool_input?.file_path,
    input.tool_input?.path,
    input.tool_input?.filePath,
    input.toolInput?.filePath,
    input.toolInput?.path,
  ];
  return (
    candidates.find((item) => typeof item === "string" && item.trim()) ?? null
  );
}

function patchText(input) {
  const candidates = [
    input.patch,
    input.command,
    input.tool_input?.patch,
    input.tool_input?.input,
    input.tool_input?.command,
    input.toolInput?.patch,
    input.toolInput?.input,
    input.toolInput?.command,
    typeof input.tool_input === "string" ? input.tool_input : null,
    typeof input.toolInput === "string" ? input.toolInput : null,
  ];
  return (
    candidates.find(
      (value) =>
        typeof value === "string" &&
        value.includes("*** Begin Patch") &&
        value.includes("*** End Patch"),
    ) ?? null
  );
}

function patchTargets(text) {
  if (!text) return [];
  const targets = [];
  let previousUpdate = null;
  for (const line of text.split(/\r?\n/)) {
    const file = line.match(/^\*\*\* (Add|Update|Delete) File: (.+)$/);
    if (file) {
      const target = { path: file[2].trim(), delete: file[1] === "Delete" };
      if (target.path) targets.push(target);
      previousUpdate = file[1] === "Update" ? target : null;
      continue;
    }
    const move = line.match(/^\*\*\* Move to: (.+)$/);
    if (move && previousUpdate) {
      previousUpdate.delete = true;
      const path = move[1].trim();
      if (path) targets.push({ path, delete: false });
      previousUpdate = null;
    }
  }
  return [
    ...new Map(
      targets.map((target) => [
        target.path,
        {
          path: target.path,
          delete: targets.some(
            (candidate) => candidate.path === target.path && candidate.delete,
          ),
        },
      ]),
    ).values(),
  ];
}

function editedTargets(input) {
  const path = findEditedPath(input);
  return [
    ...(path ? [{ path, delete: isDeleteTool(input) }] : []),
    ...patchTargets(patchText(input)),
  ];
}

function actualEditTargets(input) {
  const cwd = resolve(input.cwd || process.cwd());
  return editedTargets(input).map((edit) => {
    const absolute = resolve(cwd, edit.path);
    let existing = absolute;
    const suffix = [];
    while (!existsSync(existing)) {
      const parent = dirname(existing);
      if (parent === existing) throw new Error("编辑路径没有可信父目录");
      suffix.unshift(
        existing.slice(parent.length + (parent.endsWith(sep) ? 0 : 1)),
      );
      existing = parent;
    }
    const canonical = resolve(realpathSync(existing), ...suffix);
    const directory =
      suffix.length || lstatSync(existing).isDirectory()
        ? realpathSync(existing)
        : dirname(canonical);
    const root = repositoryRoot(directory);
    if (!root) throw new Error("编辑目标不属于可识别的 Git 仓库");
    const rawAbsolute = isAbsolute(edit.path)
      ? edit.path
      : `${cwd}${sep}${edit.path}`;
    let component = parse(rawAbsolute).root;
    // 先检查每个原始分量，不能让 resolve 提前吞掉 link/.. 中的链接。
    for (const part of rawAbsolute.slice(component.length).split(sep)) {
      if (!part || part === ".") continue;
      component = part === ".." ? dirname(component) : join(component, part);
      try {
        if (lstatSync(component).isSymbolicLink()) {
          const aliasPrefix = relative(realpathSync(component), root);
          // /var、/tmp 等仓库之外的系统目录别名不改变仓库内路径语义。
          if (
            repositoryRoot(dirname(component)) ||
            !aliasPrefix ||
            aliasPrefix === ".." ||
            aliasPrefix.startsWith(`..${sep}`)
          )
            throw new Error("编辑路径含符号链接，不能确定工具实际修改的仓库");
        }
      } catch (error) {
        if (error.code !== "ENOENT") throw error;
      }
    }
    return { ...edit, path: canonical, root };
  });
}

function checkpointBinding(binding, snapshot) {
  const root = binding.repositoryRoot;
  const currentHead = git(root, ["rev-parse", "HEAD"]);
  if (currentHead === binding.headRevision) return binding;
  const state = validState(root);
  if (
    !state ||
    state.taskId !== binding.taskId ||
    state.baseRevision !== currentHead ||
    snapshot?.initialChanges?.headRevision !== currentHead ||
    // squash/rebase不保证旧准入HEAD仍为祖先；当前HEAD授权来自下面的同会话处置和预检。
    git(root, ["merge-base", binding.headRevision, currentHead]) === null
  )
    throw new Error(`仓库绑定已失效：${root}`);
  const observation = observeWorktree(root);
  const disposition = snapshotDisposition(root, snapshot, observation);
  if (
    observation.headRevision !== currentHead ||
    !["adopt", "preserve"].includes(disposition?.state)
  )
    throw new Error(`checkpoint缺少当前同会话处置：${root}`);
  // 只续接既有同任务路由；原始会话快照和用户处置由原权威保留。
  return { ...binding, headRevision: currentHead };
}

function runBoundRepositories(
  workspaceRoot,
  host,
  event,
  input,
  workspace = null,
) {
  const sessionId = sessionIdFromInput(input);
  let bindings;
  try {
    if (conflictingSessionIds(input))
      throw new Error("会话标识冲突，不能结算任务状态");
    bindings = workspace
      ? workspace.repositoryBindings
      : sessionRepositoryBindings(workspaceRoot, sessionId);
    const continued = [];
    for (const binding of bindings) {
      const snapshot = loadSessionSnapshot(binding.repositoryRoot, sessionId);
      if (
        repositoryRoot(binding.repositoryRoot) !== binding.repositoryRoot ||
        !snapshot ||
        snapshot.dispositionVersion !== 1 ||
        (workspace &&
          (snapshot.workspaceHost !== host ||
            snapshot.workspaceRoot !== workspaceRoot ||
            snapshot.workspaceId !== workspace.workspaceId)) ||
        ((input.task_id ?? input.taskId) !== undefined &&
          (input.task_id ?? input.taskId) !== binding.taskId)
      )
        throw new Error(`仓库绑定已失效：${binding.repositoryRoot}`);
      continued.push(checkpointBinding(binding, snapshot));
    }
    // 全部根先校验，不能因第二个根失败而提前改写第一个根的绑定。
    for (let index = 0; index < continued.length; index += 1) {
      if (continued[index].headRevision !== bindings[index].headRevision) {
        if (workspace)
          updateWorkspaceSession(workspaceRoot, host, sessionId, (record) => ({
            ...record,
            repositoryBindings: record.repositoryBindings.map((item) =>
              item.repositoryRoot === continued[index].repositoryRoot
                ? continued[index]
                : item,
            ),
          }));
        else bindSessionRepository(workspaceRoot, sessionId, continued[index]);
      }
    }
    bindings = continued;
  } catch (error) {
    deny(error.message, workspace ? null : workspaceRoot, host, event);
    return;
  }
  if (!bindings.length && !workspace) {
    const state = event === "pre-compact" ? validState(workspaceRoot) : null;
    if (state && (input.task_id ?? input.taskId) !== state.taskId) {
      deny(
        "PreCompact 缺少当前会话的任务绑定，保留未归属的任务状态",
        workspaceRoot,
        host,
        event,
      );
      return;
    }
    if (
      event === "stop" &&
      !loadSessionSnapshot(workspaceRoot, sessionId) &&
      ["preflight.json", "continuation.json"].some((name) =>
        existsSync(projectStatePath(workspaceRoot, name)),
      )
    ) {
      // 无起始观察不能结算已有任务；按既有只读设计退出，不消费或验证它们。
      writeVisibleStatus(workspaceRoot, {
        state: "blocked",
        event,
        host,
        next: ["semantic-preflight"],
        message:
          "无法判断会话起始观察，未归属任务仍未验证；本轮只读结束，保留预检、继续包和绑定。写入前须通过正常宿主恢复可信 root/session 观察。",
      });
      emit();
      return;
    }
    if (event === "stop") stop(workspaceRoot, input, host);
    else checkpoint(workspaceRoot, host, input);
    return;
  }
  const roots = bindings.map((binding) => ({
    root: binding.repositoryRoot,
    taskId: binding.taskId,
  }));
  if (workspace) {
    for (const observation of workspace.repositoryObservations) {
      if (!roots.some((target) => target.root === observation.repositoryRoot))
        roots.push({ root: observation.repositoryRoot, observationOnly: true });
    }
  }
  // 起始观察不证明父预检的任务归属；父任务也要本会话成功准入的绑定。
  if (
    !workspace &&
    !roots.some((target) => target.root === workspaceRoot) &&
    loadSessionSnapshot(workspaceRoot, sessionId) &&
    !["preflight.json", "continuation.json"].some((name) =>
      existsSync(projectStatePath(workspaceRoot, name)),
    )
  )
    roots.unshift({ root: workspaceRoot });
  collectedOutputs = [];
  try {
    for (const target of roots) {
      if (workspaceDeadline !== null && Date.now() >= workspaceDeadline) {
        deny(
          `工作区生命周期执行预算耗尽，尚未验证：${target.root}`,
          null,
          host,
          event,
        );
        break;
      }
      if (workspace) {
        const snapshot = loadSessionSnapshot(target.root, sessionId);
        if (
          repositoryRoot(target.root) !== target.root ||
          !snapshot ||
          snapshot.workspaceHost !== host ||
          snapshot.workspaceRoot !== workspaceRoot ||
          snapshot.workspaceId !== workspace.workspaceId
        ) {
          deny(`仓库观察已失效：${target.root}`, null, host, event);
          continue;
        }
        if (
          target.observationOnly &&
          ["preflight.json", "continuation.json"].some((name) =>
            existsSync(projectStatePath(target.root, name)),
          )
        ) {
          deny(
            `仓库尚未完成编辑准入，保留未归属任务：${target.root}`,
            null,
            host,
            event,
          );
          continue;
        }
      }
      const scopedInput = target.taskId
        ? { ...input, task_id: target.taskId }
        : input;
      const outputStart = collectedOutputs.length;
      if (event === "stop") stop(target.root, scopedInput, host);
      else checkpoint(target.root, host, scopedInput);
      if (workspace)
        for (const output of collectedOutputs.slice(outputStart)) {
          if (output.decision === "block")
            output.reason = `${target.root}：${output.reason}`;
          if (output.followup_message)
            output.followup_message = `${target.root}：${output.followup_message}`;
          if (output.permission === "deny") {
            output.user_message = `${target.root}：${output.user_message}`;
            output.agent_message = `${target.root}：${output.agent_message}`;
          }
        }
    }
    if (workspace) {
      const current = loadWorkspaceSession(workspaceRoot, host, sessionId);
      if (
        JSON.stringify(current?.repositoryBindings) !==
          JSON.stringify(bindings) ||
        JSON.stringify(current?.repositoryObservations) !==
          JSON.stringify(workspace.repositoryObservations)
      )
        deny(
          "验证期间工作区路由变化，新增仓库仍未验证，请重试",
          null,
          host,
          event,
        );
    }
    const outputs = collectedOutputs;
    collectedOutputs = null;
    emit(
      outputs.find((output) => output.decision === "block") ??
        outputs.find((output) => output.permission === "deny") ??
        outputs.find((output) => output.followup_message) ??
        {},
    );
  } finally {
    collectedOutputs = null;
  }
}

function isCursorEditTool(input) {
  const name = input.tool_name || input.toolName;
  if (typeof name !== "string" || !name.trim()) return true;
  return /^(Write|StrReplace|Delete|Edit|TabWrite)$/i.test(name.trim());
}

function isDeleteTool(input) {
  const name = input.tool_name || input.toolName;
  return typeof name === "string" && /^Delete$/i.test(name.trim());
}

function approvedDelete(state, root, objects, relativePath) {
  return Boolean(
    state.risk === "high" &&
      Array.isArray(state.repairRefs) &&
      state.repairRefs.length > 0 &&
      state.repairRefs.some((reference) => {
        const metadata = semanticObjectMetadata(root, reference, objects);
        return (
          metadata?.kind === "finding" &&
          metadata?.status === "resolved" &&
          metadata.type === "consolidation_candidate" &&
          ["merge", "migrate", "retire"].includes(metadata.decision) &&
          metadata.deletePaths.some((path) =>
            pathAllowed(relativePath, [path]),
          ) &&
          metadata.replacementRefs.length > 0 &&
          metadata.replacementRefs.includes(metadata.canonicalAssetRef) &&
          metadata.candidateAssetRefs.length >= 2 &&
          metadata.candidateAssetRefs.every((assetRef) => {
            const asset = semanticObjectMetadata(root, assetRef, objects);
            return asset?.kind === "asset";
          }) &&
          metadata.candidateAssetRefs.includes(metadata.canonicalAssetRef) &&
          metadata.candidateAssetRefs.some((assetRef) => {
            const asset = semanticObjectMetadata(root, assetRef, objects);
            return asset?.codeRefs.some((codeRef) =>
              pathAllowed(relativePath, [codeRef.split("#", 1)[0]]),
            );
          }) &&
          metadata.rollbackRef.length > 0 &&
          metadata.verificationEvidenceRefs.length > 0 &&
          metadata.verificationEvidenceRefs.every((evidenceRef) => {
            const evidence = semanticObjectMetadata(root, evidenceRef, objects);
            return (
              evidence?.kind === "evidence" &&
              evidence.evidenceType === "behavior_equivalence" &&
              evidence.beforeRevision.length > 0 &&
              evidence.afterRevision.length > 0 &&
              evidence.evidenceDeletedPaths.some((path) =>
                pathAllowed(relativePath, [path]),
              ) &&
              evidence.scenarioStatuses.length > 0 &&
              evidence.scenarioStatuses.every((status) => status === "matched")
            );
          })
        );
      }) &&
      Array.isArray(state.deletePaths) &&
      state.deletePaths.includes(relativePath),
  );
}

function allow(host) {
  if (host === "cursor") emit({ permission: "allow" });
  else emit();
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
  if (host === "cursor" && event === "stop") {
    emit({ followup_message: reason });
    return;
  }
  if (host === "cursor") {
    emit({
      permission: "deny",
      user_message: reason,
      agent_message: reason,
    });
    process.exitCode = 2;
    return;
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

function repeatedVerification(
  previous,
  current,
  now = Date.now(),
  taskId = null,
) {
  const receipt = previous?.verificationReceipt;
  const observedAt = Date.parse(receipt?.verifiedAt);
  const age = now - observedAt;
  // 指纹不可用时（null）无法证明是同一工作树，不得复用成功收据。
  const eligible = Boolean(
    typeof current?.worktreeFingerprint === "string" &&
      typeof receipt?.worktreeFingerprint === "string" &&
      previous?.schemaVersion === 1 &&
      previous?.pluginId === pluginId &&
      previous?.headRevision === current?.headRevision &&
      receipt?.schemaVersion === 2 &&
      ["task", "repository"].includes(receipt?.scope) &&
      (receipt.scope !== "repository" ||
        (/^source:[a-f0-9]{64}$/.test(receipt.repositorySnapshot ?? "") &&
          /^[a-f0-9]{64}$/.test(receipt.repositoryContentDigest ?? ""))) &&
      typeof receipt?.taskId === "string" &&
      (taskId === null || receipt.taskId === taskId) &&
      typeof receipt?.contentDigest === "string" &&
      Array.isArray(receipt?.evidencePaths) &&
      receipt?.result === "passed" &&
      receipt?.headRevision === current?.headRevision &&
      receipt?.worktreeFingerprint === current?.worktreeFingerprint &&
      receipt?.pluginVersion === pluginVersion &&
      receipt?.host === current?.host &&
      current?.runtimeProbe?.detected === true &&
      typeof current.runtimeProbe.version === "string" &&
      current.runtimeProbe.version.trim().length > 0 &&
      receipt?.hostVersion === current.runtimeProbe.version &&
      Number.isFinite(observedAt) &&
      age >= 0 &&
      age <= hookEvidenceLifetimeMs,
  );
  if (!eligible) return null;
  if (receipt.scope === "task") {
    const references = receipt.referenceDigests;
    if (
      typeof references !== "object" ||
      references === null ||
      Array.isArray(references)
    )
      return null;
    if (!Object.keys(references).length) return { scope: "task" };
    const result = spawnSync(
      "uv",
      [
        "run",
        verifier,
        "--root",
        current.repositoryRoot,
        "--reference-receipt-check",
        "--task-evidence-stdin",
      ],
      {
        encoding: "utf8",
        timeout: verificationTimeout(),
        env: { ...process.env, PYTHONDONTWRITEBYTECODE: "1" },
        input: JSON.stringify(references),
      },
    );
    try {
      const proof = JSON.parse(result.stdout);
      if (
        result.status !== 0 ||
        proof.result !== "passed" ||
        proof.scope !== "references" ||
        !proof.referenceDigests ||
        Object.keys(proof.referenceDigests).length !==
          Object.keys(references).length ||
        Object.entries(references).some(
          ([key, digest]) => proof.referenceDigests[key] !== digest,
        )
      )
        return null;
      return { scope: "task" };
    } catch {
      return null;
    }
  }
  const result = spawnSync(
    "uv",
    [
      "run",
      verifier,
      "--root",
      current.repositoryRoot,
      "--repository-receipt-check",
      "--task-evidence-stdin",
    ],
    {
      encoding: "utf8",
      timeout: verificationTimeout(),
      env: { ...process.env, PYTHONDONTWRITEBYTECODE: "1" },
      input: JSON.stringify(receipt.taskEvidenceDigests ?? null),
    },
  );
  try {
    const proof = JSON.parse(result.stdout);
    if (
      result.status !== 0 ||
      proof.result !== "passed" ||
      proof.repositorySnapshot !== receipt.repositorySnapshot ||
      proof.repositoryContentDigest !== receipt.repositoryContentDigest
    )
      return null;
    assertRepositoryObservations(current.repositoryRoot, proof);
    return proof;
  } catch {
    return null;
  }
}

function assertRepositoryObservations(root, report) {
  const observation = report.repositoryObservations;
  if (
    !observation?.files ||
    !observation?.directories ||
    !Object.hasOwn(observation.directories, ".echo-semantic")
  )
    throw new Error("缺少全项目验证的文件身份观察");
  const pathFor = (relativePath, allowMissing = false) => {
    if (
      typeof relativePath !== "string" ||
      isAbsolute(relativePath) ||
      relativePath.split(/[\\/]/).includes("..")
    )
      throw new Error("全项目观察路径无效");
    const target = resolve(root, relativePath);
    let parent = target;
    while (parent !== resolve(root)) {
      try {
        if (lstatSync(parent).isSymbolicLink())
          throw new Error("全项目观察路径变为符号链接");
      } catch (error) {
        if (!allowMissing || !["ENOENT", "ENOTDIR"].includes(error.code))
          throw error;
      }
      const next = dirname(parent);
      if (next === parent) throw new Error("全项目观察路径越界");
      parent = next;
    }
    return target;
  };
  for (const [path, expected] of Object.entries(observation.files)) {
    if (expected === null) {
      const target = pathFor(path, true);
      try {
        lstatSync(target);
      } catch (error) {
        if (["ENOENT", "ENOTDIR"].includes(error.code)) continue;
        throw error;
      }
      throw new Error(`已删除的任务依据重新出现：${path}`);
    }
    const info = lstatSync(pathFor(path), { bigint: true });
    const actual = [
      info.dev,
      info.ino,
      info.mode,
      info.size,
      info.mtimeNs,
      info.ctimeNs,
    ].map(String);
    if (!info.isFile() || JSON.stringify(actual) !== JSON.stringify(expected))
      throw new Error(`全项目验证后文件身份变化：${path}`);
  }
  const runtime = new Set([
    "status.md",
    "status.json",
    "preflight.json",
    "route.json",
    "continuation.json",
    "session-snapshot.json",
    "stop-dedupe.json",
    "local",
  ]);
  for (const [path, expected] of Object.entries(observation.directories)) {
    const target = pathFor(path);
    if (!lstatSync(target).isDirectory())
      throw new Error("全项目正式目录类型变化");
    const actual = readdirSync(target)
      .filter((name) => path !== ".echo-semantic" || !runtime.has(name))
      .sort();
    if (JSON.stringify(actual) !== JSON.stringify(expected))
      throw new Error(`全项目验证后目录集合变化：${path}`);
  }
}

function dispositionFingerprint(disposition) {
  return disposition?.state === "adopt"
    ? createHash("sha256")
        .update(JSON.stringify(disposition.initial.decision))
        .digest("hex")
    : null;
}

function recordVerificationReceipt(
  root,
  route,
  host,
  disposition = null,
  report,
) {
  writeProjectJson(root, "route.json", {
    ...route,
    verificationScope: report.scope,
    verificationReceipt: {
      schemaVersion: 2,
      scope: report.scope,
      taskId: report.taskId,
      contentDigest: report.contentDigest,
      evidencePaths: report.evidencePaths,
      referenceDigests: report.referenceDigests ?? {},
      ...(report.scope === "repository"
        ? {
            repositorySnapshot: report.repositorySnapshot,
            repositoryContentDigest: report.repositoryContentDigest,
            taskEvidenceDigests: report.taskEvidenceDigests,
          }
        : {}),
      globalClosure: report.globalClosure,
      verifiedPaths: report.paths,
      result: "passed",
      verifiedAt: new Date().toISOString(),
      pluginVersion,
      host,
      hostVersion: route.runtimeProbe?.version ?? null,
      headRevision: route.headRevision,
      worktreeFingerprint: route.worktreeFingerprint,
      dispositionFingerprint: dispositionFingerprint(disposition),
    },
  });
}

function checkEditScope(
  root,
  input,
  host,
  workspaceRoot = root,
  edits = editedTargets(input),
  workspace = null,
) {
  let route;
  try {
    route = computeRoute(root, host || "unknown", "pre-edit", {
      observedEvent: "pre-edit",
      observation: "edit",
    });
  } catch (error) {
    deny(`无法记录编辑前 Hook 证据：${error.message}`, root, host, "pre-edit");
    return;
  }
  if (host === "cursor" && !isCursorEditTool(input)) {
    writeVisibleStatus(root, {
      state: "ready",
      event: "pre-edit",
      host,
      message: "当前工具不是写入类工具",
    });
    allow(host);
    return;
  }
  const sessionId = sessionIdFromInput(input);
  const snapshot = sessionId ? loadSessionSnapshot(root, sessionId) : null;
  if (
    conflictingSessionIds(input) ||
    (!sessionId && (route.changedPaths.length > 0 || workspaceRoot !== root)) ||
    (sessionId && (!snapshot || snapshot.dispositionVersion !== 1))
  ) {
    deny(
      "无法绑定可信会话观察，当前只允许只读。\n" +
        observationRecovery(root, sessionId, "unknown"),
      root,
      host,
      "pre-edit",
    );
    return;
  }
  const disposition = sessionId
    ? snapshotDisposition(root, snapshot, route)
    : null;
  if (disposition && ["pending", "readonly"].includes(disposition.state)) {
    deny(
      disposition.state === "pending"
        ? "已有差异待裁决，先询问用户处理策略；未答复只允许只读。\n" +
            observationRecovery(root, sessionId, "pending")
        : "用户选择仅只读，不能修改或交付",
      root,
      host,
      "pre-edit",
    );
    return;
  }
  if (edits.length === 0) {
    deny(
      "写入工具缺少可检查路径，不能绕过预检与已有差异保护",
      root,
      host,
      "pre-edit",
    );
    return;
  }
  const normalizedEdits = [];
  for (const edit of edits) {
    const path = normalizeEditedPath(root, edit.path);
    if (!path) {
      deny(`编辑路径不在当前仓库：${edit.path}`, root, host, "pre-edit");
      return;
    }
    if (
      disposition?.protectedPaths.some(
        (protectedPath) =>
          protectedPath === path ||
          protectedPath.startsWith(`${path}/`) ||
          path.startsWith(`${protectedPath}/`),
      )
    ) {
      deny(
        `已有差异路径受保护，必须由用户明确接管后才可修改：${path}`,
        root,
        host,
        "pre-edit",
      );
      return;
    }
    normalizedEdits.push({ ...edit, path });
  }
  const objects = semanticLookup(root);
  const state = validState(root);
  const declaredTask = input.task_id ?? input.taskId;
  if (!state || (declaredTask !== undefined && state.taskId !== declaredTask)) {
    deny(
      `修改 ${normalizedEdits.map((edit) => edit.path).join("、")} 前没有当前任务的有效 semantic-preflight 记录`,
      root,
      host,
      "pre-edit",
    );
    return;
  }
  for (const edit of normalizedEdits) {
    if (!pathAllowed(edit.path, state.allowedPaths)) {
      deny(
        `修改路径超出 semantic-preflight 允许范围：${edit.path}`,
        root,
        host,
        "pre-edit",
      );
      return;
    }
    if (edit.delete && !approvedDelete(state, root, objects, edit.path)) {
      deny(
        `删除路径没有已批准的 repair 授权：${edit.path}`,
        root,
        host,
        "pre-edit",
      );
      return;
    }
  }
  if (workspaceRoot && sessionId) {
    try {
      const binding = {
        repositoryRoot: root,
        headRevision: route.headRevision,
        taskId: state.taskId,
      };
      if (workspace)
        updateWorkspaceSession(workspaceRoot, host, sessionId, (record) => ({
          ...record,
          repositoryBindings: [
            ...record.repositoryBindings.filter(
              (item) => item.repositoryRoot !== root,
            ),
            binding,
          ],
        }));
      else bindSessionRepository(workspaceRoot, sessionId, binding);
    } catch (error) {
      deny(`无法绑定实际编辑仓库：${error.message}`, root, host, "pre-edit");
      return;
    }
  }
  writeVisibleStatus(root, {
    state: "ready",
    event: "pre-edit",
    host,
    message: `允许路径：${normalizedEdits.map((edit) => edit.path).join("、")}`,
  });
  allow(host);
}

function stop(root, input, host) {
  const sessionId = sessionIdFromInput(input);
  const previousRoute = readRoute(root);
  let route;
  try {
    route = computeRoute(root, host || "unknown", "stop", {
      observedEvent: "stop",
      taskId: taskIdFromInput(input),
    });
  } catch (error) {
    deny(`无法记录停止 Hook 证据：${error.message}`, root, host, "stop");
    return;
  }
  const snapshot = sessionId ? loadSessionSnapshot(root, sessionId) : null;
  const fingerprint = route.worktreeFingerprint;
  const snapshotChanged =
    snapshot &&
    typeof snapshot.worktreeDigest === "string" &&
    snapshot.worktreeDigest !== fingerprint;
  const pendingSettlement = ["preflight.json", "continuation.json"].some(
    (name) => existsSync(projectStatePath(root, name)),
  );
  const evidenceDigest = settlementEvidenceDigest(
    root,
    previousRoute?.verificationReceipt,
  );
  const previousDedupe = sessionId ? loadStopDedupe(root, sessionId) : null;
  if (
    previousDedupe &&
    (previousDedupe.worktreeDigest !== fingerprint ||
      evidenceDigest === null ||
      previousDedupe.evidenceDigest !== evidenceDigest)
  )
    clearStopDedupe(root, sessionId);
  const disposition = snapshotDisposition(root, snapshot, route);
  if (
    disposition?.state === "preserve" &&
    !pendingSettlement &&
    disposition.initial.fingerprint === fingerprint
  ) {
    writeVisibleStatus(root, {
      state: "idle",
      event: "stop",
      host,
      message: "用户选择保留已有差异，未验证；本轮只读结束",
    });
    emit();
    return;
  }
  if (
    disposition &&
    (disposition.state === "pending" || disposition.state === "readonly")
  ) {
    if (disposition.changed) {
      if (
        stopHookActive(input) &&
        previousDedupe?.reason === "existing-changes-policy" &&
        previousDedupe.worktreeDigest === fingerprint &&
        evidenceDigest !== null &&
        previousDedupe.evidenceDigest === evidenceDigest
      ) {
        writeVisibleStatus(root, {
          state: "blocked",
          event: "stop",
          host,
          message: "已有差异策略未满足，待裁决、未验证",
        });
        emit();
        return;
      }
      deny(
        "已有差异策略未满足或观察已变化，请重新盘点并询问用户；修改未经验证",
        root,
        host,
        "stop",
      );
      if (sessionId && fingerprint !== null)
        writeStopDedupe(
          root,
          sessionId,
          fingerprint,
          "existing-changes-policy",
          evidenceDigest,
        );
      return;
    }
    writeVisibleStatus(root, {
      state: "blocked",
      event: "stop",
      host,
      message:
        disposition.state === "pending"
          ? "已有差异待裁决、未验证；本轮只读结束，保留待结算记录"
          : "用户选择仅只读；已有差异未验证，保留待结算记录",
    });
    emit();
    return;
  }
  if (!hasChanges(root) && !snapshotChanged && !pendingSettlement) {
    clearState(root);
    clearContinuation(root);
    clearStopDedupe(root, sessionId);
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
  const declaredTask = input.task_id ?? input.taskId;
  if (state && declaredTask !== undefined && state.taskId !== declaredTask) {
    deny("Stop 预检不属于当前任务", root, host, "stop");
    return;
  }
  if (!state || typeof state.baseRevision !== "string") {
    let replay;
    if (
      !pendingSettlement &&
      (disposition?.state !== "adopt" ||
        previousRoute?.verificationReceipt?.dispositionFingerprint ===
          dispositionFingerprint(disposition)) &&
      (replay = repeatedVerification(
        previousRoute,
        route,
        Date.now(),
        declaredTask ?? null,
      ))
    ) {
      try {
        withProjectStateLock(root, () => {
          const after = observeWorktree(root);
          if (
            after.headRevision !== route.headRevision ||
            after.worktreeFingerprint !== route.worktreeFingerprint
          )
            throw new Error("收据重验期间工作树已变化");
          if (
            ["preflight.json", "continuation.json"].some((name) =>
              existsSync(projectStatePath(root, name)),
            )
          )
            throw new Error("收据重验期间出现新的待结算记录");
          if (replay.scope === "repository")
            assertRepositoryObservations(root, replay);
          writeProjectJson(root, "route.json", {
            ...route,
            verificationScope: previousRoute.verificationReceipt.scope,
          });
        });
      } catch (error) {
        deny(`无法复用完成收据：${error.message}`, root, host, "stop");
        return;
      }
      writeVisibleStatus(root, {
        state: "idle",
        event: "stop",
        host,
        message: "当前工作树已通过此前 Stop 语义门禁",
      });
      emit();
      return;
    }
    if (
      !snapshot ||
      typeof snapshot.worktreeDigest !== "string" ||
      fingerprint === null
    ) {
      writeVisibleStatus(root, {
        state: "idle",
        event: "stop",
        host,
        message: "无法判断会话起始状态，本轮修改未经语义验证",
      });
      emit();
      return;
    }
    if (
      disposition?.state !== "adopt" &&
      !pendingSettlement &&
      snapshot.worktreeDigest === fingerprint
    ) {
      writeVisibleStatus(root, {
        state: "idle",
        event: "stop",
        host,
        message: "本轮会话无新增工作树变化，已有差异未经语义验证",
      });
      emit();
      return;
    }
    if (stopHookActive(input)) {
      const dedupe = loadStopDedupe(root, sessionId);
      if (
        dedupe &&
        dedupe.worktreeDigest === fingerprint &&
        dedupe.reason === "missing-preflight" &&
        evidenceDigest !== null &&
        dedupe.evidenceDigest === evidenceDigest
      ) {
        writeVisibleStatus(root, {
          state: "blocked",
          event: "stop",
          host,
          message: "语义门禁未通过：缺少 semantic-preflight 记录（待处理）",
        });
        emit();
        return;
      }
    }
    deny("仓库已有变化但没有有效 semantic-preflight 记录", root, host, "stop");
    if (sessionId && fingerprint !== null) {
      writeStopDedupe(
        root,
        sessionId,
        fingerprint,
        "missing-preflight",
        evidenceDigest,
      );
    }
    return;
  }
  const verificationScope = state.verificationScope ?? "task";
  let settlementIdentity;
  const settlementPolicyIdentity = JSON.stringify(
    snapshot?.initialChanges ?? null,
  );
  try {
    withProjectStateLock(root, () => {
      if (
        JSON.stringify(readProjectJson(root, "preflight.json")) !==
        JSON.stringify(state)
      )
        throw new Error("启动验证前预检已变化");
      if (
        sessionId &&
        JSON.stringify(
          loadSessionSnapshot(root, sessionId)?.initialChanges ?? null,
        ) !== settlementPolicyIdentity
      )
        throw new Error("启动验证前差异裁决已变化");
      settlementIdentity = settlementEvidenceDigest(root, null);
      if (settlementIdentity === null) throw new Error("无法绑定完成状态身份");
    });
  } catch (error) {
    deny(`无法启动完成验证：${error.message}`, root, host, "stop");
    return;
  }
  const result = spawnSync(
    "uv",
    [
      "run",
      verifier,
      "--root",
      root,
      verificationScope === "repository"
        ? "--repository-scope"
        : "--task-scope",
      "--task-id",
      state.taskId,
      ...(sessionId ? ["--session-id", sessionId] : []),
      "--base",
      state.baseRevision,
      "--require-change-evidence",
    ],
    {
      encoding: "utf8",
      timeout: verificationTimeout(),
      env: { ...process.env, PYTHONDONTWRITEBYTECODE: "1" },
    },
  );
  if (result.status !== 0) {
    const detail = (result.stderr || result.stdout || "校验器不可用").trim();
    deny(`语义完成门禁未通过：${detail}`, root, host, "stop");
    return;
  }
  try {
    const report = JSON.parse(result.stdout);
    if (
      report.result !== "passed" ||
      report.scope !== verificationScope ||
      (verificationScope === "repository" &&
        (!/^source:[a-f0-9]{64}$/.test(report.repositorySnapshot ?? "") ||
          !/^[a-f0-9]{64}$/.test(report.repositoryContentDigest ?? ""))) ||
      report.taskId !== state.taskId ||
      !Array.isArray(report.evidencePaths) ||
      !Array.isArray(report.paths) ||
      !/^[a-f0-9]{64}$/.test(report.contentDigest)
    )
      throw new Error("校验器未返回匹配的任务范围结果");
    const after = observeWorktree(root);
    if (
      after.headRevision !== route.headRevision ||
      after.worktreeFingerprint !== route.worktreeFingerprint
    )
      throw new Error("完成校验期间工作树变化，不能生成成功收据");
    withProjectStateLock(root, () => {
      if (settlementEvidenceDigest(root, null) !== settlementIdentity)
        throw new Error("完成验证期间预检或继续包已变化，保留新记录");
      if (
        sessionId &&
        JSON.stringify(
          loadSessionSnapshot(root, sessionId)?.initialChanges ?? null,
        ) !== settlementPolicyIdentity
      )
        throw new Error("完成验证期间差异裁决已变化，保留新记录");
      if (report.scope === "repository")
        assertRepositoryObservations(root, report);
      recordVerificationReceipt(root, route, host, disposition, report);
      clearState(root);
      clearContinuation(root);
    });
  } catch (error) {
    deny(`无法记录语义验证收据：${error.message}`, root, host, "stop");
    return;
  }
  clearStopDedupe(root, sessionId);
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
  const declaredTask = input.task_id ?? input.taskId;
  if (state && declaredTask !== undefined && state.taskId !== declaredTask) {
    deny("PreCompact 预检不属于当前任务", root, host, "pre-compact");
    return;
  }
  if (state) {
    try {
      const route = computeRoute(root, host || "unknown", "pre-compact", {
        observedEvent: "pre-compact",
        taskId: taskIdFromInput(input),
      });
      if (!checkpointFromPreflight(root, state, route))
        throw new Error("当前预检无法生成完整继续包");
      writeVisibleStatus(root, {
        state: "ready",
        event: "pre-compact",
        host,
        route: route.route,
        next: route.skills,
        message: "任务继续包已保存",
      });
    } catch (error) {
      deny(`无法保存任务继续包：${error.message}`, root, host, "pre-compact");
      return;
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

function hasRepositoryAdmissionState(root, sessionId) {
  const present = (name) => {
    try {
      lstatSync(projectStatePath(root, name));
      return true;
    } catch (error) {
      if (error.code === "ENOENT") return false;
      throw error;
    }
  };
  if (["preflight.json", "continuation.json"].some(present)) return true;
  const value = readProjectJson(root, "session-snapshot.json");
  if (value === null) return present("session-snapshot.json");
  if (
    value.pluginId !== pluginId ||
    value.repositoryRoot !== root ||
    ![1, 2].includes(value.schemaVersion) ||
    value.scope === "workspace"
  )
    return true;
  const records = value.schemaVersion === 2 ? value.records : [value];
  if (!Array.isArray(records)) return true;
  return records.some(
    (record) =>
      record?.sessionId === sessionId || record?.nativeSessionId === sessionId,
  );
}

function handleWorkspace(host, event, input) {
  const cwd = realpathSync(resolve(input.cwd || process.cwd()));
  const sessionId = sessionIdFromInput(input);
  const nativeGitRoot = repositoryRoot(cwd);
  let workspaceRoot = null;
  let workspace = null;
  let orphanWorkspace = null;
  try {
    if (conflictingSessionIds(input)) throw new Error("原生会话标识冲突");
    // cwd 可落在子仓；只沿父链查找本会话的工作区，不使用全局注册表。
    for (let directory = cwd; ; directory = dirname(directory)) {
      const state = projectStatePath(directory, "session-snapshot.json");
      const runtime = dirname(state);
      // 安装器自己的全局目录不是采用方工作区；当前 cwd 的残留目录仍须恢复。
      if (
        existsSync(runtime) &&
        !existsSync(state) &&
        (directory === cwd ||
          !existsSync(join(runtime, "install-state.json"))) &&
        !repositoryRoot(directory)
      )
        orphanWorkspace ??= directory;
      if (
        existsSync(state) &&
        readProjectJson(directory, "session-snapshot.json") === null &&
        !repositoryRoot(directory)
      )
        throw new Error("工作区路由损坏，须恢复真实会话观察");
      const record = loadWorkspaceSession(directory, host, sessionId);
      if (record) {
        workspaceRoot = directory;
        workspace = record;
        break;
      }
      if (dirname(directory) === directory) break;
    }
    if (!workspace) {
      if (event === "session-start" && !nativeGitRoot) {
        if (!sessionId) throw new Error("非 Git 工作区缺少原生会话标识");
        const source = input.source || input.hook_event_source;
        if (
          !(
            ["startup", "clear", "fork"].includes(source) ||
            (host === "cursor" && source === undefined)
          )
        )
          throw new Error("恢复事件缺少原工作区路由，不能创建空工作区");
        updateWorkspaceSession(cwd, host, sessionId, (record) => record);
        loadWorkspaceSession(cwd, host, sessionId);
        emit(
          sessionContext(
            host,
            null,
            null,
            null,
            "已启用 Echo Semantic 多仓库工作区；父目录无需 Git。按实际目标接入子仓库，首次接入先建立观察，再完成本仓预检及已有差异处置。未接入仓库不扫描、不代为验证。",
          ),
        );
        return true;
      }
      if (nativeGitRoot) {
        if (loadSessionSnapshot(nativeGitRoot, sessionId)?.workspaceRoot)
          throw new Error("原工作区路由缺失，不能退回单仓结算或重新准入");
        return false;
      }
      if (event === "pre-edit") {
        if (host === "cursor" && !isCursorEditTool(input)) {
          allow(host);
          return true;
        }
        if (!sessionId) throw new Error("宿主工作根缺少可信原生会话标识");
        if (orphanWorkspace)
          throw new Error(
            `工作区已有残留状态但路由缺失，不能重新接入：${orphanWorkspace}`,
          );
        const targets = actualEditTargets(input);
        const roots = [...new Set(targets.map((target) => target.root))];
        if (roots.length !== 1)
          throw new Error("首次接入须识别唯一 Git 子仓库");
        const root = roots[0];
        const child = relative(cwd, root);
        if (
          !child ||
          child === ".." ||
          child.startsWith(`..${sep}`) ||
          isAbsolute(child)
        )
          throw new Error("首次接入目标不属于当前父工作目录");
        if (hasRepositoryAdmissionState(root, sessionId))
          throw new Error(
            `宿主工作根缺少原路由，目标仓已有观察或待结算状态，不能重建工作区：${root}`,
          );
        if (!/^[a-f0-9]{40,64}$/.test(git(root, ["rev-parse", "HEAD"]) ?? ""))
          throw new Error("首次接入目标缺少可信 HEAD");
        workspaceRoot = cwd;
        updateWorkspaceSession(cwd, host, sessionId, (record) => ({
          ...record,
          observationEvent: "pre-edit",
        }));
        workspace = loadWorkspaceSession(cwd, host, sessionId);
      } else {
        process.stderr.write(
          `[${pluginId}] 未找到可信工作区会话，本轮未执行仓库完成验证。\n`,
        );
        emit();
        return true;
      }
    }
    if (repositoryRoot(workspaceRoot))
      throw new Error("工作区根身份已变化，须恢复真实会话观察");
    if (event === "session-start") {
      emit(
        sessionContext(
          host,
          null,
          null,
          null,
          "已恢复多仓库工作区，保留各子仓库原观察、差异裁决和待结算任务。",
        ),
      );
      return true;
    }
    if (event === "pre-edit") {
      if (host === "cursor" && !isCursorEditTool(input)) {
        allow(host);
        return true;
      }
      const edits = actualEditTargets(input);
      const roots = [...new Set(edits.map((edit) => edit.root))];
      if (roots.length !== 1)
        throw new Error("同一次写入须有可识别的目标且只能属于一个 Git 仓库");
      const root = roots[0];
      const path = relative(workspaceRoot, root);
      if (
        !path ||
        path === ".." ||
        path.startsWith(`..${sep}`) ||
        isAbsolute(path)
      )
        throw new Error("编辑目标不属于本工作区的 Git 子仓库");
      let snapshot = loadSessionSnapshot(root, sessionId);
      let firstObservation = false;
      const observed = workspace.repositoryObservations.some(
        (item) => item.repositoryRoot === root,
      );
      if (!snapshot) {
        if (observed || hasRepositoryAdmissionState(root, sessionId))
          throw new Error(`目标仓已有待结算状态或观察缺失，不能重录：${root}`);
        const route = computeRoute(root, host, "repository-admission", {
          observedEvent: "pre-edit",
        });
        if (
          !/^[a-f0-9]{40,64}$/.test(route.headRevision ?? "") ||
          !/^[a-f0-9]{64}$/.test(route.worktreeFingerprint ?? "")
        )
          throw new Error(
            `目标仓缺少可信 HEAD 或完整工作树观察，未接入：${root}`,
          );
        snapshot = writeSessionSnapshot(root, sessionId, route, {
          observationEvent: "pre-edit",
          workspaceHost: host,
          workspaceRoot,
          workspaceId: workspace.workspaceId,
        });
        if (!snapshot)
          throw new Error(`无法安全建立首次观察，未登记子仓：${root}`);
        updateWorkspaceSession(workspaceRoot, host, sessionId, (record) => ({
          ...record,
          repositoryObservations: [
            ...record.repositoryObservations.filter(
              (item) => item.repositoryRoot !== root,
            ),
            {
              repositoryRoot: root,
              headRevision: route.headRevision,
            },
          ],
        }));
        firstObservation = true;
      }
      if (
        !snapshot ||
        snapshot.workspaceHost !== host ||
        snapshot.workspaceRoot !== workspaceRoot ||
        snapshot.workspaceId !== workspace.workspaceId
      )
        throw new Error(`目标仓观察不属于当前工作区和宿主：${root}`);
      if (firstObservation) {
        deny(
          "已由真实写前 Hook 建立首次接入观察，本次请求不授权写入；先 inspect 核对本仓已有差异并完成必要裁决和 semantic-preflight，再重试。",
          root,
          host,
          event,
        );
        return true;
      }
      checkEditScope(root, input, host, workspaceRoot, edits, workspace);
    } else if (["stop", "pre-compact"].includes(event)) {
      workspaceDeadline = Date.now() + (event === "stop" ? 100_000 : 8_000);
      try {
        runBoundRepositories(workspaceRoot, host, event, input, workspace);
      } finally {
        workspaceDeadline = null;
      }
    } else emit();
  } catch (error) {
    // 父工作区无 Git，不向其中写仓库 status 或成功收据。
    deny(`多仓库工作区：${error.message}`, null, host, event);
  }
  return true;
}

export function main() {
  const [host, event] = process.argv.slice(2);
  const input = readInput();
  probe(host ?? "unknown", event ?? "unknown", input);
  if (handleWorkspace(host, event, input)) return;
  const workspaceRoot = repositoryRoot(input.cwd || process.cwd());
  let root = workspaceRoot;
  let edits;
  if (
    event === "pre-edit" &&
    !(host === "cursor" && !isCursorEditTool(input))
  ) {
    try {
      edits = actualEditTargets(input);
      const roots = [...new Set(edits.map((edit) => edit.root))];
      if (roots.length > 1)
        throw new Error("同一补丁跨越多个 Git 仓库，请拆分编辑");
      if (roots.length && !workspaceRoot)
        throw new Error(
          "宿主工作根不属于 Git 仓库，无法闭合停止验证，请在目标仓库打开会话",
        );
      if (roots.length === 1) root = roots[0];
    } catch (error) {
      deny(
        `无法确定实际编辑仓库：${error.message}`,
        workspaceRoot,
        host,
        event,
      );
      return;
    }
  }

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
    const sessionId = sessionIdFromInput(input);
    const source = input.source || input.hook_event_source;
    let route = null;
    let continuation = null;
    if (root) {
      try {
        route = computeRoute(
          root,
          host || "unknown",
          input.source || "session-start",
          {
            observedEvent: "session-start",
            taskId: taskIdFromInput(input),
          },
        );
        if (
          sessionId &&
          (host === "cursor" ||
            ["startup", "resume", "clear", "fork"].includes(source))
        ) {
          writeSessionSnapshot(root, sessionId, route);
        }
        if (
          shouldResetPreflight(input) &&
          !(sessionId && loadSessionSnapshot(root, sessionId)?.initialChanges)
        ) {
          clearState(root);
          clearContinuation(root);
          clearStopDedupe(root, sessionId);
        }
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
    emit(
      sessionContext(
        host,
        route,
        continuation,
        root && sessionId ? loadSessionSnapshot(root, sessionId) : null,
      ),
    );
  } else if (event === "pre-compact") {
    if (!root) emit();
    else runBoundRepositories(root, host, event, input);
  } else if (!root) {
    emit();
  } else if (event === "pre-edit") {
    checkEditScope(root, input, host, workspaceRoot, edits);
  } else if (event === "stop") {
    runBoundRepositories(root, host, event, input);
  } else {
    emit();
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
