#!/usr/bin/env node

import { createHash } from "node:crypto";
import {
  closeSync,
  existsSync,
  lstatSync,
  openSync,
  realpathSync,
  readFileSync,
  readSync,
  unlinkSync,
} from "node:fs";
import { isAbsolute, relative, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { projectStatePath, writeProjectJson } from "./project-state.mjs";

export const CONTINUATION_SCHEMA_VERSION = 1;
const PLUGIN_ID = "echo-semantic";
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_PACKET_BYTES = 32 * 1024;
const TASK_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const ROUTES = new Set(["bootstrap", "fast", "standard", "strict", "idle"]);
const FIELDS = new Set([
  "schemaVersion",
  "pluginId",
  "repositoryRoot",
  "taskId",
  "branch",
  "route",
  "stage",
  "next",
  "resolved",
  "open",
  "evidenceRefs",
  "evidenceHashes",
  "updatedAt",
]);

function git(root, args) {
  const result = spawnSync("git", ["-C", root, ...args], {
    encoding: "utf8",
    timeout: 10_000,
  });
  return result.status === 0 ? result.stdout.trim() : null;
}

function currentBranch(root) {
  return git(root, ["branch", "--show-current"]) || null;
}

function canonicalRoot(root) {
  try {
    return realpathSync(resolve(root));
  } catch {
    return resolve(root);
  }
}

export function continuationPath(root) {
  return projectStatePath(root, "continuation.json");
}

function evidenceTarget(root, reference) {
  if (
    typeof reference !== "string" ||
    !reference ||
    isAbsolute(reference) ||
    reference.includes("\0")
  )
    return null;
  const candidate = resolve(root, reference);
  const relativePath = relative(resolve(root), candidate);
  if (
    !relativePath ||
    relativePath === ".." ||
    relativePath.startsWith("../") ||
    isAbsolute(relativePath)
  )
    return null;
  return candidate;
}

function hashFile(root, reference) {
  const candidate = evidenceTarget(root, reference);
  if (!candidate || !existsSync(candidate)) return null;
  let target;
  try {
    target = resolve(candidate);
    const relativePath = relative(resolve(root), target);
    if (
      !relativePath ||
      relativePath === ".." ||
      relativePath.startsWith("../") ||
      isAbsolute(relativePath)
    )
      return null;
    if (!lstatSync(target).isFile()) return null;
  } catch {
    return null;
  }
  const hash = createHash("sha256");
  let handle;
  try {
    handle = openSync(target, "r");
    const buffer = Buffer.alloc(64 * 1024);
    let bytesRead = 0;
    do {
      bytesRead = readSync(handle, buffer, 0, buffer.length, null);
      if (bytesRead > 0) hash.update(buffer.subarray(0, bytesRead));
    } while (bytesRead > 0);
  } catch {
    return null;
  } finally {
    if (handle !== undefined) closeSync(handle);
  }
  return hash.digest("hex");
}

function validTimestamp(value) {
  return (
    typeof value === "string" &&
    Number.isFinite(Date.parse(value)) &&
    /^\d{4}-\d{2}-\d{2}T/.test(value)
  );
}

function validList(value, maxItems, maxLength) {
  return (
    Array.isArray(value) &&
    value.length <= maxItems &&
    value.every(
      (item) =>
        typeof item === "string" && item.trim() && item.length <= maxLength,
    )
  );
}

function validatePacket(root, packet, allowManagedFields) {
  const errors = [];
  if (!packet || typeof packet !== "object" || Array.isArray(packet)) {
    return ["任务继续包必须是对象"];
  }
  for (const key of Object.keys(packet)) {
    if (!FIELDS.has(key)) errors.push(`未知任务继续包字段：${key}`);
  }
  if (packet.schemaVersion !== CONTINUATION_SCHEMA_VERSION)
    errors.push("任务继续包版本无效");
  if (packet.pluginId !== PLUGIN_ID) errors.push("任务继续包插件标识无效");
  if (packet.repositoryRoot !== resolve(root))
    errors.push("任务继续包仓库不匹配");
  if (typeof packet.taskId !== "string" || !TASK_ID_PATTERN.test(packet.taskId))
    errors.push("任务继续包 taskId 无效");
  if (packet.branch !== null && typeof packet.branch !== "string")
    errors.push("任务继续包 branch 无效");
  if (typeof packet.route !== "string" || !ROUTES.has(packet.route))
    errors.push("任务继续包 route 无效");
  for (const field of ["stage", "next"]) {
    if (
      typeof packet[field] !== "string" ||
      !packet[field].trim() ||
      packet[field].length > 512
    )
      errors.push(`任务继续包 ${field} 无效`);
  }
  for (const field of ["resolved", "open", "evidenceRefs"]) {
    if (!validList(packet[field], 32, 1024))
      errors.push(`任务继续包 ${field} 无效`);
  }
  if (Array.isArray(packet.evidenceRefs) && packet.evidenceRefs.length === 0)
    errors.push("任务继续包至少需要一项证据");
  if (packet.evidenceRefs.some((reference) => !evidenceTarget(root, reference)))
    errors.push("任务继续包证据必须位于仓库内");
  if (allowManagedFields) {
    if (
      !Array.isArray(packet.evidenceHashes) ||
      packet.evidenceHashes.length !== packet.evidenceRefs.length ||
      packet.evidenceHashes.some(
        (hash) => typeof hash !== "string" || !/^[a-f0-9]{64}$/.test(hash),
      )
    )
      errors.push("任务继续包证据摘要无效");
    if (!validTimestamp(packet.updatedAt)) errors.push("任务继续包时间无效");
  } else if (
    packet.evidenceHashes !== undefined ||
    packet.updatedAt !== undefined
  ) {
    errors.push("任务继续包内部字段不可由调用方设置");
  }
  if (Buffer.byteLength(JSON.stringify(packet), "utf8") > MAX_PACKET_BYTES)
    errors.push("任务继续包超过大小限制");
  return errors;
}

function evidenceMatches(root, packet) {
  return packet.evidenceRefs.every(
    (reference, index) =>
      hashFile(root, reference) === packet.evidenceHashes[index],
  );
}

function fresh(packet) {
  const age = Date.now() - Date.parse(packet.updatedAt);
  return age >= 0 && age <= MAX_AGE_MS;
}

export function isContinuationTaskId(value) {
  return typeof value === "string" && TASK_ID_PATTERN.test(value);
}

export function taskIdFromInput(input) {
  for (const value of [
    input?.task_id,
    input?.taskId,
    input?.session_id,
    input?.sessionId,
    input?.conversation_id,
    input?.conversationId,
    input?.thread_id,
    input?.threadId,
  ]) {
    if (isContinuationTaskId(value)) return value;
  }
  return null;
}

export function writeContinuation(root, packet) {
  const repositoryRoot = canonicalRoot(root);
  const normalized = {
    ...packet,
    pluginId: PLUGIN_ID,
    repositoryRoot,
  };
  const errors = validatePacket(repositoryRoot, normalized, false);
  if (normalized.branch !== currentBranch(repositoryRoot))
    errors.push("任务继续包 branch 与当前分支不匹配");
  const hashes = Array.isArray(normalized.evidenceRefs)
    ? normalized.evidenceRefs.map((reference) =>
        hashFile(repositoryRoot, reference),
      )
    : [];
  if (hashes.some((hash) => hash === null))
    errors.push("任务继续包证据文件不存在或不可读");
  if (errors.length) throw new Error(errors.join("；"));
  const destination = continuationPath(repositoryRoot);
  if (!destination) throw new Error("无法定位 Git 私有继续包路径");
  const stored = {
    ...normalized,
    evidenceHashes: hashes,
    updatedAt: new Date().toISOString(),
  };
  const storedErrors = validatePacket(repositoryRoot, stored, true);
  if (storedErrors.length) throw new Error(storedErrors.join("；"));
  writeProjectJson(repositoryRoot, "continuation.json", stored);
  return destination;
}

export function readContinuation(root, taskId) {
  const repositoryRoot = canonicalRoot(root);
  if (!isContinuationTaskId(taskId)) return null;
  const source = continuationPath(repositoryRoot);
  if (!source || !existsSync(source)) return null;
  let packet;
  try {
    packet = JSON.parse(readFileSync(source, "utf8"));
  } catch {
    return null;
  }
  if (
    validatePacket(repositoryRoot, packet, true).length > 0 ||
    packet.taskId !== taskId ||
    packet.branch !== currentBranch(repositoryRoot) ||
    !fresh(packet) ||
    !evidenceMatches(repositoryRoot, packet)
  )
    return null;
  return packet;
}

export function clearContinuation(root) {
  const source = continuationPath(resolve(root));
  if (!source || !existsSync(source)) return;
  try {
    unlinkSync(source);
  } catch {
    // 继续包是可丢弃恢复线索，清理失败不应阻断宿主生命周期。
  }
}

export function formatContinuation(packet) {
  if (!packet) return "";
  const resolved = packet.resolved.length ? packet.resolved.join("、") : "无";
  const open = packet.open.length ? packet.open.join("、") : "无";
  return [
    "## 语义治理任务继续包",
    `当前阶段：${packet.stage}`,
    `当前路由：${packet.route}`,
    `已完成：${resolved}`,
    `未决 Frontier：${open}`,
    `下一入口：${packet.next}`,
  ].join("\n");
}

export function checkpointFromPreflight(root, preflight, route) {
  if (!preflight || !isContinuationTaskId(preflight.taskId)) return null;
  const evidenceRefs = existsSync(resolve(root, ".echo-semantic/baseline.md"))
    ? [".echo-semantic/baseline.md"]
    : [];
  const objectDirectories = [
    "maps",
    "behaviors",
    "rules",
    "evidence",
    "findings",
    "audits",
    "discovery",
  ];
  for (const reference of Array.isArray(preflight.semanticRefs)
    ? preflight.semanticRefs
    : []) {
    if (typeof reference !== "string") return null;
    const candidate = objectDirectories
      .map((directory) => `.echo-semantic/${directory}/${reference}.md`)
      .find((value) => existsSync(resolve(root, value)));
    if (!candidate) return null;
    evidenceRefs.push(candidate);
  }
  for (const authority of Array.isArray(preflight.designAuthorities)
    ? preflight.designAuthorities
    : []) {
    if (
      typeof authority?.path !== "string" ||
      !existsSync(resolve(root, authority.path))
    )
      return null;
    evidenceRefs.push(authority.path);
  }
  const uniqueEvidenceRefs = [...new Set(evidenceRefs)].slice(0, 32);
  if (!uniqueEvidenceRefs.length) return null;
  return writeContinuation(resolve(root), {
    schemaVersion: CONTINUATION_SCHEMA_VERSION,
    taskId: preflight.taskId,
    branch: currentBranch(resolve(root)),
    route: ROUTES.has(route?.route) ? route.route : "standard",
    stage: "semantic-preflight",
    next: route?.skills?.[0] || "semantic-verify",
    resolved: ["semantic-preflight"],
    open: Array.isArray(route?.skills)
      ? route.skills.filter((skill) => skill !== "semantic-preflight")
      : ["semantic-verify"],
    evidenceRefs: uniqueEvidenceRefs,
  });
}
