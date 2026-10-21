import { createHash } from "node:crypto";
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { recordPreflight } from "../scripts/record-preflight.mjs";

test(
  "两个同任务写入者竞争时，后取得锁的低风险不能覆盖已升级信号",
  { timeout: 30_000 },
  async (t) => {
    const root = realpathSync(
      mkdtempSync(resolve(tmpdir(), "echo-preflight-writers-")),
    );
    t.after(() => rmSync(root, { recursive: true, force: true }));
    const run = (name, args) => {
      const result = spawnSync(name, args, {
        cwd: root,
        encoding: "utf8",
        timeout: 10_000,
      });
      assert.equal(result.status, 0, result.stderr);
      return result.stdout.trim();
    };
    run("git", ["init", "-q"]);
    run("git", ["config", "user.email", "test@example.com"]);
    run("git", ["config", "user.name", "Test"]);
    mkdirSync(resolve(root, ".echo-semantic/rules"), { recursive: true });
    writeFileSync(
      resolve(root, ".echo-semantic/rules/rule.fixture.md"),
      "---\nid: rule.fixture\nkind: rule\n---\n",
    );
    run("git", ["add", "."]);
    run("git", ["-c", "commit.gpgsign=false", "commit", "-qm", "baseline"]);
    const cli = fileURLToPath(
      new URL(
        "../skills/semantic-preflight/scripts/preflight.py",
        import.meta.url,
      ),
    );
    run("python3", [
      cli,
      "record",
      "--root",
      root,
      "--task-id",
      "shared-task",
      "--kind",
      "bugfix",
      "--risk",
      "low",
      "--allow",
      "src",
      "--search",
      ".",
      "--reuse-decision",
      "new",
      "--reuse",
      "复用能力",
      "--verify",
      "定向测试",
      "--basis",
      "任务证据",
      "--semantic-ref",
      "rule.fixture",
      "--reuse-existing-boundary",
      "已有边界",
    ]);
    const path = resolve(root, ".echo-semantic/preflight.json");
    const low = JSON.parse(readFileSync(path, "utf8"));
    const high = {
      ...low,
      risk: "high",
      signals: { ...low.signals, publicApi: true },
    };
    const lock = resolve(
      root,
      run("git", [
        "rev-parse",
        "--git-path",
        "echo-semantic-project-state.lock",
      ]),
    );
    const gate = resolve(root, ".git/low-writer-gate");
    writeFileSync(lock, `${process.pid}:${randomUUID()}`, { flag: "wx" });
    writeFileSync(gate, "等待高风险写入者完成\n");
    const moduleUrl = new URL(
      "../scripts/record-preflight.mjs",
      import.meta.url,
    ).href;
    // 只在测试子进程暂停第一次取锁，让两者先竞争，再强制 high → low。
    const script = `import fs from 'node:fs'; import {syncBuiltinESMExports} from 'node:module';
    import {recordPreflight} from ${JSON.stringify(moduleUrl)};
    const [root,payload,lock,gate]=process.argv.slice(1); const original=fs.openSync; let reported=false;
    fs.openSync=(path,...args)=>{if(String(path)===lock&&args[0]==='wx'&&!reported){reported=true;fs.writeSync(1,'ready\\n');
      while(gate&&fs.existsSync(gate)) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,10);}
      return original(path,...args);}; syncBuiltinESMExports();
    try{recordPreflight(root,JSON.parse(payload));}catch(error){fs.writeSync(2,error.message);process.exitCode=1;}`;
    const writer = (payload, writerGate) => {
      const child = spawn(
        process.execPath,
        [
          "--input-type=module",
          "-e",
          script,
          root,
          JSON.stringify(payload),
          lock,
          writerGate,
        ],
        { stdio: ["ignore", "pipe", "pipe"] },
      );
      t.after(() => {
        if (child.exitCode === null) child.kill();
      });
      let stderr = "";
      child.stderr.on("data", (chunk) => {
        stderr += chunk;
      });
      const ready = new Promise((resolveReady, reject) => {
        child.stdout.on("data", (chunk) => {
          if (String(chunk).includes("ready")) resolveReady();
        });
        child.once("error", reject);
        child.once("close", () =>
          reject(new Error(`竞争者未到取锁点：${stderr}`)),
        );
      });
      const done = new Promise((resolveDone) =>
        child.once("close", (code) => resolveDone({ code, stderr })),
      );
      return { ready, done };
    };
    const higher = writer(high, "");
    const lower = writer(low, gate);
    try {
      await Promise.all([higher.ready, lower.ready]);
      unlinkSync(lock);
      const accepted = await higher.done;
      assert.equal(accepted.code, 0, accepted.stderr);
      unlinkSync(gate);
      const rejected = await lower.done;
      assert.equal(rejected.code, 1);
      assert.match(rejected.stderr, /不得降级/);
      const final = JSON.parse(readFileSync(path, "utf8"));
      assert.equal(final.risk, "high");
      assert.equal(final.signals.publicApi, true);
    } finally {
      rmSync(gate, { force: true });
      rmSync(lock, { force: true });
    }
  },
);

