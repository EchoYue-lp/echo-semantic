import assert from "node:assert/strict";
import fs from "node:fs";
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import childProcess from "node:child_process";
import { syncBuiltinESMExports } from "node:module";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { observeWorktree } from "../runtime/route.mjs";
import {
  decideSessionChanges,
  loadSessionSnapshot,
  snapshotDisposition,
  refreshSessionChanges,
  writeSessionRecord,
  SESSION_SNAPSHOT_LIFETIME_MS,
} from "../runtime/session-state.mjs";

function git(root, ...args) {
  const value = spawnSync("git", ["-C", root, ...args], { encoding: "utf8" });
  assert.equal(value.status, 0, value.stderr);
  return value.stdout.trim();
}

function fixture() {
  const supplied = mkdtempSync(resolve(tmpdir(), "echo-disposition-"));
  git(supplied, "init", "-q");
  git(supplied, "config", "user.email", "test@example.com");
  git(supplied, "config", "user.name", "Test");
  mkdirSync(resolve(supplied, ".echo-semantic"));
  writeFileSync(resolve(supplied, ".echo-semantic/baseline.md"), "基线\n");
  writeFileSync(resolve(supplied, "tracked.txt"), "before\n");
  git(supplied, "add", ".");
  git(supplied, "-c", "commit.gpgsign=false", "commit", "-qm", "initial");
  writeFileSync(resolve(supplied, "tracked.txt"), "initial dirty\n");
  writeFileSync(resolve(supplied, "existing.txt"), "existing\n");
  const observation = observeWorktree(supplied);
  const root = observation.repositoryRoot;
  const record = {
    sessionId: "a",
    recordedAt: new Date().toISOString(),
    dispositionVersion: 1,
    headRevision: observation.headRevision,
    worktreeDigest: observation.worktreeFingerprint,
    initialChanges: {
      headRevision: observation.headRevision,
      fingerprint: observation.worktreeFingerprint,
      paths: observation.changes.map((change) => change.path),
      decision: null,
    },
  };
  writeSessionRecord(
    root,
    "session-snapshot.json",
    record,
    SESSION_SNAPSHOT_LIFETIME_MS,
  );
  const evaluate = () =>
    snapshotDisposition(
      root,
      loadSessionSnapshot(root, "a"),
      observeWorktree(root),
    );
  return { root, observation, evaluate };
}

test("保留策略保护初始内容，但本轮新路径或暂存不使无关裁决失效", () => {
  const { root, observation, evaluate } = fixture();
  assert.equal(evaluate().state, "pending");
  decideSessionChanges(
    root,
    "a",
    observation.worktreeFingerprint,
    "preserve",
    [],
    "用户明确保留已有差异",
  );
  assert.equal(evaluate().state, "preserve");
  writeFileSync(resolve(root, "new.txt"), "new work\n");
  git(root, "add", "new.txt");
  assert.equal(evaluate().state, "preserve");
  writeFileSync(resolve(root, "existing.txt"), "initial changed\n");
  assert.equal(evaluate().state, "pending");
  assert.equal(evaluate().changed, true);
});

test("接管只解除指定路径，接管内修改不自动重新询问", () => {
  const { root, observation, evaluate } = fixture();
  decideSessionChanges(
    root,
    "a",
    observation.worktreeFingerprint,
    "adopt",
    ["existing.txt"],
    "用户明确接管 existing.txt",
  );
  assert.equal(evaluate().state, "adopt");
  assert.deepEqual(evaluate().protectedPaths, ["tracked.txt"]);
  writeFileSync(resolve(root, "existing.txt"), "approved work\n");
  assert.equal(evaluate().state, "adopt");
  writeFileSync(resolve(root, "tracked.txt"), "unapproved\n");
  assert.equal(evaluate().state, "pending");
});

test("只读策略遇到新增修改失效，HEAD 变化重新待裁决", () => {
  const { root, observation, evaluate } = fixture();
  decideSessionChanges(
    root,
    "a",
    observation.worktreeFingerprint,
    "readonly",
    [],
    "用户明确只读",
  );
  writeFileSync(resolve(root, "new.txt"), "new\n");
  assert.equal(evaluate().changed, true);
  git(
    root,
    "-c",
    "commit.gpgsign=false",
    "commit",
    "--allow-empty",
    "-qm",
    "head changed",
  );
  assert.equal(evaluate().state, "pending");
});

