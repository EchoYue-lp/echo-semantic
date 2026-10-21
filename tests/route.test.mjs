import assert from "node:assert/strict";
import fs from "node:fs";
import {
  appendFileSync,
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import childProcess from "node:child_process";
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

test("编辑观察不读取无关差异内容，完整观察仍绑定内容", () => {
  const root = mkdtempSync(resolve(tmpdir(), "echo-edit-observation-"));
  git(root, "init", "-q");
  git(root, "config", "user.email", "test@example.com");
  git(root, "config", "user.name", "Test");
  writeFileSync(resolve(root, "README.md"), "baseline\n");
  git(root, "add", ".");
  git(root, "-c", "commit.gpgsign=false", "commit", "-qm", "baseline");
  const asset = resolve(root, "large.bin");
  writeFileSync(asset, Buffer.alloc(1024 * 1024));
  const original = fs.openSync;
  let reads = 0;
  fs.openSync = (path, ...args) => {
    if (String(path) === realpathSync(asset)) reads += 1;
    return original(path, ...args);
  };
  syncBuiltinESMExports();
  try {
    const options = { probe: () => ({ detected: true, version: "test" }) };
    const edit = computeRoute(root, "codex", "pre-edit", {
      ...options,
      observation: "edit",
    });
    assert.equal(reads, 0);
    assert.equal(edit.observation, "edit");
    assert.equal(edit.worktreeFingerprint, null);
    assert.ok(edit.changedPaths.includes("large.bin"));
    const full = computeRoute(root, "codex", "stop", options);
    assert.equal(full.observation, "full");
    assert.equal(typeof full.worktreeFingerprint, "string");
    assert.ok(reads > 0);
  } finally {
    fs.openSync = original;
    syncBuiltinESMExports();
    rmSync(root, { recursive: true, force: true });
  }
});

test("宿主探测仅复用身份未变且未过期的观察，完整探测仍执行 CLI", () => {
  const root = mkdtempSync(resolve(tmpdir(), "echo-probe-cache-"));
  const command = resolve(
    root,
    process.platform === "win32" ? "codex.exe" : "codex",
  );
  writeFileSync(command, "first", { mode: 0o755 });
  const originalPath = process.env.PATH;
  const originalSpawn = childProcess.spawnSync;
  let calls = 0;
  childProcess.spawnSync = () => {
    calls += 1;
    return { status: 0, stdout: `version-${calls}\n`, stderr: "" };
  };
  process.env.PATH = root;
  syncBuiltinESMExports();
  try {
    const first = probeHost("codex", { now: 1000 });
    const reused = probeHost("codex", { previous: first, now: 2000 });
    assert.equal(calls, 1);
    assert.equal(reused.version, first.version);
    assert.equal(reused.versionObservedAt, first.versionObservedAt);
    probeHost("codex", { previous: reused, now: 400000 });
    assert.equal(calls, 2);
    writeFileSync(command, "changed executable");
    probeHost("codex", { previous: first, now: 2000 });
    assert.equal(calls, 3);
    probeHost("codex", { now: 2000 });
    assert.equal(calls, 4);
  } finally {
    process.env.PATH = originalPath;
    childProcess.spawnSync = originalSpawn;
    syncBuiltinESMExports();
    rmSync(root, { recursive: true, force: true });
  }
});

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
  assert.equal(route(root, "codex").route, "idle");
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
    "semantic-verify",
  ]);
});

test("没有任务和工作树变化时等待，明确任务时保留任务范围", () => {
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
  assert.equal(maintenance.route, "idle");
  assert.equal(maintenance.scope, "task");
  assert.equal(maintenance.verificationScope, "task");
  assert.deepEqual(maintenance.skills, []);

  const task = computeRoute(root, "codex", "manual", {
    probe: () => ({ detected: true, version: "test" }),
    scope: "task",
  });
  assert.equal(task.route, "bootstrap");
  assert.equal(task.scope, "task");
  assert.equal(task.verificationScope, "task");
  assert.deepEqual(task.skills, ["semantic-preflight", "semantic-verify"]);
  const repository = computeRoute(root, "codex", "manual", {
    probe: () => ({ detected: true, version: "test" }),
    scope: "repository",
  });
  assert.equal(repository.verificationScope, "repository");
});

