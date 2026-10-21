import { createHash } from "node:crypto";
import assert from "node:assert/strict";
import fs from "node:fs";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { syncBuiltinESMExports } from "node:module";
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
  const value = {
    schemaVersion: 2,
    pluginId: "echo-semantic",
    scope: "task",
    repositoryRoot: realpathSync(root),
    baseRevision: "a".repeat(40),
    recordedAt: new Date(currentTime).toISOString(),
    taskId: "contract-fixture",
    kind: "bugfix",
    risk: "low",
    allowedPaths: ["src"],
    reuseCheck: {
      searchPaths: ["."],
      decision: "new",
      reason: "夹具已进行名称与行为检索",
      candidates: [],
      evidence: [],
    },
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

test("Node 无引用零读取，多引用共享单次索引，下次检查不复用旧内容", () => {
  const root = realpathSync(
    mkdtempSync(resolve(tmpdir(), "echo-node-ref-cache-")),
  );
  const directory = resolve(root, ".echo-semantic/rules");
  mkdirSync(directory, { recursive: true });
  const first = resolve(directory, "rule.one.md");
  const second = resolve(directory, "rule.two.md");
  writeFileSync(first, "---\nid: rule.one\n---\n");
  writeFileSync(second, "---\nid: rule.two\n---\n");
  const original = fs.readFileSync;
  let reads = 0;
  fs.readFileSync = (path, ...args) => {
    if ([first, second].includes(String(path))) reads += 1;
    return original(path, ...args);
  };
  syncBuiltinESMExports();
  try {
    const now = Date.now();
    const value = record(root, now);
    const options = { currentHead: "a".repeat(40), currentTime: now };
    assert.equal(validPreflightRecord(value, root, options), true);
    assert.equal(reads, 0);
    value.semanticRefs = ["rule.one", "rule.two", "rule.one"];
    assert.equal(validPreflightRecord(value, root, options), true);
    assert.ok(reads >= 2);
    writeFileSync(second, "---\nid: rule.changed\n---\n");
    assert.equal(validPreflightRecord(value, root, options), false);
    assert.ok(reads >= 4);
  } finally {
    fs.readFileSync = original;
    syncBuiltinESMExports();
    rmSync(root, { recursive: true, force: true });
  }
});

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

test("仅有自由文本的旧预检不能作为当前写入依据", () => {
  const root = realpathSync(mkdtempSync(resolve(tmpdir(), "echo-old-record-")));
  try {
    const value = record(root, Date.now());
    value.schemaVersion = 1;
    delete value.reuseCheck;
    assert.equal(validPreflightRecord(value, root), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
