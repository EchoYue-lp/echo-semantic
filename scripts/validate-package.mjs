#!/usr/bin/env node

import { spawnSync } from "node:child_process";

const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";
const result = spawnSync(npmCommand, ["pack", "--dry-run", "--json"], {
  cwd: new URL("..", import.meta.url),
  encoding: "utf8",
});

function fail(message) {
  process.stderr.write(`分发包校验失败：${message}\n`);
  process.exitCode = 1;
}

if (result.error) {
  fail(`无法执行 npm pack：${result.error.message}`);
} else if (result.status !== 0) {
  fail(result.stderr.trim() || `npm pack 退出码为 ${result.status}`);
} else {
  let entries;
  try {
    entries = JSON.parse(result.stdout);
  } catch (error) {
    fail(`npm pack 输出不是有效 JSON：${error.message}`);
  }

  const files = new Set(
    entries?.at(0)?.files?.map((entry) => entry.path.replaceAll("\\", "/")) ??
      [],
  );
  const required = [
    ".echo-semantic/baseline.md",
    "hooks/hooks.json",
    "hooks/plugin-entry.mjs",
    "runtime/project-state.mjs",
    "scripts/preflight_contract.py",
    "skills/semantic-contract/references/semantic-artifact-contract.md",
    "skills/semantic-preflight/SKILL.md",
    "skills/semantic-preflight/references/routing-cases.md",
    "skills/semantic-preflight/workflows/architecture-convergence.md",
  ];
  const forbidden = [
    ".echo-semantic/status.md",
    ".echo-semantic/status.json",
    ".echo-semantic/preflight.json",
    ".echo-semantic/route.json",
    ".echo-semantic/continuation.json",
  ];

  for (const path of required) {
    if (!files.has(path)) fail(`缺少必需文件 ${path}`);
  }
  for (const path of forbidden) {
    if (files.has(path)) fail(`不得包含项目运行态文件 ${path}`);
  }
  for (const path of files) {
    if (path.includes("/__pycache__/") || path.endsWith(".pyc")) {
      fail(`不得包含 Python 缓存 ${path}`);
    }
  }
}

if (!process.exitCode) process.stdout.write("分发包内容校验通过\n");
