import assert from "node:assert/strict";
import {
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
  symlinkSync,
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
  const statusMarkdown = readFileSync(
    projectStatePath(repository, "status.md"),
    "utf8",
  );
  assert.match(statusMarkdown, /状态：已就绪/);
  assert.match(statusMarkdown, new RegExp(`状态版本：${visible.revision}`));
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

test("拒绝通过符号链接写出项目目录", () => {
  const repository = mkdtempSync(
    resolve(tmpdir(), "echo-semantic-state-symlink-"),
  );
  const outside = mkdtempSync(
    resolve(tmpdir(), "echo-semantic-state-outside-"),
  );
  git(repository, "init", "-q");
  const legacy = resolve(
    repository,
    git(repository, "rev-parse", "--git-path", "echo-semantic"),
  );
  mkdirSync(legacy, { recursive: true });
  writeFileSync(resolve(legacy, "preflight.json"), '{"legacy":true}\n', "utf8");
  symlinkSync(outside, resolve(repository, ".echo-semantic"), "dir");
  assert.throws(
    () => writeVisibleStatus(repository, { state: "working", host: "codex" }),
    /必须是普通目录/,
  );
  assert.equal(existsSync(resolve(outside, "status.json")), false);
  assert.equal(existsSync(resolve(outside, "preflight.json")), false);
  assert.equal(existsSync(resolve(legacy, "preflight.json")), true);
});

test("拒绝覆盖已被 Git 跟踪的运行态文件", () => {
  const repository = mkdtempSync(
    resolve(tmpdir(), "echo-semantic-state-tracked-"),
  );
  git(repository, "init", "-q");
  mkdirSync(resolve(repository, ".echo-semantic"));
  writeFileSync(
    resolve(repository, ".echo-semantic/status.json"),
    "{}\n",
    "utf8",
  );
  git(repository, "add", "-f", ".echo-semantic/status.json");
  assert.throws(
    () => writeVisibleStatus(repository, { state: "working", host: "codex" }),
    /不能被 Git 跟踪/,
  );
  assert.equal(
    readFileSync(resolve(repository, ".echo-semantic/status.json"), "utf8"),
    "{}\n",
  );
});

test("无法写入精确排除规则时拒绝创建运行态", () => {
  const repository = mkdtempSync(
    resolve(tmpdir(), "echo-semantic-state-exclude-"),
  );
  git(repository, "init", "-q");
  const exclude = resolve(
    repository,
    git(repository, "rev-parse", "--git-path", "info/exclude"),
  );
  rmSync(exclude, { force: true });
  mkdirSync(exclude);
  assert.throws(
    () => writeProjectJson(repository, "route.json", { schemaVersion: 1 }),
    /无法把 Echo Semantic 运行态加入/,
  );
  assert.equal(
    existsSync(resolve(repository, ".echo-semantic/route.json")),
    false,
  );
});
