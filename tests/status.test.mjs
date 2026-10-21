import assert from "node:assert/strict";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

import { writeContinuation } from "../runtime/continuation.mjs";
import { computeRoute } from "../runtime/route.mjs";

const root = resolve(import.meta.dirname, "..");
const script = resolve(root, "skills/semantic-status/scripts/status.py");

function git(cwd, ...args) {
  const result = spawnSync("git", ["-C", cwd, ...args], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim();
}

test("状态建议区分无任务等待、任务检查与显式全项目治理", () => {
  // 直接执行生产函数，避免为路由选择导入 YAML 或写入宿主状态。
  const program = `
import ast,json,pathlib,sys
tree=ast.parse(pathlib.Path(sys.argv[1]).read_text())
function=next(node for node in tree.body if isinstance(node,ast.FunctionDef) and node.name=='next_actions')
for arg in function.args.args+function.args.kwonlyargs:arg.annotation=None
function.returns=None
module=ast.Module(body=[function],type_ignores=[]);ast.fix_missing_locations(module)
namespace={};exec(compile(module,sys.argv[1],'exec'),namespace)
objects={'invalidObjects':['unrelated'], 'openFindings':['unrelated'], 'staleAudits':['unrelated']}
for case in json.loads(sys.argv[2]):
    actual=namespace['next_actions'](case['baseline'],case['route'],case['preflight'],objects)
    assert actual==case['expected'], (case['name'],actual,case['expected'])
print('状态建议场景通过')
`;
  const open = {
    present: true,
    validStructure: true,
    inventoryClosure: "open",
  };
  const closed = { ...open, inventoryClosure: "closed" };
  const task = (route, extra = {}) => ({
    route,
    scope: "task",
    trusted: true,
    changedPaths: [],
    ...extra,
  });
  const cases = [
    {
      name: "纯查询无基线",
      baseline: null,
      route: null,
      preflight: { fresh: false },
      expected: [],
    },
    {
      name: "无基线空闲",
      baseline: null,
      route: task("idle"),
      preflight: { fresh: false },
      expected: [],
    },
    {
      name: "开放库存空闲",
      baseline: open,
      route: task("idle"),
      preflight: { fresh: false },
      expected: [],
    },
    {
      name: "任务不因无基线建库",
      baseline: null,
      route: task("bootstrap", { changedPaths: ["target.txt"] }),
      preflight: { fresh: false },
      expected: ["semantic-preflight"],
    },
    {
      name: "任务不因无关库存升级",
      baseline: open,
      route: task("standard", { changedPaths: ["target.txt"] }),
      preflight: { fresh: true },
      expected: ["semantic-diff", "semantic-verify"],
    },
    {
      name: "高风险只定向审查",
      baseline: null,
      route: task("strict", { changedPaths: ["target.txt"] }),
      preflight: { fresh: true },
      expected: ["semantic-diff", "semantic-audit", "semantic-verify"],
    },
    {
      name: "有效预检继续验证",
      baseline: null,
      route: task("bootstrap"),
      preflight: { fresh: true },
      expected: ["semantic-verify"],
    },
    {
      name: "不可信范围不能启动发现",
      baseline: null,
      route: { route: "maintenance", scope: "repository", trusted: false },
      preflight: { fresh: false },
      expected: ["semantic-verify"],
    },
    {
      name: "显式全项目无基线",
      baseline: null,
      route: { route: "maintenance", scope: "repository", trusted: true },
      preflight: { fresh: false },
      expected: ["semantic-discover", "semantic-verify"],
    },
    {
      name: "显式全项目开放库存",
      baseline: open,
      route: { route: "maintenance", scope: "repository", trusted: true },
      preflight: { fresh: false },
      expected: ["semantic-discover"],
    },
    {
      name: "显式全项目维护",
      baseline: closed,
      route: { route: "maintenance", scope: "repository", trusted: true },
      preflight: { fresh: false },
      expected: [
        "semantic-discover",
        "semantic-status",
        "semantic-consolidate",
        "semantic-audit",
        "semantic-verify",
      ],
    },
  ];
  const result = spawnSync(
    "python3",
    ["-B", "-c", program, script, JSON.stringify(cases)],
    { encoding: "utf8" },
  );
  assert.equal(result.status, 0, result.stderr || result.stdout);
});

test("无基线状态 CLI 只读等待，不创建基线或路由", (t) => {
  const repository = mkdtempSync(resolve(tmpdir(), "echo-status-readonly-"));
  t.after(() => rmSync(repository, { recursive: true, force: true }));
  git(repository, "init", "-q");
  git(repository, "config", "user.email", "test@example.com");
  git(repository, "config", "user.name", "Test");
  writeFileSync(resolve(repository, "target.txt"), "fixture\n");
  git(repository, "add", ".");
  git(repository, "-c", "commit.gpgsign=false", "commit", "-qm", "fixture");
  const before = git(
    repository,
    "status",
    "--porcelain=v1",
    "--untracked-files=all",
  );
  const result = spawnSync("uv", ["run", script, "--root", repository], {
    encoding: "utf8",
  });
  assert.equal(result.status, 0, result.stderr);
  const value = JSON.parse(result.stdout);
  assert.equal(value.baseline.present, false);
  assert.deepEqual(value.next, []);
  assert.equal(
    git(repository, "status", "--porcelain=v1", "--untracked-files=all"),
    before,
  );
});

test("待结算预检、继续包与 Stop 阻断保留局部恢复入口", () => {
  const program = `
import ast,inspect,json,pathlib,sys
tree=ast.parse(pathlib.Path(sys.argv[1]).read_text())
function=next(node for node in tree.body if isinstance(node,ast.FunctionDef) and node.name=='next_actions')
for arg in function.args.args+function.args.kwonlyargs:arg.annotation=None
function.returns=None
module=ast.Module(body=[function],type_ignores=[]);ast.fix_missing_locations(module)
namespace={};exec(compile(module,sys.argv[1],'exec'),namespace)
recommend=namespace['next_actions'];parameters=inspect.signature(recommend).parameters
objects={'invalidObjects':[], 'openFindings':[], 'staleAudits':[]}
failed=[]
for case in json.loads(sys.argv[2]):
    extras={key:case[key] for key in ['continuation','visible_status'] if key in parameters and key in case}
    actual=recommend(None,case['route'],case['preflight'],objects,**extras)
    if actual!=case['expected']:failed.append((case['name'],actual,case['expected']))
assert not failed,failed
print('局部恢复场景通过')
`;
  const idle = {
    present: true,
    route: "idle",
    scope: "task",
    trusted: true,
    changedPaths: [],
  };
  const none = { present: false, fresh: false };
  const stale = {
    present: true,
    fresh: false,
    valid: false,
    taskId: "pending-task",
    reasons: ["recordedAt 超出有效期"],
  };
  const fresh = {
    present: true,
    fresh: true,
    valid: true,
    taskId: "pending-task",
  };
  const continuation = {
    present: true,
    trusted: true,
    taskId: "pending-task",
    next: "semantic-diff",
    route: "standard",
    open: ["semantic-diff", "semantic-verify"],
  };
  const blocked = {
    present: true,
    trusted: true,
    event: "stop",
    state: "blocked",
    effectiveState: "blocked",
    next: ["semantic-verify"],
  };
  const cases = [
    {
      name: "路由缺失但过期预检未结算",
      route: null,
      preflight: stale,
      expected: ["semantic-preflight"],
    },
    {
      name: "路由尚未建立但过期预检未结算",
      route: { present: false, trusted: false },
      preflight: stale,
      expected: ["semantic-preflight"],
    },
    {
      name: "可信空闲但依据失效",
      route: idle,
      preflight: { ...stale, reasons: ["相关依据内容摘要已变化"] },
      expected: ["semantic-preflight"],
    },
    {
      name: "继续包与Stop阻断且预检缺失",
      route: idle,
      preflight: none,
      continuation,
      visible_status: blocked,
      expected: ["semantic-preflight"],
    },
    {
      name: "有效预检Stop失败继续局部验证",
      route: idle,
      preflight: fresh,
      visible_status: blocked,
      expected: ["semantic-verify"],
    },
    {
      name: "Stop失败保留过期预检先重验依据",
      route: null,
      preflight: stale,
      visible_status: blocked,
      expected: ["semantic-preflight"],
    },
    {
      name: "可信继续包和同任务有效预检",
      route: idle,
      preflight: fresh,
      continuation,
      expected: ["semantic-diff"],
    },
    {
      name: "只有可信继续包先建立当前预检",
      route: null,
      preflight: none,
      continuation,
      expected: ["semantic-preflight"],
    },
    {
      name: "继续包失效不得继承授权",
      route: idle,
      preflight: none,
      continuation: { ...continuation, trusted: false },
      expected: ["semantic-preflight"],
    },
    {
      name: "继续包任务不匹配重新核对",
      route: idle,
      preflight: fresh,
      continuation: { ...continuation, taskId: "other-task" },
      expected: ["semantic-preflight"],
    },
    {
      name: "继续包不能把空闲任务升级全仓",
      route: idle,
      preflight: fresh,
      continuation: {
        ...continuation,
        route: "maintenance",
        next: "semantic-discover",
      },
      expected: ["semantic-preflight"],
    },
    {
      name: "Stop阻断不接管其全仓提示",
      route: idle,
      preflight: fresh,
      visible_status: { ...blocked, next: ["semantic-discover"] },
      expected: ["semantic-verify"],
    },
  ];
  const result = spawnSync(
    "python3",
    ["-B", "-c", program, script, JSON.stringify(cases)],
    { encoding: "utf8" },
  );
  assert.equal(result.status, 0, result.stderr || result.stdout);
});

test("状态CLI保留过期预检和Stop失败恢复线索且不写入", (t) => {
  const repository = mkdtempSync(resolve(tmpdir(), "echo-status-pending-"));
  t.after(() => rmSync(repository, { recursive: true, force: true }));
  git(repository, "init", "-q");
  git(repository, "config", "user.email", "test@example.com");
  git(repository, "config", "user.name", "Test");
  writeFileSync(resolve(repository, "target.txt"), "fixture\n");
  git(repository, "add", ".");
  git(repository, "-c", "commit.gpgsign=false", "commit", "-qm", "fixture");
  mkdirSync(resolve(repository, ".echo-semantic"));
  const pending = resolve(repository, ".echo-semantic/preflight.json");
  writeFileSync(
    pending,
    JSON.stringify({
      schemaVersion: 2,
      taskId: "pending-task",
      recordedAt: "2000-01-01T00:00:00Z",
    }),
  );
  const invoke = () =>
    spawnSync("uv", ["run", script, "--root", repository], {
      encoding: "utf8",
    });
  const initialBytes = readFileSync(pending, "utf8");
  const initialGit = git(
    repository,
    "status",
    "--porcelain=v1",
    "--untracked-files=all",
  );
  let result = invoke();
  assert.equal(result.status, 0, result.stderr);
  let value = JSON.parse(result.stdout);
  assert.equal(value.preflight.present, true);
  assert.equal(value.preflight.fresh, false);
  assert.deepEqual(value.next, ["semantic-preflight"]);
  assert.equal(readFileSync(pending, "utf8"), initialBytes);
  assert.equal(
    git(repository, "status", "--porcelain=v1", "--untracked-files=all"),
    initialGit,
  );
  writeFileSync(pending, "{invalid-json");
  result = invoke();
  assert.equal(result.status, 0, result.stderr);
  value = JSON.parse(result.stdout);
  assert.equal(value.preflight.present, true);
  assert.deepEqual(value.next, ["semantic-preflight"]);
  assert.equal(readFileSync(pending, "utf8"), "{invalid-json");

  rmSync(pending);
  writeContinuation(repository, {
    schemaVersion: 1,
    taskId: "pending-task",
    branch: git(repository, "branch", "--show-current"),
    route: "standard",
    stage: "semantic-preflight",
    next: "semantic-diff",
    resolved: ["semantic-preflight"],
    open: ["semantic-diff"],
    evidenceRefs: ["target.txt"],
  });
  const revision = "readonly-stop-recovery";
  writeFileSync(
    resolve(repository, ".echo-semantic/status.json"),
    JSON.stringify({
      schemaVersion: 1,
      pluginId: "echo-semantic",
      state: "blocked",
      event: "stop",
      revision,
      updatedAt: new Date().toISOString(),
      next: ["semantic-verify"],
    }),
  );
  writeFileSync(
    resolve(repository, ".echo-semantic/status.md"),
    `状态版本：${revision}\n`,
  );
  const statePaths = ["continuation.json", "status.json", "status.md"];
  const bytes = statePaths.map((path) =>
    readFileSync(resolve(repository, ".echo-semantic", path), "utf8"),
  );
  const beforeGit = git(
    repository,
    "status",
    "--porcelain=v1",
    "--untracked-files=all",
  );
  result = invoke();
  assert.equal(result.status, 0, result.stderr);
  value = JSON.parse(result.stdout);
  assert.equal(value.preflight.present, false);
  assert.equal(value.continuation.trusted, true);
  assert.equal(value.visibleStatus.trusted, true);
  assert.deepEqual(value.next, ["semantic-preflight"]);
  assert.deepEqual(
    statePaths.map((path) =>
      readFileSync(resolve(repository, ".echo-semantic", path), "utf8"),
    ),
    bytes,
  );
  assert.equal(
    git(repository, "status", "--porcelain=v1", "--untracked-files=all"),
    beforeGit,
  );
  writeFileSync(
    resolve(repository, ".echo-semantic/continuation.json"),
    "{invalid-packet",
  );
  result = invoke();
  assert.equal(result.status, 0, result.stderr);
  value = JSON.parse(result.stdout);
  assert.equal(value.continuation.present, true);
  assert.equal(value.continuation.trusted, false);
  assert.deepEqual(value.next, ["semantic-preflight"]);
});

test("semantic-status 输出基线、路由和 Frontier", () => {
  const repository = mkdtempSync(resolve(tmpdir(), "echo-semantic-status-"));
  git(repository, "init", "-q");
  git(repository, "config", "user.email", "test@example.com");
  git(repository, "config", "user.name", "Test");
  for (const directory of [
    "maps",
    "behaviors",
    "rules",
    "evidence",
    "findings",
    "audits",
    "discovery",
    "assets",
  ]) {
    mkdirSync(resolve(repository, `.echo-semantic/${directory}`), {
      recursive: true,
    });
  }
  writeFileSync(
    resolve(repository, ".echo-semantic/baseline.md"),
    "---\n" +
      "schema_version: 1\n" +
      "id: baseline.repository\n" +
      "kind: baseline\n" +
      "source_snapshot:\n" +
      "  base_revision: '" +
      "0".repeat(40) +
      "'\n" +
      "  content_digest: '" +
      "0".repeat(64) +
      "'\n" +
      "inventory_closure: closed\n" +
      "behavior_model_closure: open\n" +
      "map_refs: [map.example]\n" +
      "regions: [{path: semantic, status: in_scope}]\n" +
      "boundaries: [{id: boundary.example, map_ref: map.example, risk: low}]\n" +
      "coverage: [{region: semantic, lens: trigger_input, status: not_applicable, reason: test}]\n" +
      "---\n",
    "utf8",
  );
  for (const directory of [
    "maps",
    "behaviors",
    "rules",
    "evidence",
    "discovery",
    "assets",
  ]) {
    writeFileSync(
      resolve(
        repository,
        `.echo-semantic/${directory}/${directory}.example.md`,
      ),
      "---\n" + `id: ${directory}.example\n` + "---\n\n# 状态测试\n",
      "utf8",
    );
  }
  git(repository, "add", ".");
  git(repository, "-c", "commit.gpgsign=false", "commit", "-qm", "baseline");
  writeContinuation(repository, {
    schemaVersion: 1,
    taskId: "status-continuation-test",
    branch: git(repository, "branch", "--show-current"),
    route: "idle",
    stage: "semantic-preflight",
    next: "semantic-verify",
    resolved: ["semantic-preflight"],
    open: ["semantic-verify"],
    evidenceRefs: [".echo-semantic/baseline.md"],
  });
  computeRoute(repository, "codex", "status-test", {
    probe: () => ({ detected: true, version: "test" }),
  });
  const result = spawnSync("uv", ["run", script, "--root", repository], {
    encoding: "utf8",
  });
  assert.equal(result.status, 0, result.stderr);
  const value = JSON.parse(result.stdout);
  assert.equal(value.baseline.present, true);
  assert.equal(value.baseline.inventoryClosure, "closed");
  assert.equal(value.continuation.trusted, true);
  assert.equal(value.route.trusted, true);
  assert.equal(value.visibleStatus.trusted, true);
  assert.ok(Array.isArray(value.next));

  const routePath = resolve(repository, ".echo-semantic/route.json");
  const forgedEnforcement = JSON.parse(readFileSync(routePath, "utf8"));
  forgedEnforcement.enforcement.stop = true;
  writeFileSync(routePath, JSON.stringify(forgedEnforcement), "utf8");
  const forged = spawnSync("uv", ["run", script, "--root", repository], {
    encoding: "utf8",
  });
  assert.equal(forged.status, 0, forged.stderr);
  const forgedValue = JSON.parse(forged.stdout);
  assert.equal(forgedValue.route.trusted, false);
  assert.match(forgedValue.route.reasons.join("、"), /Hook 事件证据不一致/);
  computeRoute(repository, "codex", "status-test", {
    probe: () => ({ detected: true, version: "test" }),
  });

  // 脏工作树刚计算的路由必须仍被消费者信任（-z 摘要契约）
  writeFileSync(resolve(repository, "dirty.txt"), "dirty\n", "utf8");
  computeRoute(repository, "codex", "status-test", {
    probe: () => ({ detected: true, version: "test" }),
  });
  const dirtyFresh = spawnSync("uv", ["run", script, "--root", repository], {
    encoding: "utf8",
  });
  assert.equal(dirtyFresh.status, 0, dirtyFresh.stderr);
  const dirtyFreshValue = JSON.parse(dirtyFresh.stdout);
  assert.equal(dirtyFreshValue.route.trusted, true);
  assert.deepEqual(dirtyFreshValue.route.reasons, []);
  rmSync(resolve(repository, "dirty.txt"));

  const preflightPath = resolve(repository, ".echo-semantic/preflight.json");
  writeFileSync(preflightPath, '{"schemaVersion":1}\n', "utf8");
  const malformedPreflight = spawnSync(
    "uv",
    ["run", script, "--root", repository],
    { encoding: "utf8" },
  );
  assert.equal(malformedPreflight.status, 0, malformedPreflight.stderr);
  const malformedPreflightValue = JSON.parse(malformedPreflight.stdout);
  assert.equal(malformedPreflightValue.preflight.valid, false);
  assert.match(
    malformedPreflightValue.preflight.reasons.join("、"),
    /reuse|verifications/,
  );
  rmSync(preflightPath);

  writeFileSync(resolve(repository, "change.txt"), "change\n", "utf8");
  const changed = spawnSync("uv", ["run", script, "--root", repository], {
    encoding: "utf8",
  });
  assert.equal(changed.status, 0, changed.stderr);
  const changedValue = JSON.parse(changed.stdout);
  assert.equal(changedValue.route.trusted, false);
  assert.match(changedValue.route.reasons.join("、"), /工作树已变化/);

  mkdirSync(resolve(routePath, ".."), { recursive: true });
  writeFileSync(routePath, JSON.stringify({ route: "strict" }), "utf8");
  const malformedRoute = spawnSync(
    "uv",
    ["run", script, "--root", repository],
    {
      encoding: "utf8",
    },
  );
  assert.equal(malformedRoute.status, 0, malformedRoute.stderr);
  const malformedRouteValue = JSON.parse(malformedRoute.stdout);
  assert.equal(malformedRouteValue.route.trusted, false);
  // 路由诊断保留；已有继续包但缺少有效预检时，先核对局部恢复依据。
  assert.deepEqual(malformedRouteValue.next, ["semantic-preflight"]);

  const continuationPath = resolve(
    repository,
    ".echo-semantic/continuation.json",
  );
  const malformedContinuation = JSON.parse(
    readFileSync(continuationPath, "utf8"),
  );
  delete malformedContinuation.schemaVersion;
  writeFileSync(
    continuationPath,
    JSON.stringify(malformedContinuation),
    "utf8",
  );
  const malformed = spawnSync("uv", ["run", script, "--root", repository], {
    encoding: "utf8",
  });
  assert.equal(malformed.status, 0, malformed.stderr);
  const malformedValue = JSON.parse(malformed.stdout);
  assert.equal(malformedValue.continuation.trusted, false);
  assert.match(malformedValue.continuation.reasons.join("、"), /版本无效/);

  writeFileSync(
    resolve(repository, ".echo-semantic/baseline.md"),
    "changed\n",
    "utf8",
  );
  const stale = spawnSync("uv", ["run", script, "--root", repository], {
    encoding: "utf8",
  });
  assert.equal(stale.status, 0, stale.stderr);
  const staleValue = JSON.parse(stale.stdout);
  assert.equal(staleValue.baseline.validStructure, false);
  assert.equal(staleValue.continuation.trusted, false);
  assert.match(staleValue.continuation.reasons.join("、"), /证据已变化/);
});
