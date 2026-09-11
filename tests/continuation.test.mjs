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
  mkdirSync(resolve(repository, ".echo-semantic"));
  writeFileSync(
    resolve(repository, ".echo-semantic/baseline.md"),
    "baseline\n",
    "utf8",
  );
  git(repository, "add", ".echo-semantic/baseline.md");
  git(repository, "-c", "commit.gpgsign=false", "commit", "-qm", "baseline");
  const head = git(repository, "rev-parse", "HEAD");
  const statePath = resolve(repository, ".echo-semantic/preflight.json");
  mkdirSync(resolve(statePath, ".."), { recursive: true });
  writeFileSync(
    statePath,
    JSON.stringify({
      schemaVersion: 1,
      pluginId: "echo-semantic",
      scope: "task",
      repositoryRoot: realpathSync(repository),
      baseRevision: head,
      recordedAt: new Date().toISOString(),
      taskId: "task-continuation-test",
      kind: "bugfix",
      risk: "low",
      allowedPaths: ["src"],
      reuse: ["复用现有能力"],
      verifications: ["定向测试"],
      basis: [],
      semanticRefs: [],
      signals: {
        publicApi: false,
        newStateAuthority: false,
        newProtocol: false,
        crossServiceMigration: false,
        architectureChange: false,
        unknownProductionCode: false,
      },
      boundaryDecision: { createsNew: false, reason: "复用现有边界" },
      designAuthorities: [],
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
  const visible = JSON.parse(
    readFileSync(resolve(repository, ".echo-semantic/status.json"), "utf8"),
  );
  assert.equal(visible.state, "ready");
  assert.equal(visible.event, "pre-compact");
  const continuationPath = resolve(
    repository,
    ".echo-semantic/continuation.json",
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
    resolve(repository, ".echo-semantic/baseline.md"),
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

test("PreCompact 缺少有效预检时写入 stale 终态", () => {
  const repository = mkdtempSync(
    resolve(tmpdir(), "echo-semantic-continuation-stale-"),
  );
  git(repository, "init", "-q");
  const result = spawnSync("node", [hook, "codex", "pre-compact"], {
    cwd: repository,
    input: JSON.stringify({ cwd: repository }),
    encoding: "utf8",
  });
  assert.equal(result.status, 0, result.stderr);
  const visible = JSON.parse(
    readFileSync(resolve(repository, ".echo-semantic/status.json"), "utf8"),
  );
  assert.equal(visible.state, "stale");
  assert.deepEqual(visible.next, ["semantic-preflight"]);
});