test("旧观察、错误会话、未指定接管范围或空答复不能记录策略", () => {
  const { root, observation } = fixture();
  const fingerprint = observation.worktreeFingerprint;
  assert.throws(
    () => decideSessionChanges(root, "a", fingerprint, "adopt", [], "接管"),
    /指定已有差异路径/,
  );
  assert.throws(
    () => decideSessionChanges(root, "a", fingerprint, "preserve", [], ""),
    /明确答复/,
  );
  assert.throws(
    () => decideSessionChanges(root, "b", fingerprint, "preserve", [], "保留"),
    /没有首次差异盘点/,
  );
  writeFileSync(resolve(root, "existing.txt"), "changed while waiting\n");
  assert.throws(
    () => decideSessionChanges(root, "a", fingerprint, "preserve", [], "保留"),
    /观察已变化/,
  );
  assert.equal(loadSessionSnapshot(root, "a").initialChanges.decision, null);
  const fresh = observeWorktree(root).worktreeFingerprint;
  assert.throws(
    () =>
      decideSessionChanges(
        root,
        "a",
        fresh,
        "preserve",
        [],
        "旧回答不能套用新指纹",
      ),
    /不匹配询问时/,
  );
  const original = loadSessionSnapshot(root, "a").worktreeDigest;
  refreshSessionChanges(root, "a");
  assert.equal(loadSessionSnapshot(root, "a").worktreeDigest, original);
  decideSessionChanges(root, "a", fresh, "preserve", [], "用户明确确认新盘点");
  assert.equal(
    loadSessionSnapshot(root, "a").initialChanges.decision.strategy,
    "preserve",
  );
});

test("裁决 CLI 只写运行态，提供可用的 inspect 和显式 decide", () => {
  const { root } = fixture();
  const script = resolve(import.meta.dirname, "../scripts/session-changes.mjs");
  const invoke = (...args) =>
    spawnSync(
      process.execPath,
      [script, ...args, "--root", root, "--session-id", "a"],
      { encoding: "utf8" },
    );
  const before = git(root, "status", "--porcelain=v1");
  const inspected = invoke("inspect");
  assert.equal(inspected.status, 0, inspected.stderr);
  const value = JSON.parse(inspected.stdout);
  assert.equal(value.disposition.state, "pending");
  assert.deepEqual(
    value.presentation.changes.map(({ path, states, kind }) => ({
      path,
      states,
      kind,
    })),
    [
      { path: "tracked.txt", states: ["未暂存修改"], kind: "file" },
      { path: "existing.txt", states: ["未跟踪"], kind: "file" },
    ],
  );
  assert.deepEqual(value.presentation.summary, {
    staged: 0,
    unstaged: 1,
    untracked: 1,
  });
  assert.match(value.presentation.questionContract, /不得只说明.*存在/);
  assert.match(value.presentation.questionContract, /任务.*重叠/);
  assert.match(value.presentation.questionContract, /推荐.*理由/);
  assert.match(value.presentation.questionContract, /无法判断.*只读/);
  assert.equal(
    invoke(
      "decide",
      "--fingerprint",
      value.worktreeFingerprint,
      "--strategy",
      "preserve",
      "--basis",
      "用户明确保留",
    ).status,
    0,
  );
  assert.equal(
    JSON.parse(invoke("inspect").stdout).disposition.state,
    "preserve",
  );
  assert.equal(git(root, "status", "--porcelain=v1"), before);
  assert.equal(
    invoke(
      "decide",
      "--fingerprint",
      value.worktreeFingerprint,
      "--strategy",
      "preserve",
    ).status,
    1,
  );
});

