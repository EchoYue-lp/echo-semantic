import {
  readProjectJson,
  updateProjectJson,
  PLUGIN_ID,
} from "./project-state.mjs";
import { observeWorktree } from "./route.mjs";

export const SESSION_SNAPSHOT_LIFETIME_MS = 7 * 24 * 60 * 60 * 1000;
export const STOP_DEDUPE_LIFETIME_MS = 24 * 60 * 60 * 1000;
const SESSION_RECORD_LIMIT = 128;
const strategies = new Set(["adopt", "preserve", "readonly"]);

function sessionRecords(value, root, lifetimeMs, now = Date.now()) {
  let records = [];
  if (value?.pluginId === PLUGIN_ID && value?.repositoryRoot === root) {
    if (value.schemaVersion === 2 && Array.isArray(value.records))
      records = value.records;
    else if (value.schemaVersion === 1) records = [value];
  }
  return records.filter((record) => {
    const age = now - Date.parse(record?.recordedAt);
    return (
      typeof record?.sessionId === "string" &&
      record.sessionId.length > 0 &&
      record.sessionId.length <= 256 &&
      Number.isFinite(age) &&
      age >= -5 * 60 * 1000 &&
      age <= lifetimeMs
    );
  });
}

export function loadSessionRecord(root, name, sessionId, lifetimeMs) {
  return (
    sessionRecords(readProjectJson(root, name), root, lifetimeMs).findLast(
      (record) => record.sessionId === sessionId,
    ) ?? null
  );
}

export function updateSessionRecord(
  root,
  name,
  sessionId,
  lifetimeMs,
  updater,
) {
  let record;
  updateProjectJson(root, name, (value) => {
    const records = sessionRecords(value, root, lifetimeMs);
    const previous =
      records.findLast((item) => item.sessionId === sessionId) ?? null;
    record = updater(previous);
    const retained = records.filter((item) => item.sessionId !== sessionId);
    if (record !== null) retained.push(record);
    return {
      schemaVersion: 2,
      pluginId: PLUGIN_ID,
      repositoryRoot: root,
      records: retained.slice(-SESSION_RECORD_LIMIT),
      updatedAt: new Date().toISOString(),
    };
  });
  return record;
}

export function writeSessionRecord(root, name, record, lifetimeMs) {
  return updateSessionRecord(
    root,
    name,
    record.sessionId,
    lifetimeMs,
    () => record,
  );
}

export function clearSessionRecord(root, name, sessionId, lifetimeMs) {
  if (sessionId)
    updateSessionRecord(root, name, sessionId, lifetimeMs, () => null);
}

export function loadSessionSnapshot(root, sessionId) {
  const record = loadSessionRecord(
    root,
    "session-snapshot.json",
    sessionId,
    SESSION_SNAPSHOT_LIFETIME_MS,
  );
  // 仓库路由只证明成功准入过哪些根，绝不能冒充修改前观察。
  return record?.routingOnly ? null : record;
}

export function bindSessionRepository(root, sessionId, binding) {
  if (!sessionId) throw new Error("仓库绑定缺少原生会话标识");
  return updateSessionRecord(
    root,
    "session-snapshot.json",
    sessionId,
    SESSION_SNAPSHOT_LIFETIME_MS,
    (previous) => {
      const bindings = previous?.repositoryBindings ?? [];
      if (!Array.isArray(bindings)) throw new Error("会话仓库绑定无效");
      const retained = bindings.filter(
        (item) => item.repositoryRoot !== binding.repositoryRoot,
      );
      if (retained.length >= 8)
        throw new Error("同一会话触及仓库过多，请拆分任务");
      return {
        ...(previous ?? {
          sessionId,
          recordedAt: new Date().toISOString(),
          routingOnly: true,
        }),
        repositoryBindings: [...retained, binding],
      };
    },
  );
}

export function sessionRepositoryBindings(root, sessionId) {
  if (!sessionId) return [];
  const record = loadSessionRecord(
    root,
    "session-snapshot.json",
    sessionId,
    SESSION_SNAPSHOT_LIFETIME_MS,
  );
  const bindings = record?.repositoryBindings ?? [];
  if (
    !Array.isArray(bindings) ||
    bindings.length > 8 ||
    bindings.some(
      (item) =>
        !item ||
        typeof item.repositoryRoot !== "string" ||
        typeof item.taskId !== "string" ||
        !item.taskId ||
        !/^[a-f0-9]{40,64}$/.test(item.headRevision ?? ""),
    )
  )
    throw new Error("会话仓库绑定损坏，不能结算其它仓库");
  return bindings;
}

