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
  for (const path of [
    ".codex-plugin/plugin.json",
    ".cursor-plugin/plugin.json",
    ".claude-plugin/plugin.json",
  ]) {
    const manifest = readJson(path);
    assert.equal(manifest.name, packageJson.name);
    assert.equal(manifest.version, packageJson.version);
  }
});

test("三个宿主使用各自 Hook 事件命名", () => {
  const claude = readJson("hooks/hooks-claude.json");
  const codex = readJson("hooks/hooks-codex.json");
  const cursor = readJson("hooks/hooks-cursor.json");
  assert.ok(claude.hooks.SessionStart);
  assert.ok(claude.hooks.PreCompact);
  assert.ok(codex.hooks.PreCompact);
  assert.ok(codex.hooks.Stop);
  assert.ok(cursor.hooks.sessionStart);
  assert.ok(cursor.hooks.preCompact);
  assert.ok(cursor.hooks.preToolUse);
});

test("GitHub Action 将高风险基准声明为必填", () => {
  const action = readFileSync(resolve(root, "action.yml"), "utf8");
  assert.match(action, /base:\n\s+description:[^\n]+\n\s+required: true/);
  assert.match(action, /必须提供有效 base revision/);
});
