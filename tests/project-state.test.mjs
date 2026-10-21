import assert from "node:assert/strict";
import {
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { spawn, spawnSync } from "node:child_process";
import test from "node:test";

import {
  projectStatePath,
  readProjectJson,
  updateProjectJson,
  writeProjectJson,
  writeVisibleStatus,
} from "../runtime/project-state.mjs";

function git(cwd, ...args) {
  const result = spawnSync("git", ["-C", cwd, ...args], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim();
}

test("项目状态统一写入 .echo-semantic 并自动从 Git 状态排除", () => {
  const repository = mkdtempSync(
    resolve(tmpdir(), "echo-semantic-project-state-"),
  );
  git(repository, "init", "-q");
  writeProjectJson(repository, "preflight.json", { schemaVersion: 1 });
  writeProjectJson(repository, "route.json", { schemaVersion: 1 });
  writeProjectJson(repository, "continuation.json", { schemaVersion: 1 });
  writeProjectJson(repository, "session-snapshot.json", { schemaVersion: 2 });
  writeProjectJson(repository, "stop-dedupe.json", { schemaVersion: 2 });
  const visible = writeVisibleStatus(repository, {
    state: "ready",
    event: "session-start",
    host: "codex",
    route: "strict",
    next: ["semantic-audit", "semantic-verify"],
    message: "路由已计算",
  });

  for (const name of [
    "status.md",
    "status.json",
    "preflight.json",
    "route.json",
    "continuation.json",
    "session-snapshot.json",
    "stop-dedupe.json",
  ]) {
    assert.equal(existsSync(projectStatePath(repository, name)), true);
  }
  assert.equal(visible.state, "ready");
  const statusMarkdown = readFileSync(
    projectStatePath(repository, "status.md"),
    "utf8",
  );
  assert.match(statusMarkdown, /状态：已就绪/);
  assert.match(statusMarkdown, new RegExp(`状态版本：${visible.revision}`));
  assert.match(
    readFileSync(projectStatePath(repository, "status.md"), "utf8"),
    /semantic-audit -> semantic-verify/,
  );
  assert.equal(git(repository, "status", "--short"), "");
  const exclude = resolve(
    repository,
    git(repository, "rev-parse", "--git-path", "info/exclude"),
  );
  const excluded = readFileSync(exclude, "utf8");
  for (const name of [
    "status.md",
    "status.json",
    "preflight.json",
    "route.json",
    "continuation.json",
    "session-snapshot.json",
    "stop-dedupe.json",
  ]) {
    assert.match(
      excluded,
      new RegExp(`^/\\.echo-semantic/${name.replace(".", "\\.")}$`, "m"),
    );
  }
});

test("首次使用时迁移旧 Git 私有状态且不覆盖新目录文件", () => {
  const repository = mkdtempSync(
    resolve(tmpdir(), "echo-semantic-state-migration-"),
  );
  git(repository, "init", "-q");
  const legacy = resolve(
    repository,
    git(repository, "rev-parse", "--git-path", "echo-semantic"),
  );
  mkdirSync(legacy, { recursive: true });
  writeFileSync(resolve(legacy, "preflight.json"), '{"legacy":true}\n', "utf8");
  mkdirSync(resolve(repository, ".echo-semantic"), { recursive: true });
  writeFileSync(
    resolve(repository, ".echo-semantic/route.json"),
    '{"current":true}\n',
    "utf8",
  );

  writeVisibleStatus(repository, {
    state: "working",
    event: "session-start",
    host: "codex",
  });

  assert.equal(
    existsSync(resolve(repository, ".echo-semantic/preflight.json")),
    true,
  );
  assert.equal(
    JSON.parse(
      readFileSync(
        resolve(repository, ".echo-semantic/preflight.json"),
        "utf8",
      ),
    ).legacy,
    true,
  );
  assert.equal(
    JSON.parse(
      readFileSync(resolve(repository, ".echo-semantic/route.json"), "utf8"),
    ).current,
    true,
  );
  assert.equal(existsSync(resolve(legacy, "preflight.json")), false);
});

test("拒绝通过符号链接写出项目目录", () => {
  const repository = mkdtempSync(
    resolve(tmpdir(), "echo-semantic-state-symlink-"),
  );
  const outside = mkdtempSync(
    resolve(tmpdir(), "echo-semantic-state-outside-"),
  );
  git(repository, "init", "-q");
  const legacy = resolve(
    repository,
    git(repository, "rev-parse", "--git-path", "echo-semantic"),
  );
  mkdirSync(legacy, { recursive: true });
  writeFileSync(resolve(legacy, "preflight.json"), '{"legacy":true}\n', "utf8");
  symlinkSync(outside, resolve(repository, ".echo-semantic"), "dir");
  assert.throws(
    () => writeVisibleStatus(repository, { state: "working", host: "codex" }),
    /必须是普通目录/,
  );
  assert.equal(existsSync(resolve(outside, "status.json")), false);
  assert.equal(existsSync(resolve(outside, "preflight.json")), false);
  assert.equal(existsSync(resolve(legacy, "preflight.json")), true);
});

test("运行态 JSON 读取拒绝仓外最终符号链接", () => {
  const repository = mkdtempSync(resolve(tmpdir(), "echo-state-read-symlink-"));
  const outside = mkdtempSync(resolve(tmpdir(), "echo-state-read-outside-"));
  git(repository, "init", "-q");
  mkdirSync(resolve(repository, ".echo-semantic"));
  const privateFile = resolve(outside, "private.json");
  writeFileSync(privateFile, '{"private":true}\n', "utf8");
  symlinkSync(
    privateFile,
    projectStatePath(repository, "session-snapshot.json"),
  );
  assert.equal(readProjectJson(repository, "session-snapshot.json"), null);
});

test("拒绝覆盖已被 Git 跟踪的运行态文件", () => {
  const repository = mkdtempSync(
    resolve(tmpdir(), "echo-semantic-state-tracked-"),
  );
  git(repository, "init", "-q");
  mkdirSync(resolve(repository, ".echo-semantic"));
  writeFileSync(
    resolve(repository, ".echo-semantic/status.json"),
    "{}\n",
    "utf8",
  );
  git(repository, "add", "-f", ".echo-semantic/status.json");
  assert.throws(
    () => writeVisibleStatus(repository, { state: "working", host: "codex" }),
    /不能被 Git 跟踪/,
  );
  assert.equal(
    readFileSync(resolve(repository, ".echo-semantic/status.json"), "utf8"),
    "{}\n",
  );
});

test("超过安全读取上限的 JSON 写入不会覆盖原运行态", () => {
  const repository = mkdtempSync(resolve(tmpdir(), "echo-state-size-limit-"));
  git(repository, "init", "-q");
  writeProjectJson(repository, "session-snapshot.json", { records: [] });
  const path = projectStatePath(repository, "session-snapshot.json");
  const before = readFileSync(path, "utf8");
  assert.throws(
    () =>
      writeProjectJson(repository, "session-snapshot.json", {
        large: "x".repeat(1024 * 1024),
      }),
    /超过 1 MiB/,
  );
  assert.equal(readFileSync(path, "utf8"), before);
});

test("无法写入精确排除规则时拒绝创建运行态", () => {
  const repository = mkdtempSync(
    resolve(tmpdir(), "echo-semantic-state-exclude-"),
  );
  git(repository, "init", "-q");
  const exclude = resolve(
    repository,
    git(repository, "rev-parse", "--git-path", "info/exclude"),
  );
  rmSync(exclude, { force: true });
  mkdirSync(exclude);
  assert.throws(
    () => writeProjectJson(repository, "route.json", { schemaVersion: 1 }),
    /无法把 Echo Semantic 运行态加入/,
  );
  assert.equal(
    existsSync(resolve(repository, ".echo-semantic/route.json")),
    false,
  );
});

test("项目状态更新锁拒绝覆盖竞争写并恢复陈旧锁", () => {
  const repository = mkdtempSync(
    resolve(tmpdir(), "echo-semantic-state-lock-"),
  );
  git(repository, "init", "-q");
  updateProjectJson(repository, "route.json", () => ({ value: 1 }));
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
  assert.throws(
    () =>
      updateProjectJson(repository, "route.json", () => ({ value: 2 }), {
        timeoutMs: 20,
        staleMs: 60_000,
      }),
    /无法获取 Echo Semantic 项目状态锁/,
  );
  assert.equal(
    JSON.parse(readFileSync(projectStatePath(repository, "route.json"), "utf8"))
      .value,
    1,
  );

  const old = new Date(Date.now() - 120_000);
  const exited = spawnSync(process.execPath, ["-e", ""], { encoding: "utf8" });
  assert.equal(exited.status, 0);
  writeFileSync(lock, `${exited.pid}:exited`, "utf8");
  utimesSync(lock, old, old);
  updateProjectJson(
    repository,
    "route.json",
    (current) => ({ value: current.value + 1 }),
    { timeoutMs: 50, staleMs: 60_000 },
  );
  assert.equal(existsSync(lock), false);
  assert.equal(
    JSON.parse(readFileSync(projectStatePath(repository, "route.json"), "utf8"))
      .value,
    2,
  );
});

for (const owner of ["active", "untrusted"]) {
  test(`陈旧 ${owner} 锁不能仅凭年龄删除`, () => {
    const repository = mkdtempSync(resolve(tmpdir(), "echo-state-live-lock-"));
    git(repository, "init", "-q");
    const lock = resolve(
      repository,
      git(
        repository,
        "rev-parse",
        "--git-path",
        "echo-semantic-project-state.lock",
      ),
    );
    const token = owner === "active" ? `${process.pid}:held` : "untrusted";
    writeFileSync(lock, token, "utf8");
    const old = new Date(Date.now() - 120_000);
    utimesSync(lock, old, old);
    assert.throws(
      () =>
        updateProjectJson(repository, "route.json", () => ({ value: 1 }), {
          timeoutMs: 20,
          staleMs: 10,
        }),
      /无法获取 Echo Semantic 项目状态锁/,
    );
    assert.equal(readFileSync(lock, "utf8"), token);
  });
}

for (const stale of [false, true]) {
  test(`双进程状态更新不丢记录（stale=${stale}）`, async () => {
    const repository = mkdtempSync(resolve(tmpdir(), "echo-state-concurrent-"));
    git(repository, "init", "-q");
    if (stale) {
      const lock = resolve(
        repository,
        git(
          repository,
          "rev-parse",
          "--git-path",
          "echo-semantic-project-state.lock",
        ),
      );
      const exited = spawnSync(process.execPath, ["-e", ""], {
        encoding: "utf8",
      });
      assert.equal(exited.status, 0);
      writeFileSync(lock, `${exited.pid}:exited`, "utf8");
      const old = new Date(Date.now() - 120_000);
      utimesSync(lock, old, old);
    }
    const moduleUrl = new URL("../runtime/project-state.mjs", import.meta.url)
      .href;
    const script = `
      import { updateProjectJson } from ${JSON.stringify(moduleUrl)};
      updateProjectJson(process.argv[1], "session-snapshot.json", (current) => {
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 100);
        return { records: [...(current?.records ?? []), process.argv[2]] };
      });
    `;
    const run = (id) =>
      new Promise((accept, reject) => {
        const child = spawn(process.execPath, [
          "--input-type=module",
          "-e",
          script,
          repository,
          id,
        ]);
        let stderr = "";
        child.stderr.on("data", (value) => {
          stderr += value;
        });
        child.on("error", reject);
        child.on("close", (code) => {
          if (code === 0) accept();
          else reject(new Error(stderr || `child exited ${code}`));
        });
      });
    await Promise.all([run("a"), run("b")]);
    const value = JSON.parse(
      readFileSync(
        projectStatePath(repository, "session-snapshot.json"),
        "utf8",
      ),
    );
    assert.deepEqual(value.records.sort(), ["a", "b"]);
  });
}