test("遗留预检没有匹配当前任务标识时等待", () => {
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
      schemaVersion: 2,
      pluginId: "echo-semantic",
      scope: "task",
      repositoryRoot: realpathSync(root),
      baseRevision: head,
      taskId: "old-task",
      recordedAt: new Date().toISOString(),
      kind: "refactor",
      risk: "low",
      allowedPaths: ["src"],
      reuseCheck: {
        searchPaths: ["."],
        decision: "new",
        reason: "夹具已进行名称与行为检索",
        candidates: [],
        evidence: [],
      },
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
  assert.equal(repository.route, "idle");
  assert.equal(repository.scope, "task");

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

test("干净 submodule 不使工作树指纹退化为空", () => {
  const source = mkdtempSync(resolve(tmpdir(), "echo-semantic-sub-source-"));
  git(source, "init", "-q");
  git(source, "config", "user.email", "test@example.com");
  git(source, "config", "user.name", "Test");
  writeFileSync(resolve(source, "README.md"), "submodule\n", "utf8");
  git(source, "add", "README.md");
  git(source, "-c", "commit.gpgsign=false", "commit", "-qm", "initial");

  const root = mkdtempSync(resolve(tmpdir(), "echo-semantic-sub-parent-"));
  git(root, "init", "-q");
  git(root, "config", "user.email", "test@example.com");
  git(root, "config", "user.name", "Test");
  mkdirSync(resolve(root, ".echo-semantic"));
  writeFileSync(resolve(root, ".echo-semantic/baseline.md"), "baseline\n");
  git(
    root,
    "-c",
    "protocol.file.allow=always",
    "submodule",
    "add",
    "-q",
    source,
    "vendor/sub",
  );
  git(root, "add", ".");
  git(root, "-c", "commit.gpgsign=false", "commit", "-qm", "baseline");
  writeFileSync(resolve(root, "change.txt"), "change\n", "utf8");

  const state = route(root, "codex", "manual");
  assert.equal(typeof state.worktreeFingerprint, "string");
  assert.equal(state.worktreeFingerprint.length, 64);
  const subFile = resolve(root, "vendor/sub/README.md");
  writeFileSync(subFile, "dirty before\n");
  const dirty = route(root, "codex", "manual");
  const status = git(root, "status", "--porcelain=v1");
  writeFileSync(subFile, "dirty after\n");
  const changed = route(root, "codex", "manual");
  assert.equal(git(root, "status", "--porcelain=v1"), status);
  assert.equal(typeof dirty.worktreeFingerprint, "string");
  assert.equal(typeof changed.worktreeFingerprint, "string");
  assert.notEqual(dirty.worktreeFingerprint, changed.worktreeFingerprint);
  const originalSpawn = childProcess.spawnSync;
  let unavailable = 0;
  let pathFallback = 0;
  childProcess.spawnSync = (command, args, options) => {
    if (command === "python3") {
      unavailable += 1;
      return {
        status: null,
        stdout: Buffer.alloc(0),
        error: { code: "ENOENT" },
      };
    }
    if (
      command === "git" &&
      args[0] === "-C" &&
      args[1].endsWith("/vendor/sub")
    )
      pathFallback += 1;
    return originalSpawn(command, args, options);
  };
  syncBuiltinESMExports();
  try {
    const unsupported = route(root, "codex", "manual");
    assert.equal(unsupported.worktreeFingerprint, null);
    assert.ok(unavailable > 0);
    assert.equal(pathFallback, 0);
  } finally {
    childProcess.spawnSync = originalSpawn;
    syncBuiltinESMExports();
  }
});

function pathBoundaryFixture() {
  const root = mkdtempSync(resolve(tmpdir(), "echo-fingerprint-boundary-"));
  const outside = mkdtempSync(resolve(tmpdir(), "echo-fingerprint-outside-"));
  git(root, "init", "-q");
  git(root, "config", "user.email", "test@example.com");
  git(root, "config", "user.name", "Test");
  mkdirSync(resolve(root, ".echo-semantic"));
  mkdirSync(resolve(root, "dir"));
  writeFileSync(resolve(root, ".echo-semantic/baseline.md"), "baseline\n");
  writeFileSync(resolve(root, "dir/config.pem"), "inside\n");
  writeFileSync(resolve(outside, "config.pem"), "outside private content\n");
  git(root, "add", ".");
  git(root, "-c", "commit.gpgsign=false", "commit", "-qm", "baseline");
  return { root, outside };
}

for (const scenario of ["parent", "final-race"]) {
  test(`工作树指纹拒绝 ${scenario} symlink 仓外内容读取`, () => {
    const { root, outside } = pathBoundaryFixture();
    const target = resolve(root, "dir/config.pem");
    const canonicalTarget = realpathSync(target);
    const canonicalOutside = realpathSync(outside);
    if (scenario === "parent") {
      rmSync(resolve(root, "dir"), { recursive: true });
      symlinkSync(outside, resolve(root, "dir"), "dir");
    } else {
      writeFileSync(target, "changed inside\n");
    }
    const originalOpen = fs.openSync;
    const originalRead = fs.readSync;
    const outsideDescriptors = new Set();
    let outsideReads = 0;
    let swapped = false;
    fs.openSync = (path, flags, mode) => {
      const supplied = Buffer.isBuffer(path)
        ? path.toString("utf8")
        : String(path);
      if (
        scenario === "final-race" &&
        supplied === canonicalTarget &&
        !swapped
      ) {
        swapped = true;
        rmSync(target);
        symlinkSync(resolve(outside, "config.pem"), target);
      }
      const descriptor = originalOpen(path, flags, mode);
      try {
        if (realpathSync(path).startsWith(`${canonicalOutside}/`))
          outsideDescriptors.add(descriptor);
      } catch {}
      return descriptor;
    };
    fs.readSync = (descriptor, ...args) => {
      if (outsideDescriptors.has(descriptor)) outsideReads += 1;
      return originalRead(descriptor, ...args);
    };
    syncBuiltinESMExports();
    try {
      const state = route(root, "codex", "manual");
      assert.equal(state.worktreeFingerprint, null);
      assert.equal(outsideReads, 0);
    } finally {
      fs.openSync = originalOpen;
      fs.readSync = originalRead;
      syncBuiltinESMExports();
    }
  });
}

for (const window of ["before-stat", "git-use"]) {
  test(`子模块目录竞态不能重新授权仓外根 ${window}`, () => {
    const source = mkdtempSync(resolve(tmpdir(), "echo-sub-race-source-"));
    git(source, "init", "-q");
    git(source, "config", "user.email", "test@example.com");
    git(source, "config", "user.name", "Test");
    writeFileSync(resolve(source, "README.md"), "submodule\n");
    git(source, "add", ".");
    git(source, "-c", "commit.gpgsign=false", "commit", "-qm", "source");
    const { root, outside } = pathBoundaryFixture();
    git(
      root,
      "-c",
      "protocol.file.allow=always",
      "submodule",
      "add",
      "-q",
      source,
      "vendor/sub",
    );
    git(root, "-c", "commit.gpgsign=false", "commit", "-am", "submodule", "-q");
    writeFileSync(resolve(root, "vendor/sub/README.md"), "dirty submodule\n");
    const outsideSub = resolve(outside, "sub");
    mkdirSync(outsideSub);
    git(outsideSub, "init", "-q");
    git(outsideSub, "config", "user.email", "test@example.com");
    git(outsideSub, "config", "user.name", "Test");
    writeFileSync(resolve(outsideSub, "private.txt"), "private baseline\n");
    git(outsideSub, "add", ".");
    git(outsideSub, "-c", "commit.gpgsign=false", "commit", "-qm", "private");
    writeFileSync(resolve(outsideSub, "private.txt"), "private changed\n");
    const canonicalTarget = realpathSync(resolve(root, "vendor/sub"));
    const canonicalOutside = realpathSync(outside);
    const insideDirectory = fs.statSync(canonicalTarget);
    const outsideDirectory = fs.statSync(outsideSub);
    const originalStat = fs.lstatSync;
    const originalOpen = fs.openSync;
    const originalRead = fs.readSync;
    const originalSpawn = childProcess.spawnSync;
    const outsideDescriptors = new Set();
    let swapped = false;
    let outsideReads = 0;
    let outsideGit = 0;
    const replaceDirectory = () => {
      swapped = true;
      rmSync(resolve(root, "vendor"), { recursive: true });
      symlinkSync(outside, resolve(root, "vendor"), "dir");
    };
    fs.lstatSync = (path, options) => {
      const supplied = Buffer.isBuffer(path)
        ? path.toString("utf8")
        : String(path);
      if (window === "before-stat" && supplied === canonicalTarget && !swapped)
        replaceDirectory();
      return originalStat(path, options);
    };
    fs.openSync = (path, flags, mode) => {
      const descriptor = originalOpen(path, flags, mode);
      if (realpathSync(path).startsWith(`${canonicalOutside}/`))
        outsideDescriptors.add(descriptor);
      return descriptor;
    };
    fs.readSync = (descriptor, ...args) => {
      if (outsideDescriptors.has(descriptor)) outsideReads += 1;
      return originalRead(descriptor, ...args);
    };
    childProcess.spawnSync = (command, args, options) => {
      let inherited = null;
      if (command === "python3" && typeof options?.stdio?.[3] === "number")
        inherited = fs.fstatSync(options.stdio[3]);
      let nestedPath = false;
      if (command === "git" && args[0] === "-C") {
        try {
          nestedPath = realpathSync(args[1]) === canonicalTarget;
        } catch {}
      }
      if (
        window === "git-use" &&
        !swapped &&
        (nestedPath ||
          (inherited &&
            inherited.dev === insideDirectory.dev &&
            inherited.ino === insideDirectory.ino))
      )
        replaceDirectory();
      if (
        inherited &&
        inherited.dev === outsideDirectory.dev &&
        inherited.ino === outsideDirectory.ino
      )
        outsideGit += 1;
      if (command === "git" && args[0] === "-C") {
        try {
          if (realpathSync(args[1]).startsWith(`${canonicalOutside}/`))
            outsideGit += 1;
        } catch {}
      }
      return originalSpawn(command, args, options);
    };
    syncBuiltinESMExports();
    try {
      const state = route(root, "codex", "manual");
      assert.equal(state.worktreeFingerprint, null);
      assert.equal(outsideGit, 0);
      assert.equal(outsideReads, 0);
    } finally {
      fs.lstatSync = originalStat;
      fs.openSync = originalOpen;
      fs.readSync = originalRead;
      childProcess.spawnSync = originalSpawn;
      syncBuiltinESMExports();
    }
  });
}

test("路由预检读取拒绝仓外 symlink 即使没有 taskId", () => {
  const { root, outside } = pathBoundaryFixture();
  const privateFile = resolve(outside, "preflight.json");
  writeFileSync(privateFile, '{"private":true}\n');
  symlinkSync(privateFile, resolve(root, ".echo-semantic/preflight.json"));
  const canonicalPrivate = realpathSync(privateFile);
  const originalRead = fs.readFileSync;
  let outsideReads = 0;
  fs.readFileSync = (path, ...args) => {
    if (typeof path !== "number") {
      try {
        if (realpathSync(path) === canonicalPrivate) outsideReads += 1;
      } catch {}
    }
    return originalRead(path, ...args);
  };
  syncBuiltinESMExports();
  try {
    for (const taskId of [null, "task"]) {
      const state = computeRoute(root, "codex", "manual", {
        probe: () => ({ detected: true, version: "test" }),
        observedEvent: "stop",
        taskId,
      });
      assert.equal(state.scope, "task");
    }
    assert.equal(outsideReads, 0);
  } finally {
    fs.readFileSync = originalRead;
    syncBuiltinESMExports();
  }
});
