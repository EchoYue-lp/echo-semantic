import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import test from "node:test";

import { validPreflightRecord } from "../hooks/entry.mjs";

const fixture = JSON.parse(
  readFileSync(
    resolve(import.meta.dirname, "fixtures/preflight-contract.json"),
    "utf8",
  ),
);

function record(root, currentTime) {
  return {
    schemaVersion: 1,
    pluginId: "echo-semantic",
    repositoryRoot: realpathSync(root),
    baseRevision: "a".repeat(40),
    recordedAt: new Date(currentTime).toISOString(),
    taskId: "contract-fixture",
    kind: "bugfix",
    risk: "low",
    allowedPaths: ["src"],
    reuse: ["复用现有能力"],
    verifications: ["运行定向测试"],
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

test("Node 与 Python 共享预检合同 fixture", () => {
  const root = mkdtempSync(resolve(tmpdir(), "echo-preflight-fixture-"));
  const currentTime = Date.now();
  for (const item of fixture.cases) {
    const value = record(root, currentTime);
    Object.assign(value, item.set ?? {});
    Object.assign(value.signals, item.signals ?? {});
    for (const field of item.remove ?? []) delete value[field];
    assert.equal(
      validPreflightRecord(value, realpathSync(root), {
        currentHead: "a".repeat(40),
        currentTime,
      }),
      item.valid,
      item.name,
    );
  }
});
