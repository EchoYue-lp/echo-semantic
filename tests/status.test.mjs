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
  assert.ok(
    malformedRouteValue.next.includes("semantic-verify"),
    JSON.stringify(malformedRouteValue),
  );

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
