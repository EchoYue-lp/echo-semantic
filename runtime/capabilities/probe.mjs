#!/usr/bin/env node

import { existsSync } from "node:fs";
import { delimiter, join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { loadCapabilities } from "./load.mjs";

export const HOSTS = ["codex", "cursor", "claude-code"];

function commandPath(name) {
  const extensions =
    process.platform === "win32" ? [".exe", ".cmd", ".bat", ""] : [""];
  for (const directory of (process.env.PATH || "").split(delimiter)) {
    if (!directory) continue;
    for (const extension of extensions) {
      const candidate = join(directory, `${name}${extension}`);
      if (existsSync(candidate)) return candidate;
    }
  }
  return null;
}

function cursorInstalled() {
  return [
    commandPath("cursor"),
    join(process.env.HOME || process.env.USERPROFILE || "", ".cursor"),
    "/Applications/Cursor.app",
    process.env.LOCALAPPDATA
      ? join(process.env.LOCALAPPDATA, "Programs", "cursor")
      : null,
    "/usr/share/cursor",
  ].some((candidate) => Boolean(candidate) && existsSync(candidate));
}

export function probeHost(host) {
  const normalized = String(host || "").toLowerCase();
  if (!HOSTS.includes(normalized)) throw new Error(`未知宿主：${host}`);
  const command =
    normalized === "codex"
      ? commandPath("codex")
      : normalized === "claude-code"
        ? commandPath("claude")
        : commandPath("cursor");
  const detected =
    normalized === "cursor" ? cursorInstalled() : Boolean(command);
  let version = null;
  if (command) {
    const result = spawnSync(command, ["--version"], {
      encoding: "utf8",
      timeout: 10_000,
    });
    if (result.status === 0)
      version =
        String(result.stdout || result.stderr || "")
          .trim()
          .split("\n")[0] || null;
  }
  const capabilities = loadCapabilities(normalized);
  return {
    schemaVersion: 1,
    host: normalized,
    detected,
    version,
    install: capabilities.install,
    skills: capabilities.skills,
    agents: capabilities.agents,
    hooks: capabilities.hooks,
    lifecycle: Object.fromEntries(
      Object.entries(capabilities.lifecycle).map(([name, support]) => [
        name,
        {
          support,
          probe:
            name === "startup"
              ? detected
                ? "passed"
                : "blocked"
              : "live-session-required",
        },
      ]),
    ),
  };
}

function main() {
  const hosts = process.argv.slice(2).length ? process.argv.slice(2) : HOSTS;
  if (hosts.some((host) => !HOSTS.includes(host))) {
    process.stderr.write(
      `用法：node runtime/capabilities/probe.mjs [${HOSTS.join("|")} ...]\n`,
    );
    return 2;
  }
  try {
    process.stdout.write(`${JSON.stringify(hosts.map(probeHost), null, 2)}\n`);
    return 0;
  } catch (error) {
    process.stderr.write(`宿主能力探测失败：${error.message}\n`);
    return 1;
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url))
  process.exitCode = main();
