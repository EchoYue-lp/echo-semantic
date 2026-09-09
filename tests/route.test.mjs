import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

import { computeRoute } from "../runtime/route.mjs";
import {
  loadCapabilities,
  validateCapabilities,
} from "../runtime/capabilities/load.mjs";
import { probeHost } from "../runtime/capabilities/probe.mjs";

function git(cwd, ...args) {
  const result = spawnSync("git", ["-C", cwd, ...args], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim();
}

function route(root, host, event) {
  return computeRoute(root, host, event, {
    probe: () => ({ detected: true }),
  });
}

test("宿主能力矩阵可解析并拒绝未知字段", () => {
  for (const host of ["codex", "cursor", "claude-code"]) {
    const value = loadCapabilities(host);
    assert.equal(value.host, host);
    assert.deepEqual(
      validateCapabilities({ ...value, unknown: true }).length > 0,
      true,
    );
  }
});

test("宿主探测输出安装状态、版本和生命周期", () => {
  const value = probeHost("codex");
  assert.equal(value.host, "codex");
  assert.equal(typeof value.detected, "boolean");
  assert.deepEqual(Object.keys(value.lifecycle).sort(), [
    "compact",
    "resume",
    "startup",
  ]);
});

test("路由器按基线和差异选择 bootstrap、fast、standard、strict", () => {
  const root = mkdtempSync(resolve(tmpdir(), "echo-semantic-route-"));
  git(root, "init", "-q");
  git(root, "config", "user.email", "test@example.com");
  git(root, "config", "user.name", "Test");
  writeFileSync(resolve(root, "src.txt"), "source\n", "utf8");
  git(root, "add", "src.txt");
  git(root, "-c", "commit.gpgsign=false", "commit", "-qm", "source");
  assert.equal(route(root, "codex").route, "bootstrap");
  mkdirSync(resolve(root, "semantic"));
  writeFileSync(resolve(root, "semantic/baseline.md"), "baseline\n", "utf8");
  git(root, "add", "semantic/baseline.md");
  git(root, "-c", "commit.gpgsign=false", "commit", "-qm", "baseline");
  writeFileSync(resolve(root, "README.md"), "docs\n", "utf8");
  assert.equal(route(root, "codex").route, "fast");
  writeFileSync(resolve(root, "Makefile"), "run:\n\ttrue\n", "utf8");
  assert.equal(route(root, "codex").route, "standard");
  mkdirSync(resolve(root, "contracts"));
  writeFileSync(resolve(root, "contracts/api.json"), "{}\n", "utf8");
  assert.equal(route(root, "codex").route, "strict");
});

test("未知宿主或缺少停止 Hook 时采用保守 bootstrap", () => {
  const root = mkdtempSync(
    resolve(tmpdir(), "echo-semantic-route-conservative-"),
  );
  git(root, "init", "-q");
  git(root, "config", "user.email", "test@example.com");
  git(root, "config", "user.name", "Test");
  mkdirSync(resolve(root, "semantic"));
  writeFileSync(resolve(root, "semantic/baseline.md"), "baseline\n", "utf8");
  git(root, "add", "semantic/baseline.md");
  git(root, "-c", "commit.gpgsign=false", "commit", "-qm", "baseline");
  writeFileSync(resolve(root, "runtime.rs"), "fn run() {}\n", "utf8");
  const state = route(root, "unknown");
  assert.equal(state.route, "bootstrap");
  assert.equal(state.enforcement.stop, false);
  assert.equal(state.enforcement.continuation, false);
});

test("运行时宿主探测失败时不沿用静态能力路由", () => {
  const root = mkdtempSync(
    resolve(tmpdir(), "echo-semantic-route-unverified-"),
  );
  git(root, "init", "-q");
  git(root, "config", "user.email", "test@example.com");
  git(root, "config", "user.name", "Test");
  mkdirSync(resolve(root, "semantic"));
  writeFileSync(resolve(root, "semantic/baseline.md"), "baseline\n", "utf8");
  git(root, "add", "semantic/baseline.md");
  git(root, "-c", "commit.gpgsign=false", "commit", "-qm", "baseline");
  writeFileSync(resolve(root, "Makefile"), "run:\n\ttrue\n", "utf8");
  const state = computeRoute(root, "codex", "manual", {
    probe: () => ({ detected: false }),
  });
  assert.equal(state.route, "bootstrap");
  assert.equal(state.enforcement.stop, false);
  assert.equal(state.runtimeProbe.detected, false);
});
