#!/usr/bin/env node

import { fileURLToPath } from "node:url";

const events = new Set(["session-start", "pre-compact", "pre-edit", "stop"]);

export async function run(event) {
  if (!events.has(event)) throw new Error(`unsupported hook event: ${event}`);
  // Codex 同时提供 Claude 兼容别名；PLUGIN_ROOT 才是它的规范入口。
  const host = process.env.PLUGIN_ROOT
    ? "codex"
    : process.env.CLAUDE_PLUGIN_ROOT
      ? "claude-code"
      : "codex";
  process.argv = [
    process.execPath,
    fileURLToPath(import.meta.url),
    host,
    event,
  ];
  const entry = await import("./entry.mjs");
  entry.main();
}
