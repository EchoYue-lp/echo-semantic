import assert from "node:assert/strict";
import {
  chmodSync,
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readlinkSync,
  realpathSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

const root = resolve(import.meta.dirname, "..");
const installer = resolve(root, "bin/install.mjs");

test("Cursor 单渠道安装、覆盖和卸载", () => {
  const home = mkdtempSync(resolve(tmpdir(), "echo-semantic-install-"));
  mkdirSync(resolve(home, ".cursor/plugins/local"), { recursive: true });
  const env = { ...process.env, HOME: home };
  const target = resolve(home, ".cursor/plugins/local/echo-semantic");
  const legacyTarget = resolve(
    home,
    ".cursor/plugins/local/echo-coding-semantic-governance",
  );
  const legacyState = resolve(
    home,
    ".echo-coding-semantic-governance/install-state.json",
  );
  mkdirSync(legacyTarget, { recursive: true });
  writeFileSync(resolve(legacyTarget, "legacy.txt"), "legacy\n", "utf8");
  mkdirSync(dirname(legacyState), { recursive: true });
  writeFileSync(legacyState, "{}\n", "utf8");

  let result = spawnSync("node", [installer, "install", "cursor"], {
    encoding: "utf8",
    env,
  });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(resolve(target, "..", readlinkSync(target)), root);
  assert.equal(existsSync(legacyTarget), false);
  assert.equal(existsSync(dirname(legacyState)), false);

  result = spawnSync("node", [installer, "install", "cursor"], {
    encoding: "utf8",
    env,
  });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(resolve(target, "..", readlinkSync(target)), root);

  result = spawnSync("node", [installer, "uninstall", "cursor"], {
    encoding: "utf8",
    env,
  });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(existsSync(target), false);
  assert.equal(existsSync(resolve(home, ".echo-semantic")), false);
});

test("跨克隆安装直接覆盖当前渠道，不需要来源迁移", () => {
  const directory = mkdtempSync(resolve(tmpdir(), "echo-semantic-clones-"));
  const home = resolve(directory, "home");
  const first = resolve(directory, "first");
  const second = resolve(directory, "second");
  mkdirSync(resolve(home, ".cursor/plugins/local"), { recursive: true });
  for (const source of [first, second]) {
    mkdirSync(resolve(source, "bin"), { recursive: true });
    cpSync(installer, resolve(source, "bin/install.mjs"));
  }
  const env = { ...process.env, HOME: home };
  const target = resolve(home, ".cursor/plugins/local/echo-semantic");
  let result = spawnSync(
    "node",
    [resolve(first, "bin/install.mjs"), "install", "cursor"],
    {
      encoding: "utf8",
      env,
    },
  );
  assert.equal(result.status, 0, result.stderr);
  result = spawnSync(
    "node",
    [resolve(second, "bin/install.mjs"), "install", "cursor"],
    {
      encoding: "utf8",
      env,
    },
  );
  assert.equal(result.status, 0, result.stderr);
  assert.equal(
    resolve(target, "..", readlinkSync(target)),
    realpathSync(second),
  );
});

test("悬空 Cursor 符号链接也会被卸载", () => {
  const home = mkdtempSync(resolve(tmpdir(), "echo-semantic-dangling-"));
  const target = resolve(home, ".cursor/plugins/local/echo-semantic");
  mkdirSync(resolve(home, ".cursor/plugins/local"), { recursive: true });
  symlinkSync(resolve(home, "missing-plugin"), target, "dir");
  const result = spawnSync("node", [installer, "uninstall", "cursor"], {
    encoding: "utf8",
    env: { ...process.env, HOME: home },
  });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(existsSync(target), false);
});

test("一键安装会检测未安装宿主并独立报告", () => {
  const home = mkdtempSync(resolve(tmpdir(), "echo-semantic-detect-"));
  const fakeBin = resolve(home, "bin");
  mkdirSync(fakeBin, { recursive: true });
  writeFileSync(resolve(fakeBin, "codex"), "", "utf8");
  writeFileSync(resolve(fakeBin, "claude"), "", "utf8");
  const detectedEnv = {
    ...process.env,
    HOME: home,
    PATH: `${dirname(process.execPath)}${process.platform === "win32" ? ";" : ":"}${fakeBin}`,
  };
  const dryRun = spawnSync("node", [installer, "install", "all", "--dry-run"], {
    encoding: "utf8",
    env: detectedEnv,
  });
  assert.equal(dryRun.status, 0, dryRun.stderr);
  const output = JSON.parse(dryRun.stdout);
  assert.equal(output.results.codex.status, "installed");
  assert.equal(output.results["claude-code"].status, "installed");
  assert.ok(["installed", "skipped"].includes(output.results.cursor.status));
});

test("Codex 重命名安装清理旧 Hook、Agent 和状态", () => {
  const home = mkdtempSync(resolve(tmpdir(), "echo-semantic-codex-rename-"));
  const fakeBin = resolve(home, "bin");
  const codex = resolve(fakeBin, "codex");
  mkdirSync(fakeBin, { recursive: true });
  writeFileSync(codex, "#!/bin/sh\nexit 0\n", "utf8");
  chmodSync(codex, 0o755);

  const hooksPath = resolve(home, ".codex/hooks.json");
  mkdirSync(dirname(hooksPath), { recursive: true });
  writeFileSync(
    hooksPath,
    JSON.stringify({
      hooks: {
        SessionStart: [
          {
            hooks: [
              {
                type: "command",
                command:
                  'node "${PLUGIN_ROOT}/hooks/entry.mjs" codex session-start',
              },
            ],
          },
        ],
      },
    }),
    "utf8",
  );
  const agentRoot = resolve(home, ".codex/agents");
  mkdirSync(agentRoot, { recursive: true });
  writeFileSync(
    resolve(
      agentRoot,
      "echo-coding-semantic-governance-semantic-risk-reviewer.toml",
    ),
    "legacy\n",
    "utf8",
  );
  const legacyStateRoot = resolve(home, ".echo-coding-semantic-governance");
  mkdirSync(legacyStateRoot, { recursive: true });
  writeFileSync(resolve(legacyStateRoot, "install-state.json"), "{}\n", "utf8");

  const result = spawnSync("node", [installer, "install", "codex"], {
    encoding: "utf8",
    env: {
      ...process.env,
      HOME: home,
      PATH: `${fakeBin}${process.platform === "win32" ? ";" : ":"}${dirname(process.execPath)}`,
    },
  });
  assert.equal(result.status, 0, result.stderr);
  const hooks = JSON.parse(readFileSync(hooksPath, "utf8"));
  assert.equal(hooks.hooks.SessionStart.length, 1);
  assert.match(hooks.hooks.SessionStart[0].hooks[0].command, /echo-semantic$/);
  assert.equal(existsSync(legacyStateRoot), false);
  assert.equal(
    existsSync(
      resolve(
        agentRoot,
        "echo-coding-semantic-governance-semantic-risk-reviewer.toml",
      ),
    ),
    false,
  );
  assert.equal(
    existsSync(resolve(agentRoot, "echo-semantic-semantic-risk-reviewer.toml")),
    true,
  );
});

test("未知宿主返回非零且不创建状态", () => {
  const home = mkdtempSync(resolve(tmpdir(), "echo-semantic-invalid-"));
  const result = spawnSync("node", [installer, "install", "unknown"], {
    encoding: "utf8",
    env: { ...process.env, HOME: home },
  });
  assert.notEqual(result.status, 0);
  assert.equal(existsSync(resolve(home, ".echo-semantic")), false);
});
