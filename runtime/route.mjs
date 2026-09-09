#!/usr/bin/env node

import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { resolve, dirname, join, extname, isAbsolute } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { loadCapabilities } from "./capabilities/load.mjs";
import { probeHost } from "./capabilities/probe.mjs";

const pluginId = "echo-coding-semantic-governance";

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

function statePath(root) {
  const value = git(root, [
    "rev-parse",
    "--git-path",
    `${pluginId}/route.json`,
  ]);
  if (!value) return null;
  return isAbsolute(value) ? resolve(value) : resolve(root, value);
}

function changedPaths(root) {
  const status = gitStatus(root);
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
    /^(?:hooks|runtime|scripts|bin|semantic)(?:\/|$)|^\.github\/workflows(?:\/|$)|^action\.ya?ml$/i;
  for (const path of paths) {
    const suffix = extname(path).toLowerCase();
    if (control.test(path)) high.push({ path, reason: "governance-control" });
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

function writeState(path, value) {
  if (!path) return;
  mkdirSync(dirname(path), { recursive: true });
  const temporary = join(
    dirname(path),
    `.${pluginId}-route.${process.pid}.tmp`,
  );
  writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  renameSync(temporary, path);
}

export function computeRoute(
  root,
  host = "unknown",
  event = "manual",
  { probe = probeHost } = {},
) {
  const capabilities = loadCapabilities(host);
  let runtimeProbe = null;
  try {
    runtimeProbe = probe(host);
  } catch (error) {
    runtimeProbe = { detected: false, error: error.message };
  }
  const baseline = existsSync(resolve(root, "semantic/baseline.md"));
  const paths = changedPaths(root);
  const high = classify(paths);
  const conservative =
    capabilities.host === "unknown" ||
    capabilities.hooks.stop !== true ||
    capabilities.skills === "unsupported" ||
    runtimeProbe?.detected !== true;
  let route = "idle";
  let skills = [];
  if (!baseline) {
    route = "bootstrap";
    skills = ["semantic-discover", "semantic-verify"];
  } else if (conservative) {
    route = "bootstrap";
    skills = ["semantic-preflight", "semantic-verify"];
  } else if (paths.length > 0 && high.length > 0) {
    route = "strict";
    skills = [
      "semantic-preflight",
      "semantic-diff",
      "semantic-audit",
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
    host,
    event,
    route,
    skills,
    changedPaths: paths,
    highRiskPaths: high,
    enforcement: {
      preEdit:
        runtimeProbe?.detected === true &&
        capabilities.hooks.preToolUse === true,
      stop: runtimeProbe?.detected === true && capabilities.hooks.stop === true,
      continuation:
        runtimeProbe?.detected === true &&
        capabilities.lifecycle.compact !== "unsupported",
    },
    capabilities,
    runtimeProbe,
    updatedAt: new Date().toISOString(),
  };
  writeState(statePath(root), state);
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
