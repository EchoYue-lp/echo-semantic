import assert from "node:assert/strict";
import { createHash } from "node:crypto";
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
import { computeRoute, readRoute } from "../runtime/route.mjs";

const root = resolve(import.meta.dirname, "..");
const hook = resolve(root, "hooks/entry.mjs");

function git(cwd, ...args) {
  const result = spawnSync("git", ["-C", cwd, ...args], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim();
}

function preflightState(repository, head, taskId, allowedPaths) {
  return {
    schemaVersion: 1,
    pluginId: "echo-semantic",
    scope: "task",
    repositoryRoot: realpathSync(repository),
    baseRevision: head,
    recordedAt: new Date().toISOString(),
    taskId,
    kind: "bugfix",
    risk: "low",
    allowedPaths,
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
}

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

test("插件单独触发时注入仓库级语义维护入口", () => {
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
  assert.match(context, /semantic-discover/);
  assert.match(context, /semantic-status/);
  assert.match(context, /semantic-audit/);
  assert.match(context, /semantic-verify/);
  assert.match(context, /semantic-consolidate/);
  assert.match(context, /不要自动进入 semantic-repair/);
  assert.match(context, /Baseline 覆盖的已完成代码/);
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
      tool_input: { path: "old.txt" },
    }),
    encoding: "utf8",
  });
  assert.equal(malformedRepair.status, 2);
  assert.match(malformedRepair.stderr, /没有已批准的 repair/);

  writeFileSync(
    resolve(repository, ".echo-semantic/findings/finding.repair.md"),
    "---\nid: finding.repair\nkind: finding\nstatus: resolved\ntype: consolidation_candidate\ndecision: migrate\ncanonical_asset_ref: asset.new\ncandidate_asset_refs: [asset.old, asset.new]\ndelete_paths: [old.txt]\nreplacement_refs: [asset.new]\nrollback_ref: revert-old\nverification_evidence_refs: [evidence.missing]\n---\n\n# repair\n",
  );
  const missingEvidence = spawnSync("node", [hook, "cursor", "pre-edit"], {
    cwd: repository,
    input: JSON.stringify({
      cwd: repository,
      tool_name: "Delete",
      tool_input: { path: "old.txt" },
    }),
    encoding: "utf8",
  });
  assert.equal(missingEvidence.status, 2);
  assert.match(missingEvidence.stderr, /没有已批准的 repair/);

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
      tool_input: { path: "old.txt" },
    }),
    encoding: "utf8",
  });
  assert.equal(denied.status, 2);
  assert.match(denied.stderr, /没有已批准的 repair/);
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
    input: JSON.stringify({ cwd: repository, file_path: "src/lib.rs" }),
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
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const result = spawnSync("node", [hook, "cursor", "stop"], {
      cwd: repository,
      input: JSON.stringify({ cwd: repository, stop_hook_active: true }),
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
    input: JSON.stringify({ cwd: repository, stop_hook_active: true }),
    encoding: "utf8",
  });
  assert.equal(claude.status, 2);
  assert.match(claude.stderr, /语义完成门禁未通过/);
  assert.equal(JSON.parse(claude.stdout).decision, "block");
  const codex = spawnSync("node", [hook, "codex", "stop"], {
    cwd: repository,
    input: JSON.stringify({ cwd: repository, stop_hook_active: true }),
    encoding: "utf8",
  });
  assert.equal(codex.status, 2);
  assert.equal(JSON.parse(codex.stdout).decision, "block");
  assert.match(JSON.parse(codex.stdout).reason, /语义完成门禁未通过/);
});

test("成功 Stop 后同一工作树重复调用幂等放行", () => {
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
  writeFileSync(resolve(repository, "change.txt"), "change\n");

  computeRoute(repository, "claude-code", "stop", {
    observedEvent: "stop",
  });
  const previous = readRoute(repository);
  previous.hookEvidence.stop.observedAt = new Date(
    Date.now() - 1_000,
  ).toISOString();
  previous.verificationReceipt = {
    schemaVersion: 1,
    result: "passed",
    verifiedAt: new Date(Date.now() - 1_000).toISOString(),
    pluginVersion: "0.1.0",
    host: "claude-code",
    headRevision: previous.headRevision,
    worktreeFingerprint: previous.worktreeFingerprint,
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
  assert.deepEqual(JSON.parse(repeated.stdout), {});
  assert.match(
    readFileSync(resolve(repository, ".echo-semantic/status.md"), "utf8"),
    /当前工作树已通过此前 Stop 语义门禁/,
  );

  writeFileSync(resolve(repository, "new-change.txt"), "new change\n");
  const changed = spawnSync("node", [hook, "claude-code", "stop"], {
    cwd: repository,
    input: JSON.stringify({ cwd: repository }),
    encoding: "utf8",
  });
  assert.equal(changed.status, 2);
  assert.match(changed.stderr, /没有有效 semantic-preflight/);
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