test("inspect 展开嵌套仓库的索引与当前 revision，不输出完整内容", () => {
  const parent = mkdtempSync(resolve(tmpdir(), "echo-disposition-parent-"));
  const nested = resolve(parent, "nested");
  git(parent, "init", "-q");
  git(parent, "config", "user.email", "test@example.com");
  git(parent, "config", "user.name", "Test");
  mkdirSync(resolve(parent, ".echo-semantic"));
  writeFileSync(resolve(parent, ".echo-semantic/baseline.md"), "基线\n");
  mkdirSync(nested);
  git(nested, "init", "-q");
  git(nested, "config", "user.email", "test@example.com");
  git(nested, "config", "user.name", "Test");
  writeFileSync(resolve(nested, "tracked.txt"), "one\n");
  git(nested, "add", ".");
  git(nested, "-c", "commit.gpgsign=false", "commit", "-qm", "one");
  const indexRevision = git(nested, "rev-parse", "HEAD");
  git(parent, "add", ".");
  git(parent, "-c", "commit.gpgsign=false", "commit", "-qm", "parent");
  writeFileSync(resolve(nested, "tracked.txt"), "two\n");
  git(nested, "add", ".");
  git(nested, "-c", "commit.gpgsign=false", "commit", "-qm", "two");
  writeFileSync(resolve(nested, "dirty.txt"), "dirty\n");
  const observation = observeWorktree(parent);
  writeSessionRecord(
    observation.repositoryRoot,
    "session-snapshot.json",
    {
      sessionId: "nested",
      recordedAt: new Date().toISOString(),
      dispositionVersion: 1,
      headRevision: observation.headRevision,
      worktreeDigest: observation.worktreeFingerprint,
      initialChanges: {
        headRevision: observation.headRevision,
        fingerprint: observation.worktreeFingerprint,
        paths: observation.changes.map((change) => change.path),
        summary: observation.summary,
        decision: null,
      },
    },
    SESSION_SNAPSHOT_LIFETIME_MS,
  );
  const script = resolve(import.meta.dirname, "../scripts/session-changes.mjs");
  const inspected = spawnSync(
    process.execPath,
    [script, "inspect", "--root", parent, "--session-id", "nested"],
    { encoding: "utf8" },
  );
  assert.equal(inspected.status, 0, inspected.stderr);
  const change = JSON.parse(inspected.stdout).presentation.changes.find(
    (item) => item.path === "nested",
  );
  assert.equal(change.kind, "nested-repository");
  assert.equal(change.nestedRepository.indexRevision, indexRevision);
  assert.equal(change.nestedRepository.observationAvailable, true);
  assert.equal(
    change.nestedRepository.headRevision,
    git(nested, "rev-parse", "HEAD"),
  );
  assert.equal(typeof change.nestedRepository.branch, "string");
  assert.deepEqual(change.nestedRepository.summary, {
    staged: 0,
    unstaged: 0,
    untracked: 1,
  });
  assert.deepEqual(change.nestedRepository.changes, [
    { path: "dirty.txt", status: "??", states: ["未跟踪"], kind: "path" },
  ]);
});

