#!/usr/bin/env node

import { existsSync, readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { loadCapabilities } from "../runtime/capabilities/load.mjs";

const root = resolve(import.meta.dirname, "..");
const expectedId = "echo-semantic";
const expectedSkills = new Set([
  "semantic-preflight",
  "semantic-status",
  "semantic-discover",
  "semantic-diff",
  "semantic-audit",
  "semantic-decide",
  "semantic-verify",
  "semantic-contract",
]);

function fail(message) {
  process.stderr.write(`插件校验失败：${message}\n`);
  process.exitCode = 1;
}

function json(relativePath) {
  const path = resolve(root, relativePath);
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    fail(`${relativePath} 无法解析：${error.message}`);
    return {};
  }
}

const packageJson = json("package.json");
const manifests = [
  ".codex-plugin/plugin.json",
  ".cursor-plugin/plugin.json",
  ".claude-plugin/plugin.json",
].map((path) => [path, json(path)]);

for (const [path, manifest] of manifests) {
  if (manifest.name !== expectedId) fail(`${path} name 不一致`);
  if (manifest.version !== packageJson.version) fail(`${path} version 不一致`);
}
if (manifests[0][1].hooks !== undefined) {
  fail("Codex plugin.json 不得声明当前第三方 schema 不接受的 hooks 字段");
}

const skillRoot = resolve(root, "skills");
const actualSkills = new Set(
  readdirSync(skillRoot, { withFileTypes: true })
    .filter(
      (entry) =>
        entry.isDirectory() &&
        existsSync(resolve(skillRoot, entry.name, "SKILL.md")),
    )
    .map((entry) => entry.name),
);
if (
  actualSkills.size !== expectedSkills.size ||
  [...expectedSkills].some((name) => !actualSkills.has(name))
) {
  fail(`Skill 集合不一致：${[...actualSkills].sort().join(", ")}`);
}

for (const name of actualSkills) {
  const text = readFileSync(resolve(skillRoot, name, "SKILL.md"), "utf8");
  const frontmatter = text.match(/^---\n([\s\S]*?)\n---\n/);
  if (!frontmatter) {
    fail(`${name}/SKILL.md 缺少 frontmatter`);
    continue;
  }
  const declared = frontmatter[1].match(/^name:\s*([^\n]+)$/m)?.[1]?.trim();
  if (declared !== name) fail(`${name}/SKILL.md 的 name 不一致`);
  if (!/^description:/m.test(frontmatter[1]))
    fail(`${name}/SKILL.md 缺少 description`);
}

const cursor = json(".cursor-plugin/plugin.json");
if (
  !Array.isArray(cursor.skills) ||
  cursor.skills.length !== expectedSkills.size
) {
  fail("Cursor manifest 的 skills 数量不一致");
} else {
  for (const skillPath of cursor.skills) {
    if (!existsSync(resolve(root, skillPath, "SKILL.md"))) {
      fail(`Cursor manifest 引用不存在 Skill：${skillPath}`);
    }
  }
}

for (const path of [
  "hooks/hooks-claude.json",
  "hooks/hooks-codex.json",
  "hooks/hooks-cursor.json",
  ".agents/plugins/marketplace.json",
  ".claude-plugin/marketplace.json",
]) {
  json(path);
}

for (const host of ["codex", "cursor", "claude-code"]) {
  try {
    loadCapabilities(host);
  } catch (error) {
    fail(`宿主能力文档无效：${host}：${error.message}`);
  }
}

const forbidden = /\b(?:echo-agent-cli|TaskRun|PlanTask|SubagentRun|EKO)\b/;
for (const name of actualSkills) {
  const text = readFileSync(resolve(skillRoot, name, "SKILL.md"), "utf8");
  if (forbidden.test(text)) fail(`${name}/SKILL.md 含项目专属术语`);
}

if (!process.exitCode) process.stdout.write("插件静态合同校验通过\n");
