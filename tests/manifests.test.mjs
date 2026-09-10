import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

const root = resolve(import.meta.dirname, "..");

function readJson(path) {
  return JSON.parse(readFileSync(resolve(root, path), "utf8"));
}

test("三个宿主清单共享插件名称和版本", () => {
  const packageJson = readJson("package.json");
  assert.equal(packageJson.name, "echo-semantic");
  assert.ok(packageJson.files.includes(".echo-semantic/baseline.md"));
  for (const path of [
    ".codex-plugin/plugin.json",
    ".cursor-plugin/plugin.json",
    ".claude-plugin/plugin.json",
  ]) {
    const manifest = readJson(path);
    assert.equal(manifest.name, packageJson.name);
    assert.equal(manifest.version, packageJson.version);
    assert.equal(manifest.description, "Coding Agent 语义预检与持续质量门禁");
  }
  assert.equal(
    readJson(".codex-plugin/plugin.json").interface.displayName,
    "Echo Semantic",
  );
  assert.equal(
    readJson(".cursor-plugin/plugin.json").displayName,
    "Echo Semantic",
  );
  assert.equal(
    readJson(".agents/plugins/marketplace.json").interface.displayName,
    "Echo Semantic",
  );
});

test("Codex 清单保留可读中文而不是 Unicode 转义", () => {
  const source = readFileSync(
    resolve(root, ".codex-plugin/plugin.json"),
    "utf8",
  );
  assert.match(source, /语义预检与持续质量门禁/);
  assert.doesNotMatch(source, /\\u[0-9a-f]{4}/i);
});

test("Codex 与 Claude Code 共用原生 Hook，Cursor 保留专用事件名", () => {
  const native = readJson("hooks/hooks.json");
  const cursor = readJson("hooks/hooks-cursor.json");
  assert.ok(native.hooks.SessionStart);
  assert.ok(native.hooks.PreCompact);
  assert.ok(native.hooks.PreToolUse);
  assert.ok(native.hooks.Stop);
  assert.ok(cursor.hooks.sessionStart);
  assert.ok(cursor.hooks.preCompact);
  assert.ok(cursor.hooks.preToolUse);
});

test("GitHub Action 将高风险基准声明为必填", () => {
  const action = readFileSync(resolve(root, "action.yml"), "utf8");
  assert.match(action, /base:\n\s+description:[^\n]+\n\s+required: true/);
  assert.match(action, /必须提供有效 base revision/);
});
