import assert from "node:assert/strict";
import {
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

const root = resolve(import.meta.dirname, "..");
const hook = resolve(root, "hooks/entry.mjs");

function git(cwd, ...args) {
  const result = spawnSync("git", ["-C", cwd, ...args], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim();
}

test("SessionStart 为不同宿主输出对应上下文字段", () => {
  const cursor = spawnSync("node", [hook, "cursor", "session-start"], {
    input: "{}",
    encoding: "utf8",
  });
  const claude = spawnSync("node", [hook, "claude-code", "session-start"], {
    input: "{}",
    encoding: "utf8",
  });
  assert.equal(cursor.status, 0);
  assert.match(
    JSON.parse(cursor.stdout).additional_context,
    /semantic-preflight/,
  );
  assert.equal(claude.status, 0);
  assert.match(
    JSON.parse(claude.stdout).hookSpecificOutput.additionalContext,
    /semantic-verify/,
  );
});

test("已采用语义基线的项目阻断预检范围外编辑", () => {
  const repository = mkdtempSync(resolve(tmpdir(), "echo-semantic-hook-"));
  git(repository, "init", "-q");
  mkdirSync(resolve(repository, "semantic"));
  writeFileSync(
    resolve(repository, "semantic/baseline.md"),
    "baseline\n",
    "utf8",
  );
  git(repository, "config", "user.email", "test@example.com");
  git(repository, "config", "user.name", "Test");
  git(repository, "add", "semantic/baseline.md");
  git(repository, "-c", "commit.gpgsign=false", "commit", "-qm", "baseline");
  const head = git(repository, "rev-parse", "HEAD");
  const canonicalRepository = realpathSync(repository);
  const gitPath = git(
    repository,
    "rev-parse",
    "--git-path",
    "echo-coding-semantic-governance/preflight.json",
  );
  const state = resolve(repository, gitPath);
  mkdirSync(resolve(state, ".."), { recursive: true });
  writeFileSync(
    state,
    JSON.stringify({
      schemaVersion: 1,
      repositoryRoot: canonicalRepository,
      baseRevision: head,
      recordedAt: new Date().toISOString(),
      taskId: "task-scope-test",
      allowedPaths: ["src"],
    }),
    "utf8",
  );
  const allowed = spawnSync("node", [hook, "cursor", "pre-edit"], {
    cwd: repository,
    input: JSON.stringify({ cwd: repository, file_path: "src/lib.rs" }),
    encoding: "utf8",
  });
  assert.equal(allowed.status, 0);
  assert.deepEqual(JSON.parse(allowed.stdout), {});

  const denied = spawnSync("node", [hook, "cursor", "pre-edit"], {
    cwd: repository,
    input: JSON.stringify({ cwd: repository, file_path: "docs/readme.md" }),
    encoding: "utf8",
  });
  assert.equal(denied.status, 2);
  assert.match(denied.stderr, /超出/);
});

test("失败 Stop 不被去重且保留预检供连续重试", () => {
  const repository = mkdtempSync(resolve(tmpdir(), "echo-semantic-stop-"));
  git(repository, "init", "-q");
  git(repository, "config", "user.email", "test@example.com");
  git(repository, "config", "user.name", "Test");
  mkdirSync(resolve(repository, "semantic"));
  writeFileSync(
    resolve(repository, "semantic/baseline.md"),
    "无效基线\n",
    "utf8",
  );
  git(repository, "add", "semantic/baseline.md");
  git(repository, "-c", "commit.gpgsign=false", "commit", "-qm", "baseline");
  const head = git(repository, "rev-parse", "HEAD");
  const canonicalRepository = realpathSync(repository);
  writeFileSync(resolve(repository, "change.txt"), "change\n", "utf8");
  const gitPath = git(
    repository,
    "rev-parse",
    "--git-path",
    "echo-coding-semantic-governance/preflight.json",
  );
  const state = resolve(repository, gitPath);
  mkdirSync(resolve(state, ".."), { recursive: true });
  writeFileSync(
    state,
    JSON.stringify({
      schemaVersion: 1,
      repositoryRoot: canonicalRepository,
      baseRevision: head,
      recordedAt: new Date().toISOString(),
      taskId: "task-stop-test",
      allowedPaths: ["change.txt"],
    }),
    "utf8",
  );
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const result = spawnSync("node", [hook, "cursor", "stop"], {
      cwd: repository,
      input: JSON.stringify({ cwd: repository, stop_hook_active: true }),
      encoding: "utf8",
    });
    assert.equal(result.status, 2);
    assert.match(result.stderr, /语义完成门禁未通过/);
    assert.equal(readFileSync(state, "utf8").includes("task-stop-test"), true);
  }
});

test("明确的新会话清除上一任务的预检状态", () => {
  const repository = mkdtempSync(resolve(tmpdir(), "echo-semantic-session-"));
  git(repository, "init", "-q");
  const gitPath = git(
    repository,
    "rev-parse",
    "--git-path",
    "echo-coding-semantic-governance/preflight.json",
  );
  const state = resolve(repository, gitPath);
  mkdirSync(resolve(state, ".."), { recursive: true });
  writeFileSync(state, JSON.stringify({ schemaVersion: 1 }), "utf8");
  const result = spawnSync("node", [hook, "cursor", "session-start"], {
    cwd: repository,
    input: JSON.stringify({ cwd: repository, source: "startup" }),
    encoding: "utf8",
  });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(existsSync(state), false);
});

test("缺少宿主 source 时保守保留上一任务的预检状态", () => {
  const repository = mkdtempSync(
    resolve(tmpdir(), "echo-semantic-session-unknown-source-"),
  );
  git(repository, "init", "-q");
  const gitPath = git(
    repository,
    "rev-parse",
    "--git-path",
    "echo-coding-semantic-governance/preflight.json",
  );
  const state = resolve(repository, gitPath);
  mkdirSync(resolve(state, ".."), { recursive: true });
  writeFileSync(state, JSON.stringify({ schemaVersion: 1 }), "utf8");
  const result = spawnSync("node", [hook, "cursor", "session-start"], {
    cwd: repository,
    input: JSON.stringify({ cwd: repository }),
    encoding: "utf8",
  });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(existsSync(state), true);
});

test("resume 和 compact 不消费当前任务的预检状态", () => {
  const repository = mkdtempSync(resolve(tmpdir(), "echo-semantic-resume-"));
  git(repository, "init", "-q");
  const gitPath = git(
    repository,
    "rev-parse",
    "--git-path",
    "echo-coding-semantic-governance/preflight.json",
  );
  const state = resolve(repository, gitPath);
  mkdirSync(resolve(state, ".."), { recursive: true });
  writeFileSync(state, JSON.stringify({ schemaVersion: 1 }), "utf8");
  for (const source of ["resume", "compact"]) {
    const result = spawnSync("node", [hook, "cursor", "session-start"], {
      cwd: repository,
      input: JSON.stringify({ cwd: repository, source }),
      encoding: "utf8",
    });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(existsSync(state), true);
  }
});

test("验收探针只在显式环境变量下写入", () => {
  const directory = mkdtempSync(resolve(tmpdir(), "echo-semantic-probe-"));
  const probe = resolve(directory, "events.jsonl");
  const result = spawnSync("node", [hook, "codex", "session-start"], {
    input: "{}",
    encoding: "utf8",
    env: { ...process.env, ECHO_SEMANTIC_GOVERNANCE_PROBE_FILE: probe },
  });
  assert.equal(result.status, 0);
  assert.match(readFileSync(probe, "utf8"), /session-start/);
});