test("inspect 的嵌套仓库观察拒绝目录替换为仓外 symlink", () => {
  const parent = mkdtempSync(
    resolve(tmpdir(), "echo-disposition-race-parent-"),
  );
  const nested = resolve(parent, "nested");
  const outside = mkdtempSync(
    resolve(tmpdir(), "echo-disposition-race-outside-"),
  );
  for (const repository of [parent, outside]) {
    git(repository, "init", "-q");
    git(repository, "config", "user.email", "test@example.com");
    git(repository, "config", "user.name", "Test");
  }
  mkdirSync(resolve(parent, ".echo-semantic"));
  writeFileSync(resolve(parent, ".echo-semantic/baseline.md"), "基线\n");
  mkdirSync(nested);
  git(nested, "init", "-q");
  git(nested, "config", "user.email", "test@example.com");
  git(nested, "config", "user.name", "Test");
  writeFileSync(resolve(nested, "tracked.txt"), "inside\n");
  git(nested, "add", ".");
  git(nested, "-c", "commit.gpgsign=false", "commit", "-qm", "inside");
  git(parent, "add", ".");
  git(parent, "-c", "commit.gpgsign=false", "commit", "-qm", "parent");
  writeFileSync(resolve(nested, "tracked.txt"), "inside changed\n");
  writeFileSync(resolve(outside, "private.txt"), "private\n");
  git(outside, "add", ".");
  git(outside, "-c", "commit.gpgsign=false", "commit", "-qm", "outside");
  writeFileSync(resolve(outside, "private.txt"), "private changed\n");
  const observation = observeWorktree(parent);
  writeSessionRecord(
    observation.repositoryRoot,
    "session-snapshot.json",
    {
      sessionId: "race",
      recordedAt: new Date().toISOString(),
      dispositionVersion: 1,
      headRevision: observation.headRevision,
      worktreeDigest: observation.worktreeFingerprint,
      initialChanges: {
        headRevision: observation.headRevision,
        fingerprint: observation.worktreeFingerprint,
        paths: observation.changes.map((change) => change.path),
        summary: observation.summary,
        decision: null,
      },
    },
    SESSION_SNAPSHOT_LIFETIME_MS,
  );
  const script = resolve(import.meta.dirname, "../scripts/session-changes.mjs");
  const runner = `
    import fs from "node:fs";
    import childProcess from "node:child_process";
    import { syncBuiltinESMExports } from "node:module";
    import { pathToFileURL } from "node:url";
    const target = ${JSON.stringify(realpathSync(nested))};
    const outside = ${JSON.stringify(realpathSync(outside))};
    const parent = ${JSON.stringify(realpathSync(parent))};
    const script = ${JSON.stringify(script)};
    const originalLstat = fs.lstatSync;
    const originalOpen = fs.openSync;
    const originalRead = fs.readSync;
    const originalSpawn = childProcess.spawnSync;
    const outsideDescriptors = new Set();
    let swapped = false;
    let outsideGit = 0;
    let outsideReads = 0;
    fs.lstatSync = (path, options) => {
      const supplied = Buffer.isBuffer(path) ? path.toString("utf8") : String(path);
      if (
        supplied === target &&
        !swapped &&
        /pathKind|openNestedBinding/.test(new Error().stack)
      ) {
        const initial = originalLstat(path, options);
        fs.rmSync(target, { recursive: true });
        fs.symlinkSync(outside, target, "dir");
        swapped = true;
        return initial;
      }
      return originalLstat(path, options);
    };
    fs.openSync = (path, flags, mode) => {
      const descriptor = originalOpen(path, flags, mode);
      try {
        if (fs.realpathSync(path).startsWith(outside)) outsideDescriptors.add(descriptor);
      } catch {}
      return descriptor;
    };
    fs.readSync = (descriptor, ...args) => {
      if (outsideDescriptors.has(descriptor)) outsideReads += 1;
      return originalRead(descriptor, ...args);
    };
    childProcess.spawnSync = (command, args, options) => {
      if (command === "git" && args?.[0] === "-C") {
        if (swapped && args[1] === target) outsideGit += 1;
        else {
          try { if (fs.realpathSync(args[1]).startsWith(outside)) outsideGit += 1; } catch {}
        }
      }
      if (command === "python3" && typeof options?.stdio?.[3] === "number") {
        const opened = fs.fstatSync(options.stdio[3]);
        const expected = fs.statSync(outside);
        if (opened.dev === expected.dev && opened.ino === expected.ino) outsideGit += 1;
      }
      return originalSpawn(command, args, options);
    };
    syncBuiltinESMExports();
    process.argv = [process.execPath, script, "inspect", "--root", parent, "--session-id", "race"];
    await import(pathToFileURL(script).href + "?race=" + Date.now());
    fs.writeSync(2, JSON.stringify({ outsideGit, outsideReads }));
  `;
  const inspected = spawnSync(
    process.execPath,
    ["--input-type=module", "-e", runner],
    {
      encoding: "utf8",
    },
  );
  assert.equal(inspected.status, 0, inspected.stderr);
  const counters = JSON.parse(inspected.stderr);
  assert.deepEqual(counters, { outsideGit: 0, outsideReads: 0 });
  assert.doesNotMatch(inspected.stdout, new RegExp(realpathSync(outside)));
  const nestedChange = JSON.parse(inspected.stdout).presentation.changes.find(
    (change) => change.path === "nested",
  );
  assert.equal(nestedChange.kind, "nested-repository");
  assert.equal(nestedChange.nestedRepository.observationAvailable, false);
  assert.equal(nestedChange.nestedRepository.indexRevision.length, 40);
  assert.equal("repositoryRoot" in nestedChange.nestedRepository, false);
});

test("Skill 要求先展示具体差异和推荐证据，再请求裁决", () => {
  const skill = readFileSync(
    resolve(import.meta.dirname, "../skills/semantic-preflight/SKILL.md"),
    "utf8",
  );
  assert.match(skill, /不得只说.*存在已有差异/);
  assert.match(skill, /与当前任务.*重叠/);
  assert.match(skill, /唯一推荐/);
  assert.match(skill, /无法判断.*只读/);
});
