import assert from "node:assert/strict";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, resolve } from "node:path";
import { spawn, spawnSync } from "node:child_process";
import test from "node:test";
import {
  decideSessionChanges,
  loadSessionSnapshot,
} from "../runtime/session-state.mjs";

const plugin = resolve(import.meta.dirname, "..");
const entry = resolve(plugin, "hooks/entry.mjs");
const bootstrap = resolve(plugin, "hooks/plugin-entry.mjs");

function git(root, ...args) {
  const result = spawnSync("git", ["-C", root, ...args], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim();
}

function repository(path) {
  mkdirSync(path, { recursive: true });
  git(path, "init", "-q");
  git(path, "config", "user.email", "fixture@example.com");
  git(path, "config", "user.name", "Fixture");
  writeFileSync(resolve(path, ".gitignore"), "child/\nother/\n");
  writeFileSync(resolve(path, "target.txt"), "before\n");
  git(path, "add", ".");
  git(path, "-c", "commit.gpgsign=false", "commit", "-qm", "fixture");
  return path;
}

function fixture(t) {
  const directory = realpathSync(
    mkdtempSync(resolve(tmpdir(), "echo-native-binding-")),
  );
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const workspace = repository(resolve(directory, "workspace"));
  const child = repository(resolve(workspace, "child"));
  const session = "native-session";
  const invoke = (cwd, event, extra = {}, host = "codex") =>
    spawnSync(process.execPath, [entry, host, event], {
      cwd,
      input: JSON.stringify({ cwd, session_id: session, ...extra }),
      encoding: "utf8",
    });
  const preflight = (root, paths = ["target.txt"]) => {
    const result = spawnSync(
      "python3",
      [
        resolve(plugin, "skills/semantic-preflight/scripts/preflight.py"),
        "record",
        "--root",
        root,
        "--task-id",
        "native-task",
        "--kind",
        "bugfix",
        "--risk",
        "low",
        ...paths.flatMap((path) => ["--allow", path]),
        "--search",
        ".",
        "--reuse-decision",
        "new",
        "--reuse",
        "隔离夹具不存在复用候选",
        "--verify",
        "定向测试",
        "--reuse-existing-boundary",
        "复用夹具边界",
      ],
      { encoding: "utf8" },
    );
    assert.equal(result.status, 0, result.stderr);
  };
  const start = (root = child, source = "startup") => {
    const result = invoke(root, "session-start", { source });
    assert.equal(result.status, 0, result.stderr);
  };
  return { workspace, child, session, invoke, preflight, start };
}

function patch(...paths) {
  return {
    tool_name: "apply_patch",
    tool_input: `*** Begin Patch\n${paths.map((path) => `*** Update File: ${path}\n@@\n-before\n+after`).join("\n")}\n*** End Patch`,
  };
}

function multiRepositoryFixture(t, host = "codex", startWorkspace = true) {
  const f = fixture(t);
  const collection = resolve(f.workspace, "../多个项目");
  mkdirSync(collection);
  const roots = ["项目 A", "分组/项目 B", "项目 C"].map((name) =>
    repository(resolve(collection, name)),
  );
  const started = startWorkspace
    ? f.invoke(collection, "session-start", { source: "startup" }, host)
    : null;
  if (started) assert.equal(started.status, 0, started.stderr);
  const admit = (root) => {
    const request =
      host === "cursor"
        ? {
            tool_name: "Write",
            tool_input: { path: resolve(root, "target.txt") },
          }
        : patch(resolve(root, "target.txt"));
    const first = f.invoke(collection, "pre-edit", request, host);
    assert.equal(first.status, 2, first.stderr);
    const snapshot = loadSessionSnapshot(root, f.session);
    assert.ok(snapshot, first.stderr);
    assert.equal(snapshot.observationEvent, "pre-edit");
    f.preflight(root);
    const admitted = f.invoke(collection, "pre-edit", request, host);
    assert.equal(admitted.status, 0, admitted.stderr);
  };
  return { ...f, collection, roots, admit };
}

test("旧父目录会话无SessionStart时由真实写前请求首次接入，三仓仍独立结算", (t) => {
  const f = multiRepositoryFixture(t, "codex", false);
  const installState = resolve(f.collection, "../.echo-semantic");
  mkdirSync(installState);
  writeFileSync(resolve(installState, "install-state.json"), "{}");
  assert.equal(existsSync(resolve(f.collection, ".echo-semantic")), false);
  for (const root of f.roots) {
    f.admit(root);
    assert.equal(readFileSync(resolve(root, "target.txt"), "utf8"), "before\n");
    writeFileSync(resolve(root, "target.txt"), "after\n");
  }
  const state = JSON.parse(
    readFileSync(resolve(f.collection, ".echo-semantic/session-snapshot.json")),
  );
  assert.equal(state.records[0].observationEvent, "pre-edit");
  assert.equal(state.records[0].routingOnly, true);
  assert.equal(f.invoke(f.collection, "stop").status, 0);
  for (const root of f.roots)
    assert.equal(
      JSON.parse(readFileSync(resolve(root, ".echo-semantic/route.json")))
        .verificationReceipt.result,
      "passed",
    );
});

test("旧父目录会话inspect未知应指向真实首次接入，refresh不能补快照", (t) => {
  const f = multiRepositoryFixture(t, "codex", false);
  const root = f.roots[0];
  writeFileSync(resolve(root, "existing.txt"), "protected\n");
  const inspect = () =>
    spawnSync(
      process.execPath,
      [
        resolve(plugin, "scripts/session-changes.mjs"),
        "inspect",
        "--root",
        root,
        "--session-id",
        f.session,
      ],
      { encoding: "utf8" },
    );
  const unknown = JSON.parse(inspect().stdout);
  assert.equal(unknown.disposition.state, "unknown");
  assert.match(unknown.disposition.message, /真实.*接入/);
  const refreshed = spawnSync(
    process.execPath,
    [
      resolve(plugin, "scripts/session-changes.mjs"),
      "refresh",
      "--root",
      root,
      "--session-id",
      f.session,
    ],
    { encoding: "utf8" },
  );
  assert.notEqual(refreshed.status, 0);
  assert.equal(loadSessionSnapshot(root, f.session), null);
  assert.equal(
    f.invoke(f.collection, "pre-edit", patch(resolve(root, "target.txt")))
      .status,
    2,
  );
  const known = JSON.parse(inspect().stdout);
  assert.equal(known.disposition.state, "pending");
  assert.equal(typeof known.questionFingerprint, "string");
  decideSessionChanges(
    root,
    f.session,
    known.questionFingerprint,
    "preserve",
    [],
    "用户保留既有内容，接入后只改本轮目标",
  );
  f.preflight(root);
  assert.equal(
    f.invoke(f.collection, "pre-edit", patch(resolve(root, "target.txt")))
      .status,
    0,
  );
  assert.equal(
    readFileSync(resolve(root, "existing.txt"), "utf8"),
    "protected\n",
  );
});

test("旧父目录会话首次接入不覆盖丢失路由或子仓既有待结算状态", (t) => {
  const f = multiRepositoryFixture(t);
  const state = resolve(f.collection, ".echo-semantic/session-snapshot.json");
  rmSync(state);
  const result = f.invoke(
    f.collection,
    "pre-edit",
    patch(resolve(f.roots[0], "target.txt")),
  );
  assert.equal(result.status, 2);
  assert.equal(existsSync(state), false);
  assert.equal(loadSessionSnapshot(f.roots[0], f.session), null);
  const fresh = multiRepositoryFixture(t, "codex", false);
  fresh.preflight(fresh.roots[0]);
  assert.equal(
    fresh.invoke(
      fresh.collection,
      "pre-edit",
      patch(resolve(fresh.roots[0], "target.txt")),
    ).status,
    2,
  );
  assert.equal(
    existsSync(
      resolve(fresh.collection, ".echo-semantic/session-snapshot.json"),
    ),
    false,
  );
  const observed = multiRepositoryFixture(t, "codex", false);
  observed.start(observed.roots[0]);
  assert.equal(
    observed.invoke(
      observed.collection,
      "pre-edit",
      patch(resolve(observed.roots[0], "target.txt")),
    ).status,
    2,
  );
  assert.equal(
    existsSync(
      resolve(observed.collection, ".echo-semantic/session-snapshot.json"),
    ),
    false,
  );
  const linked = multiRepositoryFixture(t, "codex", false);
  mkdirSync(resolve(linked.roots[0], ".echo-semantic"));
  symlinkSync(
    resolve(linked.collection, "missing-state.json"),
    resolve(linked.roots[0], ".echo-semantic/preflight.json"),
  );
  assert.equal(
    linked.invoke(
      linked.collection,
      "pre-edit",
      patch(resolve(linked.roots[0], "target.txt")),
    ).status,
    2,
  );
  assert.equal(loadSessionSnapshot(linked.roots[0], linked.session), null);
});

test("旧父目录会话首次观察提交前出现另一任务预检时拒绝接入且保留原件", (t) => {
  if (process.platform === "win32") {
    t.skip("此确定性调度使用 POSIX 可执行包装");
    return;
  }
  const f = multiRepositoryFixture(t);
  const root = f.roots[0];
  const originalPath = process.env.PATH;
  const realGit = spawnSync("which", ["git"], {
    encoding: "utf8",
  }).stdout.trim();
  assert.ok(realGit);
  const bin = resolve(f.collection, "../race-bin");
  mkdirSync(bin);
  const marker = resolve(bin, "injected.json");
  const args = [
    resolve(plugin, "skills/semantic-preflight/scripts/preflight.py"),
    "record",
    "--root",
    root,
    "--task-id",
    "other-race-task",
    "--kind",
    "bugfix",
    "--risk",
    "low",
    "--allow",
    "target.txt",
    "--search",
    ".",
    "--reuse-decision",
    "new",
    "--reuse",
    "另一会话确定性竞争夹具",
    "--verify",
    "定向回归",
    "--reuse-existing-boundary",
    "复用夹具边界",
  ];
  writeFileSync(
    resolve(bin, "git"),
    `#!/usr/bin/env node\nconst fs=require('node:fs');const cp=require('node:child_process');
const marker=${JSON.stringify(marker)};const env={...process.env,PATH:${JSON.stringify(originalPath)}};
if(process.argv.includes('status')&&!fs.existsSync(marker)){
 const r=cp.spawnSync('python3',${JSON.stringify(args)},{env,encoding:'utf8'});
 if(r.status!==0){process.stderr.write(r.stderr||r.stdout);process.exit(1);}
 fs.writeFileSync(marker,JSON.stringify({preflight:fs.readFileSync(${JSON.stringify(resolve(root, ".echo-semantic/preflight.json"))},'utf8')}));
}
const r=cp.spawnSync(${JSON.stringify(realGit)},process.argv.slice(2),{env,stdio:'inherit'});process.exit(r.status??1);\n`,
  );
  chmodSync(resolve(bin, "git"), 0o755);
  const request = patch(resolve(root, "target.txt"));
  const result = spawnSync(process.execPath, [entry, "codex", "pre-edit"], {
    cwd: f.collection,
    input: JSON.stringify({
      cwd: f.collection,
      session_id: f.session,
      ...request,
    }),
    encoding: "utf8",
    env: { ...process.env, PATH: `${bin}${delimiter}${originalPath}` },
  });
  assert.equal(result.status, 2, result.stderr);
  assert.ok(existsSync(marker), result.stderr);
  assert.equal(loadSessionSnapshot(root, f.session), null);
  const original = JSON.parse(readFileSync(marker)).preflight;
  const parent = JSON.parse(
    readFileSync(resolve(f.collection, ".echo-semantic/session-snapshot.json")),
  );
  assert.equal(parent.records[0].repositoryObservations.length, 0);
  assert.equal(
    readFileSync(resolve(root, ".echo-semantic/preflight.json"), "utf8"),
    original,
  );
  assert.equal(f.invoke(f.collection, "pre-edit", request).status, 2);
  assert.equal(readFileSync(resolve(root, "target.txt"), "utf8"), "before\n");
});

test("审查反例：多仓库SessionStart按三个宿主合同注入启动和恢复上下文", (t) => {
  const f = multiRepositoryFixture(t);
  for (const host of ["codex", "claude-code", "cursor"]) {
    for (const source of ["startup", "resume"]) {
      const result = f.invoke(f.collection, "session-start", { source }, host);
      assert.equal(result.status, 0, result.stderr);
      const output = JSON.parse(result.stdout);
      const context =
        host === "cursor"
          ? output.additional_context
          : output.hookSpecificOutput?.additionalContext;
      assert.equal(
        typeof context,
        "string",
        `${host}/${source}: ${result.stdout}`,
      );
      assert.match(context, /semantic-preflight/);
      assert.match(context, /工作区/);
      if (host !== "cursor")
        assert.equal(output.hookSpecificOutput.hookEventName, "SessionStart");
    }
  }
});

test("审查反例：父路由丢失后父目录与分组目录resume不得新建空工作区", (t) => {
  const f = multiRepositoryFixture(t);
  f.admit(f.roots[0]);
  assert.equal(f.invoke(f.collection, "pre-compact").status, 0);
  const names = ["preflight.json", "continuation.json"];
  const before = names.map((name) =>
    readFileSync(resolve(f.roots[0], ".echo-semantic", name)),
  );
  rmSync(resolve(f.collection, ".echo-semantic/session-snapshot.json"));
  for (const cwd of [f.collection, resolve(f.collection, "分组")]) {
    for (const source of ["resume", "compact"]) {
      assert.equal(f.invoke(cwd, "session-start", { source }).status, 2);
      assert.equal(
        existsSync(resolve(cwd, ".echo-semantic/session-snapshot.json")),
        false,
      );
    }
  }
  assert.deepEqual(
    names.map((name) =>
      readFileSync(resolve(f.roots[0], ".echo-semantic", name)),
    ),
    before,
  );
});

test("审查反例：一仓继续包失败须向Codex和Cursor报告且其它仓仍保存", (t) => {
  for (const host of ["codex", "cursor"]) {
    const f = multiRepositoryFixture(t, host);
    for (const root of f.roots.slice(0, 2)) f.admit(root);
    mkdirSync(resolve(f.roots[0], ".echo-semantic/continuation.json"));
    const result = f.invoke(f.collection, "pre-compact", {}, host);
    assert.equal(result.status, 2, result.stdout);
    const output = JSON.parse(result.stdout);
    assert.match(
      host === "cursor" ? output.user_message : output.reason,
      /继续包/,
    );
    assert.ok(existsSync(resolve(f.roots[0], ".echo-semantic/preflight.json")));
    assert.ok(
      existsSync(resolve(f.roots[1], ".echo-semantic/continuation.json")),
    );
  }
});

test("审查反例：无提交子仓接入失败不污染其它已准入仓库路由", (t) => {
  const f = multiRepositoryFixture(t);
  f.admit(f.roots[0]);
  const state = resolve(f.collection, ".echo-semantic/session-snapshot.json");
  const before = readFileSync(state, "utf8");
  const empty = resolve(f.collection, "empty repository");
  mkdirSync(empty);
  git(empty, "init", "-q");
  writeFileSync(resolve(empty, "target.txt"), "before\n");
  assert.equal(
    f.invoke(f.collection, "pre-edit", patch(resolve(empty, "target.txt")))
      .status,
    2,
  );
  assert.equal(readFileSync(state, "utf8"), before);
  const good = f.invoke(
    f.collection,
    "pre-edit",
    patch(resolve(f.roots[0], "target.txt")),
  );
  assert.equal(good.status, 0, good.stderr);
  writeFileSync(resolve(f.roots[0], "target.txt"), "after\n");
  const stopped = f.invoke(f.collection, "stop");
  assert.equal(stopped.status, 0, stopped.stderr);
  assert.equal(
    JSON.parse(readFileSync(resolve(f.roots[0], ".echo-semantic/route.json")))
      .verificationReceipt.result,
    "passed",
  );
});

test("非Git工作区只启动一次即可接入三个子仓并压缩、逐仓结算和重试", (t) => {
  const f = multiRepositoryFixture(t);
  assert.equal(loadSessionSnapshot(f.collection, f.session), null);
  for (const root of f.roots) {
    f.admit(root);
    writeFileSync(resolve(root, "target.txt"), "after\n");
  }
  const group = resolve(f.collection, "分组");
  assert.equal(
    f.invoke(group, "session-start", { source: "resume" }).status,
    0,
  );
  assert.equal(
    existsSync(resolve(group, ".echo-semantic/session-snapshot.json")),
    false,
  );
  const compact = f.invoke(f.collection, "pre-compact");
  assert.equal(compact.status, 0, compact.stderr);
  for (const root of f.roots)
    assert.ok(existsSync(resolve(root, ".echo-semantic/continuation.json")));
  for (let attempt = 0; attempt < 2; attempt++) {
    const stopped = f.invoke(f.collection, "stop");
    assert.equal(stopped.status, 0, stopped.stderr);
    for (const root of f.roots) {
      const route = JSON.parse(
        readFileSync(resolve(root, ".echo-semantic/route.json")),
      );
      assert.equal(route.verificationReceipt.result, "passed");
      assert.equal(route.verificationReceipt.taskId, "native-task");
    }
  }
});

test("非Git工作区保留首次接入的dirty保护且不串用其它宿主会话", (t) => {
  const f = multiRepositoryFixture(t);
  const root = f.roots[0];
  writeFileSync(resolve(root, "existing.txt"), "protected\n");
  const request = patch(resolve(root, "target.txt"));
  assert.equal(f.invoke(f.collection, "pre-edit", request).status, 2);
  const snapshot = loadSessionSnapshot(root, f.session);
  assert.ok(snapshot);
  assert.ok(snapshot.initialChanges.paths.includes("existing.txt"));
  decideSessionChanges(
    root,
    f.session,
    snapshot.initialChanges.fingerprint,
    "preserve",
    [],
    "用户明确保留初始差异",
  );
  f.preflight(root);
  assert.equal(f.invoke(f.collection, "pre-edit", request).status, 0);
  const foreign = f.invoke(f.collection, "pre-edit", request, "claude");
  assert.equal(foreign.status, 2);
  assert.equal(
    f.invoke(f.collection, "pre-edit", patch(resolve(root, "existing.txt")))
      .status,
    2,
  );
});

test("非Git工作区部分仓库失败后保留预检，修复后复用已通过仓库收据", (t) => {
  const f = multiRepositoryFixture(t);
  for (const root of f.roots) {
    f.admit(root);
    writeFileSync(resolve(root, "target.txt"), "after\n");
  }
  writeFileSync(resolve(f.roots[1], "unexpected.txt"), "outside scope\n");
  const failed = f.invoke(f.collection, "stop");
  assert.equal(failed.status, 2, failed.stderr);
  assert.ok(existsSync(resolve(f.roots[1], ".echo-semantic/preflight.json")));
  assert.equal(
    JSON.parse(readFileSync(resolve(f.roots[0], ".echo-semantic/route.json")))
      .verificationReceipt.result,
    "passed",
  );
  rmSync(resolve(f.roots[1], "unexpected.txt"));
  const retried = f.invoke(f.collection, "stop");
  assert.equal(retried.status, 0, retried.stderr);
  for (const root of f.roots)
    assert.equal(
      JSON.parse(readFileSync(resolve(root, ".echo-semantic/route.json")))
        .verificationReceipt.result,
      "passed",
    );
});

test("非Git工作区从子目录恢复，原路由损坏或丢失不得退回单仓通过", (t) => {
  const f = multiRepositoryFixture(t);
  const root = f.roots[0];
  f.admit(root);
  writeFileSync(resolve(root, "target.txt"), "after\n");
  assert.equal(f.invoke(root, "session-start", { source: "resume" }).status, 0);
  assert.equal(f.invoke(root, "pre-compact").status, 0);
  const path = resolve(f.collection, ".echo-semantic/session-snapshot.json");
  const before = readFileSync(path);
  writeFileSync(path, "{broken");
  assert.equal(f.invoke(root, "stop").status, 2);
  assert.equal(
    f.invoke(f.collection, "session-start", { source: "resume" }).status,
    2,
  );
  rmSync(path);
  assert.equal(f.invoke(root, "stop").status, 2);
  assert.equal(
    f.invoke(f.collection, "session-start", { source: "startup" }).status,
    0,
  );
  assert.equal(
    f.invoke(f.collection, "pre-edit", patch(resolve(root, "target.txt")))
      .status,
    2,
  );
  writeFileSync(path, before);
  assert.equal(f.invoke(root, "stop").status, 0);
});

test("非Git工作区超过八仓仍保留完整准入集合，跨仓补丁和仓外路径拒绝", (t) => {
  const f = multiRepositoryFixture(t);
  const roots = [
    ...f.roots,
    ...Array.from({ length: 6 }, (_, index) =>
      repository(resolve(f.collection, `模块 ${index}`)),
    ),
  ];
  for (const root of roots) f.admit(root);
  const envelope = JSON.parse(
    readFileSync(resolve(f.collection, ".echo-semantic/session-snapshot.json")),
  );
  assert.equal(envelope.records[0].repositoryBindings.length, 9);
  assert.equal(envelope.records[0].repositoryObservations.length, 9);
  assert.equal(
    f.invoke(
      f.collection,
      "pre-edit",
      patch(...roots.slice(0, 2).map((root) => resolve(root, "target.txt"))),
    ).status,
    2,
  );
  assert.equal(
    f.invoke(f.collection, "pre-edit", patch(resolve(f.child, "target.txt")))
      .status,
    2,
  );
});

test("非Git工作区并发SessionStart不覆盖其它会话，未归属任务不能重录观察", async (t) => {
  const f = multiRepositoryFixture(t);
  const ids = ["parallel-A", "parallel-B", "parallel-C"];
  await Promise.all(
    ids.map(
      (session_id) =>
        new Promise((done, reject) => {
          const child = spawn(
            process.execPath,
            [entry, "codex", "session-start"],
            { cwd: f.collection },
          );
          let error = "";
          child.stderr.on("data", (chunk) => (error += chunk));
          child.on("error", reject);
          child.on("close", (code) =>
            code === 0 ? done() : reject(new Error(error)),
          );
          child.stdin.end(
            JSON.stringify({
              cwd: f.collection,
              session_id,
              source: "startup",
            }),
          );
        }),
    ),
  );
  const envelope = JSON.parse(
    readFileSync(resolve(f.collection, ".echo-semantic/session-snapshot.json")),
  );
  assert.equal(envelope.records.length, 4);
  for (const id of ids)
    assert.ok(envelope.records.some((record) => record.nativeSessionId === id));
  f.preflight(f.roots[0]);
  const before = readFileSync(
    resolve(f.roots[0], ".echo-semantic/preflight.json"),
  );
  assert.equal(
    f.invoke(f.collection, "pre-edit", patch(resolve(f.roots[0], "target.txt")))
      .status,
    2,
  );
  assert.equal(loadSessionSnapshot(f.roots[0], f.session), null);
  assert.deepEqual(
    readFileSync(resolve(f.roots[0], ".echo-semantic/preflight.json")),
    before,
  );
});

test("非Git工作区区分linked worktree与独立克隆，已有基线按任务范围结算", (t) => {
  const f = multiRepositoryFixture(t);
  const main = f.roots[0];
  const linked = resolve(f.collection, "linked module");
  git(main, "worktree", "add", "-qb", "fixture-linked", linked);
  const root = f.roots[1];
  mkdirSync(resolve(root, ".echo-semantic"));
  const baseline = {
    schema_version: 1,
    id: "baseline.repository",
    kind: "baseline",
    source_snapshot: {
      base_revision: git(root, "rev-parse", "HEAD"),
      content_digest: "0".repeat(64),
    },
    inventory_closure: "open",
    behavior_model_closure: "open",
    map_refs: [],
    regions: [],
    boundaries: [],
    coverage: [],
  };
  writeFileSync(
    resolve(root, ".echo-semantic/baseline.md"),
    `---\n${JSON.stringify(baseline)}\n---\n# 既有基线\n`,
  );
  git(root, "add", ".echo-semantic/baseline.md");
  git(root, "-c", "commit.gpgsign=false", "commit", "-qm", "existing baseline");
  for (const target of [main, linked, root]) {
    f.admit(target);
    writeFileSync(resolve(target, "target.txt"), "after\n");
  }
  const stopped = f.invoke(f.collection, "stop");
  assert.equal(stopped.status, 0, stopped.stderr);
  for (const target of [main, linked, root]) {
    const receipt = JSON.parse(
      readFileSync(resolve(target, ".echo-semantic/route.json")),
    ).verificationReceipt;
    assert.equal(receipt.result, "passed");
    assert.equal(receipt.scope, "task");
  }
});

function recoveryData(reason) {
  const prefix = "恢复入口与参数（JSON）：";
  const line = reason.split("\n").find((item) => item.startsWith(prefix));
  assert.ok(line, reason);
  return JSON.parse(line.slice(prefix.length));
}

test("Stop无起始观察保留未归属任务并只读结束", (t) => {
  const f = fixture(t);
  assert.equal(
    f.invoke(f.workspace, "session-start", {
      source: "startup",
      session_id: "other-session",
    }).status,
    0,
  );
  f.preflight(f.workspace);
  assert.equal(
    f.invoke(f.workspace, "pre-edit", {
      ...patch("target.txt"),
      session_id: "other-session",
    }).status,
    0,
  );
  const directory = resolve(f.workspace, ".echo-semantic");
  writeFileSync(
    resolve(directory, "continuation.json"),
    JSON.stringify({ taskId: "foreign-task", pending: "opaque state" }),
  );
  const names = [
    "preflight.json",
    "continuation.json",
    "session-snapshot.json",
  ];
  const before = names.map((name) => readFileSync(resolve(directory, name)));
  assert.equal(loadSessionSnapshot(f.workspace, f.session), null);
  for (const stop_hook_active of [false, true]) {
    const result = f.invoke(f.workspace, "stop", { stop_hook_active });
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(JSON.parse(result.stdout), {});
    assert.deepEqual(
      names.map((name) => readFileSync(resolve(directory, name))),
      before,
    );
    assert.equal(loadSessionSnapshot(f.workspace, f.session), null);
    const route = JSON.parse(readFileSync(resolve(directory, "route.json")));
    assert.equal(route.verificationReceipt ?? null, null);
    const status = JSON.parse(readFileSync(resolve(directory, "status.json")));
    assert.equal(status.state, "blocked");
    assert.match(status.message, /无法判断.*未验证/);
  }
  assert.equal(
    f.invoke(f.workspace, "pre-edit", patch("target.txt")).status,
    2,
  );
  assert.equal(
    readFileSync(resolve(f.workspace, "target.txt"), "utf8"),
    "before\n",
  );
});

test("pending拒写反馈提供本仓inspect和实际提问接续", (t) => {
  const f = fixture(t);
  const sessionId = "native-session '$(printf never-execute)";
  writeFileSync(resolve(f.workspace, "existing.txt"), "protected\n");
  assert.equal(
    f.invoke(f.workspace, "session-start", {
      source: "startup",
      session_id: sessionId,
    }).status,
    0,
  );
  f.preflight(f.workspace);
  const result = f.invoke(f.workspace, "pre-edit", {
    ...patch("target.txt"),
    session_id: sessionId,
  });
  assert.equal(result.status, 2);
  const reason = JSON.parse(result.stdout).reason;
  const recovery = recoveryData(reason);
  assert.equal(recovery.observation, "pending");
  assert.deepEqual(recovery.inspectArgs, [
    "inspect",
    "--root",
    f.workspace,
    "--session-id",
    sessionId,
  ]);
  assert.deepEqual(recovery.refreshArgs, [
    "refresh",
    "--root",
    f.workspace,
    "--session-id",
    sessionId,
  ]);
  assert.match(reason, /展示.*presentation/);
  assert.match(reason, /提问工具/);
  assert.match(reason, /没有.*提问工具.*正文.*提问/);
  assert.match(reason, /preserve.*adopt.*readonly/);
  assert.match(reason, /等待.*明确答复/);
  const inspected = spawnSync(
    process.execPath,
    [recovery.entry, ...recovery.inspectArgs],
    {
      encoding: "utf8",
    },
  );
  assert.equal(inspected.status, 0, inspected.stderr);
  const value = JSON.parse(inspected.stdout);
  assert.equal(value.repositoryRoot, f.workspace);
  assert.equal(value.sessionId, sessionId);
  assert.equal(value.disposition.state, "pending");
  assert.equal(typeof value.questionFingerprint, "string");
  assert.ok(
    value.presentation.changes.some((item) => item.path === "existing.txt"),
  );
  if (process.platform !== "win32") {
    const prefix = "诊断命令（POSIX shell）：";
    const line = reason.split("\n").find((item) => item.startsWith(prefix));
    assert.ok(line, reason);
    const shell = spawnSync("/bin/sh", ["-c", line.slice(prefix.length)], {
      encoding: "utf8",
    });
    assert.equal(shell.status, 0, shell.stderr);
    assert.equal(JSON.parse(shell.stdout).sessionId, sessionId);
  }
  assert.equal(
    readFileSync(resolve(f.workspace, "existing.txt"), "utf8"),
    "protected\n",
  );
});

test("unknown拒写反馈仅诊断不把空观察当裁决", (t) => {
  const f = fixture(t);
  f.preflight(f.workspace);
  const state = resolve(f.workspace, ".echo-semantic/preflight.json");
  const before = readFileSync(state);
  const result = f.invoke(f.workspace, "pre-edit", patch("target.txt"));
  assert.equal(result.status, 2);
  const reason = JSON.parse(result.stdout).reason;
  const recovery = recoveryData(reason);
  assert.equal(recovery.observation, "unknown");
  assert.equal(recovery.refreshArgs, null);
  assert.match(reason, /不能.*空.*指纹.*裁决/);
  assert.match(reason, /正常.*SessionStart/);
  assert.doesNotMatch(reason, /已有差异待裁决/);
  const inspected = spawnSync(
    process.execPath,
    [recovery.entry, ...recovery.inspectArgs],
    {
      encoding: "utf8",
    },
  );
  assert.equal(inspected.status, 0, inspected.stderr);
  const value = JSON.parse(inspected.stdout);
  assert.equal(value.questionFingerprint, null);
  assert.equal(value.disposition.state, "unknown");
  assert.deepEqual(readFileSync(state), before);
  assert.equal(
    existsSync(resolve(f.workspace, ".echo-semantic/session-snapshot.json")),
    false,
  );
});

test("共享入口在Codex兼容Claude变量时仍识别Codex", (t) => {
  const f = fixture(t);
  for (const alias of [plugin, resolve(f.workspace, "stale-plugin")]) {
    const result = spawnSync(
      process.execPath,
      [
        "--input-type=module",
        "-e",
        `import(${JSON.stringify(bootstrap)}).then(m => m.run('session-start'))`,
      ],
      {
        cwd: f.workspace,
        input: JSON.stringify({
          cwd: f.workspace,
          session_id: f.session,
          source: "startup",
        }),
        encoding: "utf8",
        env: { ...process.env, PLUGIN_ROOT: plugin, CLAUDE_PLUGIN_ROOT: alias },
      },
    );
    assert.equal(result.status, 0, result.stderr);
    const route = JSON.parse(
      readFileSync(resolve(f.workspace, ".echo-semantic/route.json")),
    );
    assert.equal(route.host, "codex");
  }
});

test("只有Claude规范变量时保持Claude宿主，与继承的Codex线索分开", (t) => {
  const f = fixture(t);
  const env = { ...process.env, CLAUDE_PLUGIN_ROOT: plugin };
  delete env.PLUGIN_ROOT;
  const result = spawnSync(
    process.execPath,
    [
      "--input-type=module",
      "-e",
      `import(${JSON.stringify(bootstrap)}).then(m => m.run('session-start'))`,
    ],
    {
      cwd: f.workspace,
      encoding: "utf8",
      env,
      input: JSON.stringify({
        cwd: f.workspace,
        session_id: f.session,
        source: "startup",
      }),
    },
  );
  assert.equal(result.status, 0, result.stderr);
  assert.equal(
    JSON.parse(readFileSync(resolve(f.workspace, ".echo-semantic/route.json")))
      .host,
    "claude-code",
  );
});

test("父workspace事件使用目标子Git根的同会话依据，Stop真实验证子仓", (t) => {
  const f = fixture(t);
  f.start();
  f.preflight(f.child);
  const edit = f.invoke(f.workspace, "pre-edit", patch("child/target.txt"));
  assert.equal(edit.status, 0, edit.stderr);
  writeFileSync(resolve(f.child, "target.txt"), "after\n");
  const compact = f.invoke(f.workspace, "pre-compact");
  assert.equal(compact.status, 0, compact.stderr);
  const stopped = f.invoke(f.workspace, "stop");
  assert.equal(stopped.status, 0, stopped.stderr);
  assert.doesNotThrow(() => JSON.parse(stopped.stdout));
  const route = JSON.parse(
    readFileSync(resolve(f.child, ".echo-semantic/route.json")),
  );
  assert.equal(route.verificationReceipt.taskId, "native-task");
  assert.equal(route.verificationReceipt.scope, "task");
  assert.equal(loadSessionSnapshot(f.workspace, f.session), null);
});

test("目标子仓缺少或不匹配session时不能从预检补造观察", (t) => {
  const f = fixture(t);
  f.preflight(f.child);
  for (const session_id of [undefined, "unknown-session", f.session]) {
    const rejected = f.invoke(f.workspace, "pre-edit", {
      ...patch("child/target.txt"),
      session_id,
    });
    assert.equal(rejected.status, 2, rejected.stdout);
    assert.equal(loadSessionSnapshot(f.child, session_id ?? f.session), null);
  }
  f.start();
  const mismatch = f.invoke(f.workspace, "pre-edit", {
    ...patch("child/target.txt"),
    session_id: "other-session",
  });
  assert.equal(mismatch.status, 2);
});

test("子仓dirty必须明确接管，未接管路径继续保护", (t) => {
  const f = fixture(t);
  writeFileSync(resolve(f.child, "target.txt"), "dirty\n");
  writeFileSync(resolve(f.child, "protected.txt"), "protected\n");
  f.start();
  f.preflight(f.child, ["target.txt", "protected.txt"]);
  assert.equal(
    f.invoke(f.workspace, "pre-edit", patch("child/target.txt")).status,
    2,
  );
  const observation = loadSessionSnapshot(f.child, f.session);
  decideSessionChanges(
    f.child,
    f.session,
    observation.initialChanges.fingerprint,
    "adopt",
    ["target.txt"],
    "夹具明确接管目标",
  );
  assert.equal(
    f.invoke(f.workspace, "pre-edit", patch("child/target.txt")).status,
    0,
  );
  assert.equal(
    f.invoke(f.workspace, "pre-edit", patch("child/protected.txt")).status,
    2,
  );
  writeFileSync(resolve(f.child, "protected.txt"), "changed\n");
  assert.equal(
    f.invoke(f.workspace, "pre-edit", patch("child/target.txt")).status,
    2,
  );
});

test("跨仓补丁整批拒绝，父仓预检不能授权子仓", (t) => {
  const f = fixture(t);
  f.start(f.workspace);
  f.preflight(f.workspace, ["target.txt", "child"]);
  assert.equal(
    f.invoke(f.workspace, "pre-edit", patch("child/target.txt")).status,
    2,
  );
  f.start();
  f.preflight(f.child);
  const result = f.invoke(
    f.workspace,
    "pre-edit",
    patch("target.txt", "child/target.txt"),
  );
  assert.equal(result.status, 2);
  assert.match(result.stderr, /Git|仓库/);
});

test("fork原生开始事件也建立本会话观察，普通单仓路径保持", (t) => {
  const f = fixture(t);
  f.start(f.workspace, "fork");
  assert.ok(loadSessionSnapshot(f.workspace, f.session));
  f.preflight(f.workspace);
  assert.equal(
    f.invoke(f.workspace, "pre-edit", patch("target.txt")).status,
    0,
  );
});

test("路径以事件cwd解析，新增多层目录仍落在实际子仓", (t) => {
  const f = fixture(t);
  f.start();
  f.preflight(f.child, ["new"]);
  const result = f.invoke(f.workspace, "pre-edit", {
    tool_name: "Write",
    tool_input: { path: "child/new/deep/file.txt" },
  });
  assert.equal(result.status, 0, result.stderr);
});

test("符号链接文件、目录以及删除或Move两端都拒绝", (t) => {
  const f = fixture(t);
  f.start();
  f.preflight(f.child, ["target.txt", "moved.txt"]);
  symlinkSync(resolve(f.child, "target.txt"), resolve(f.workspace, "link"));
  symlinkSync(f.child, resolve(f.workspace, "directory-link"));
  for (const path of ["link", "directory-link/target.txt"]) {
    for (const tool_name of ["Write", "Delete"]) {
      const result = f.invoke(f.workspace, "pre-edit", {
        tool_name,
        tool_input: { path },
      });
      assert.equal(result.status, 2);
      assert.match(result.stderr, /符号链接/);
    }
    const moved = f.invoke(f.workspace, "pre-edit", {
      tool_name: "apply_patch",
      tool_input: `*** Begin Patch\n*** Update File: ${path}\n*** Move to: child/moved.txt\n@@\n-before\n+after\n*** End Patch`,
    });
    assert.equal(moved.status, 2);
    assert.match(moved.stderr, /符号链接/);
  }
});

test("无Git父工作根不能准入后丢失Stop结算", (t) => {
  const f = fixture(t);
  f.start();
  f.preflight(f.child);
  const cwd = resolve(f.workspace, "..");
  const result = f.invoke(
    cwd,
    "pre-edit",
    patch(resolve(f.child, "target.txt")),
  );
  assert.equal(result.status, 2);
  assert.match(result.stderr, /宿主工作根/);
});

test("session别名冲突仍拒绝，无观察Stop只读保留父仓预检", (t) => {
  const f = fixture(t);
  f.start(f.workspace);
  f.preflight(f.workspace);
  const statePath = resolve(f.workspace, ".echo-semantic/preflight.json");
  const before = readFileSync(statePath, "utf8");
  const extra = { sessionId: "conflicting-session" };
  assert.equal(
    f.invoke(f.workspace, "pre-edit", { ...patch("target.txt"), ...extra })
      .status,
    2,
  );
  assert.equal(f.invoke(f.workspace, "stop", extra).status, 2);
  assert.equal(readFileSync(statePath, "utf8"), before);
  for (const session_id of [undefined, "unknown-session"]) {
    const stopped = f.invoke(f.workspace, "stop", { session_id });
    assert.equal(stopped.status, 0, stopped.stderr);
    assert.deepEqual(JSON.parse(stopped.stdout), {});
    const route = JSON.parse(
      readFileSync(resolve(f.workspace, ".echo-semantic/route.json")),
    );
    assert.equal(route.verificationReceipt ?? null, null);
    assert.equal(
      f.invoke(f.workspace, "pre-compact", { session_id }).status,
      2,
    );
    assert.equal(readFileSync(statePath, "utf8"), before);
  }
});

test("绑定任务被替换后PreCompact和Stop保留新任务记录", (t) => {
  const f = fixture(t);
  f.start();
  f.preflight(f.child);
  assert.equal(
    f.invoke(f.workspace, "pre-edit", patch("child/target.txt")).status,
    0,
  );
  const statePath = resolve(f.child, ".echo-semantic/preflight.json");
  const state = JSON.parse(readFileSync(statePath));
  state.taskId = "replacement-task";
  writeFileSync(statePath, JSON.stringify(state));
  const before = readFileSync(statePath, "utf8");
  for (const event of ["pre-compact", "stop"]) {
    const result = f.invoke(f.workspace, event);
    assert.equal(result.status, 2, result.stdout);
    assert.match(result.stderr, /当前任务/);
    assert.equal(readFileSync(statePath, "utf8"), before);
  }
});

test("同会话先后编辑两个子仓，Stop逐仓生成真实收据且保持父状态", (t) => {
  const f = fixture(t);
  const other = repository(resolve(f.workspace, "other"));
  f.preflight(f.workspace);
  const parentState = readFileSync(
    resolve(f.workspace, ".echo-semantic/preflight.json"),
    "utf8",
  );
  for (const child of [f.child, other]) {
    f.start(child);
    f.preflight(child);
    assert.equal(
      f.invoke(f.workspace, "pre-edit", patch(resolve(child, "target.txt")))
        .status,
      0,
    );
    writeFileSync(resolve(child, "target.txt"), "after\n");
  }
  const result = f.invoke(f.workspace, "stop");
  assert.equal(result.status, 0, result.stderr);
  assert.doesNotThrow(() => JSON.parse(result.stdout));
  for (const child of [f.child, other]) {
    assert.equal(
      JSON.parse(readFileSync(resolve(child, ".echo-semantic/route.json")))
        .verificationReceipt.result,
      "passed",
    );
  }
  assert.equal(
    readFileSync(resolve(f.workspace, ".echo-semantic/preflight.json"), "utf8"),
    parentState,
  );
});

test("任一已绑定仓库验证失败仍阻断，另一仓通过不掩盖失败", (t) => {
  const f = fixture(t);
  const other = repository(resolve(f.workspace, "other"));
  for (const child of [f.child, other]) {
    f.start(child);
    f.preflight(child);
    assert.equal(
      f.invoke(f.workspace, "pre-edit", patch(resolve(child, "target.txt")))
        .status,
      0,
    );
    writeFileSync(resolve(child, "target.txt"), "after\n");
  }
  writeFileSync(resolve(other, "unexpected.txt"), "outside scope\n");
  const result = f.invoke(f.workspace, "stop");
  assert.equal(result.status, 2);
  assert.equal(JSON.parse(result.stdout).decision, "block");
  assert.equal(
    JSON.parse(readFileSync(resolve(f.child, ".echo-semantic/route.json")))
      .verificationReceipt.result,
    "passed",
  );
  assert.ok(readFileSync(resolve(other, ".echo-semantic/preflight.json")));
});

test("词法归一化不能吞掉link/..并借用错误仓库授权", (t) => {
  const f = fixture(t);
  f.start(f.workspace);
  f.preflight(f.workspace);
  const outside = resolve(f.workspace, "../outside/subdir");
  mkdirSync(outside, { recursive: true });
  symlinkSync(outside, resolve(f.workspace, "link"));
  const path = "link/../target.txt";
  for (const tool_name of ["Write", "Delete"]) {
    const result = f.invoke(f.workspace, "pre-edit", {
      tool_name,
      tool_input: { path },
    });
    assert.equal(result.status, 2);
    assert.match(result.stderr, /符号链接/);
  }
  assert.equal(f.invoke(f.workspace, "pre-edit", patch(path)).status, 2);
});

test("不含链接的普通父目录相对路径保持事件cwd语义", (t) => {
  const f = fixture(t);
  f.start();
  f.preflight(f.child);
  const cwd = resolve(f.child, "deep");
  mkdirSync(cwd);
  const result = f.invoke(cwd, "pre-edit", patch("../target.txt"));
  assert.equal(result.status, 0, result.stderr);
});

test("父根起始观察不能授权消费另一个任务的预检和继续包", (t) => {
  const f = fixture(t);
  f.start(f.workspace);
  f.preflight(f.workspace);
  const statePath = resolve(f.workspace, ".echo-semantic/preflight.json");
  const state = JSON.parse(readFileSync(statePath));
  state.taskId = "another-parent-task";
  writeFileSync(statePath, JSON.stringify(state));
  const before = readFileSync(statePath, "utf8");
  f.start();
  f.preflight(f.child);
  assert.equal(
    f.invoke(f.workspace, "pre-edit", patch("child/target.txt")).status,
    0,
  );
  writeFileSync(resolve(f.child, "target.txt"), "after\n");
  for (const event of ["pre-compact", "stop"]) {
    const result = f.invoke(f.workspace, event);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(readFileSync(statePath, "utf8"), before);
  }
});

function checkpointFixture(t) {
  const f = fixture(t);
  writeFileSync(resolve(f.child, "target.txt"), "authorized initial dirty\n");
  f.start();
  const initial = loadSessionSnapshot(f.child, f.session);
  decideSessionChanges(
    f.child,
    f.session,
    initial.initialChanges.fingerprint,
    "adopt",
    ["target.txt"],
    "夹具明确接管本任务路径",
  );
  f.preflight(f.child);
  const admitted = f.invoke(f.workspace, "pre-edit", patch("child/target.txt"));
  assert.equal(admitted.status, 0, admitted.stderr);
  const oldHead = git(f.child, "rev-parse", "HEAD");
  git(f.child, "add", "target.txt");
  git(
    f.child,
    "-c",
    "commit.gpgsign=false",
    "commit",
    "-qm",
    "authorized checkpoint",
  );
  const newHead = git(f.child, "rev-parse", "HEAD");
  const disposition = (operation, extra = []) =>
    spawnSync(
      process.execPath,
      [
        resolve(plugin, "scripts/session-changes.mjs"),
        operation,
        "--root",
        f.child,
        "--session-id",
        f.session,
        ...extra,
      ],
      { encoding: "utf8" },
    );
  const refresh = () => {
    const result = disposition("refresh");
    assert.equal(result.status, 0, result.stderr);
    return JSON.parse(result.stdout).initialChanges.fingerprint;
  };
  const accept = () => {
    const fingerprint = refresh();
    const result = disposition("decide", [
      "--fingerprint",
      fingerprint,
      "--strategy",
      "preserve",
      "--basis",
      "已确认本任务checkpoint，当前零dirty继续原任务",
    ]);
    assert.equal(result.status, 0, result.stderr);
  };
  return { ...f, oldHead, newHead, refresh, accept };
}

test("正常commit后官方同session处置与预检续接Stop，无需额外编辑", (t) => {
  const f = checkpointFixture(t);
  f.accept();
  f.preflight(f.child);
  assert.equal(git(f.child, "status", "--porcelain"), "");
  const before = loadSessionSnapshot(f.child, f.session);
  const result = f.invoke(f.workspace, "stop");
  assert.equal(result.status, 0, result.stderr);
  assert.doesNotThrow(() => JSON.parse(result.stdout));
  const route = JSON.parse(
    readFileSync(resolve(f.child, ".echo-semantic/route.json")),
  );
  assert.equal(route.verificationReceipt.headRevision, f.newHead);
  assert.equal(route.verificationReceipt.taskId, "native-task");
  const after = loadSessionSnapshot(f.child, f.session);
  assert.equal(after.headRevision, before.headRevision);
  assert.equal(after.recordedAt, before.recordedAt);
  assert.equal(after.initialChanges.headRevision, f.newHead);
});

test("正常checkpoint也可保存PreCompact，绑定不依赖新的源码编辑", (t) => {
  const f = checkpointFixture(t);
  f.accept();
  f.preflight(f.child);
  const result = f.invoke(f.workspace, "pre-compact");
  assert.equal(result.status, 0, result.stderr);
  const continuation = JSON.parse(
    readFileSync(resolve(f.child, ".echo-semantic/continuation.json")),
  );
  assert.equal(continuation.taskId, "native-task");
});

for (const scenario of [
  "no-refresh",
  "pending",
  "no-preflight",
  "wrong-task",
  "unrelated-head",
  "wrong-session",
]) {
  test(`checkpoint续接仍拒绝未授权身份：${scenario}`, (t) => {
    const f = checkpointFixture(t);
    if (scenario === "unrelated-head") {
      git(f.child, "checkout", "--orphan", "unrelated");
      git(
        f.child,
        "-c",
        "commit.gpgsign=false",
        "commit",
        "-qm",
        "unrelated history",
      );
    }
    if (scenario === "pending") f.refresh();
    else if (scenario !== "no-refresh") f.accept();
    if (scenario !== "no-preflight") f.preflight(f.child);
    if (scenario === "wrong-task") {
      const path = resolve(f.child, ".echo-semantic/preflight.json");
      const state = JSON.parse(readFileSync(path));
      state.taskId = "different-task";
      writeFileSync(path, JSON.stringify(state));
    }
    const parentBefore = readFileSync(
      resolve(f.workspace, ".echo-semantic/session-snapshot.json"),
      "utf8",
    );
    const statePath = resolve(f.child, ".echo-semantic/preflight.json");
    const stateBefore = readFileSync(statePath, "utf8");
    const extra =
      scenario === "wrong-session" ? { session_id: "different-session" } : {};
    const result = f.invoke(f.workspace, "stop", extra);
    if (scenario === "wrong-session") {
      // 未知会话没有子仓路由，只能结束父根的空只读会话；不得消费子任务。
      assert.equal(result.status, 0, result.stderr);
      assert.equal(
        JSON.parse(readFileSync(resolve(f.child, ".echo-semantic/route.json")))
          .verificationReceipt,
        null,
      );
    } else assert.equal(result.status, 2, result.stdout + result.stderr);
    assert.equal(
      readFileSync(
        resolve(f.workspace, ".echo-semantic/session-snapshot.json"),
        "utf8",
      ),
      parentBefore,
    );
    assert.equal(readFileSync(statePath, "utf8"), stateBefore);
  });
}

test("checkpoint续接拒绝实际事件声明另一个任务", (t) => {
  const f = checkpointFixture(t);
  f.accept();
  f.preflight(f.child);
  const parentPath = resolve(
    f.workspace,
    ".echo-semantic/session-snapshot.json",
  );
  const parentBefore = readFileSync(parentPath, "utf8");
  const result = f.invoke(f.workspace, "stop", { task_id: "foreign-task" });
  assert.equal(result.status, 2, result.stdout);
  assert.equal(readFileSync(parentPath, "utf8"), parentBefore);
});

function squashCheckpointFixture(t) {
  const f = checkpointFixture(t);
  git(f.child, "branch", "main", f.oldHead);
  git(f.child, "branch", "-m", "topic");
  // 第二处必要任务编辑的真实准入把路由绑定到任务分支第一个commit。
  f.accept();
  f.preflight(f.child);
  const admitted = f.invoke(f.workspace, "pre-edit", patch("child/target.txt"));
  assert.equal(admitted.status, 0, admitted.stderr);
  const taskBindingHead = git(f.child, "rev-parse", "HEAD");
  writeFileSync(resolve(f.child, "target.txt"), "second task change\n");
  git(f.child, "add", "target.txt");
  git(
    f.child,
    "-c",
    "commit.gpgsign=false",
    "commit",
    "-qm",
    "second task commit",
  );
  const taskTip = git(f.child, "rev-parse", "HEAD");
  const taskTree = git(f.child, "rev-parse", "HEAD^{tree}");
  git(f.child, "checkout", "main");
  git(f.child, "merge", "--squash", "topic");
  git(f.child, "-c", "commit.gpgsign=false", "commit", "-qm", "squash task");
  const mainHead = git(f.child, "rev-parse", "HEAD");
  git(f.child, "branch", "-D", "topic");
  assert.equal(git(f.child, "status", "--porcelain"), "");
  assert.equal(git(f.child, "rev-parse", "HEAD^{tree}"), taskTree);
  const ancestry = spawnSync("git", [
    "-C",
    f.child,
    "merge-base",
    "--is-ancestor",
    taskBindingHead,
    mainHead,
  ]);
  assert.equal(ancestry.status, 1);
  assert.equal(git(f.child, "branch", "--list", "topic"), "");
  return { ...f, taskBindingHead, taskTip, mainHead };
}

test("真实两commit squash到main并删分支后，当前同session处置和PF可收口Stop", (t) => {
  const f = squashCheckpointFixture(t);
  f.accept();
  f.preflight(f.child);
  const original = loadSessionSnapshot(f.child, f.session);
  const result = f.invoke(f.workspace, "stop");
  assert.equal(result.status, 0, result.stderr);
  const route = JSON.parse(
    readFileSync(resolve(f.child, ".echo-semantic/route.json")),
  );
  assert.equal(route.verificationReceipt.headRevision, f.mainHead);
  assert.equal(route.verificationReceipt.taskId, "native-task");
  const after = loadSessionSnapshot(f.child, f.session);
  assert.equal(after.headRevision, original.headRevision);
  assert.equal(after.recordedAt, original.recordedAt);
});

for (const scenario of [
  "unconfirmed-head",
  "pending-decision",
  "old-preflight",
  "foreign-task",
]) {
  test(`squash后未经当前确认的HEAD或任务不借旧绑定：${scenario}`, (t) => {
    const f = squashCheckpointFixture(t);
    if (scenario === "pending-decision") f.refresh();
    else if (scenario !== "unconfirmed-head") f.accept();
    if (scenario !== "old-preflight") f.preflight(f.child);
    if (scenario === "foreign-task") {
      const path = resolve(f.child, ".echo-semantic/preflight.json");
      const state = JSON.parse(readFileSync(path));
      state.taskId = "other-task";
      writeFileSync(path, JSON.stringify(state));
    }
    const parentPath = resolve(
      f.workspace,
      ".echo-semantic/session-snapshot.json",
    );
    const before = readFileSync(parentPath, "utf8");
    const result = f.invoke(f.workspace, "stop");
    assert.equal(result.status, 2, result.stdout);
    assert.equal(readFileSync(parentPath, "utf8"), before);
  });
}
