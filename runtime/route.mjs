#!/usr/bin/env node

import { createHash } from "node:crypto";
import { existsSync, lstatSync, readFileSync, readlinkSync } from "node:fs";
import { dirname, extname, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { loadCapabilities } from "./capabilities/load.mjs";
import { probeHost } from "./capabilities/probe.mjs";
import {
  projectStatePath,
  writeProjectJson,
  writeVisibleStatus,
} from "./project-state.mjs";

const pluginId = "echo-semantic";
const pluginRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const pluginVersion = JSON.parse(
  readFileSync(resolve(pluginRoot, "package.json"), "utf8"),
).version;
const hookEvidenceLifetimeMs = 24 * 60 * 60 * 1000;
const hookEvents = {
  "session-start": "sessionStart",
  "pre-edit": "preEdit",
  "pre-compact": "preCompact",
  stop: "stop",
};
const preflightKinds = new Set([
  "bugfix",
  "feature",
  "refactor",
  "contract",
  "style",
]);
const preflightRisks = new Set(["low", "medium", "high"]);
const preflightSignals = new Set([
  "publicApi",
  "newStateAuthority",
  "newProtocol",
  "crossServiceMigration",
  "architectureChange",
  "unknownProductionCode",
]);
const taskIdPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;

function git(root, args) {
  const result = spawnSync("git", ["-C", root, ...args], {
    encoding: "utf8",
    timeout: 10_000,
  });
  return result.status === 0 ? result.stdout.trim() : null;
}

function gitStatus(root) {
  const result = spawnSync(
    "git",
    ["-C", root, "status", "--porcelain=v1", "--untracked-files=all"],
    { encoding: "utf8", timeout: 10_000 },
  );
  return result.status === 0 ? result.stdout : null;
}

function worktreeFingerprint(root, status, paths) {
  if (status === null) return null;
  const digest = createHash("sha256");
  digest.update(status);
  for (const relative of paths) {
    digest.update(`\n${relative}\0`);
    const path = resolve(root, relative);
    try {
      const stat = lstatSync(path);
      if (stat.isSymbolicLink()) {
        digest.update(`symlink:${readlinkSync(path)}`);
      } else if (stat.isFile()) {
        digest.update("file:");
        digest.update(readFileSync(path));
      } else {
        digest.update("other");
      }
    } catch {
      digest.update("missing");
    }
  }
  return digest.digest("hex");
}

function statePath(root) {
  return projectStatePath(root, "route.json");
}

function changedPaths(root, suppliedStatus = undefined) {
  const status =
    suppliedStatus === undefined ? gitStatus(root) : suppliedStatus;
  if (!status) return [];
  return status
    .split("\n")
    .filter(Boolean)
    .map((line) => line.slice(3).replace(/^\"|\"$/g, ""));
}

function classify(paths) {
  const high = [];
  const protocol =
    /(^|\/)(contract|contracts|schema|schemas|protocol|protocols)(\/|$)|openapi|\.proto$|\.graphql$/i;
  const migration = /(^|\/)(migration|migrations)(\/|$)/i;
  const source = new Set([
    ".rs",
    ".py",
    ".go",
    ".java",
    ".ts",
    ".tsx",
    ".js",
    ".mjs",
    ".c",
    ".cpp",
    ".cs",
    ".swift",
    ".dart",
    ".scala",
    ".zig",
    ".ex",
    ".exs",
  ]);
  const control =
    /^(?:hooks|runtime|scripts|bin|\.echo-semantic)(?:\/|$)|^\.github\/workflows(?:\/|$)|^action\.ya?ml$/i;
  const lowRiskSource = /^(?:tests|test|examples)(?:\/|$)/i;
  for (const path of paths) {
    const suffix = extname(path).toLowerCase();
    if (control.test(path)) high.push({ path, reason: "governance-control" });
    else if (lowRiskSource.test(path)) continue;
    else if (protocol.test(path)) high.push({ path, reason: "protocol" });
    else if (migration.test(path)) high.push({ path, reason: "migration" });
    else if (source.has(suffix)) {
      high.push({
        path,
        reason: /(^|\/)(api|public|src|lib)(\/|$)/i.test(path)
          ? "production-source"
          : "unknown-production-source",
      });
    }
  }
  return high;
}

function isFastPath(path) {
  const suffix = extname(path).toLowerCase();
  return (
    /^(?:docs|tests|test|examples|\.github)\//i.test(path) ||
    [".md", ".json", ".yaml", ".yml", ".toml", ".txt"].includes(suffix)
  );
}

function hasCurrentTaskPreflight(root, headRevision, taskId) {
  try {
    const value = JSON.parse(
      readFileSync(resolve(root, ".echo-semantic/preflight.json"), "utf8"),
    );
    const recordedAt = Date.parse(value?.recordedAt);
    const age = Date.now() - recordedAt;
    const stringList = (items, required = false) =>
      Array.isArray(items) &&
      (!required || items.length > 0) &&
      items.every((item) => typeof item === "string" && item.trim());
    const relativePaths = (items, required = false) =>
      stringList(items, required) &&
      items.every(
        (item) =>
          item !== "." &&
          !item.startsWith("/") &&
          !item.split(/[\\/]/).includes(".."),
      );
    const signals = value?.signals;
    const boundary = value?.boundaryDecision;
    const taskIdentityMatches =
      typeof taskId === "string" && taskId.trim() && value?.taskId === taskId;
    return (
      value?.schemaVersion === 1 &&
      value?.pluginId === pluginId &&
      value?.repositoryRoot === root &&
      value?.baseRevision === headRevision &&
      taskIdentityMatches &&
      taskIdPattern.test(String(value?.taskId ?? "")) &&
      preflightKinds.has(value?.kind) &&
      preflightRisks.has(value?.risk) &&
      Number.isFinite(recordedAt) &&
      age >= 0 &&
      age <= 24 * 60 * 60 * 1000 &&
      relativePaths(value?.allowedPaths, true) &&
      stringList(value?.reuse, true) &&
      stringList(value?.verifications, true) &&
      stringList(value?.basis) &&
      stringList(value?.semanticRefs) &&
      stringList(value?.repairRefs) &&
      relativePaths(value?.deletePaths) &&
      signals &&
      typeof signals === "object" &&
      !Array.isArray(signals) &&
      Object.keys(signals).length === preflightSignals.size &&
      [...preflightSignals].every(
        (name) => typeof signals[name] === "boolean",
      ) &&
      boundary &&
      typeof boundary === "object" &&
      typeof boundary.createsNew === "boolean" &&
      typeof boundary.reason === "string" &&
      boundary.reason.trim() &&
      Array.isArray(value?.designAuthorities)
    );
  } catch {
    return false;
  }
}

function writeState(root, value) {
  writeProjectJson(root, "route.json", value);
}

function currentHookEvidence(previous, host, runtimeProbe, now) {
  if (
    previous?.schemaVersion !== 1 ||
    previous?.pluginId !== pluginId ||
    previous?.host !== host ||
    !previous?.hookEvidence ||
    typeof previous.hookEvidence !== "object" ||
    Array.isArray(previous.hookEvidence)
  )
    return {};
  const hostVersion = runtimeProbe?.version ?? null;
  const evidence = {};
  for (const [name, value] of Object.entries(previous.hookEvidence)) {
    const observedAt = Date.parse(value?.observedAt);
    const age = now.getTime() - observedAt;
    if (
      Object.values(hookEvents).includes(name) &&
      value?.pluginVersion === pluginVersion &&
      (value?.hostVersion ?? null) === hostVersion &&
      Number.isFinite(observedAt) &&
      age >= 0 &&
      age <= hookEvidenceLifetimeMs
    ) {
      evidence[name] = value;
    }
  }
  return evidence;
}

export function computeRoute(
  root,
  host = "unknown",
  event = "manual",
  {
    probe = probeHost,
    observedEvent = null,
    now = () => new Date(),
    scope = "auto",
    taskId = null,
  } = {},
) {
  root = resolve(git(root, ["rev-parse", "--show-toplevel"]) || root);
  const previous = readRoute(root);
  const capabilities = loadCapabilities(host);
  let runtimeProbe = null;
  try {
    runtimeProbe = probe(host);
  } catch (error) {
    runtimeProbe = { detected: false, error: error.message };
  }
  const baseline = existsSync(resolve(root, ".echo-semantic/baseline.md"));
  const headRevision = git(root, ["rev-parse", "HEAD"]);
  const taskScoped =
    scope === "task" ||
    (scope === "auto" && hasCurrentTaskPreflight(root, headRevision, taskId));
  const worktreeStatus = gitStatus(root);
  const paths = changedPaths(root, worktreeStatus);
  const high = classify(paths);
  const currentTime = now();
  const hookEvidence = currentHookEvidence(
    previous,
    host,
    runtimeProbe,
    currentTime,
  );
  const observedKey = hookEvents[observedEvent];
  if (observedKey) {
    hookEvidence[observedKey] = {
      observedAt: currentTime.toISOString(),
      pluginVersion,
      hostVersion: runtimeProbe?.version ?? null,
    };
  }
  const stopVerified = Boolean(hookEvidence.stop);
  const conservative =
    capabilities.host === "unknown" ||
    capabilities.hooks.stop !== true ||
    capabilities.skills === "unsupported" ||
    runtimeProbe?.detected !== true ||
    !stopVerified;
  let route = "idle";
  let skills = [];
  if (!baseline) {
    route = "bootstrap";
    skills = ["semantic-discover", "semantic-verify"];
  } else if (paths.length === 0 && !taskScoped) {
    route = "maintenance";
    skills = [
      "semantic-discover",
      "semantic-status",
      "semantic-consolidate",
      "semantic-audit",
      "semantic-verify",
    ];
  } else if (conservative) {
    route = "bootstrap";
    skills = ["semantic-preflight", "semantic-verify"];
  } else if (paths.length > 0 && high.length > 0) {
    route = "strict";
    skills = [
      "semantic-preflight",
      "semantic-diff",
      "semantic-audit",
      "semantic-consolidate",
      "semantic-repair",
      "semantic-verify",
    ];
  } else if (paths.length > 0) {
    if (paths.every(isFastPath)) {
      route = "fast";
      skills = ["semantic-preflight", "semantic-verify"];
    } else {
      route = "standard";
      skills = ["semantic-preflight", "semantic-diff", "semantic-verify"];
    }
  } else {
    skills = ["semantic-preflight"];
  }
  const state = {
    schemaVersion: 1,
    pluginId,
    repositoryRoot: root,
    headRevision,
    worktreeDigest:
      worktreeStatus === null
        ? null
        : createHash("sha256").update(worktreeStatus).digest("hex"),
    worktreeFingerprint: worktreeFingerprint(root, worktreeStatus, paths),
    host,
    scope: taskScoped ? "task" : "repository",
    event,
    route,
    skills,
    changedPaths: paths,
    highRiskPaths: high,
    hookEvidence,
    verificationReceipt: previous?.verificationReceipt ?? null,
    enforcement: {
      preEdit:
        Boolean(hookEvidence.preEdit) && capabilities.hooks.preToolUse === true,
      stop: stopVerified && capabilities.hooks.stop === true,
      continuation:
        Boolean(hookEvidence.preCompact) &&
        capabilities.lifecycle.compact !== "unsupported",
    },
    capabilities,
    runtimeProbe,
    updatedAt: currentTime.toISOString(),
  };
  writeState(root, state);
  writeVisibleStatus(root, {
    state: "ready",
    event,
    host,
    route,
    next: skills,
    message:
      runtimeProbe?.detected !== true
        ? "宿主安装状态未确认，采用保守路径"
        : stopVerified
          ? "路由已计算，停止 Hook 具有新鲜事件证据"
          : "停止 Hook 尚无新鲜事件证据，采用保守路径",
  });
  return state;
}

export function readRoute(root) {
  const path = statePath(root);
  if (!path || !existsSync(path)) return null;
  try {
    const value = JSON.parse(readFileSync(path, "utf8"));
    return value?.schemaVersion === 1 ? value : null;
  } catch {
    return null;
  }
}

function main() {
  const args = process.argv.slice(2);
  const rootIndex = args.indexOf("--root");
  const hostIndex = args.indexOf("--host");
  const eventIndex = args.indexOf("--event");
  const root = resolve(
    rootIndex >= 0 ? args[rootIndex + 1] || process.cwd() : process.cwd(),
  );
  const host = hostIndex >= 0 ? args[hostIndex + 1] || "unknown" : "unknown";
  const event = eventIndex >= 0 ? args[eventIndex + 1] || "manual" : "manual";
  const result = computeRoute(root, host, event);
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
