import assert from "node:assert/strict";
import {
  chmodSync,
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
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
    cwd: home,
    encoding: "utf8",
    env: {
      ...process.env,
      HOME: home,
      PATH: `${fakeBin}${process.platform === "win32" ? ";" : ":"}${dirname(process.execPath)}`,
    },
  });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(existsSync(hooksPath), false);
  const distribution = resolve(home, ".echo-semantic/distribution");
  assert.equal(
    existsSync(resolve(distribution, ".echo-semantic/baseline.md")),
    true,
  );
  for (const forbidden of [
    ".echo-semantic/status.md",
    ".echo-semantic/status.json",
    ".echo-semantic/preflight.json",
    ".echo-semantic/route.json",
    ".echo-semantic/continuation.json",
    "scripts/__pycache__",
  ]) {
    assert.equal(existsSync(resolve(distribution, forbidden)), false);
  }
  const nativeHooks = JSON.parse(
    readFileSync(resolve(distribution, "hooks/hooks.json"), "utf8"),
  );
  const probe = resolve(home, "native-hook-events.jsonl");
  for (const event of ["SessionStart", "PreCompact", "PreToolUse", "Stop"]) {
    const installedCommand = nativeHooks.hooks[event][0].hooks[0].command;
    assert.match(installedCommand, /PLUGIN_ROOT/);
    const hookResult = spawnSync(installedCommand, {
      cwd: home,
      input: "{}",
      encoding: "utf8",
      env: {
        ...process.env,
        HOME: home,
        PLUGIN_ROOT: distribution,
        PATH: `${dirname(process.execPath)}${process.platform === "win32" ? ";" : ":"}${fakeBin}`,
      },
      shell: true,
    });
    assert.equal(hookResult.status, 0, hookResult.stderr);
  }
  const claudeCommand = nativeHooks.hooks.SessionStart[0].hooks[0].command;
  const claudeResult = spawnSync(claudeCommand, {
    cwd: home,
    input: "{}",
    encoding: "utf8",
    env: {
      ...process.env,
      HOME: home,
      CLAUDE_PLUGIN_ROOT: distribution,
      ECHO_SEMANTIC_GOVERNANCE_PROBE_FILE: probe,
      PATH: `${dirname(process.execPath)}${process.platform === "win32" ? ";" : ":"}${fakeBin}`,
    },
    shell: true,
  });
  assert.equal(claudeResult.status, 0, claudeResult.stderr);
  assert.equal(JSON.parse(readFileSync(probe, "utf8")).host, "claude-code");
  const scriptResult = spawnSync(
    "python3",
    [
      resolve(distribution, "skills/semantic-preflight/scripts/preflight.py"),
      "--help",
    ],
    { cwd: home, encoding: "utf8", env: { ...process.env, HOME: home } },
  );
  assert.equal(scriptResult.status, 0, scriptResult.stderr);
  assert.deepEqual(
    readdirSync(distribution, { recursive: true }).filter(
      (path) => path.includes("__pycache__") || path.endsWith(".pyc"),
    ),
    [],
  );
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

  const uninstall = spawnSync("node", [installer, "uninstall", "codex"], {
    encoding: "utf8",
    env: {
      ...process.env,
      HOME: home,
      PATH: `${fakeBin}${process.platform === "win32" ? ";" : ":"}${dirname(process.execPath)}`,
    },
  });
  assert.equal(uninstall.status, 0, uninstall.stderr);
  assert.equal(existsSync(distribution), false);
});

test("Codex 与 Claude Code 共用分发副本并在最后卸载时清理", () => {
  const home = mkdtempSync(resolve(tmpdir(), "echo-semantic-shared-dist-"));
  const fakeBin = resolve(home, "bin");
  mkdirSync(fakeBin, { recursive: true });
  for (const command of ["codex", "claude"]) {
    const executable = resolve(fakeBin, command);
    writeFileSync(executable, "#!/bin/sh\nexit 0\n", "utf8");
    chmodSync(executable, 0o755);
  }
  const env = {
    ...process.env,
    HOME: home,
    PATH: `${fakeBin}${process.platform === "win32" ? ";" : ":"}${dirname(process.execPath)}`,
  };
  const distribution = resolve(home, ".echo-semantic/distribution");

  for (const host of ["codex", "claude-code"]) {
    const install = spawnSync("node", [installer, "install", host], {
      encoding: "utf8",
      env,
    });
    assert.equal(install.status, 0, install.stderr);
    assert.equal(existsSync(distribution), true);
  }

  const uninstallCodex = spawnSync("node", [installer, "uninstall", "codex"], {
    encoding: "utf8",
    env,
  });
  assert.equal(uninstallCodex.status, 0, uninstallCodex.stderr);
  assert.equal(existsSync(distribution), true);

  const uninstallClaude = spawnSync(
    "node",
    [installer, "uninstall", "claude-code"],
    { encoding: "utf8", env },
  );
  assert.equal(uninstallClaude.status, 0, uninstallClaude.stderr);
  assert.equal(existsSync(resolve(home, ".echo-semantic")), false);
});

