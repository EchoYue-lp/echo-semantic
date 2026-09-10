#!/usr/bin/env node

import {
  appendFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";

export const PROJECT_STATE_DIRECTORY = ".echo-semantic";
export const PROJECT_STATE_SCHEMA_VERSION = 1;
export const PLUGIN_ID = "echo-semantic";
export const RUNTIME_STATE_FILES = [
  "status.md",
  "status.json",
  "preflight.json",
  "route.json",
  "continuation.json",
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
  return join(projectStateDirectory(root), name);
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
  try {
    const stat = lstatSync(legacy);
    if (!stat.isDirectory() || stat.isSymbolicLink()) return;
    mkdirSync(target, { recursive: true });
    for (const name of RUNTIME_STATE_FILES) {
      const source = join(legacy, name);
      const destination = join(target, name);
      if (existsSync(source) && !existsSync(destination))
        renameSync(source, destination);
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
  migrateLegacyProjectState(root);
  const directory = projectStateDirectory(root);
  mkdirSync(directory, { recursive: true });
  return directory;
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
  const markers = RUNTIME_STATE_FILES.map(
    (name) => `/${PROJECT_STATE_DIRECTORY}/${name}`,
  );
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

function atomicWrite(path, content) {
  const temporary = join(dirname(path), `.${PLUGIN_ID}-${process.pid}.tmp`);
  writeFileSync(temporary, content, "utf8");
  renameSync(temporary, path);
}

export function writeProjectJson(root, name, value) {
  const directory = ensureProjectStateDirectory(root);
  ensureProjectStateIgnored(root);
  const target = join(directory, name);
  atomicWrite(target, `${JSON.stringify(value, null, 2)}\n`);
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
    updatedAt,
  };
  const directory = ensureProjectStateDirectory(root);
  ensureProjectStateIgnored(root);
  writeProjectJson(root, "status.json", payload);
  const label = stateLabels[state] || state;
  const routeText = payload.route || "未计算";
  const nextText = safeNext.length ? safeNext.join(" -> ") : "无";
  const messageText = payload.message ? `\n原因：${payload.message}` : "";
  atomicWrite(
    join(directory, "status.md"),
    `# Echo Semantic\n\n状态：${label}\n宿主：${host}\n事件：${event}\n路由：${routeText}\n下一步：${nextText}\n更新时间：${updatedAt}${messageText}\n`,
  );
  return payload;
}

export function readProjectJson(root, name) {
  const target = projectStatePath(root, name);
  if (!existsSync(target)) return null;
  try {
    const value = JSON.parse(readFileSync(target, "utf8"));
    return value && typeof value === "object" && !Array.isArray(value)
      ? value
      : null;
  } catch {
    return null;
  }
}