export function snapshotDisposition(root, snapshot, route) {
  if (snapshot && snapshot.dispositionVersion !== 1)
    return { state: "pending", initial: null, changed: false };
  const initial = snapshot?.initialChanges;
  if (!initial) return null;
  const paths = initial.paths;
  const validPaths =
    Array.isArray(paths) &&
    paths.every(
      (path) =>
        typeof path === "string" &&
        path &&
        !path.startsWith("/") &&
        !path.split(/[\\/]/).includes(".."),
    );
  if (!validPaths || typeof initial.fingerprint !== "string")
    return { state: "pending", initial, changed: false };
  // 编辑准入不需要只读策略的全量指纹；停止时仍核对完整内容。
  if (route.observation === "edit" && initial.decision?.strategy === "readonly")
    return { state: "readonly", initial, changed: false };
  const decision = initial.decision;
  const age = Date.now() - Date.parse(decision?.decidedAt);
  if (
    !decision ||
    !strategies.has(decision.strategy) ||
    decision.observedFingerprint !== initial.fingerprint ||
    typeof decision.basis !== "string" ||
    !decision.basis.trim() ||
    !Number.isFinite(age) ||
    age < -5 * 60 * 1000 ||
    age > SESSION_SNAPSHOT_LIFETIME_MS ||
    typeof decision.protectedFingerprint !== "string" ||
    !Array.isArray(decision.paths) ||
    decision.paths.some((path) => !paths.includes(path)) ||
    (decision.strategy === "adopt"
      ? decision.paths.length === 0
      : decision.paths.length > 0)
  ) {
    return {
      state: "pending",
      initial,
      changed:
        route.worktreeFingerprint !== null &&
        initial.fingerprint !== route.worktreeFingerprint,
    };
  }
  const protectedPaths = paths.filter((path) => !decision.paths.includes(path));
  let protectedObservation;
  try {
    protectedObservation = observeWorktree(root, protectedPaths);
  } catch {
    return { state: "pending", initial, changed: false };
  }
  if (protectedObservation.worktreeFingerprint === null)
    return { state: "pending", initial, changed: false };
  if (
    initial.headRevision !== route.headRevision ||
    protectedObservation.worktreeFingerprint !== decision.protectedFingerprint
  )
    return { state: "pending", initial, changed: true };
  if (
    decision.strategy === "readonly" &&
    initial.fingerprint !== route.worktreeFingerprint
  )
    return { state: "pending", initial, changed: true };
  return { state: decision.strategy, initial, protectedPaths, changed: false };
}

export function decideSessionChanges(
  root,
  sessionId,
  expectedFingerprint,
  strategy,
  paths,
  basis,
) {
  if (
    typeof sessionId !== "string" ||
    !sessionId ||
    sessionId.length > 256 ||
    !strategies.has(strategy) ||
    !Array.isArray(paths) ||
    !paths.every((path) => typeof path === "string") ||
    typeof basis !== "string" ||
    !basis.trim() ||
    basis.length > 1000
  )
    throw new Error("必须提供会话、有效策略与用户明确答复依据");
  return updateSessionRecord(
    root,
    "session-snapshot.json",
    sessionId,
    SESSION_SNAPSHOT_LIFETIME_MS,
    (previous) => {
      if (previous?.dispositionVersion !== 1 || !previous.initialChanges)
        throw new Error("当前会话没有首次差异盘点，不得补造修改前记录");
      if (previous.initialChanges.fingerprint !== expectedFingerprint)
        throw new Error(
          "答复不匹配询问时的观察，请显式 refresh 并重新询问用户",
        );
      const observed = observeWorktree(root);
      if (
        observed.worktreeFingerprint === null ||
        observed.worktreeFingerprint !== expectedFingerprint
      )
        throw new Error("差异观察已变化或不可用，请重新盘点并询问用户");
      const existing = [
        ...new Set(observed.changes.map((change) => change.path)),
      ];
      const selected = [...new Set(paths)];
      if (
        (strategy === "adopt" && selected.length === 0) ||
        (strategy !== "adopt" && selected.length > 0) ||
        selected.some((path) => !existing.includes(path))
      )
        throw new Error("接管须指定已有差异路径，保留和只读不得指定接管路径");
      const protectedPaths = existing.filter(
        (path) => !selected.includes(path),
      );
      const protectedObservation = observeWorktree(root, protectedPaths);
      if (
        protectedObservation.worktreeFingerprint === null ||
        observeWorktree(root).worktreeFingerprint !== expectedFingerprint
      )
        throw new Error("裁决记录期间差异已变化，请重新询问");
      return {
        ...previous,
        initialChanges: {
          headRevision: observed.headRevision,
          fingerprint: expectedFingerprint,
          paths: existing,
          summary: observed.summary,
          decision: {
            strategy,
            paths: selected,
            observedFingerprint: expectedFingerprint,
            protectedFingerprint: protectedObservation.worktreeFingerprint,
            basis: basis.trim(),
            decidedAt: new Date().toISOString(),
          },
        },
      };
    },
  );
}

export function refreshSessionChanges(root, sessionId) {
  return updateSessionRecord(
    root,
    "session-snapshot.json",
    sessionId,
    SESSION_SNAPSHOT_LIFETIME_MS,
    (previous) => {
      if (previous?.dispositionVersion !== 1 || !previous.initialChanges)
        throw new Error("当前会话没有首次差异盘点，不得补造修改前记录");
      const observation = observeWorktree(root);
      if (observation.worktreeFingerprint === null)
        throw new Error("当前差异观察不可用，只允许只读");
      return {
        ...previous,
        initialChanges: {
          headRevision: observation.headRevision,
          fingerprint: observation.worktreeFingerprint,
          paths: [...new Set(observation.changes.map((change) => change.path))],
          summary: observation.summary,
          decision: null,
        },
      };
    },
  );
}