test("分发 staging 失败时保留现有副本", () => {
  const home = mkdtempSync(resolve(tmpdir(), "echo-semantic-stage-failure-"));
  const fakeBin = resolve(home, "bin");
  mkdirSync(fakeBin, { recursive: true });
  const codex = resolve(fakeBin, "codex");
  writeFileSync(codex, "#!/bin/sh\nexit 0\n", "utf8");
  chmodSync(codex, 0o755);
  const npm = resolve(
    fakeBin,
    process.platform === "win32" ? "npm.cmd" : "npm",
  );
  writeFileSync(
    npm,
    process.platform === "win32"
      ? '@echo [{"files":[{"path":"missing.txt"}]}]\r\n'
      : '#!/bin/sh\nprintf \'[{"files":[{"path":"missing.txt"}]}]\\n\'\n',
    "utf8",
  );
  chmodSync(npm, 0o755);
  const distribution = resolve(home, ".echo-semantic/distribution");
  mkdirSync(distribution, { recursive: true });
  writeFileSync(resolve(distribution, "marker.txt"), "current\n", "utf8");
  writeFileSync(
    resolve(home, ".echo-semantic/install-state.json"),
    JSON.stringify({
      schemaVersion: 1,
      pluginId: "echo-semantic",
      providers: { "claude-code": { status: "installed" } },
    }),
    "utf8",
  );

  const result = spawnSync("node", [installer, "install", "codex"], {
    cwd: home,
    encoding: "utf8",
    env: {
      ...process.env,
      HOME: home,
      PATH: `${fakeBin}${process.platform === "win32" ? ";" : ":"}${dirname(process.execPath)}`,
    },
  });
  assert.notEqual(result.status, 0);
  assert.equal(
    readFileSync(resolve(distribution, "marker.txt"), "utf8"),
    "current\n",
  );
});

test("清理旧 Codex Hook 时保留用户配置的其它顶层字段", () => {
  const home = mkdtempSync(resolve(tmpdir(), "echo-semantic-hook-ownership-"));
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
      metadata: { owner: "user" },
      hooks: {
        Stop: [
          {
            hooks: [
              {
                type: "command",
                command:
                  'node "${PLUGIN_ROOT}/hooks/entry.mjs" codex stop echo-semantic',
              },
            ],
          },
        ],
      },
    }),
    "utf8",
  );

  const result = spawnSync("node", [installer, "install", "codex"], {
    encoding: "utf8",
    env: {
      ...process.env,
      HOME: home,
      PATH: `${fakeBin}${process.platform === "win32" ? ";" : ":"}${dirname(process.execPath)}`,
    },
  });
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(readFileSync(hooksPath, "utf8")), {
    metadata: { owner: "user" },
    hooks: {},
  });
});

for (const action of ["install", "uninstall"]) {
  test(`Codex ${action} 遇到损坏 Hook 配置时保留原文件且不调用宿主`, () => {
    const home = mkdtempSync(
      resolve(tmpdir(), `echo-semantic-corrupt-hooks-${action}-`),
    );
    const fakeBin = resolve(home, "bin");
    const codex = resolve(fakeBin, "codex");
    mkdirSync(fakeBin, { recursive: true });
    writeFileSync(
      codex,
      '#!/bin/sh\necho called >> "$HOME/codex-calls"\nexit 0\n',
      "utf8",
    );
    chmodSync(codex, 0o755);
    const hooksPath = resolve(home, ".codex/hooks.json");
    mkdirSync(dirname(hooksPath), { recursive: true });
    const damaged = '{"hooks":';
    writeFileSync(hooksPath, damaged, "utf8");

    const result = spawnSync("node", [installer, action, "codex"], {
      encoding: "utf8",
      env: {
        ...process.env,
        HOME: home,
        PATH: `${fakeBin}${process.platform === "win32" ? ";" : ":"}${dirname(process.execPath)}`,
      },
    });
    assert.notEqual(result.status, 0);
    assert.equal(readFileSync(hooksPath, "utf8"), damaged);
    assert.equal(existsSync(resolve(home, "codex-calls")), false);
  });
}

test("未知宿主返回非零且不创建状态", () => {
  const home = mkdtempSync(resolve(tmpdir(), "echo-semantic-invalid-"));
  const result = spawnSync("node", [installer, "install", "unknown"], {
    encoding: "utf8",
    env: { ...process.env, HOME: home },
  });
  assert.notEqual(result.status, 0);
  assert.equal(existsSync(resolve(home, ".echo-semantic")), false);
});
