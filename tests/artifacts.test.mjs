import assert from "node:assert/strict";
import {
  copyFileSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { prepareTaskArtifactDirectory } from "../runtime/project-state.mjs";

function git(root, ...args) {
  const result = spawnSync("git", ["-C", root, ...args], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim();
}

function repository(t) {
  const root = mkdtempSync(resolve(tmpdir(), "echo-artifacts-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  git(root, "init", "-q");
  return root;
}

test("任务产物准备可重复且保留文件，产物从Git排除", (t) => {
  const root = repository(t);
  const target = prepareTaskArtifactDirectory(root, "task-1");
  writeFileSync(resolve(target, "results.json"), "{}\n");
  assert.equal(prepareTaskArtifactDirectory(root, "task-1"), target);
  assert.equal(readFileSync(resolve(target, "results.json"), "utf8"), "{}\n");
  assert.equal(git(root, "status", "--short"), "");
  for (const id of [
    "../outside",
    "a/b",
    "a\\b",
    ".",
    "NUL",
    "task.",
    "a:b",
    "",
  ]) {
    assert.throws(() => prepareTaskArtifactDirectory(root, id), /任务标识/);
  }
});

test("已跟踪产物和优先级更高的取消忽略规则阻止准备", (t) => {
  const root = repository(t);
  const target = prepareTaskArtifactDirectory(root, "task");
  writeFileSync(resolve(target, "data.json"), "{}");
  git(root, "add", "-f", ".echo-semantic/local/task/data.json");
  assert.throws(() => prepareTaskArtifactDirectory(root, "other"), /Git 跟踪/);
  git(root, "rm", "--cached", "-f", ".echo-semantic/local/task/data.json");
  writeFileSync(
    resolve(root, ".gitignore"),
    "!.echo-semantic/local/\n!.echo-semantic/local/**\n",
  );
  assert.throws(() => prepareTaskArtifactDirectory(root, "other"), /未生效/);
});

test("probe被忽略也不能放过选择性取消忽略的日志", (t) => {
  const root = repository(t);
  writeFileSync(
    resolve(root, ".gitignore"),
    "!.echo-semantic/local/\n.echo-semantic/local/**\n!.echo-semantic/local/task/\n.echo-semantic/local/task/**\n!.echo-semantic/local/task/*.log\n",
  );
  assert.throws(() => prepareTaskArtifactDirectory(root, "task"), /未生效/);
  rmSync(resolve(root, ".gitignore"));
  const target = prepareTaskArtifactDirectory(root, "task");
  writeFileSync(resolve(target, ".gitignore"), "!*.log\n");
  writeFileSync(resolve(target, "test.log"), "test");
  assert.equal(prepareTaskArtifactDirectory(root, "task"), target);
  assert.equal(git(root, "status", "--short"), "");
});

test("大小写别名的已跟踪local仍阻止目录准备", (t) => {
  const root = repository(t);
  mkdirSync(resolve(root, ".ECHO-SEMANTIC/LOCAL/task"), { recursive: true });
  writeFileSync(resolve(root, ".ECHO-SEMANTIC/LOCAL/task/result.json"), "{}");
  git(root, "add", "-f", ".ECHO-SEMANTIC/LOCAL/task/result.json");
  assert.throws(() => prepareTaskArtifactDirectory(root, "task"), /Git 跟踪/);
});

test(
  "拒绝本地产物根、任务目录和悬空符号链接",
  { skip: process.platform === "win32" },
  (t) => {
    const root = repository(t);
    mkdirSync(resolve(root, ".echo-semantic"));
    const local = resolve(root, ".echo-semantic/local");
    symlinkSync(resolve(root, "missing"), local);
    assert.throws(() => prepareTaskArtifactDirectory(root, "task"), /普通目录/);
    rmSync(local);
    mkdirSync(local);
    symlinkSync(resolve(root, "missing"), resolve(local, "task"));
    assert.throws(() => prepareTaskArtifactDirectory(root, "task"), /普通目录/);
    rmSync(resolve(local, "task"));
    writeFileSync(resolve(local, "task"), "保留原文件");
    assert.throws(() => prepareTaskArtifactDirectory(root, "task"), /普通目录/);
  },
);

test("无法更新忽略文件时失败，CLI输出统一目录", (t) => {
  const root = repository(t);
  const entry = resolve("scripts/artifacts.mjs");
  const result = spawnSync(
    process.execPath,
    [entry, "prepare", "--root", root, "--task-id", "task"],
    { encoding: "utf8" },
  );
  assert.equal(result.status, 0, result.stderr);
  assert.equal(
    result.stdout.trim(),
    resolve(root, ".echo-semantic/local/task"),
  );
  const exclude = resolve(
    root,
    git(root, "rev-parse", "--git-path", "info/exclude"),
  );
  rmSync(exclude);
  mkdirSync(exclude);
  assert.throws(
    () => prepareTaskArtifactDirectory(root, "other"),
    /无法把本地产物/,
  );
});

test("分发白名单排除local，误扩大时分发校验拒绝泄漏", (t) => {
  const root = repository(t);
  const packageFiles = JSON.parse(
    readFileSync(resolve("package.json"), "utf8"),
  ).files;
  writeFileSync(
    resolve(root, "package.json"),
    JSON.stringify({
      name: "echo-artifact-fixture",
      version: "1.0.0",
      files: packageFiles,
    }),
  );
  copyFileSync(resolve(".npmignore"), resolve(root, ".npmignore"));
  mkdirSync(resolve(root, ".echo-semantic/evidence"), { recursive: true });
  writeFileSync(
    resolve(root, ".echo-semantic/evidence/evidence.fixture.md"),
    "保留长期材料",
  );
  const target = prepareTaskArtifactDirectory(root, "task");
  writeFileSync(resolve(target, "results.json"), "不应分发");
  const result = spawnSync(
    process.platform === "win32" ? "npm.cmd" : "npm",
    ["pack", "--dry-run", "--json"],
    { cwd: root, encoding: "utf8", timeout: 30000 },
  );
  assert.equal(result.status, 0, result.stderr);
  const files = JSON.parse(result.stdout)[0].files.map((entry) => entry.path);
  assert.ok(files.includes(".echo-semantic/evidence/evidence.fixture.md"));
  assert.ok(!files.some((path) => path.startsWith(".echo-semantic/local/")));
  writeFileSync(
    resolve(root, "package.json"),
    JSON.stringify({
      name: "echo-artifact-fixture",
      version: "1.0.0",
      files: [".echo-semantic/"],
    }),
  );
  mkdirSync(resolve(root, "scripts"));
  copyFileSync(
    resolve("scripts/validate-package.mjs"),
    resolve(root, "scripts/validate-package.mjs"),
  );
  const rejected = spawnSync(
    process.execPath,
    [resolve(root, "scripts/validate-package.mjs")],
    { cwd: root, encoding: "utf8", timeout: 30000 },
  );
  assert.equal(rejected.status, 1);
  assert.match(rejected.stderr, /不得包含本地产物.*local\/task\/results.json/);
});
