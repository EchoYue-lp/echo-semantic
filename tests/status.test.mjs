import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

import { writeContinuation } from "../runtime/continuation.mjs";

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
    mkdirSync(resolve(repository, `semantic/${directory}`), {
      recursive: true,
    });
  }
  writeFileSync(
    resolve(repository, "semantic/baseline.md"),
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
      resolve(repository, `semantic/${directory}/${directory}.example.md`),
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
    evidenceRefs: ["semantic/baseline.md"],
  });
  const result = spawnSync("uv", ["run", script, "--root", repository], {
    encoding: "utf8",
  });
  assert.equal(result.status, 0, result.stderr);
  const value = JSON.parse(result.stdout);
  assert.equal(value.baseline.present, true);
  assert.equal(value.baseline.inventoryClosure, "closed");
  assert.equal(value.continuation.trusted, true);
  assert.ok(Array.isArray(value.next));

  const routePath = resolve(
    repository,
    git(repository, "rev-parse", "--git-path", "echo-semantic/route.json"),
  );
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
    git(
      repository,
      "rev-parse",
      "--git-path",
      "echo-semantic/continuation.json",
    ),
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
    resolve(repository, "semantic/baseline.md"),
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
