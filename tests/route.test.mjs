import assert from "node:assert/strict";
import {
  appendFileSync,
  mkdirSync,
  mkdtempSync,
  realpathSync,
  writeFileSync,
} from "node:fs";
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
    probe: () => ({ detected: true, version: "test" }),
    observedEvent: "stop",
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
  assert.equal(
    value.lifecycle.startup.probe,
    value.detected ? "live-session-required" : "blocked",
  );
});

test("仅检测到宿主安装不能启用运行时门禁", () => {
  const root = mkdtempSync(resolve(tmpdir(), "echo-semantic-route-detected-"));
  git(root, "init", "-q");
  git(root, "config", "user.email", "test@example.com");
  git(root, "config", "user.name", "Test");
  mkdirSync(resolve(root, ".echo-semantic"), { recursive: true });
  writeFileSync(
    resolve(root, ".echo-semantic/baseline.md"),
    "baseline\n",
    "utf8",
  );
  git(root, "add", ".echo-semantic/baseline.md");
  git(root, "-c", "commit.gpgsign=false", "commit", "-qm", "baseline");
  writeFileSync(resolve(root, "README.md"), "change\n", "utf8");

  const installedOnly = computeRoute(root, "codex", "session-start", {
    probe: () => ({ detected: true, version: "one" }),
    observedEvent: "session-start",
  });
  assert.equal(installedOnly.route, "bootstrap");
  assert.deepEqual(installedOnly.enforcement, {
    preEdit: false,
    stop: false,
    continuation: false,
  });

  const observedStop = computeRoute(root, "codex", "stop", {
    probe: () => ({ detected: true, version: "one" }),
    observedEvent: "stop",
  });
  assert.equal(observedStop.route, "fast");
  assert.equal(observedStop.enforcement.stop, true);

  const changedVersion = computeRoute(root, "codex", "session-start", {
    probe: () => ({ detected: true, version: "two" }),
    observedEvent: "session-start",
  });
  assert.equal(changedVersion.route, "bootstrap");
  assert.equal(changedVersion.enforcement.stop, false);
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
  mkdirSync(resolve(root, ".echo-semantic"), { recursive: true });
  writeFileSync(
    resolve(root, ".echo-semantic/baseline.md"),
    "baseline\n",
    "utf8",
  );
  git(root, "add", ".echo-semantic/baseline.md");
  git(root, "-c", "commit.gpgsign=false", "commit", "-qm", "baseline");
  writeFileSync(resolve(root, "README.md"), "docs\n", "utf8");
  assert.equal(route(root, "codex").route, "fast");
  writeFileSync(resolve(root, "Makefile"), "run:\n\ttrue\n", "utf8");
  assert.equal(route(root, "codex").route, "standard");
  mkdirSync(resolve(root, "contracts"));
  writeFileSync(resolve(root, "contracts/api.json"), "{}\n", "utf8");
  const strict = route(root, "codex");
  assert.equal(strict.route, "strict");
  assert.deepEqual(strict.skills, [
    "semantic-preflight",
    "semantic-diff",
    "semantic-audit",
    "semantic-consolidate",
    "semantic-repair",
    "semantic-verify",
  ]);
});

test("没有任务和工作树变化时进入仓库语义维护，明确任务时保留任务范围", () => {
  const root = mkdtempSync(
    resolve(tmpdir(), "echo-semantic-route-maintenance-"),
  );
  git(root, "init", "-q");
  git(root, "config", "user.email", "test@example.com");
  git(root, "config", "user.name", "Test");
  mkdirSync(resolve(root, ".echo-semantic"), { recursive: true });
  writeFileSync(
    resolve(root, ".echo-semantic/baseline.md"),
    "baseline\n",
    "utf8",
  );
  git(root, "add", ".echo-semantic/baseline.md");
  git(root, "-c", "commit.gpgsign=false", "commit", "-qm", "baseline");

  const maintenance = computeRoute(root, "codex", "manual", {
    probe: () => ({ detected: true, version: "test" }),
  });
  assert.equal(maintenance.route, "maintenance");
  assert.equal(maintenance.scope, "repository");
  assert.deepEqual(maintenance.skills, [
    "semantic-discover",
    "semantic-status",
    "semantic-consolidate",
    "semantic-audit",
    "semantic-verify",
  ]);

  const task = computeRoute(root, "codex", "manual", {
    probe: () => ({ detected: true, version: "test" }),
    scope: "task",
  });
  assert.equal(task.route, "bootstrap");
  assert.equal(task.scope, "task");
  assert.deepEqual(task.skills, ["semantic-preflight", "semantic-verify"]);
});

