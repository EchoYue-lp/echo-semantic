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

test("PreCompact 保存继续包，resume 只恢复仍可信的任务", () => {
  const repository = mkdtempSync(
    resolve(tmpdir(), "echo-semantic-continuation-"),
  );
  git(repository, "init", "-q");
  git(repository, "config", "user.email", "test@example.com");
  git(repository, "config", "user.name", "Test");
  mkdirSync(resolve(repository, "semantic"));
  writeFileSync(
    resolve(repository, "semantic/baseline.md"),
    "baseline\n",
    "utf8",
  );
  git(repository, "add", "semantic/baseline.md");
  git(repository, "-c", "commit.gpgsign=false", "commit", "-qm", "baseline");
  const head = git(repository, "rev-parse", "HEAD");
  const statePath = resolve(
    repository,
    git(repository, "rev-parse", "--git-path", "echo-semantic/preflight.json"),
  );
  mkdirSync(resolve(statePath, ".."), { recursive: true });
  writeFileSync(
    statePath,
    JSON.stringify({
      schemaVersion: 1,
      repositoryRoot: realpathSync(repository),
      baseRevision: head,
      recordedAt: new Date().toISOString(),
      taskId: "task-continuation-test",
      allowedPaths: ["src"],
    }),
    "utf8",
  );

  const checkpoint = spawnSync("node", [hook, "codex", "pre-compact"], {
    cwd: repository,
    input: JSON.stringify({
      cwd: repository,
      task_id: "task-continuation-test",
    }),
    encoding: "utf8",
  });
  assert.equal(checkpoint.status, 0, checkpoint.stderr);
  const continuationPath = resolve(
    repository,
    git(
      repository,
      "rev-parse",
      "--git-path",
      "echo-semantic/continuation.json",
    ),
  );
  assert.equal(existsSync(continuationPath), true);
  assert.equal(
    JSON.parse(readFileSync(continuationPath, "utf8")).taskId,
    "task-continuation-test",
  );

  const resumed = spawnSync("node", [hook, "codex", "session-start"], {
    cwd: repository,
    input: JSON.stringify({
      cwd: repository,
      source: "resume",
      task_id: "task-continuation-test",
    }),
    encoding: "utf8",
  });
  assert.equal(resumed.status, 0, resumed.stderr);
  assert.match(
    JSON.parse(resumed.stdout).hookSpecificOutput.additionalContext,
    /任务继续包/,
  );

  writeFileSync(
    resolve(repository, "semantic/baseline.md"),
    "changed\n",
    "utf8",
  );
  const stale = spawnSync("node", [hook, "codex", "session-start"], {
    cwd: repository,
    input: JSON.stringify({
      cwd: repository,
      source: "resume",
      task_id: "task-continuation-test",
    }),
    encoding: "utf8",
  });
  assert.equal(stale.status, 0, stale.stderr);
  assert.doesNotMatch(
    JSON.parse(stale.stdout).hookSpecificOutput.additionalContext,
    /任务继续包/,
  );
});
