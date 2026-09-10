import assert from "node:assert/strict";
import {
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

import {
  projectStatePath,
  writeProjectJson,
  writeVisibleStatus,
} from "../runtime/project-state.mjs";

function git(cwd, ...args) {
  const result = spawnSync("git", ["-C", cwd, ...args], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim();
}

test("项目状态统一写入 .echo-semantic 并自动从 Git 状态排除", () => {
  const repository = mkdtempSync(
    resolve(tmpdir(), "echo-semantic-project-state-"),
  );
  git(repository, "init", "-q");
  writeProjectJson(repository, "preflight.json", { schemaVersion: 1 });
  writeProjectJson(repository, "route.json", { schemaVersion: 1 });
  writeProjectJson(repository, "continuation.json", { schemaVersion: 1 });
  const visible = writeVisibleStatus(repository, {
    state: "ready",
    event: "session-start",
    host: "codex",
    route: "strict",
    next: ["semantic-audit", "semantic-verify"],
    message: "路由已计算",
  });

  for (const name of [
    "status.md",
    "status.json",
    "preflight.json",
    "route.json",
    "continuation.json",
  ]) {
    assert.equal(existsSync(projectStatePath(repository, name)), true);
  }
  assert.equal(visible.state, "ready");
  assert.match(
    readFileSync(projectStatePath(repository, "status.md"), "utf8"),
    /状态：已就绪/,
  );
  assert.match(
    readFileSync(projectStatePath(repository, "status.md"), "utf8"),
    /semantic-audit -> semantic-verify/,
  );
  assert.equal(git(repository, "status", "--short"), "");
  const exclude = resolve(
    repository,
    git(repository, "rev-parse", "--git-path", "info/exclude"),
  );
  const excluded = readFileSync(exclude, "utf8");
  for (const name of [
    "status.md",
    "status.json",
    "preflight.json",
    "route.json",
    "continuation.json",
  ]) {
    assert.match(
      excluded,
      new RegExp(`^/\\.echo-semantic/${name.replace(".", "\\.")}$`, "m"),
    );
  }
});

test("首次使用时迁移旧 Git 私有状态且不覆盖新目录文件", () => {
  const repository = mkdtempSync(
    resolve(tmpdir(), "echo-semantic-state-migration-"),
  );
  git(repository, "init", "-q");
  const legacy = resolve(
    repository,
    git(repository, "rev-parse", "--git-path", "echo-semantic"),
  );
  mkdirSync(legacy, { recursive: true });
  writeFileSync(resolve(legacy, "preflight.json"), '{"legacy":true}\n', "utf8");
  mkdirSync(resolve(repository, ".echo-semantic"), { recursive: true });
  writeFileSync(
    resolve(repository, ".echo-semantic/route.json"),
    '{"current":true}\n',
    "utf8",
  );

  writeVisibleStatus(repository, {
    state: "working",
    event: "session-start",
    host: "codex",
  });

  assert.equal(
    existsSync(resolve(repository, ".echo-semantic/preflight.json")),
    true,
  );
  assert.equal(
    JSON.parse(
      readFileSync(
        resolve(repository, ".echo-semantic/preflight.json"),
        "utf8",
      ),
    ).legacy,
    true,
  );
  assert.equal(
    JSON.parse(
      readFileSync(resolve(repository, ".echo-semantic/route.json"), "utf8"),
    ).current,
    true,
  );
  assert.equal(existsSync(resolve(legacy, "preflight.json")), false);
});