test("遗留预检没有匹配当前任务标识时仍进入仓库维护", () => {
  const root = mkdtempSync(
    resolve(tmpdir(), "echo-semantic-route-stale-task-preflight-"),
  );
  git(root, "init", "-q");
  git(root, "config", "user.email", "test@example.com");
  git(root, "config", "user.name", "Test");
  mkdirSync(resolve(root, ".echo-semantic"), { recursive: true });
  writeFileSync(resolve(root, ".echo-semantic/baseline.md"), "baseline\n");
  git(root, "add", ".");
  git(root, "-c", "commit.gpgsign=false", "commit", "-qm", "baseline");
  appendFileSync(resolve(root, ".git/info/exclude"), ".echo-semantic/*.json\n");
  const head = git(root, "rev-parse", "HEAD");
  writeFileSync(
    resolve(root, ".echo-semantic/preflight.json"),
    JSON.stringify({
      schemaVersion: 1,
      pluginId: "echo-semantic",
      scope: "task",
      repositoryRoot: realpathSync(root),
      baseRevision: head,
      taskId: "old-task",
      recordedAt: new Date().toISOString(),
      kind: "refactor",
      risk: "low",
      allowedPaths: ["src"],
      reuse: ["existing"],
      verifications: ["test"],
      basis: [],
      semanticRefs: [],
      repairRefs: [],
      deletePaths: [],
      signals: {
        publicApi: false,
        newStateAuthority: false,
        newProtocol: false,
        crossServiceMigration: false,
        architectureChange: false,
        unknownProductionCode: false,
      },
      boundaryDecision: { createsNew: false, reason: "existing boundary" },
      designAuthorities: [],
    }),
  );

  const repository = computeRoute(root, "codex", "manual", {
    probe: () => ({ detected: true, version: "test" }),
  });
  assert.equal(repository.route, "maintenance");
  assert.equal(repository.scope, "repository");

  const task = computeRoute(root, "codex", "manual", {
    probe: () => ({ detected: true, version: "test" }),
    taskId: "old-task",
  });
  assert.equal(task.scope, "task");
  assert.equal(task.route, "bootstrap");
});

test("纯测试和示例源码走 fast，治理控制面仍走 strict", () => {
  const root = mkdtempSync(resolve(tmpdir(), "echo-semantic-route-test-only-"));
  git(root, "init", "-q");
  git(root, "config", "user.email", "test@example.com");
  git(root, "config", "user.name", "Test");
  mkdirSync(resolve(root, ".echo-semantic"), { recursive: true });
  writeFileSync(
    resolve(root, ".echo-semantic/baseline.md"),
    "baseline\n",
    "utf8",
  );
  git(root, "add", ".echo-semantic/baseline.md");
  git(root, "-c", "commit.gpgsign=false", "commit", "-qm", "baseline");
  mkdirSync(resolve(root, "tests"));
  mkdirSync(resolve(root, "examples"));
  writeFileSync(
    resolve(root, "tests/example.test.mjs"),
    "export {};\n",
    "utf8",
  );
  writeFileSync(resolve(root, "examples/example.py"), "value = 1\n", "utf8");
  assert.equal(route(root, "codex").route, "fast");

  mkdirSync(resolve(root, "runtime"));
  writeFileSync(
    resolve(root, "runtime/route.test.mjs"),
    "export {};\n",
    "utf8",
  );
  assert.equal(route(root, "codex").route, "strict");
});

test("未知宿主或缺少停止 Hook 时采用保守 bootstrap", () => {
  const root = mkdtempSync(
    resolve(tmpdir(), "echo-semantic-route-conservative-"),
  );
  git(root, "init", "-q");
  git(root, "config", "user.email", "test@example.com");
  git(root, "config", "user.name", "Test");
  mkdirSync(resolve(root, ".echo-semantic"), { recursive: true });
  writeFileSync(
    resolve(root, ".echo-semantic/baseline.md"),
    "baseline\n",
    "utf8",
  );
  git(root, "add", ".echo-semantic/baseline.md");
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
  mkdirSync(resolve(root, ".echo-semantic"), { recursive: true });
  writeFileSync(
    resolve(root, ".echo-semantic/baseline.md"),
    "baseline\n",
    "utf8",
  );
  git(root, "add", ".echo-semantic/baseline.md");
  git(root, "-c", "commit.gpgsign=false", "commit", "-qm", "baseline");
  writeFileSync(resolve(root, "Makefile"), "run:\n\ttrue\n", "utf8");
  const state = computeRoute(root, "codex", "manual", {
    probe: () => ({ detected: false }),
  });
  assert.equal(state.route, "bootstrap");
  assert.equal(state.enforcement.stop, false);
  assert.equal(state.runtimeProbe.detected, false);
});

test(".echo-semantic 长期权威变化进入 strict", () => {
  const root = mkdtempSync(resolve(tmpdir(), "echo-semantic-route-authority-"));
  git(root, "init", "-q");
  git(root, "config", "user.email", "test@example.com");
  git(root, "config", "user.name", "Test");
  mkdirSync(resolve(root, ".echo-semantic/maps"), { recursive: true });
  writeFileSync(
    resolve(root, ".echo-semantic/baseline.md"),
    "baseline\n",
    "utf8",
  );
  git(root, "add", ".echo-semantic/baseline.md");
  git(root, "-c", "commit.gpgsign=false", "commit", "-qm", "baseline");
  writeFileSync(
    resolve(root, ".echo-semantic/maps/map.example.md"),
    "map\n",
    "utf8",
  );
  const state = route(root, "codex");
  assert.equal(state.route, "strict");
  assert.deepEqual(state.highRiskPaths, [
    {
      path: ".echo-semantic/maps/map.example.md",
      reason: "governance-control",
    },
  ]);
});
