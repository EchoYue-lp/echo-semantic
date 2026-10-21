import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  appendFileSync,
  existsSync,
  chmodSync,
  copyFileSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { computeRoute, readRoute } from "../runtime/route.mjs";
import {
  decideSessionChanges,
  loadSessionSnapshot,
} from "../runtime/session-state.mjs";

const root = resolve(import.meta.dirname, "..");
const hook = resolve(root, "hooks/entry.mjs");
const pluginVersion = JSON.parse(
  readFileSync(resolve(root, "package.json"), "utf8"),
).version;

function git(cwd, ...args) {
  const result = spawnSync("git", ["-C", cwd, ...args], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim();
}

function preflightState(repository, head, taskId, allowedPaths) {
  const value = {
    schemaVersion: 2,
    pluginId: "echo-semantic",
    scope: "task",
    repositoryRoot: realpathSync(repository),
    baseRevision: head,
    recordedAt: new Date().toISOString(),
    taskId,
    kind: "bugfix",
    risk: "low",
    allowedPaths,
    reuseCheck: {
      searchPaths: ["."],
      decision: "new",
      reason: "夹具已进行名称与行为检索",
      candidates: [],
      evidence: [],
    },
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
  };
  Object.defineProperty(value.reuseCheck, "evidence", {
    enumerable: true,
    get() {
      return [
        ...new Set([
          ...(value.semanticRefs ?? []),
          ...(value.repairRefs ?? []),
        ]),
      ].flatMap((ref) => {
        const paths = [
          "maps",
          "behaviors",
          "rules",
          "evidence",
          "findings",
          "audits",
          "discovery",
          "assets",
        ]
          .map((dir) => `.echo-semantic/${dir}/${ref}.md`)
          .filter((path) => {
            try {
              return (
                readFileSync(resolve(value.repositoryRoot, path)).length >= 0
              );
            } catch {
              return false;
            }
          });
        return paths.map((path) => ({
          path,
          contentDigest: createHash("sha256")
            .update(readFileSync(resolve(value.repositoryRoot, path)))
            .digest("hex"),
          mutable: false,
        }));
      });
    },
  });
  return value;
}

function fixtureHost(t) {
  const directory = mkdtempSync(resolve(tmpdir(), "echo-fixture-host-"));
  const command = resolve(
    directory,
    process.platform === "win32" ? "claude.exe" : "claude",
  );
  // 部分Node发行版依赖相对动态库，单独复制可执行文件不能启动。
  if (process.platform === "win32") copyFileSync(process.execPath, command);
  else symlinkSync(process.execPath, command);
  chmodSync(command, 0o755);
  const previousPath = process.env.PATH;
  process.env.PATH = `${directory}${delimiter}${previousPath ?? ""}`;
  t.after(() => {
    process.env.PATH = previousPath;
    rmSync(directory, { recursive: true, force: true });
  });
}

test("无基线任务也要求预检，并产生仅绑定任务范围的完成收据", (t) => {
  fixtureHost(t);
  const repository = realpathSync(
    mkdtempSync(resolve(tmpdir(), "echo-no-baseline-")),
  );
  t.after(() => rmSync(repository, { recursive: true, force: true }));
  git(repository, "init", "-q");
  git(repository, "config", "user.email", "fixture@example.com");
  git(repository, "config", "user.name", "Fixture");
  writeFileSync(resolve(repository, "target.txt"), "before\n");
  git(repository, "add", ".");
  git(repository, "-c", "commit.gpgsign=false", "commit", "-qm", "source");
  const invoke = (event, extra = {}) =>
    spawnSync("node", [hook, "claude-code", event], {
      cwd: repository,
      input: JSON.stringify({ cwd: repository, session_id: "local", ...extra }),
      encoding: "utf8",
    });
  assert.equal(invoke("session-start", { source: "startup" }).status, 0);
  const edit = { tool_name: "Write", tool_input: { file_path: "target.txt" } };
  assert.equal(invoke("pre-edit", edit).status, 2);
  writeFileSync(
    resolve(repository, ".echo-semantic/preflight.json"),
    JSON.stringify(
      preflightState(
        repository,
        git(repository, "rev-parse", "HEAD"),
        "local-task",
        ["target.txt"],
      ),
    ),
  );
  assert.equal(invoke("pre-edit", edit).status, 0);
  writeFileSync(resolve(repository, "target.txt"), "after\n");
  const stopped = invoke("stop");
  assert.equal(stopped.status, 0, stopped.stderr);
  const receipt = readRoute(repository).verificationReceipt;
  assert.equal(receipt.schemaVersion, 2);
  assert.equal(receipt.scope, "task");
  assert.equal(receipt.taskId, "local-task");
  assert.deepEqual(receipt.verifiedPaths, ["target.txt"]);
  assert.equal(invoke("stop").status, 0);
});

test("Baseline必须显式全项目验证，Stop记录真实范围且失败保留预检", (t) => {
  fixtureHost(t);
  const repository = realpathSync(
    mkdtempSync(resolve(tmpdir(), "echo-repository-stop-")),
  );
  t.after(() => rmSync(repository, { recursive: true, force: true }));
  git(repository, "init", "-q");
  git(repository, "config", "user.email", "fixture@example.com");
  git(repository, "config", "user.name", "Fixture");
  writeFileSync(resolve(repository, "target.txt"), "before\n");
  git(repository, "add", ".");
  git(repository, "-c", "commit.gpgsign=false", "commit", "-qm", "source");
  const sourceHead = git(repository, "rev-parse", "HEAD");
  const content = createHash("sha256").update("before\n").digest("hex");
  const digest = createHash("sha256")
    .update(`target.txt\0file:${content}\n`)
    .digest("hex");
  const semantic = resolve(repository, ".echo-semantic");
  for (const dir of [
    "maps",
    "behaviors",
    "rules",
    "evidence",
    "findings",
    "audits",
    "discovery",
    "assets",
  ]) {
    mkdirSync(resolve(semantic, dir), { recursive: true });
    writeFileSync(resolve(semantic, dir, ".gitkeep"), "");
  }
  writeFileSync(resolve(semantic, "README.md"), "# 夹具语义入口\n");
  const baseline = {
    schema_version: 1,
    id: "baseline.repository",
    kind: "baseline",
    source_snapshot: { base_revision: sourceHead, content_digest: digest },
    inventory_closure: "open",
    behavior_model_closure: "open",
    map_refs: [],
    regions: [{ path: "target.txt", status: "supporting" }],
    boundaries: [],
    coverage: [],
  };
  const headings = [
    "源码快照",
    "仓库区域",
    "能力图与边界",
    "覆盖网格",
    "未知与缺口",
    "闭合结论",
  ];
  appendFileSync(resolve(repository, ".git/info/exclude"), "\n/ignored.txt\n");
  writeFileSync(resolve(repository, "ignored.txt"), "anchor before\n");
  const evidence = {
    schema_version: 1,
    id: "evidence.ignored",
    kind: "evidence",
    observed_at: `source:${digest}`,
    source_refs: ["ignored.txt#anchor"],
    supports: [],
    limitations: ["夹具"],
  };
  writeFileSync(
    resolve(semantic, "evidence/evidence.ignored.md"),
    `---\n${JSON.stringify(evidence)}\n---\n# 夹具证据\n\n## 支持的结论\n\n夹具。\n\n## 来源与范围\n\n夹具。\n\n## 已知缺口\n\n夹具。\n`,
  );
  writeFileSync(
    resolve(semantic, "baseline.md"),
    `---\n${JSON.stringify(baseline, null, 2)}\n---\n# 夹具\n\n${headings.map((h) => `## ${h}\n\n已记录。`).join("\n\n")}\n`,
  );
  git(repository, "add", ".echo-semantic");
  git(repository, "-c", "commit.gpgsign=false", "commit", "-qm", "baseline");
  const invoke = (event, extra = {}) =>
    spawnSync("node", [hook, "claude-code", event], {
      cwd: repository,
      input: JSON.stringify({
        cwd: repository,
        session_id: "repository-stop",
        ...(event === "session-start" ? { source: "startup" } : {}),
        ...extra,
      }),
      encoding: "utf8",
    });
  assert.equal(invoke("session-start").status, 0);
  const statePath = resolve(semantic, "preflight.json");
  const state = JSON.parse(
    JSON.stringify(
      preflightState(
        repository,
        git(repository, "rev-parse", "HEAD"),
        "repository-task",
        [".echo-semantic/baseline.md", "target.txt"],
      ),
    ),
  );
  appendFileSync(
    resolve(repository, ".git/info/exclude"),
    "\n/task-basis.txt\n",
  );
  writeFileSync(resolve(repository, "task-basis.txt"), "basis before\n");
  state.reuseCheck.evidence.push({
    path: "task-basis.txt",
    contentDigest: createHash("sha256").update("basis before\n").digest("hex"),
    mutable: false,
  });
  writeFileSync(statePath, JSON.stringify(state));
  writeFileSync(
    resolve(semantic, "baseline.md"),
    readFileSync(resolve(semantic, "baseline.md"), "utf8") + "\n补充结论。\n",
  );
  const local = invoke("stop");
  assert.equal(local.status, 2);
  assert.match(local.stderr, /Baseline/);
  assert.ok(existsSync(statePath));
  assert.equal(readRoute(repository).verificationReceipt, null);
  const mismatch = spawnSync(
    "uv",
    [
      "run",
      resolve(root, "skills/semantic-contract/scripts/verify_semantic.py"),
      "--root",
      repository,
      "--repository-scope",
      "--task-id",
      state.taskId,
      "--base",
      state.baseRevision,
    ],
    { encoding: "utf8" },
  );
  assert.notEqual(mismatch.status, 0);
  assert.match(mismatch.stderr, /verificationScope/);
  state.verificationScope = "repository";
  writeFileSync(statePath, JSON.stringify(state));
  const downgrade = spawnSync(
    "uv",
    [
      "run",
      resolve(root, "skills/semantic-contract/scripts/verify_semantic.py"),
      "--root",
      repository,
      "--task-scope",
      "--task-id",
      state.taskId,
      "--base",
      state.baseRevision,
    ],
    { encoding: "utf8" },
  );
  assert.notEqual(downgrade.status, 0);
  assert.match(downgrade.stderr, /verificationScope/);
  const policyCheck = spawnSync(
    "node",
    [
      resolve(root, "scripts/session-changes.mjs"),
      "inspect",
      "--root",
      repository,
      "--session-id",
      "repository-stop",
    ],
    { encoding: "utf8" },
  );
  const policy = JSON.parse(policyCheck.stdout).disposition;
  assert.ok(
    policy === null || ["adopt", "preserve"].includes(policy.state),
    JSON.stringify(policy),
  );
  assert.equal(invoke("stop", { task_id: "wrong-task" }).status, 2);
  assert.ok(existsSync(statePath));
  const full = invoke("stop");
  assert.equal(full.status, 0, full.stderr);
  const receipt = readRoute(repository).verificationReceipt;
  assert.equal(receipt.scope, "repository");
  assert.equal(readRoute(repository).verificationScope, "repository");
  assert.equal(receipt.repositorySnapshot, `source:${digest}`);
  assert.equal(receipt.taskId, state.taskId);
  assert.ok(receipt.evidencePaths.includes(".echo-semantic/baseline.md"));
  assert.ok(!existsSync(statePath));
  assert.equal(invoke("stop").status, 0);
  assert.equal(readRoute(repository).verificationScope, "repository");
  appendFileSync(
    resolve(repository, ".git/info/exclude"),
    "\n/.echo-semantic/evidence/ignored.md\n",
  );
  writeFileSync(
    resolve(semantic, "evidence/ignored.md"),
    "invalid semantic material",
  );
  assert.equal(invoke("stop").status, 2);
  rmSync(resolve(semantic, "evidence/ignored.md"));
  assert.equal(invoke("stop").status, 0);
  writeFileSync(resolve(repository, "ignored.txt"), "anchor after\n");
  assert.equal(invoke("stop").status, 2);
  writeFileSync(resolve(repository, "ignored.txt"), "anchor before\n");
  assert.equal(invoke("stop").status, 0);
  writeFileSync(resolve(repository, "task-basis.txt"), "basis after\n");
  assert.equal(invoke("stop").status, 2);
  writeFileSync(resolve(repository, "task-basis.txt"), "basis before\n");
  assert.equal(invoke("stop").status, 0);
  assert.equal(invoke("stop", { task_id: "another-task" }).status, 2);
  writeFileSync(resolve(repository, "target.txt"), "changed\n");
  assert.equal(invoke("stop").status, 2);
  writeFileSync(statePath, JSON.stringify(state));
  const stale = invoke("stop");
  assert.equal(stale.status, 2);
  assert.match(stale.stderr, /摘要/);
  assert.ok(existsSync(statePath));
  assert.equal(
    readRoute(repository).verificationReceipt.worktreeFingerprint,
    receipt.worktreeFingerprint,
  );
  writeFileSync(resolve(repository, "target.txt"), "before\n");
  writeFileSync(resolve(repository, "outside.txt"), "outside\n");
  const outside = invoke("stop");
  assert.equal(outside.status, 2);
  assert.match(outside.stderr, /超出预检允许路径/);
  assert.ok(existsSync(statePath));
  if (process.platform !== "win32") {
    rmSync(resolve(repository, "outside.txt"));
    const realUv = spawnSync("which", ["uv"], {
      encoding: "utf8",
    }).stdout.trim();
    const commands = mkdtempSync(resolve(tmpdir(), "echo-stop-race-"));
    t.after(() => rmSync(commands, { recursive: true, force: true }));
    const previousPath = process.env.PATH;
    for (const mode of [
      "preflight",
      "continuation",
      "ignored-basis",
      "ignored-material",
      "replay-source",
      "replay-basis",
    ]) {
      writeFileSync(resolve(repository, "target.txt"), "before\n");
      writeFileSync(resolve(repository, "task-basis.txt"), "basis before\n");
      rmSync(resolve(semantic, "evidence/ignored.md"), { force: true });
      if (mode.startsWith("replay")) rmSync(statePath, { force: true });
      else writeFileSync(statePath, JSON.stringify(state));
      rmSync(resolve(semantic, "continuation.json"), { force: true });
      const wrapper = `#!/usr/bin/env node
const fs=require('node:fs');
const p=require('node:path');
const {spawnSync}=require('node:child_process');
const args=process.argv.slice(2);
const r=spawnSync(${JSON.stringify(realUv)},args,{encoding:'utf8',env:process.env,input:args.includes('--task-evidence-stdin')?fs.readFileSync(0,'utf8'):undefined});
const mode=${JSON.stringify(mode)};
if(r.status===0&&args.includes(mode.startsWith('replay')?'--repository-receipt-check':'--repository-scope')) {
  const root=args[args.indexOf('--root')+1];
  const dir=p.join(root,'.echo-semantic');
  if(mode==='preflight') {
    const path=p.join(dir,'preflight.json');
    const s=JSON.parse(fs.readFileSync(path,'utf8'));
    s.taskId='new-concurrent-task';
    fs.writeFileSync(path,JSON.stringify(s));
  } else if(mode==='continuation') {
    fs.writeFileSync(p.join(dir,'continuation.json'),JSON.stringify({taskId:'new-concurrent-task'}));
  } else if(mode==='ignored-material') {
    fs.writeFileSync(p.join(dir,'evidence','ignored.md'),'invalid after validation');
  } else if(mode==='replay-source') {
    fs.writeFileSync(p.join(root,'target.txt'),'code raced');
  } else {
    fs.writeFileSync(p.join(root,'task-basis.txt'),'basis raced');
  }
}
process.stdout.write(r.stdout||'');
process.stderr.write(r.stderr||'');
process.exit(r.status??1);
`;
      writeFileSync(resolve(commands, "uv"), wrapper);
      chmodSync(resolve(commands, "uv"), 0o755);
      process.env.PATH = `${commands}${delimiter}${previousPath}`;
      let result;
      try {
        result = invoke("stop");
      } finally {
        process.env.PATH = previousPath;
      }
      assert.equal(result.status, 2, result.stderr);
      if (["preflight", "continuation"].includes(mode))
        assert.match(result.stderr, /预检或继续包已变化/);
      if (!mode.startsWith("replay")) assert.ok(existsSync(statePath));
      if (mode === "preflight")
        assert.equal(
          JSON.parse(readFileSync(statePath, "utf8")).taskId,
          "new-concurrent-task",
        );
      else if (mode === "continuation")
        assert.equal(
          JSON.parse(
            readFileSync(resolve(semantic, "continuation.json"), "utf8"),
          ).taskId,
          "new-concurrent-task",
        );
      else if (mode === "ignored-material")
        assert.equal(
          readFileSync(resolve(semantic, "evidence/ignored.md"), "utf8"),
          "invalid after validation",
        );
      else if (mode === "replay-source")
        assert.equal(
          readFileSync(resolve(repository, "target.txt"), "utf8"),
          "code raced",
        );
      else
        assert.equal(
          readFileSync(resolve(repository, "task-basis.txt"), "utf8"),
          "basis raced",
        );
      assert.equal(
        readRoute(repository).verificationReceipt.verifiedAt,
        receipt.verifiedAt,
      );
    }
  }
});

test("SessionStart 为不同宿主输出对应上下文字段", () => {
  const repository = mkdtempSync(
    resolve(tmpdir(), "echo-semantic-session-context-"),
  );
  git(repository, "init", "-q");
  const input = JSON.stringify({ cwd: repository });
  const cursor = spawnSync("node", [hook, "cursor", "session-start"], {
    cwd: repository,
    input,
    encoding: "utf8",
  });
  const claude = spawnSync("node", [hook, "claude-code", "session-start"], {
    cwd: repository,
    input,
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
  const codex = spawnSync("node", [hook, "codex", "session-start"], {
    cwd: repository,
    input,
    encoding: "utf8",
  });
  assert.equal(codex.status, 0);
  assert.match(
    JSON.parse(codex.stdout).hookSpecificOutput.additionalContext,
    /semantic-preflight/,
  );
  assert.equal(
    JSON.parse(codex.stdout).hookSpecificOutput.hookEventName,
    "SessionStart",
  );
});

test("SessionStart 在项目根生成用户可见状态", () => {
  const repository = mkdtempSync(
    resolve(tmpdir(), "echo-semantic-visible-status-"),
  );
  git(repository, "init", "-q");
  const result = spawnSync("node", [hook, "codex", "session-start"], {
    cwd: repository,
    input: JSON.stringify({ cwd: repository, source: "startup" }),
    encoding: "utf8",
  });
  assert.equal(result.status, 0, result.stderr);
  const state = JSON.parse(
    readFileSync(resolve(repository, ".echo-semantic/status.json"), "utf8"),
  );
  assert.equal(state.host, "codex");
  assert.equal(state.event, "startup");
  assert.equal(state.state, "ready");
  assert.match(
    readFileSync(resolve(repository, ".echo-semantic/status.md"), "utf8"),
    /Echo Semantic/,
  );
  assert.equal(git(repository, "status", "--short"), "");
});

test("插件单独触发时保持等待，不自动扫描全项目", () => {
  const repository = mkdtempSync(
    resolve(tmpdir(), "echo-semantic-maintenance-"),
  );
  git(repository, "init", "-q");
  git(repository, "config", "user.email", "test@example.com");
  git(repository, "config", "user.name", "Test");
  mkdirSync(resolve(repository, ".echo-semantic"));
  writeFileSync(
    resolve(repository, ".echo-semantic/baseline.md"),
    "baseline\n",
  );
  git(repository, "add", ".");
  git(repository, "-c", "commit.gpgsign=false", "commit", "-qm", "baseline");
  const result = spawnSync("node", [hook, "claude-code", "session-start"], {
    cwd: repository,
    input: JSON.stringify({ cwd: repository, source: "startup" }),
    encoding: "utf8",
  });
  assert.equal(result.status, 0, result.stderr);
  const context = JSON.parse(result.stdout).hookSpecificOutput
    .additionalContext;
  assert.doesNotMatch(
    context,
    /semantic-discover|semantic-consolidate|semantic-audit/,
  );
  assert.doesNotMatch(
    context,
    /semantic-discover|semantic-consolidate|semantic-audit/,
  );
  assert.doesNotMatch(
    context,
    /semantic-discover|semantic-consolidate|semantic-audit/,
  );
  assert.match(context, /semantic-verify/);
  assert.doesNotMatch(
    context,
    /semantic-discover|semantic-consolidate|semantic-audit/,
  );
  assert.match(context, /无明确任务时等待/);
});

test("已采用语义基线的项目阻断预检范围外编辑", () => {
  const repository = mkdtempSync(resolve(tmpdir(), "echo-semantic-hook-"));
  git(repository, "init", "-q");
  mkdirSync(resolve(repository, ".echo-semantic"));
  writeFileSync(
    resolve(repository, ".echo-semantic/baseline.md"),
    "baseline\n",
    "utf8",
  );
  git(repository, "config", "user.email", "test@example.com");
  git(repository, "config", "user.name", "Test");
  git(repository, "add", ".echo-semantic/baseline.md");
  git(repository, "-c", "commit.gpgsign=false", "commit", "-qm", "baseline");
  const head = git(repository, "rev-parse", "HEAD");
  const state = resolve(repository, ".echo-semantic/preflight.json");
  mkdirSync(resolve(state, ".."), { recursive: true });
  writeFileSync(
    state,
    JSON.stringify(
      preflightState(repository, head, "task-scope-test", ["src"]),
    ),
    "utf8",
  );
  const allowed = spawnSync("node", [hook, "cursor", "pre-edit"], {
    cwd: repository,
    input: JSON.stringify({ cwd: repository, file_path: "src/lib.rs" }),
    encoding: "utf8",
  });
  assert.equal(allowed.status, 0);
  assert.deepEqual(JSON.parse(allowed.stdout), { permission: "allow" });

  const denied = spawnSync("node", [hook, "cursor", "pre-edit"], {
    cwd: repository,
    input: JSON.stringify({ cwd: repository, file_path: "docs/readme.md" }),
    encoding: "utf8",
  });
  assert.equal(denied.status, 2);
  assert.match(denied.stderr, /超出/);
  const deniedPayload = JSON.parse(denied.stdout);
  assert.equal(deniedPayload.permission, "deny");
  assert.match(deniedPayload.agent_message, /超出/);
  assert.match(deniedPayload.user_message, /超出/);

  const malformedState = preflightState(
    repository,
    head,
    "task-malformed-test",
    ["src"],
  );
  delete malformedState.reuse;
  writeFileSync(state, JSON.stringify(malformedState), "utf8");
  const malformed = spawnSync("node", [hook, "cursor", "pre-edit"], {
    cwd: repository,
    input: JSON.stringify({ cwd: repository, file_path: "src/lib.rs" }),
    encoding: "utf8",
  });
  assert.equal(malformed.status, 2);
  assert.match(malformed.stderr, /没有当前任务的有效 semantic-preflight/);

  const missingReference = preflightState(
    repository,
    head,
    "task-missing-reference",
    ["src"],
  );
  missingReference.semanticRefs = ["rule.missing"];
  writeFileSync(state, JSON.stringify(missingReference), "utf8");
  const missing = spawnSync("node", [hook, "cursor", "pre-edit"], {
    cwd: repository,
    input: JSON.stringify({ cwd: repository, file_path: "src/lib.rs" }),
    encoding: "utf8",
  });
  assert.equal(missing.status, 2);
  assert.match(missing.stderr, /没有当前任务的有效 semantic-preflight/);
});

test("受控删除只允许已批准 repair 的目标路径", () => {
  const repository = mkdtempSync(resolve(tmpdir(), "echo-semantic-delete-"));
  git(repository, "init", "-q");
  git(repository, "config", "user.email", "test@example.com");
  git(repository, "config", "user.name", "Test");
  mkdirSync(resolve(repository, ".echo-semantic/findings"), {
    recursive: true,
  });
  mkdirSync(resolve(repository, ".echo-semantic/evidence"), {
    recursive: true,
  });
  mkdirSync(resolve(repository, ".echo-semantic/assets"), {
    recursive: true,
  });
  writeFileSync(
    resolve(repository, ".echo-semantic/baseline.md"),
    "baseline\n",
  );
  writeFileSync(
    resolve(repository, ".echo-semantic/findings/finding.repair.md"),
    "---\nid: finding.repair\nkind: finding\nstatus: resolved\ntype: consolidation_candidate\ndecision: migrate\ncanonical_asset_ref: asset.new\ncandidate_asset_refs: [asset.old, asset.new]\ndelete_paths: [old.txt]\nreplacement_refs: [asset.new]\nrollback_ref: revert-old\nverification_evidence_refs: [evidence.equivalence]\n---\n\n# repair\n",
  );
  writeFileSync(
    resolve(repository, ".echo-semantic/assets/asset.old.md"),
    "---\nid: asset.old\nkind: asset\nstatus: active\ncode_refs: [old.txt#old]\n---\n\n# asset\n",
  );
  writeFileSync(
    resolve(repository, ".echo-semantic/assets/asset.new.md"),
    "---\nid: asset.new\nkind: asset\nstatus: active\ncode_refs: [new.txt#new]\n---\n\n# asset\n",
  );
  writeFileSync(
    resolve(repository, ".echo-semantic/evidence/evidence.equivalence.md"),
    "---\nid: evidence.equivalence\nkind: evidence\nevidence_type: behavior_equivalence\nbefore_revision: before\nafter_revision: after\ndeleted_paths: [old.txt]\nscenario_results:\n  smoke:\n    status: matched\n---\n\n# evidence\n",
  );
  git(repository, "add", ".");
  git(repository, "-c", "commit.gpgsign=false", "commit", "-qm", "baseline");
  assert.equal(
    spawnSync("node", [hook, "cursor", "session-start"], {
      cwd: repository,
      input: JSON.stringify({ cwd: repository, session_id: "delete-scope" }),
      encoding: "utf8",
    }).status,
    0,
  );
  const head = git(repository, "rev-parse", "HEAD");
  writeFileSync(resolve(repository, "old.txt"), "old\n");
  const state = preflightState(repository, head, "task-delete-test", [
    "old.txt",
  ]);
  state.risk = "high";
  state.repairRefs = ["finding.repair"];
  state.deletePaths = ["old.txt"];
  writeFileSync(
    resolve(repository, ".echo-semantic/preflight.json"),
    JSON.stringify(state),
  );

  const allowed = spawnSync("node", [hook, "cursor", "pre-edit"], {
    cwd: repository,
    input: JSON.stringify({
      cwd: repository,
      tool_name: "Delete",
      session_id: "delete-scope",
      tool_input: { path: "old.txt" },
    }),
    encoding: "utf8",
  });
  assert.equal(allowed.status, 0, allowed.stderr);
  assert.deepEqual(JSON.parse(allowed.stdout), { permission: "allow" });

  writeFileSync(
    resolve(repository, ".echo-semantic/findings/finding.repair.md"),
    "---\nid: finding.repair\nkind: finding\nstatus: resolved\n---\n\n# repair\n",
  );
  const malformedRepair = spawnSync("node", [hook, "cursor", "pre-edit"], {
    cwd: repository,
    input: JSON.stringify({
      cwd: repository,
      tool_name: "Delete",
      session_id: "delete-scope",
      tool_input: { path: "old.txt" },
    }),
    encoding: "utf8",
  });
  assert.equal(malformedRepair.status, 2);
  assert.match(
    malformedRepair.stderr,
    /没有已批准的 repair|没有当前任务的有效/,
  );

  writeFileSync(
    resolve(repository, ".echo-semantic/findings/finding.repair.md"),
    "---\nid: finding.repair\nkind: finding\nstatus: resolved\ntype: consolidation_candidate\ndecision: migrate\ncanonical_asset_ref: asset.new\ncandidate_asset_refs: [asset.old, asset.new]\ndelete_paths: [old.txt]\nreplacement_refs: [asset.new]\nrollback_ref: revert-old\nverification_evidence_refs: [evidence.missing]\n---\n\n# repair\n",
  );
  const missingEvidence = spawnSync("node", [hook, "cursor", "pre-edit"], {
    cwd: repository,
    input: JSON.stringify({
      cwd: repository,
      tool_name: "Delete",
      session_id: "delete-scope",
      tool_input: { path: "old.txt" },
    }),
    encoding: "utf8",
  });
  assert.equal(missingEvidence.status, 2);
  assert.match(
    missingEvidence.stderr,
    /没有已批准的 repair|没有当前任务的有效/,
  );

  state.deletePaths = [];
  writeFileSync(
    resolve(repository, ".echo-semantic/preflight.json"),
    JSON.stringify(state),
  );
  const denied = spawnSync("node", [hook, "cursor", "pre-edit"], {
    cwd: repository,
    input: JSON.stringify({
      cwd: repository,
      tool_name: "Delete",
      session_id: "delete-scope",
      tool_input: { path: "old.txt" },
    }),
    encoding: "utf8",
  });
  assert.equal(denied.status, 2);
  assert.match(denied.stderr, /没有已批准的 repair|没有当前任务的有效/);
});

test("设计权威摘要变化后 Hook 拒绝沿用高风险预检", () => {
  const repository = mkdtempSync(resolve(tmpdir(), "echo-semantic-authority-"));
  git(repository, "init", "-q");
  git(repository, "config", "user.email", "test@example.com");
  git(repository, "config", "user.name", "Test");
  mkdirSync(resolve(repository, ".echo-semantic/rules"), { recursive: true });
  writeFileSync(
    resolve(repository, ".echo-semantic/baseline.md"),
    "baseline\n",
    "utf8",
  );
  writeFileSync(
    resolve(repository, ".echo-semantic/rules/rule.authority.md"),
    "---\nid: rule.authority\n---\n",
    "utf8",
  );
  const designPath = resolve(repository, "docs/design/design.md");
  mkdirSync(resolve(designPath, ".."), { recursive: true });
  const design =
    "# 设计\n\n## 目标\n目标\n\n## 范围\n范围\n\n## 方案\n方案\n\n## 验收\n验收\n";
  writeFileSync(designPath, design, "utf8");
  git(repository, "add", ".");
  git(repository, "-c", "commit.gpgsign=false", "commit", "-qm", "baseline");
  assert.equal(
    spawnSync("node", [hook, "cursor", "session-start"], {
      cwd: repository,
      input: JSON.stringify({ cwd: repository, session_id: "authority-scope" }),
      encoding: "utf8",
    }).status,
    0,
  );
  const head = git(repository, "rev-parse", "HEAD");
  const state = preflightState(repository, head, "task-authority-test", [
    "src",
  ]);
  state.risk = "high";
  state.basis = ["架构依据"];
  state.semanticRefs = ["rule.authority"];
  state.signals.architectureChange = true;
  state.designAuthorities = [
    {
      path: "docs/design/design.md",
      kind: "design",
      contentDigest: createHash("sha256").update(design).digest("hex"),
    },
  ];
  writeFileSync(
    resolve(repository, ".echo-semantic/preflight.json"),
    JSON.stringify(state),
    "utf8",
  );
  writeFileSync(designPath, `${design}变化\n`, "utf8");

  const result = spawnSync("node", [hook, "cursor", "pre-edit"], {
    cwd: repository,
    input: JSON.stringify({
      cwd: repository,
      file_path: "src/lib.rs",
      session_id: "authority-scope",
    }),
    encoding: "utf8",
  });
  assert.equal(result.status, 2);
  assert.match(result.stderr, /没有当前任务的有效 semantic-preflight/);
});

test("Cursor 按官方工具名识别写入路径，并放行只读工具", () => {
  const repository = mkdtempSync(
    resolve(tmpdir(), "echo-semantic-cursor-tool-"),
  );
  git(repository, "init", "-q");
  mkdirSync(resolve(repository, ".echo-semantic"));
  writeFileSync(
    resolve(repository, ".echo-semantic/baseline.md"),
    "baseline\n",
    "utf8",
  );
  git(repository, "config", "user.email", "test@example.com");
  git(repository, "config", "user.name", "Test");
  git(repository, "add", ".echo-semantic/baseline.md");
  git(repository, "-c", "commit.gpgsign=false", "commit", "-qm", "baseline");
  const head = git(repository, "rev-parse", "HEAD");
  writeFileSync(
    resolve(repository, ".echo-semantic/preflight.json"),
    JSON.stringify(
      preflightState(repository, head, "task-cursor-tool", ["src"]),
    ),
    "utf8",
  );
  const write = spawnSync("node", [hook, "cursor", "pre-edit"], {
    cwd: repository,
    input: JSON.stringify({
      cwd: repository,
      tool_name: "Write",
      tool_input: { path: "src/lib.rs" },
    }),
    encoding: "utf8",
  });
  assert.equal(write.status, 0, write.stderr);
  assert.deepEqual(JSON.parse(write.stdout), { permission: "allow" });

  const denied = spawnSync("node", [hook, "cursor", "pre-edit"], {
    cwd: repository,
    input: JSON.stringify({
      cwd: repository,
      tool_name: "StrReplace",
      tool_input: { path: "docs/readme.md" },
    }),
    encoding: "utf8",
  });
  assert.equal(denied.status, 2);
  assert.equal(JSON.parse(denied.stdout).permission, "deny");

  const read = spawnSync("node", [hook, "cursor", "pre-edit"], {
    cwd: repository,
    input: JSON.stringify({
      cwd: repository,
      tool_name: "Read",
      tool_input: { path: "docs/readme.md" },
    }),
    encoding: "utf8",
  });
  assert.equal(read.status, 0, read.stderr);
  assert.deepEqual(JSON.parse(read.stdout), { permission: "allow" });
});

test("失败 Stop 不被去重且保留预检供连续重试", () => {
  const repository = mkdtempSync(resolve(tmpdir(), "echo-semantic-stop-"));
  git(repository, "init", "-q");
  git(repository, "config", "user.email", "test@example.com");
  git(repository, "config", "user.name", "Test");
  mkdirSync(resolve(repository, ".echo-semantic"));
  writeFileSync(
    resolve(repository, ".echo-semantic/baseline.md"),
    "无效基线\n",
    "utf8",
  );
  git(repository, "add", ".echo-semantic/baseline.md");
  git(repository, "-c", "commit.gpgsign=false", "commit", "-qm", "baseline");
  const head = git(repository, "rev-parse", "HEAD");
  const sessionId = "verification-failure";
  const started = spawnSync("node", [hook, "claude-code", "session-start"], {
    cwd: repository,
    input: JSON.stringify({
      cwd: repository,
      source: "startup",
      session_id: sessionId,
    }),
    encoding: "utf8",
  });
  assert.equal(started.status, 0, started.stderr);
  writeFileSync(resolve(repository, "change.txt"), "change\n", "utf8");
  const state = resolve(repository, ".echo-semantic/preflight.json");
  mkdirSync(resolve(state, ".."), { recursive: true });
  writeFileSync(
    state,
    JSON.stringify(
      preflightState(repository, head, "task-stop-test", ["change.txt"]),
    ),
    "utf8",
  );
  writeFileSync(resolve(repository, "unexpected.txt"), "超出允许路径\n");
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const result = spawnSync("node", [hook, "cursor", "stop"], {
      cwd: repository,
      input: JSON.stringify({
        cwd: repository,
        session_id: sessionId,
        task_id: "task-stop-test",
        stop_hook_active: true,
      }),
      encoding: "utf8",
    });
    assert.equal(result.status, 0, result.stderr);
    assert.match(
      JSON.parse(result.stdout).followup_message,
      /语义完成门禁未通过/,
    );
    assert.equal(readFileSync(state, "utf8").includes("task-stop-test"), true);
  }
  const claude = spawnSync("node", [hook, "claude-code", "stop"], {
    cwd: repository,
    input: JSON.stringify({
      cwd: repository,
      session_id: sessionId,
      task_id: "task-stop-test",
      stop_hook_active: true,
    }),
    encoding: "utf8",
  });
  assert.equal(claude.status, 2);
  assert.match(claude.stderr, /语义完成门禁未通过/);
  assert.equal(JSON.parse(claude.stdout).decision, "block");
  const codex = spawnSync("node", [hook, "codex", "stop"], {
    cwd: repository,
    input: JSON.stringify({
      cwd: repository,
      session_id: sessionId,
      task_id: "task-stop-test",
      stop_hook_active: true,
    }),
    encoding: "utf8",
  });
  assert.equal(codex.status, 2);
  assert.equal(JSON.parse(codex.stdout).decision, "block");
  assert.match(JSON.parse(codex.stdout).reason, /语义完成门禁未通过/);
});

function settlementFixture() {
  const repository = mkdtempSync(resolve(tmpdir(), "echo-settlement-"));
  git(repository, "init", "-q");
  git(repository, "config", "user.email", "test@example.com");
  git(repository, "config", "user.name", "Test");
  mkdirSync(resolve(repository, ".echo-semantic"));
  writeFileSync(
    resolve(repository, ".echo-semantic/baseline.md"),
    "无效基线\n",
  );
  git(repository, "add", ".");
  git(repository, "-c", "commit.gpgsign=false", "commit", "-qm", "baseline");
  const invoke = (event, extra = {}) =>
    spawnSync("node", [hook, "claude-code", event], {
      cwd: repository,
      input: JSON.stringify({
        cwd: repository,
        session_id: "settlement",
        ...extra,
      }),
      encoding: "utf8",
    });
  assert.equal(invoke("session-start", { source: "startup" }).status, 0);
  return { repository, invoke };
}

test("已有差异首次询问，未裁决只读 Stop 不循环且不得写入", () => {
  const { repository, invoke } = settlementFixture();
  writeFileSync(resolve(repository, "existing.txt"), "existing\n");
  const start = invoke("session-start", {
    source: "startup",
    session_id: "initial-disposition",
  });
  assert.equal(start.status, 0, start.stderr);
  assert.match(start.stdout, /第一轮.*询问.*处置策略/);
  assert.match(start.stdout, /不得只说明.*存在已有差异/);
  assert.match(start.stdout, /具体路径.*状态/);
  assert.match(start.stdout, /任务.*重叠/);
  assert.match(start.stdout, /推荐.*理由/);
  const path = resolve(repository, ".echo-semantic/preflight.json");
  writeFileSync(
    path,
    JSON.stringify(
      preflightState(
        repository,
        git(repository, "rev-parse", "HEAD"),
        "pending",
        ["new.txt"],
      ),
    ),
  );
  const edit = invoke("pre-edit", {
    session_id: "initial-disposition",
    tool_name: "Write",
    tool_input: { file_path: "new.txt" },
  });
  assert.equal(edit.status, 2);
  assert.match(edit.stderr, /待裁决/);
  for (const stop_hook_active of [false, true]) {
    const stopped = invoke("stop", {
      session_id: "initial-disposition",
      stop_hook_active,
    });
    assert.equal(stopped.status, 0, stopped.stderr);
    assert.deepEqual(JSON.parse(stopped.stdout), {});
    const status = JSON.parse(
      readFileSync(resolve(repository, ".echo-semantic/status.json"), "utf8"),
    );
    assert.match(status.message, /待裁决.*未验证/);
    assert.equal(existsSync(path), true);
    assert.equal(readRoute(repository).verificationReceipt, null);
  }
});

function initialPolicyFixture() {
  const { repository, invoke: previous } = settlementFixture();
  writeFileSync(resolve(repository, "existing.txt"), "existing\n");
  const invoke = (event, extra = {}) =>
    previous(event, { session_id: "policy", ...extra });
  assert.equal(invoke("session-start", { source: "startup" }).status, 0);
  const root = realpathSync(repository);
  const decide = (strategy, paths = []) =>
    decideSessionChanges(
      root,
      "policy",
      readRoute(root).worktreeFingerprint,
      strategy,
      paths,
      "用户明确确认该策略",
    );
  const preflight = () =>
    writeFileSync(
      resolve(root, ".echo-semantic/preflight.json"),
      JSON.stringify(
        preflightState(root, git(root, "rev-parse", "HEAD"), "policy-task", [
          "new.txt",
          "existing.txt",
        ]),
      ),
    );
  const edit = (path) =>
    invoke("pre-edit", { tool_name: "Write", tool_input: { file_path: path } });
  return { root, invoke, decide, preflight, edit };
}

test("保留策略允许本轮新路径，但拒绝已有路径且恢复不丢裁决", () => {
  const { root, invoke, decide, preflight, edit } = initialPolicyFixture();
  decide("preserve");
  preflight();
  assert.equal(edit("new.txt").status, 0);
  const protectedEdit = edit("existing.txt");
  assert.equal(protectedEdit.status, 2);
  assert.match(protectedEdit.stderr, /已有差异路径受保护/);
  const initial = loadSessionSnapshot(root, "policy").initialChanges;
  assert.equal(invoke("session-start", { source: "resume" }).status, 0);
  assert.deepEqual(loadSessionSnapshot(root, "policy").initialChanges, initial);
  writeFileSync(resolve(root, "existing.txt"), "changed externally\n");
  const invalidatedEdit = edit("new.txt");
  assert.equal(invalidatedEdit.status, 2);
  assert.match(invalidatedEdit.stderr, /待裁决/);
  assert.equal(invoke("stop").status, 2);
  assert.equal(invoke("stop", { stop_hook_active: true }).status, 0);
  assert.equal(readRoute(root).verificationReceipt, null);
});

test("轻量编辑准入仍拒绝任务错配和缺少路径的写入", () => {
  const { root, invoke, decide, preflight } = initialPolicyFixture();
  decide("preserve");
  preflight();
  const wrongTask = invoke("pre-edit", {
    tool_name: "Edit",
    task_id: "another-task",
    tool_input: { file_path: "new.txt" },
  });
  assert.equal(wrongTask.status, 2);
  assert.match(wrongTask.stderr, /当前任务/);
  const missingPath = invoke("pre-edit", { tool_name: "Edit", tool_input: {} });
  assert.equal(missingPath.status, 2);
  assert.match(missingPath.stderr, /缺少可检查路径/);
  assert.equal(readRoute(root).verificationReceipt, null);
});

test("结构化补丁按补丁头逐路径检查，不把 apply_patch 误判为缺少路径", () => {
  const { invoke, decide, preflight } = initialPolicyFixture();
  decide("preserve");
  preflight();
  const patch = (body) =>
    invoke("pre-edit", {
      tool_name: "apply_patch",
      tool_input: { patch: `*** Begin Patch\n${body}\n*** End Patch` },
    });
  assert.equal(patch("*** Update File: new.txt").status, 0);
  const protectedPath = patch(
    "*** Update File: new.txt\n*** Update File: existing.txt",
  );
  assert.equal(protectedPath.status, 2);
  assert.match(protectedPath.stderr, /existing\.txt/);
  const outside = patch("*** Add File: other.txt");
  assert.equal(outside.status, 2);
  assert.match(outside.stderr, /other\.txt/);
  const malformed = invoke("pre-edit", {
    tool_name: "apply_patch",
    tool_input: { patch: "*** Begin Patch\n*** End Patch" },
  });
  assert.equal(malformed.status, 2);
  assert.match(malformed.stderr, /缺少可检查路径/);
  const topLevelCommand = invoke("pre-edit", {
    tool_name: "apply_patch",
    command: "*** Begin Patch\n*** Update File: new.txt\n*** End Patch",
  });
  assert.equal(topLevelCommand.status, 0, topLevelCommand.stderr);
  for (const body of [
    "*** Delete File: new.txt",
    "*** Update File: new.txt\n*** Move to: moved.txt",
  ]) {
    const deletion = patch(body);
    assert.equal(deletion.status, 2);
    assert.match(deletion.stderr, /删除路径没有已批准的 repair 授权：new\.txt/);
  }
});

test("接管仍要求预检验证，不复用裁决前收据；仅只读拒绝写入", (t) => {
  fixtureHost(t);
  const { root, invoke, decide, preflight, edit } = initialPolicyFixture();
  const route = readRoute(root);
  route.verificationReceipt = {
    schemaVersion: 1,
    result: "passed",
    verifiedAt: new Date().toISOString(),
    pluginVersion,
    host: "claude-code",
    hostVersion: process.version,
    headRevision: route.headRevision,
    worktreeFingerprint: route.worktreeFingerprint,
  };
  writeFileSync(
    resolve(root, ".echo-semantic/route.json"),
    JSON.stringify(route),
  );
  decide("adopt", ["existing.txt"]);
  assert.equal(edit("existing.txt").status, 2);
  assert.equal(invoke("stop").status, 2);
  preflight();
  assert.equal(edit("existing.txt").status, 0);
  writeFileSync(resolve(root, "unexpected.txt"), "超出允许路径\n");
  const verify = invoke("stop");
  assert.equal(verify.status, 2);
  assert.match(verify.stderr, /语义完成门禁未通过/);
  rmSync(resolve(root, "unexpected.txt"));
  computeRoute(root, "claude-code", "manual");
  decide("readonly");
  assert.equal(edit("new.txt").status, 2);
  assert.equal(invoke("stop").status, 0);
});

test("初始已有差异的 startup 不清除已有待结算预检", () => {
  const { root, invoke, preflight } = initialPolicyFixture();
  preflight();
  const path = resolve(root, ".echo-semantic/preflight.json");
  const bytes = readFileSync(path, "utf8");
  assert.equal(invoke("session-start", { source: "startup" }).status, 0);
  assert.equal(readFileSync(path, "utf8"), bytes);
});

for (const dirty of [false, true]) {
  test(`待结算记录在 resume 后保留（dirty=${dirty}）`, () => {
    const { repository, invoke } = settlementFixture();
    if (dirty) writeFileSync(resolve(repository, "change.txt"), "change\n");
    const preflight = preflightState(
      repository,
      git(repository, "rev-parse", "HEAD"),
      "pending",
      ["change.txt"],
    );
    preflight.recordedAt = "2000-01-01T00:00:00Z";
    const path = resolve(repository, ".echo-semantic/preflight.json");
    const content = JSON.stringify(preflight);
    writeFileSync(path, content);
    assert.equal(invoke("session-start", { source: "resume" }).status, 0);
    const stopped = invoke("stop");
    assert.equal(stopped.status, 2, stopped.stderr || stopped.stdout);
    assert.equal(readFileSync(path, "utf8"), content);
    assert.equal(readRoute(repository).verificationReceipt, null);
  });
}

test("去重在预检变化和验证失败后失效", () => {
  const { repository, invoke } = settlementFixture();
  writeFileSync(resolve(repository, "change.txt"), "change\n");
  assert.equal(invoke("stop").status, 2);
  assert.equal(invoke("stop", { stop_hook_active: true }).status, 0);
  const path = resolve(repository, ".echo-semantic/preflight.json");
  writeFileSync(path, '{"invalid":true}');
  assert.equal(invoke("stop", { stop_hook_active: true }).status, 2);
  assert.equal(invoke("stop", { stop_hook_active: true }).status, 0);
  writeFileSync(
    path,
    JSON.stringify(
      preflightState(
        repository,
        git(repository, "rev-parse", "HEAD"),
        "retry",
        ["change.txt"],
      ),
    ),
  );
  writeFileSync(resolve(repository, "unexpected.txt"), "超出允许路径\n");
  const failed = invoke("stop", { stop_hook_active: true });
  assert.equal(failed.status, 2);
  assert.match(failed.stderr, /语义完成门禁未通过/);
  // 恢复之前的无效记录也不能复活验证前的去重豁免。
  writeFileSync(path, '{"invalid":true}');
  assert.equal(invoke("stop", { stop_hook_active: true }).status, 2);
});

test("去重清理锁失败时证据变化仍恢复阻断", () => {
  const { repository, invoke } = settlementFixture();
  writeFileSync(resolve(repository, "change.txt"), "change\n");
  assert.equal(invoke("stop").status, 2);
  writeFileSync(
    resolve(repository, ".echo-semantic/preflight.json"),
    '{"invalid":true}',
  );
  const lock = resolve(
    repository,
    git(
      repository,
      "rev-parse",
      "--git-path",
      "echo-semantic-project-state.lock",
    ),
  );
  writeFileSync(lock, `${process.pid}:held`, "utf8");
  try {
    const stopped = invoke("stop", { stop_hook_active: true });
    assert.equal(stopped.status, 2, stopped.stderr || stopped.stdout);
    assert.match(stopped.stderr, /无法获取 Echo Semantic 项目状态锁/);
  } finally {
    rmSync(lock, { force: true });
  }
});

for (const name of ["preflight.json", "continuation.json"]) {
  test(`成功收据不绕过新待结算记录 ${name}`, (t) => {
    fixtureHost(t);
    const { repository, invoke } = settlementFixture();
    const previous = computeRoute(repository, "claude-code", "stop", {
      observedEvent: "stop",
    });
    previous.verificationReceipt = {
      schemaVersion: 1,
      result: "passed",
      verifiedAt: new Date(Date.now() - 1_000).toISOString(),
      pluginVersion,
      host: "claude-code",
      hostVersion: process.version,
      headRevision: previous.headRevision,
      worktreeFingerprint: previous.worktreeFingerprint,
    };
    writeFileSync(
      resolve(repository, ".echo-semantic/route.json"),
      `${JSON.stringify(previous)}\n`,
    );
    writeFileSync(
      resolve(repository, ".echo-semantic", name),
      '{"invalid":true}',
    );
    const stopped = invoke("stop");
    assert.equal(stopped.status, 2, stopped.stderr || stopped.stdout);
    assert.match(stopped.stderr, /没有有效 semantic-preflight/);
  });
}

test("空指纹收据不得命中重复验证豁免", () => {
  const repository = mkdtempSync(
    resolve(tmpdir(), "echo-semantic-stop-null-fp-"),
  );
  git(repository, "init", "-q");
  mkdirSync(resolve(repository, ".echo-semantic"));
  writeFileSync(
    resolve(repository, ".echo-semantic/baseline.md"),
    "无效基线\n",
  );
  // 没有 HEAD 时指纹不可计算（null）。
  writeFileSync(resolve(repository, "change.txt"), "change\n");

  computeRoute(repository, "claude-code", "stop", {
    observedEvent: "stop",
  });
  const previous = readRoute(repository);
  assert.equal(previous.worktreeFingerprint, null);
  previous.hookEvidence.stop.observedAt = new Date(
    Date.now() - 1_000,
  ).toISOString();
  previous.verificationReceipt = {
    schemaVersion: 2,
    scope: "task",
    taskId: "verified-task",
    contentDigest: "a".repeat(64),
    evidencePaths: [],
    referenceDigests: {},
    verifiedPaths: [],
    result: "passed",
    verifiedAt: new Date(Date.now() - 1_000).toISOString(),
    pluginVersion,
    host: "claude-code",
    headRevision: previous.headRevision,
    worktreeFingerprint: null,
  };
  writeFileSync(
    resolve(repository, ".echo-semantic/route.json"),
    `${JSON.stringify(previous, null, 2)}\n`,
  );

  const repeated = spawnSync("node", [hook, "claude-code", "stop"], {
    cwd: repository,
    input: JSON.stringify({ cwd: repository }),
    encoding: "utf8",
  });
  assert.equal(repeated.status, 0, repeated.stderr);
  assert.match(
    readFileSync(resolve(repository, ".echo-semantic/status.md"), "utf8"),
    /无法判断/,
  );
});

test("成功 Stop 后同一工作树重复调用幂等放行", (t) => {
  fixtureHost(t);
  const repository = mkdtempSync(
    resolve(tmpdir(), "echo-semantic-stop-repeat-"),
  );
  git(repository, "init", "-q");
  git(repository, "config", "user.email", "test@example.com");
  git(repository, "config", "user.name", "Test");
  mkdirSync(resolve(repository, ".echo-semantic"));
  writeFileSync(
    resolve(repository, ".echo-semantic/baseline.md"),
    "无效基线\n",
  );
  git(repository, "add", ".echo-semantic/baseline.md");
  git(repository, "-c", "commit.gpgsign=false", "commit", "-qm", "baseline");
  const start = spawnSync("node", [hook, "claude-code", "session-start"], {
    cwd: repository,
    input: JSON.stringify({
      cwd: repository,
      source: "startup",
      session_id: "repeat",
    }),
    encoding: "utf8",
  });
  assert.equal(start.status, 0, start.stderr);
  writeFileSync(resolve(repository, "change.txt"), "change\n");

  computeRoute(repository, "claude-code", "stop", {
    observedEvent: "stop",
  });
  const previous = readRoute(repository);
  previous.hookEvidence.stop.observedAt = new Date(
    Date.now() - 1_000,
  ).toISOString();
  previous.verificationReceipt = {
    schemaVersion: 2,
    scope: "task",
    taskId: "verified-task",
    contentDigest: "a".repeat(64),
    evidencePaths: [],
    referenceDigests: {},
    verifiedPaths: [],
    result: "passed",
    verifiedAt: new Date(Date.now() - 1_000).toISOString(),
    pluginVersion,
    host: "claude-code",
    hostVersion: process.version,
    headRevision: previous.headRevision,
    worktreeFingerprint: previous.worktreeFingerprint,
  };
  writeFileSync(
    resolve(repository, ".echo-semantic/route.json"),
    `${JSON.stringify(previous, null, 2)}\n`,
  );

  const repeated = spawnSync("node", [hook, "claude-code", "stop"], {
    cwd: repository,
    input: JSON.stringify({ cwd: repository, session_id: "repeat" }),
    encoding: "utf8",
  });
  assert.equal(repeated.status, 0, repeated.stderr);
  assert.deepEqual(JSON.parse(repeated.stdout), {});
  assert.match(
    readFileSync(resolve(repository, ".echo-semantic/status.md"), "utf8"),
    /当前工作树已通过此前 Stop 语义门禁/,
  );

  for (const changedBinding of [
    { pluginVersion: "0.3.0" },
    { host: "cursor" },
    { hostVersion: "old-version" },
    { hostVersion: null },
    { hostVersion: undefined },
    { referenceDigests: undefined },
    { referenceDigests: null },
    { referenceDigests: [] },
  ]) {
    const route = readRoute(repository);
    route.verificationReceipt = {
      ...previous.verificationReceipt,
      ...changedBinding,
    };
    writeFileSync(
      resolve(repository, ".echo-semantic/route.json"),
      JSON.stringify(route),
    );
    const rejected = spawnSync("node", [hook, "claude-code", "stop"], {
      cwd: repository,
      input: JSON.stringify({ cwd: repository, session_id: "repeat" }),
      encoding: "utf8",
    });
    assert.equal(rejected.status, 2, rejected.stderr || rejected.stdout);
    assert.match(rejected.stderr, /没有有效 semantic-preflight/);
  }

  const unknown = readRoute(repository);
  unknown.verificationReceipt = {
    ...previous.verificationReceipt,
    hostVersion: null,
  };
  writeFileSync(
    resolve(repository, ".echo-semantic/route.json"),
    JSON.stringify(unknown),
  );
  const unknownVersionRunner = `import cp from 'node:child_process';
    import {syncBuiltinESMExports} from 'node:module';
    const original=cp.spawnSync; cp.spawnSync=(command,args,options)=>args[0]==='--version'
      ? {status:0,stdout:'',stderr:''} : original(command,args,options);
    syncBuiltinESMExports(); process.argv=[process.execPath,${JSON.stringify(hook)},'claude-code','stop'];
    await import(${JSON.stringify(new URL("../hooks/entry.mjs", import.meta.url).href)});`;
  const unknownVersion = spawnSync(
    process.execPath,
    ["--input-type=module", "-e", unknownVersionRunner],
    {
      cwd: repository,
      input: JSON.stringify({ cwd: repository, session_id: "repeat" }),
      encoding: "utf8",
    },
  );
  assert.equal(
    unknownVersion.status,
    2,
    unknownVersion.stderr || unknownVersion.stdout,
  );
  assert.match(unknownVersion.stderr, /没有有效 semantic-preflight/);

  writeFileSync(resolve(repository, "new-change.txt"), "new change\n");
  const changed = spawnSync("node", [hook, "claude-code", "stop"], {
    cwd: repository,
    input: JSON.stringify({ cwd: repository, session_id: "repeat" }),
    encoding: "utf8",
  });
  assert.equal(changed.status, 2, changed.stderr);
  assert.match(
    readFileSync(resolve(repository, ".echo-semantic/status.md"), "utf8"),
    /没有有效 semantic-preflight/,
  );
});

test("干净基线无会话标识也拒绝缺少路径的写入和删除", () => {
  const { repository } = settlementFixture();
  for (const tool_name of ["Write", "Delete"]) {
    const rejected = spawnSync("node", [hook, "claude-code", "pre-edit"], {
      cwd: repository,
      input: JSON.stringify({ cwd: repository, tool_name, tool_input: {} }),
      encoding: "utf8",
    });
    assert.equal(rejected.status, 2);
    assert.match(rejected.stderr, /缺少可检查路径/);
  }
});

test("Stop 按会话快照区分已有差异与本轮修改并去重重入", () => {
  const repository = mkdtempSync(
    resolve(tmpdir(), "echo-semantic-stop-session-"),
  );
  git(repository, "init", "-q");
  git(repository, "config", "user.email", "test@example.com");
  git(repository, "config", "user.name", "Test");
  mkdirSync(resolve(repository, ".echo-semantic"));
  writeFileSync(resolve(repository, ".echo-semantic/baseline.md"), "基线\n");
  git(repository, "add", ".echo-semantic/baseline.md");
  git(repository, "-c", "commit.gpgsign=false", "commit", "-qm", "baseline");
  // 会话开始前已存在脏差异
  writeFileSync(resolve(repository, "existing.txt"), "existing\n");

  const start = spawnSync("node", [hook, "claude-code", "session-start"], {
    cwd: repository,
    input: JSON.stringify({
      cwd: repository,
      source: "startup",
      session_id: "session-stop-matrix",
    }),
    encoding: "utf8",
  });
  assert.equal(start.status, 0, start.stderr);
  const snapshotRegistry = JSON.parse(
    readFileSync(
      resolve(repository, ".echo-semantic/session-snapshot.json"),
      "utf8",
    ),
  );
  const snapshot = snapshotRegistry.records.find(
    (record) => record.sessionId === "session-stop-matrix",
  );
  assert.equal(snapshotRegistry.schemaVersion, 2);
  assert.equal(snapshot.sessionId, "session-stop-matrix");
  // 快照文件不进入 Git 跟踪（info/exclude 生效）
  assert.equal(
    git(repository, "status", "--porcelain").includes("session-snapshot"),
    false,
  );

  // 场景 1：已有脏工作区 + 本轮只读 → 放行，不生成验证收据
  const readonly = spawnSync("node", [hook, "claude-code", "stop"], {
    cwd: repository,
    input: JSON.stringify({
      cwd: repository,
      session_id: "session-stop-matrix",
    }),
    encoding: "utf8",
  });
  assert.equal(readonly.status, 0, readonly.stderr);
  assert.match(
    readFileSync(resolve(repository, ".echo-semantic/status.md"), "utf8"),
    /已有差异待裁决、未验证/,
  );
  const routeAfterReadonly = readRoute(repository);
  assert.equal(routeAfterReadonly.verificationReceipt, null);

  // 场景 2+3：本轮修改已脏文件、新增未跟踪文件，无预检 → 首次阻断
  writeFileSync(resolve(repository, "existing.txt"), "modified\n");
  writeFileSync(resolve(repository, "added.txt"), "added\n");
  const firstBlock = spawnSync("node", [hook, "claude-code", "stop"], {
    cwd: repository,
    input: JSON.stringify({
      cwd: repository,
      session_id: "session-stop-matrix",
    }),
    encoding: "utf8",
  });
  assert.equal(firstBlock.status, 2);
  assert.match(firstBlock.stderr, /已有差异策略未满足/);

  // 场景 4：相同失败的重入 Stop（stop_hook_active）→ 不再阻断，保留待处理
  const reentry = spawnSync("node", [hook, "claude-code", "stop"], {
    cwd: repository,
    input: JSON.stringify({
      cwd: repository,
      session_id: "session-stop-matrix",
      stop_hook_active: true,
    }),
    encoding: "utf8",
  });
  assert.equal(reentry.status, 0, reentry.stderr);
  const statusDuringDedupe = JSON.parse(
    readFileSync(resolve(repository, ".echo-semantic/status.json"), "utf8"),
  );
  assert.equal(statusDuringDedupe.state, "blocked");
  assert.match(statusDuringDedupe.message, /待裁决、未验证/);
  assert.equal(readRoute(repository).verificationReceipt, null);

  // 场景 5：重入期间内容再次变化 → 恢复阻断
  writeFileSync(resolve(repository, "added.txt"), "changed again\n");
  const changedAgain = spawnSync("node", [hook, "claude-code", "stop"], {
    cwd: repository,
    input: JSON.stringify({
      cwd: repository,
      session_id: "session-stop-matrix",
      stop_hook_active: true,
    }),
    encoding: "utf8",
  });
  assert.equal(changedAgain.status, 2);
  assert.match(changedAgain.stderr, /已有差异策略未满足/);

  // 场景 7：未登记的会话（快照缺失）→ 提示无法判断并放行
  const unknownSession = spawnSync("node", [hook, "claude-code", "stop"], {
    cwd: repository,
    input: JSON.stringify({
      cwd: repository,
      session_id: "session-other",
      stop_hook_active: true,
    }),
    encoding: "utf8",
  });
  assert.equal(unknownSession.status, 0, unknownSession.stderr);
  assert.match(
    readFileSync(resolve(repository, ".echo-semantic/status.md"), "utf8"),
    /无法判断/,
  );
});

for (const scenario of [
  "tracked",
  "quoted-path",
  "untracked",
  "index-only",
  "head-only",
  "clean-head",
]) {
  test(`内容指纹独立识别 ${scenario}，只读不误拦`, () => {
    const repository = mkdtempSync(resolve(tmpdir(), "echo-fingerprint-"));
    git(repository, "init", "-q");
    git(repository, "config", "user.email", "test@example.com");
    git(repository, "config", "user.name", "Test");
    mkdirSync(resolve(repository, ".echo-semantic"));
    writeFileSync(resolve(repository, ".echo-semantic/baseline.md"), "基线\n");
    const name =
      scenario === "quoted-path" ? '中文 "路径"\\换行\n.txt' : "existing.txt";
    const file = resolve(repository, name);
    writeFileSync(file, "committed\n");
    git(repository, "add", ".");
    git(repository, "-c", "commit.gpgsign=false", "commit", "-qm", "baseline");
    if (scenario === "untracked") git(repository, "rm", "--cached", "--", name);
    if (scenario !== "clean-head") writeFileSync(file, "before session\n");
    if (scenario === "index-only") {
      git(repository, "add", "--", name);
      writeFileSync(file, "working tree stays fixed\n");
    }
    const invoke = (event) =>
      spawnSync("node", [hook, "claude-code", event], {
        cwd: repository,
        input: JSON.stringify({
          cwd: repository,
          session_id: "fingerprint",
          source: "startup",
        }),
        encoding: "utf8",
      });
    const start = invoke("session-start");
    assert.equal(start.status, 0, start.stderr);
    const before = readRoute(repository).worktreeFingerprint;
    const statusBefore = git(repository, "status", "--porcelain=v1");
    const readonly = invoke("stop");
    assert.equal(readonly.status, 0, readonly.stderr);
    assert.equal(readRoute(repository).verificationReceipt, null);
    if (scenario === "index-only") {
      writeFileSync(file, "new staged content\n");
      git(repository, "add", "--", name);
      writeFileSync(file, "working tree stays fixed\n");
    } else if (scenario === "head-only" || scenario === "clean-head") {
      git(
        repository,
        "-c",
        "commit.gpgsign=false",
        "commit",
        "--allow-empty",
        "-qm",
        "head changed",
      );
    } else {
      writeFileSync(file, "after session\n");
    }
    assert.equal(git(repository, "status", "--porcelain=v1"), statusBefore);
    const changed = invoke("stop");
    assert.equal(changed.status, 2, changed.stderr || changed.stdout);
    assert.match(
      changed.stderr,
      /没有有效 semantic-preflight|已有差异策略未满足/,
    );
    assert.notEqual(readRoute(repository).worktreeFingerprint, before);
    assert.equal(readRoute(repository).verificationReceipt, null);
  });
}

test("预检补齐后 Stop 走完整验证且去重不再放行", () => {
  const repository = mkdtempSync(resolve(tmpdir(), "echo-semantic-stop-pf-"));
  git(repository, "init", "-q");
  git(repository, "config", "user.email", "test@example.com");
  git(repository, "config", "user.name", "Test");
  mkdirSync(resolve(repository, ".echo-semantic"));
  writeFileSync(
    resolve(repository, ".echo-semantic/baseline.md"),
    "无效基线\n",
  );
  git(repository, "add", ".echo-semantic/baseline.md");
  git(repository, "-c", "commit.gpgsign=false", "commit", "-qm", "baseline");
  const head = git(repository, "rev-parse", "HEAD");
  spawnSync("node", [hook, "claude-code", "session-start"], {
    cwd: repository,
    input: JSON.stringify({
      cwd: repository,
      source: "startup",
      session_id: "session-preflight",
    }),
    encoding: "utf8",
  });
  // 会话开始后才修改 → 属于本轮变化
  writeFileSync(resolve(repository, "change.txt"), "change\n");
  // 无预检：先阻断并记录去重状态
  const firstBlock = spawnSync("node", [hook, "claude-code", "stop"], {
    cwd: repository,
    input: JSON.stringify({
      cwd: repository,
      session_id: "session-preflight",
    }),
    encoding: "utf8",
  });
  assert.equal(firstBlock.status, 2);
  assert.match(firstBlock.stderr, /没有有效 semantic-preflight/);

  // 预检补齐 → 去重键失效，走完整验证（本轮越界文件使局部验证失败，不依赖无关基线是否有效）
  writeFileSync(
    resolve(repository, ".echo-semantic/preflight.json"),
    JSON.stringify(
      preflightState(repository, head, "task-stop-preflight", ["change.txt"]),
    ),
    "utf8",
  );
  writeFileSync(resolve(repository, "unexpected.txt"), "超出允许路径\n");
  const retried = spawnSync("node", [hook, "claude-code", "stop"], {
    cwd: repository,
    input: JSON.stringify({
      cwd: repository,
      session_id: "session-preflight",
      stop_hook_active: true,
    }),
    encoding: "utf8",
  });
  assert.equal(retried.status, 2);
  assert.match(retried.stderr, /语义完成门禁未通过/);
});

test("并发会话的快照和失败去重记录互不覆盖", () => {
  const repository = mkdtempSync(resolve(tmpdir(), "echo-session-registry-"));
  git(repository, "init", "-q");
  git(repository, "config", "user.email", "test@example.com");
  git(repository, "config", "user.name", "Test");
  mkdirSync(resolve(repository, ".echo-semantic"));
  writeFileSync(resolve(repository, ".echo-semantic/baseline.md"), "基线\n");
  git(repository, "add", ".echo-semantic/baseline.md");
  git(repository, "-c", "commit.gpgsign=false", "commit", "-qm", "baseline");
  const invoke = (event, sessionId, extra = {}) =>
    spawnSync("node", [hook, "claude-code", event], {
      cwd: repository,
      input: JSON.stringify({
        cwd: repository,
        session_id: sessionId,
        source: "startup",
        ...extra,
      }),
      encoding: "utf8",
    });

  assert.equal(invoke("session-start", "session-a").status, 0);
  assert.equal(invoke("session-start", "session-b").status, 0);
  writeFileSync(resolve(repository, "change.txt"), "change\n");
  assert.equal(invoke("stop", "session-a").status, 2);
  assert.equal(invoke("stop", "session-b").status, 2);

  const snapshots = JSON.parse(
    readFileSync(
      resolve(repository, ".echo-semantic/session-snapshot.json"),
      "utf8",
    ),
  );
  const dedupe = JSON.parse(
    readFileSync(
      resolve(repository, ".echo-semantic/stop-dedupe.json"),
      "utf8",
    ),
  );
  assert.deepEqual(snapshots.records.map((record) => record.sessionId).sort(), [
    "session-a",
    "session-b",
  ]);
  assert.deepEqual(dedupe.records.map((record) => record.sessionId).sort(), [
    "session-a",
    "session-b",
  ]);
  assert.equal(
    invoke("stop", "session-a", { stop_hook_active: true }).status,
    0,
  );
  assert.equal(
    invoke("stop", "session-b", { stop_hook_active: true }).status,
    0,
  );
});

test("会话注册表清理过期记录并限制为最近 128 个会话", () => {
  const repository = mkdtempSync(resolve(tmpdir(), "echo-session-retention-"));
  git(repository, "init", "-q");
  git(repository, "config", "user.email", "test@example.com");
  git(repository, "config", "user.name", "Test");
  mkdirSync(resolve(repository, ".echo-semantic"));
  writeFileSync(resolve(repository, ".echo-semantic/baseline.md"), "基线\n");
  git(repository, "add", ".echo-semantic/baseline.md");
  git(repository, "-c", "commit.gpgsign=false", "commit", "-qm", "baseline");
  const repositoryRoot = resolve(
    git(repository, "rev-parse", "--show-toplevel"),
  );
  const now = Date.now();
  const records = Array.from({ length: 130 }, (_, index) => ({
    sessionId: `existing-${index}`,
    headRevision: "head",
    worktreeDigest: `digest-${index}`,
    recordedAt: new Date(now - (130 - index) * 1_000).toISOString(),
  }));
  records.unshift({
    sessionId: "expired",
    headRevision: "head",
    worktreeDigest: "expired",
    recordedAt: new Date(now - 8 * 24 * 60 * 60 * 1_000).toISOString(),
  });
  writeFileSync(
    resolve(repository, ".echo-semantic/session-snapshot.json"),
    `${JSON.stringify({
      schemaVersion: 2,
      pluginId: "echo-semantic",
      repositoryRoot,
      records,
      updatedAt: new Date(now).toISOString(),
    })}\n`,
  );
  const started = spawnSync("node", [hook, "claude-code", "session-start"], {
    cwd: repository,
    input: JSON.stringify({
      cwd: repository,
      session_id: "latest",
      source: "startup",
    }),
    encoding: "utf8",
  });
  assert.equal(started.status, 0, started.stderr);
  const current = JSON.parse(
    readFileSync(
      resolve(repository, ".echo-semantic/session-snapshot.json"),
      "utf8",
    ),
  );
  assert.equal(current.records.length, 128);
  assert.equal(
    current.records.some((record) => record.sessionId === "expired"),
    false,
  );
  assert.equal(current.records.at(-1).sessionId, "latest");
});

test("Cursor 官方会话字段建立快照并对相同失败只 followup 一次", () => {
  const repository = mkdtempSync(resolve(tmpdir(), "echo-cursor-session-"));
  git(repository, "init", "-q");
  git(repository, "config", "user.email", "test@example.com");
  git(repository, "config", "user.name", "Test");
  mkdirSync(resolve(repository, ".echo-semantic"));
  writeFileSync(resolve(repository, ".echo-semantic/baseline.md"), "基线\n");
  git(repository, "add", ".echo-semantic/baseline.md");
  git(repository, "-c", "commit.gpgsign=false", "commit", "-qm", "baseline");
  const sessionId = "cursor-conversation";
  const started = spawnSync("node", [hook, "cursor", "session-start"], {
    cwd: repository,
    input: JSON.stringify({ cwd: repository, session_id: sessionId }),
    encoding: "utf8",
  });
  assert.equal(started.status, 0, started.stderr);
  writeFileSync(resolve(repository, "change.txt"), "change\n");

  const first = spawnSync("node", [hook, "cursor", "stop"], {
    cwd: repository,
    input: JSON.stringify({
      cwd: repository,
      conversation_id: sessionId,
      loop_count: 0,
    }),
    encoding: "utf8",
  });
  assert.equal(first.status, 0, first.stderr);
  assert.match(
    JSON.parse(first.stdout).followup_message,
    /没有有效 semantic-preflight/,
  );

  const repeated = spawnSync("node", [hook, "cursor", "stop"], {
    cwd: repository,
    input: JSON.stringify({
      cwd: repository,
      conversation_id: sessionId,
      loop_count: 1,
    }),
    encoding: "utf8",
  });
  assert.equal(repeated.status, 0, repeated.stderr);
  assert.deepEqual(JSON.parse(repeated.stdout), {});
  const status = JSON.parse(
    readFileSync(resolve(repository, ".echo-semantic/status.json"), "utf8"),
  );
  assert.equal(status.state, "blocked");
  assert.match(status.message, /待处理/);
});

test("明确的新会话清除上一任务的预检状态", () => {
  const repository = mkdtempSync(resolve(tmpdir(), "echo-semantic-session-"));
  git(repository, "init", "-q");
  const state = resolve(repository, ".echo-semantic/preflight.json");
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
  const state = resolve(repository, ".echo-semantic/preflight.json");
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
  const state = resolve(repository, ".echo-semantic/preflight.json");
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
