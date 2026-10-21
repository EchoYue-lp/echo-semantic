#!/usr/bin/env node

import { randomUUID } from "node:crypto";
import {
  appendFileSync,
  closeSync,
  constants,
  existsSync,
  fstatSync,
  lstatSync,
  mkdirSync,
  openSync,
  readdirSync,
  readFileSync,
  readSync,
  realpathSync,
  renameSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";

export const PROJECT_STATE_DIRECTORY = ".echo-semantic";
export const LOCAL_ARTIFACT_DIRECTORY = "local";
export const PROJECT_STATE_SCHEMA_VERSION = 1;
export const PLUGIN_ID = "echo-semantic";
export const MAX_PROJECT_STATE_BYTES = 1024 * 1024;
const activeProjectStateLocks = new Set();
export const RUNTIME_STATE_FILES = [
  "status.md",
  "status.json",
  "preflight.json",
  "route.json",
  "continuation.json",
  "session-snapshot.json",
  "stop-dedupe.json",
];

function git(root, args) {
  const result = spawnSync("git", ["-C", root, ...args], {
    encoding: "utf8",
    timeout: 10_000,
  });
  return result.status === 0 ? result.stdout.trim() : null;
}

export function projectStateDirectory(root) {
  return resolve(root, PROJECT_STATE_DIRECTORY);
}

export function projectStatePath(root, name) {
  if (!RUNTIME_STATE_FILES.includes(name))
    throw new Error(`无效的 Echo Semantic 运行态文件：${name}`);
  const directory = projectStateDirectory(root);
  if (existsSync(directory)) {
    const stat = lstatSync(directory);
    if (!stat.isDirectory() || stat.isSymbolicLink())
      throw new Error(`Echo Semantic 项目目录必须是普通目录：${directory}`);
  }
  return join(directory, name);
}

function legacyStateDirectory(root) {
  const value = git(root, ["rev-parse", "--git-path", PLUGIN_ID]);
  if (!value) return null;
  return isAbsolute(value) ? resolve(value) : resolve(root, value);
}

export function migrateLegacyProjectState(root) {
  const target = projectStateDirectory(root);
  const legacy = legacyStateDirectory(root);
  if (!legacy || resolve(legacy) === resolve(target) || !existsSync(legacy))
    return;
  if (existsSync(target)) {
    const targetStat = lstatSync(target);
    if (!targetStat.isDirectory() || targetStat.isSymbolicLink())
      throw new Error(`Echo Semantic 项目目录必须是普通目录：${target}`);
  }
  try {
    const stat = lstatSync(legacy);
    if (!stat.isDirectory() || stat.isSymbolicLink()) return;
    mkdirSync(target, { recursive: true });
    for (const name of RUNTIME_STATE_FILES) {
      const source = join(legacy, name);
      const destination = join(target, name);
      if (existsSync(source) && !existsSync(destination)) {
        const sourceStat = lstatSync(source);
        if (sourceStat.isFile() && !sourceStat.isSymbolicLink())
          renameSync(source, destination);
      }
    }
    if (readdirSync(legacy).length === 0)
      rmSync(legacy, { recursive: true, force: true });
  } catch {
    // 迁移失败时继续使用项目目录；短期状态失效会要求重新预检。
  }
}

function infoExcludePath(root) {
  const value = git(root, ["rev-parse", "--git-path", "info/exclude"]);
  if (!value) return null;
  return isAbsolute(value) ? resolve(value) : resolve(root, value);
}

export function ensureProjectStateDirectory(root) {
  const directory = projectStateDirectory(root);
  if (existsSync(directory)) {
    const stat = lstatSync(directory);
    if (!stat.isDirectory() || stat.isSymbolicLink())
      throw new Error(`Echo Semantic 项目目录必须是普通目录：${directory}`);
  }
  migrateLegacyProjectState(root);
  if (!existsSync(directory)) mkdirSync(directory, { recursive: true });
  const stat = lstatSync(directory);
  if (!stat.isDirectory() || stat.isSymbolicLink())
    throw new Error(`Echo Semantic 项目目录必须是普通目录：${directory}`);
  return directory;
}

function ensureRuntimeFileUntracked(root, name) {
  const relative = `${PROJECT_STATE_DIRECTORY}/${name}`;
  const tracked = git(root, ["ls-files", "-z"]);
  if (
    tracked === null ||
    tracked
      .split("\0")
      .some((path) => path.toLowerCase() === relative.toLowerCase())
  )
    throw new Error(`Echo Semantic 运行态文件不能被 Git 跟踪：${relative}`);
}

export function ensureProjectStateIgnored(root) {
  const target = infoExcludePath(root);
  if (!target) return false;
  mkdirSync(dirname(target), { recursive: true });
  let current = "";
  try {
    if (existsSync(target)) current = readFileSync(target, "utf8");
  } catch {
    return false;
  }
  const markers = [
    ...RUNTIME_STATE_FILES.map((name) => `/${PROJECT_STATE_DIRECTORY}/${name}`),
    `/${PROJECT_STATE_DIRECTORY}/${LOCAL_ARTIFACT_DIRECTORY}/`,
  ];
  const lines = new Set(current.split(/\r?\n/));
  if (markers.every((marker) => lines.has(marker))) return true;
  const suffix = current.endsWith("\n") || current.length === 0 ? "" : "\n";
  const missing = markers.filter((marker) => !lines.has(marker));
  try {
    appendFileSync(
      target,
      `${suffix}# ${PLUGIN_ID} project runtime state\n${missing.join("\n")}\n`,
      "utf8",
    );
    return true;
  } catch {
    return false;
  }
}

// 只准备目录和本地排除；命令日志由调用方写入，不自动采集或清理。
export function prepareTaskArtifactDirectory(root, taskId) {
  if (
    typeof taskId !== "string" ||
    !/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(taskId) ||
    /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(taskId) ||
    taskId.endsWith(".")
  )
    throw new Error("任务标识必须是安全的单个目录名，最多 128 个字符");
  const gitRoot = git(root, ["rev-parse", "--show-toplevel"]);
  if (!gitRoot || realpathSync(root) !== realpathSync(gitRoot))
    throw new Error("产物根必须是 Git 仓库根");
  const relative = `${PROJECT_STATE_DIRECTORY}/${LOCAL_ARTIFACT_DIRECTORY}`;
  const tracked = git(root, ["ls-files", "-z"]);
  if (
    tracked === null ||
    tracked.split("\0").some((path) => {
      const normalized = path.toLowerCase();
      return normalized === relative || normalized.startsWith(`${relative}/`);
    })
  )
    throw new Error("本地产物目录不能被 Git 跟踪，请先检查现有索引");
  const directory = ensureProjectStateDirectory(root);
  // 在写入产物前拒绝现有符号链接和非目录，保留原文件。
  const local = join(directory, LOCAL_ARTIFACT_DIRECTORY);
  const target = join(local, taskId);
  for (const path of [local, target]) {
    try {
      const stat = lstatSync(path);
      if (!stat.isDirectory() || stat.isSymbolicLink())
        throw new Error(`本地产物路径必须是普通目录：${path}`);
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
  }
  if (!ensureProjectStateIgnored(root))
    throw new Error("无法把本地产物目录加入 .git/info/exclude");
  mkdirSync(local, { recursive: true });
  if (lstatSync(local).isSymbolicLink())
    throw new Error("本地产物目录不能是符号链接");
  // 根目录整体忽略才能剪枝全部后代；仅检查 probe 会漏掉按后缀取消忽略。
  // 这里不能加末尾斜线，否则 local/** 也可能把目录查询误判为整体忽略。
  if (
    git(root, ["check-ignore", "--", relative]) === null ||
    git(root, ["check-ignore", "--", `${relative}/${taskId}/probe`]) === null
  )
    throw new Error("本地产物忽略规则未生效");
  mkdirSync(target, { recursive: true });
  if (lstatSync(target).isSymbolicLink())
    throw new Error("任务产物目录不能是符号链接");
  return target;
}

function atomicWrite(path, content) {
  const temporary = join(dirname(path), `.${PLUGIN_ID}-${process.pid}.tmp`);
  writeFileSync(temporary, content, "utf8");
  renameSync(temporary, path);
}

function projectStateLockPath(root) {
  const value = git(root, [
    "rev-parse",
    "--git-path",
    `${PLUGIN_ID}-project-state.lock`,
  ]);
  if (!value) throw new Error("无法定位 Echo Semantic 项目状态锁");
  return isAbsolute(value) ? resolve(value) : resolve(root, value);
}

function wait(milliseconds) {
  Atomics.wait(
    new Int32Array(new SharedArrayBuffer(Int32Array.BYTES_PER_ELEMENT)),
    0,
    0,
    milliseconds,
  );
}

function exitedLockOwner(token) {
  const match = /^([1-9][0-9]*):[A-Za-z0-9-]+$/.exec(token);
  const pid = match ? Number(match[1]) : null;
  if (!Number.isSafeInteger(pid)) return false;
  try {
    process.kill(pid, 0);
    return false;
  } catch (error) {
    return error.code === "ESRCH";
  }
}

function readLockOwner(lock, expected) {
  let descriptor;
  try {
    descriptor = openSync(
      lock,
      constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0),
    );
    const opened = fstatSync(descriptor);
    const current = lstatSync(lock);
    if (
      !opened.isFile() ||
      !current.isFile() ||
      current.isSymbolicLink() ||
      opened.dev !== expected.dev ||
      opened.ino !== expected.ino ||
      opened.dev !== current.dev ||
      opened.ino !== current.ino ||
      opened.size > 512
    )
      return null;
    const bytes = Buffer.allocUnsafe(513);
    const count = readSync(descriptor, bytes, 0, bytes.length, 0);
    return count <= 512 ? bytes.subarray(0, count).toString("utf8") : null;
  } catch {
    return null;
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
  }
}

function recoverStaleProjectLock(lock, staleMs) {
  try {
    if (Date.now() - lstatSync(lock).mtimeMs <= staleMs) return false;
  } catch (error) {
    if (error.code === "ENOENT") return true;
    throw error;
  }
  const recovery = `${lock}.recovery`;
  let guard;
  try {
    guard = openSync(recovery, "wx", 0o600);
  } catch (error) {
    if (error.code === "EEXIST") return false;
    throw error;
  }
  // 回收者也必须互斥；未知或仍存活的持有者不能按年龄删除。
  try {
    const first = lstatSync(lock);
    if (
      !first.isFile() ||
      first.isSymbolicLink() ||
      first.size > 512 ||
      Date.now() - first.mtimeMs <= staleMs
    )
      return false;
    const token = readLockOwner(lock, first);
    if (token === null || !exitedLockOwner(token)) return false;
    const current = lstatSync(lock);
    if (
      current.dev !== first.dev ||
      current.ino !== first.ino ||
      current.mtimeMs !== first.mtimeMs ||
      readLockOwner(lock, current) !== token ||
      !exitedLockOwner(token)
    )
      return false;
    unlinkSync(lock);
    return true;
  } catch (error) {
    if (error.code === "ENOENT") return true;
    throw error;
  } finally {
    closeSync(guard);
    unlinkSync(recovery);
  }
}

export function withProjectStateLock(
  root,
  callback,
  { timeoutMs = 2_000, staleMs = 30_000 } = {},
) {
  const lock = projectStateLockPath(root);
  mkdirSync(dirname(lock), { recursive: true });
  const deadline = Date.now() + timeoutMs;
  const token = `${process.pid}:${randomUUID()}`;
  let descriptor = null;
  while (descriptor === null) {
    let candidate = null;
    try {
      candidate = openSync(lock, "wx", 0o600);
    } catch (error) {
      if (error.code !== "EEXIST") throw error;
      if (recoverStaleProjectLock(lock, staleMs)) continue;
      if (Date.now() >= deadline)
        throw new Error(`无法获取 Echo Semantic 项目状态锁：${lock}`);
      wait(10);
      continue;
    }
    try {
      writeFileSync(candidate, token, "utf8");
      descriptor = candidate;
    } catch (error) {
      closeSync(candidate);
      try {
        unlinkSync(lock);
      } catch (unlinkError) {
        if (unlinkError.code !== "ENOENT") throw unlinkError;
      }
      throw error;
    }
  }
  try {
    activeProjectStateLocks.add(lock);
    return callback();
  } finally {
    activeProjectStateLocks.delete(lock);
    const owned = fstatSync(descriptor);
    closeSync(descriptor);
    try {
      const current = lstatSync(lock);
      if (
        current.isFile() &&
        !current.isSymbolicLink() &&
        current.dev === owned.dev &&
        current.ino === owned.ino
      )
        unlinkSync(lock);
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
  }
}

function projectJsonContent(value) {
  const content = `${JSON.stringify(value, null, 2)}\n`;
  if (Buffer.byteLength(content) > MAX_PROJECT_STATE_BYTES)
    throw new Error("Echo Semantic 运行态超过 1 MiB，必须缩小观察范围");
  return content;
}

export function writeProjectJson(root, name, value) {
  if (!activeProjectStateLocks.has(projectStateLockPath(root)))
    return withProjectStateLock(root, () =>
      writeProjectJson(root, name, value),
    );
  if (!RUNTIME_STATE_FILES.includes(name))
    throw new Error(`无效的 Echo Semantic 运行态文件：${name}`);
  const content = projectJsonContent(value);
  const directory = ensureProjectStateDirectory(root);
  if (!ensureProjectStateIgnored(root))
    throw new Error("无法把 Echo Semantic 运行态加入 .git/info/exclude");
  ensureRuntimeFileUntracked(root, name);
  const target = join(directory, name);
  atomicWrite(target, content);
  return target;
}

function shortText(value, limit = 240) {
  return Array.from(String(value || ""))
    .slice(0, limit)
    .join("");
}

const stateLabels = {
  working: "工作中",
  ready: "已就绪",
  blocked: "已阻断",
  idle: "空闲",
  stale: "状态过期",
};

export function writeVisibleStatus(
  root,
  {
    state = "ready",
    event = "unknown",
    host = "unknown",
    route = null,
    next = [],
    message = "",
  } = {},
) {
  const updatedAt = new Date().toISOString();
  const revision = randomUUID();
  const safeNext = Array.isArray(next)
    ? next.filter((item) => typeof item === "string").slice(0, 8)
    : [];
  const payload = {
    schemaVersion: PROJECT_STATE_SCHEMA_VERSION,
    pluginId: PLUGIN_ID,
    state,
    event,
    host,
    route: typeof route === "string" ? route : null,
    next: safeNext,
    message: shortText(message),
    revision,
    updatedAt,
  };
  const content = projectJsonContent(payload);
  const directory = ensureProjectStateDirectory(root);
  if (!ensureProjectStateIgnored(root))
    throw new Error("无法把 Echo Semantic 运行态加入 .git/info/exclude");
  ensureRuntimeFileUntracked(root, "status.md");
  ensureRuntimeFileUntracked(root, "status.json");
  atomicWrite(join(directory, "status.json"), content);
  const label = stateLabels[state] || state;
  const routeText = payload.route || "未计算";
  const nextText = safeNext.length ? safeNext.join(" -> ") : "无";
  const messageText = payload.message ? `\n原因：${payload.message}` : "";
  atomicWrite(
    join(directory, "status.md"),
    `# Echo Semantic\n\n状态：${label}\n宿主：${host}\n事件：${event}\n路由：${routeText}\n下一步：${nextText}\n更新时间：${updatedAt}\n状态版本：${revision}${messageText}\n`,
  );
  return payload;
}

function unsafeStateRead(target) {
  const error = new Error(`Echo Semantic 运行态读取不可信：${target}`);
  error.code = "ECHO_SEMANTIC_UNSAFE_STATE";
  return error;
}

function sameStateFile(left, right) {
  return (
    left.dev === right.dev &&
    left.ino === right.ino &&
    left.mode === right.mode &&
    left.size === right.size &&
    left.mtimeMs === right.mtimeMs &&
    left.ctimeMs === right.ctimeMs
  );
}

export function readProjectBytes(root, name) {
  const target = projectStatePath(root, name);
  const expectedDirectory = join(realpathSync(root), PROJECT_STATE_DIRECTORY);
  const initial = lstatSync(target);
  if (
    !initial.isFile() ||
    initial.isSymbolicLink() ||
    initial.size > MAX_PROJECT_STATE_BYTES ||
    realpathSync(dirname(target)) !== expectedDirectory
  )
    throw unsafeStateRead(target);
  let descriptor;
  try {
    descriptor = openSync(
      target,
      constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0),
    );
    const opened = fstatSync(descriptor);
    const current = lstatSync(target);
    if (
      !opened.isFile() ||
      !current.isFile() ||
      current.isSymbolicLink() ||
      !sameStateFile(initial, opened) ||
      !sameStateFile(opened, current) ||
      realpathSync(dirname(target)) !== expectedDirectory
    )
      throw unsafeStateRead(target);
    const bytes = Buffer.allocUnsafe(MAX_PROJECT_STATE_BYTES + 1);
    let total = 0;
    while (total < bytes.length) {
      const count = readSync(
        descriptor,
        bytes,
        total,
        bytes.length - total,
        null,
      );
      if (count === 0) break;
      total += count;
    }
    if (
      total > MAX_PROJECT_STATE_BYTES ||
      total !== opened.size ||
      !sameStateFile(opened, fstatSync(descriptor))
    )
      throw unsafeStateRead(target);
    return bytes.subarray(0, total);
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
  }
}

export function readProjectJson(root, name) {
  try {
    const value = JSON.parse(readProjectBytes(root, name).toString("utf8"));
    return value && typeof value === "object" && !Array.isArray(value)
      ? value
      : null;
  } catch {
    return null;
  }
}

export function updateProjectJson(root, name, updater, lockOptions = {}) {
  if (typeof updater !== "function")
    throw new TypeError("Echo Semantic 项目状态更新器必须是函数");
  return withProjectStateLock(
    root,
    () => {
      const value = updater(readProjectJson(root, name));
      if (!value || typeof value !== "object" || Array.isArray(value))
        throw new TypeError("Echo Semantic 项目状态更新结果必须是对象");
      writeProjectJson(root, name, value);
      return value;
    },
    lockOptions,
  );
}