test(
  "等待锁期间 repair 依据失效时完整合同拒绝提交，旧记录不变",
  { timeout: 30_000 },
  async (t) => {
    const root = realpathSync(
      mkdtempSync(resolve(tmpdir(), "echo-preflight-repair-wait-")),
    );
    t.after(() => rmSync(root, { recursive: true, force: true }));
    const run = (name, args, input) => {
      const result = spawnSync(name, args, {
        cwd: root,
        input,
        encoding: "utf8",
        timeout: 10_000,
      });
      assert.equal(result.status, 0, result.stderr || result.stdout);
      return result.stdout.trim();
    };
    run("git", ["init", "-q"]);
    run("git", ["config", "user.email", "test@example.com"]);
    run("git", ["config", "user.name", "Test"]);
    writeFileSync(resolve(root, "README.md"), "基线\n");
    run("git", ["add", "."]);
    run("git", ["-c", "commit.gpgsign=false", "commit", "-qm", "baseline"]);
    const cli = fileURLToPath(
      new URL(
        "../skills/semantic-preflight/scripts/preflight.py",
        import.meta.url,
      ),
    );
    run("python3", [
      cli,
      "record",
      "--root",
      root,
      "--task-id",
      "repair-task",
      "--kind",
      "bugfix",
      "--risk",
      "low",
      "--allow",
      "src",
      "--search",
      ".",
      "--reuse-decision",
      "new",
      "--reuse",
      "复用",
      "--verify",
      "定向测试",
      "--reuse-existing-boundary",
      "已有边界",
    ]);
    const path = resolve(root, ".echo-semantic/preflight.json");
    const old = readFileSync(path);
    const payload = {
      ...JSON.parse(old),
      risk: "high",
      semanticRefs: ["finding.repair"],
      repairRefs: ["finding.repair"],
      deletePaths: ["src/old.py"],
    };
    const finding = resolve(root, ".echo-semantic/findings/finding.repair.md");
    mkdirSync(resolve(root, ".echo-semantic/findings"));
    const valid =
      "---\nid: finding.repair\nkind: finding\nstatus: resolved\ntype: consolidation_candidate\n" +
      "decision: retire\ncanonical_asset_ref: asset.new\ndelete_paths: [src/old.py]\nreplacement_refs: [asset.new]\nrollback_ref: revert\n---\n";
    const lock = resolve(
      root,
      run("git", [
        "rev-parse",
        "--git-path",
        "echo-semantic-project-state.lock",
      ]),
    );
    const url = new URL("../scripts/record-preflight.mjs", import.meta.url)
      .href;
    const script = `import fs from 'node:fs'; import {syncBuiltinESMExports} from 'node:module';
    import {recordPreflight} from ${JSON.stringify(url)};
    const [root,payload,lock]=process.argv.slice(1);const original=fs.openSync;let ready=false;
    fs.openSync=(path,...args)=>{if(String(path)===lock&&args[0]==='wx'&&!ready){ready=true;fs.writeSync(1,'ready\\n');}
      return original(path,...args);};syncBuiltinESMExports();
    try{recordPreflight(root,JSON.parse(payload));}catch(error){fs.writeSync(2,error.message);process.exitCode=1;}`;
    for (const invalid of [
      valid.replace("status: resolved", "status: open"),
      null,
      valid.replace("rollback_ref: revert\n", ""),
    ]) {
      writeFileSync(finding, valid);
      payload.reuseCheck.evidence = [
        {
          path: ".echo-semantic/findings/finding.repair.md",
          contentDigest: createHash("sha256").update(valid).digest("hex"),
          mutable: false,
        },
      ];
      const validator = fileURLToPath(
        new URL("../scripts/check-preflight.py", import.meta.url),
      );
      assert.equal(
        run(
          "python3",
          [validator, "--root", root, "--head", payload.baseRevision],
          JSON.stringify(payload),
        ),
        "[]",
      );
      writeFileSync(lock, `${process.pid}:${randomUUID()}`, { flag: "wx" });
      const child = spawn(
        process.execPath,
        [
          "--input-type=module",
          "-e",
          script,
          root,
          JSON.stringify(payload),
          lock,
        ],
        { stdio: ["ignore", "pipe", "pipe"] },
      );
      t.after(() => {
        if (child.exitCode === null) child.kill();
      });
      let stderr = "";
      child.stderr.on("data", (chunk) => {
        stderr += chunk;
      });
      const done = new Promise((resolveDone) =>
        child.once("close", (code) => resolveDone(code)),
      );
      try {
        await new Promise((resolveReady, reject) => {
          child.stdout.on("data", (chunk) => {
            if (String(chunk).includes("ready")) resolveReady();
          });
          child.once("error", reject);
          child.once("close", () => reject(new Error(`未到取锁点：${stderr}`)));
        });
        if (invalid === null) unlinkSync(finding);
        else writeFileSync(finding, invalid);
        unlinkSync(lock);
        assert.equal(await done, 1);
        assert.match(stderr, /语义对象|已完成的 Finding|rollback_ref/);
        assert.deepEqual(readFileSync(path), old);
      } finally {
        rmSync(lock, { force: true });
      }
    }
    assert.throws(
      () =>
        recordPreflight(root, {
          ...payload,
          risk: "low",
          repairRefs: ["finding.missing"],
        }),
      /risk|语义对象/,
    );
    assert.deepEqual(readFileSync(path), old);
  },
);
