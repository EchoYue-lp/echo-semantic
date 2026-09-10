#!/usr/bin/env node

import {
  existsSync,
  cpSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import {
  basename,
  delimiter,
  dirname,
  extname,
  join,
  resolve,
} from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const pluginId = "echo-semantic";
const legacyPluginIds = ["echo-coding-semantic-governance"];
const marketplace = pluginId;
const pluginRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const stateRoot = join(homedir(), `.${pluginId}`);
const stateFile = join(stateRoot, "install-state.json");
const distributionRoot = join(stateRoot, "distribution");
const hosts = ["codex", "cursor", "claude-code"];
const legacyCodexHookCommands = new Set(
  ["session-start", "pre-compact", "stop"].map(
    (event) => `node "\${PLUGIN_ROOT}/hooks/entry.mjs" codex ${event}`,
  ),
);

class InstallError extends Error {}

function commandPath(name) {
  const extensions =
    process.platform === "win32" ? [".exe", ".cmd", ".bat", ""] : [""];
  for (const directory of (process.env.PATH || "").split(delimiter)) {
    if (!directory) continue;
    for (const extension of extensions) {
      const candidate = join(directory, `${name}${extension}`);
      if (existsSync(candidate)) return candidate;
    }
  }
  return null;
}

function run(command, args, dryRun = false, { cwd } = {}) {
  if (dryRun) return { status: 0, stdout: "", stderr: "" };
  const result = spawnSync(command, args, {
    encoding: "utf8",
    timeout: 120_000,
    env: process.env,
    cwd,
  });
  if (result.status !== 0) {
    throw new InstallError(
      `${basename(command)} ${args.join(" ")} 失败：${(result.stderr || result.stdout || `退出码 ${result.status}`).trim()}`,
    );
  }
  return result;
}

function bestEffort(command, args, dryRun = false) {
  if (dryRun) return;
  spawnSync(command, args, {
    encoding: "utf8",
    timeout: 120_000,
    env: process.env,
  });
}

function loadState() {
  if (!existsSync(stateFile))
    return { schemaVersion: 1, pluginId, providers: {} };
  try {
    const data = JSON.parse(readFileSync(stateFile, "utf8"));
    if (
      data?.schemaVersion !== 1 ||
      data?.pluginId !== pluginId ||
      typeof data.providers !== "object"
    ) {
      throw new InstallError("安装状态版本或插件标识无效");
    }
    return data;
  } catch (error) {
    if (error instanceof InstallError) throw error;
    throw new InstallError(`安装状态无法读取：${error.message}`);
  }
}

function persistState(state) {
  if (Object.keys(state.providers).length === 0) {
    if (existsSync(stateFile)) rmSync(stateFile);
    if (existsSync(stateRoot) && readdirSync(stateRoot).length === 0) {
      rmSync(stateRoot, { recursive: true, force: true });
    }
    return;
  }
  mkdirSync(stateRoot, { recursive: true });
  const temporary = join(stateRoot, `.install-state.${process.pid}.tmp`);
  writeFileSync(temporary, `${JSON.stringify(state, null, 2)}\n`, "utf8");
  renameSync(temporary, stateFile);
}

function removeLegacyState(dryRun) {
  if (dryRun) return;
  for (const legacyId of legacyPluginIds) {
    rmSync(join(homedir(), `.${legacyId}`), { recursive: true, force: true });
  }
}

function cursorInstalled() {
  const candidates = [
    commandPath("cursor"),
    join(homedir(), ".cursor"),
    "/Applications/Cursor.app",
    process.env.LOCALAPPDATA
      ? join(process.env.LOCALAPPDATA, "Programs", "cursor")
      : null,
    "/usr/share/cursor",
  ];
  return candidates.some(
    (candidate) => Boolean(candidate) && existsSync(candidate),
  );
}

function detect(host) {
  if (host === "codex") return Boolean(commandPath("codex"));
  if (host === "claude-code") return Boolean(commandPath("claude"));
  return cursorInstalled();
}

function codexHooksPath() {
  return join(homedir(), ".codex", "hooks.json");
}

function hookCommand(group) {
  if (!Array.isArray(group?.hooks)) return null;
  return (
    group.hooks.find((hook) => typeof hook?.command === "string")?.command ??
    null
  );
}

function pluginHook(group) {
  const command = hookCommand(group);
  return (
    typeof command === "string" &&
    (command.includes(pluginId) ||
      legacyPluginIds.some((legacyId) => command.includes(legacyId)) ||
      legacyCodexHookCommands.has(command))
  );
}

function readCodexHooks() {
  const target = codexHooksPath();
  if (!existsSync(target)) return { hooks: {} };
  let current;
  try {
    current = JSON.parse(readFileSync(target, "utf8"));
  } catch (error) {
    throw new InstallError(
      `Codex Hook 配置无法解析，已保留原文件：${error.message}`,
    );
  }
  if (!current || typeof current !== "object" || Array.isArray(current))
    throw new InstallError("Codex Hook 配置必须是对象，已保留原文件");
  if (current.hooks === undefined) current.hooks = {};
  if (
    !current.hooks ||
    typeof current.hooks !== "object" ||
    Array.isArray(current.hooks)
  )
    throw new InstallError("Codex Hook 配置的 hooks 必须是对象，已保留原文件");
  return current;
}

function packedRelativePaths() {
  const npm = commandPath("npm");
  if (!npm) throw new InstallError("没有检测到 npm，无法生成插件分发目录");
  const packed = run(npm, ["pack", "--dry-run", "--json"], false, {
    cwd: pluginRoot,
  });
  let entries;
  try {
    entries = JSON.parse(packed.stdout);
  } catch (error) {
    throw new InstallError(`npm pack 输出无法解析：${error.message}`);
  }
  const files = entries?.at(0)?.files;
  if (!Array.isArray(files) || files.length === 0)
    throw new InstallError("npm pack 没有返回可安装文件");
  return files.map((entry) => {
    const relativePath = entry?.path?.replaceAll("\\", "/");
    if (
      typeof relativePath !== "string" ||
      !relativePath ||
      relativePath.startsWith("/") ||
      /^[A-Za-z]:\//.test(relativePath) ||
      relativePath.split("/").includes("..")
    ) {
      throw new InstallError(`npm pack 返回不安全路径：${relativePath}`);
    }
    return relativePath;
  });
}

function copyPackedFiles(destination) {
  mkdirSync(destination, { recursive: true });
  for (const relativePath of packedRelativePaths()) {
    const source = resolve(pluginRoot, relativePath);
    const target = resolve(destination, relativePath);
    mkdirSync(dirname(target), { recursive: true });
    cpSync(source, target, { dereference: true });
  }
}

function requirePackedFiles(destination, files, label) {
  for (const required of files) {
    if (!existsSync(resolve(destination, required)))
      throw new InstallError(`${label}缺少必需文件：${required}`);
  }
  const stat = lstatSync(destination);
  if (!stat.isDirectory() || stat.isSymbolicLink())
    throw new InstallError(`${label}必须是普通目录：${destination}`);
}

function stageDistribution(dryRun) {
  if (dryRun) return distributionRoot;
  mkdirSync(stateRoot, { recursive: true });
  const pending = join(stateRoot, `.distribution.${process.pid}.pending`);
  const previous = join(stateRoot, `.distribution.${process.pid}.previous`);
  rmSync(pending, { recursive: true, force: true });
  rmSync(previous, { recursive: true, force: true });
  try {
    copyPackedFiles(pending);
    requirePackedFiles(
      pending,
      [
        ".codex-plugin/plugin.json",
        "hooks/hooks.json",
        "skills/semantic-preflight/SKILL.md",
      ],
      "分发副本",
    );
    if (existsSync(distributionRoot)) {
      const stat = lstatSync(distributionRoot);
      if (!stat.isDirectory() || stat.isSymbolicLink())
        throw new InstallError(`分发副本必须是普通目录：${distributionRoot}`);
      renameSync(distributionRoot, previous);
    }
    try {
      renameSync(pending, distributionRoot);
    } catch (error) {
      if (existsSync(previous)) renameSync(previous, distributionRoot);
      throw error;
    }
    rmSync(previous, { recursive: true, force: true });
  } catch (error) {
    rmSync(pending, { recursive: true, force: true });
    throw error instanceof InstallError
      ? error
      : new InstallError(`无法生成插件分发副本：${error.message}`);
  }
  return distributionRoot;
}

function cleanupDistribution(state, dryRun) {
  if (!dryRun && !state.providers.codex && !state.providers["claude-code"]) {
    rmSync(distributionRoot, { recursive: true, force: true });
  }
}

function removeCodexHooks(dryRun) {
  const target = codexHooksPath();
  if (!existsSync(target)) return;
  const current = readCodexHooks();
  let changed = false;
  for (const [event, groups] of Object.entries(current.hooks || {})) {
    if (!Array.isArray(groups)) continue;
    const filtered = groups.filter((group) => !pluginHook(group));
    if (filtered.length !== groups.length) changed = true;
    current.hooks[event] = filtered;
    if (current.hooks[event].length === 0) delete current.hooks[event];
  }
  if (!dryRun && changed) {
    if (
      Object.keys(current.hooks || {}).length === 0 &&
      Object.keys(current).every((key) => key === "hooks")
    )
      rmSync(target);
    else writeFileSync(target, `${JSON.stringify(current, null, 2)}\n`, "utf8");
  }
}

function codexAgentsPath() {
  return join(homedir(), ".codex", "agents");
}

function updateCodexAgents(dryRun) {
  const targetRoot = codexAgentsPath();
  if (!dryRun) mkdirSync(targetRoot, { recursive: true });
  for (const entry of readdirSync(join(pluginRoot, "agents"), {
    withFileTypes: true,
  })) {
    if (!entry.isFile() || extname(entry.name) !== ".md") continue;
    const source = readFileSync(join(pluginRoot, "agents", entry.name), "utf8");
    const frontmatter = source.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
    const name = frontmatter?.[1]?.match(/^name:\s*([^\n]+)$/m)?.[1]?.trim();
    const description = frontmatter?.[1]
      ?.match(/^description:\s*([^\n]+)$/m)?.[1]
      ?.trim();
    if (!name || !description)
      throw new InstallError(`Agent frontmatter 无效：${entry.name}`);
    const target = join(targetRoot, `${pluginId}-${name}.toml`);
    const content = [
      `name = ${JSON.stringify(name)}`,
      `description = ${JSON.stringify(description)}`,
      'sandbox_mode = "read-only"',
      `developer_instructions = ${JSON.stringify(frontmatter[2].trim())}`,
      "",
    ].join("\n");
    if (!dryRun) writeFileSync(target, content, "utf8");
  }
}

function removeCodexAgents(dryRun) {
  const root = codexAgentsPath();
  if (!existsSync(root)) return;
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    if (
      !entry.isFile() ||
      ![pluginId, ...legacyPluginIds].some((id) =>
        entry.name.startsWith(`${id}-`),
      ) ||
      extname(entry.name) !== ".toml"
    )
      continue;
    if (!dryRun) rmSync(join(root, entry.name));
  }
}

function installCodex(dryRun) {
  const command = commandPath("codex");
  if (!command) throw new InstallError("没有检测到 Codex CLI");
  readCodexHooks();
  const installedRoot = stageDistribution(dryRun);
  for (const id of [pluginId, ...legacyPluginIds]) {
    bestEffort(command, ["plugin", "remove", `${id}@${id}`, "--json"], dryRun);
    bestEffort(
      command,
      ["plugin", "marketplace", "remove", id, "--json"],
      dryRun,
    );
  }
  run(
    command,
    ["plugin", "marketplace", "add", installedRoot, "--json"],
    dryRun,
  );
  run(
    command,
    ["plugin", "add", `${pluginId}@${marketplace}`, "--json"],
    dryRun,
  );
  removeCodexAgents(dryRun);
  updateCodexAgents(dryRun);
  removeCodexHooks(dryRun);
  return { status: "installed", pluginRef: `${pluginId}@${marketplace}` };
}

function uninstallCodex(dryRun) {
  const command = commandPath("codex");
  if (!command) throw new InstallError("没有检测到 Codex CLI");
  readCodexHooks();
  for (const id of [pluginId, ...legacyPluginIds]) {
    bestEffort(command, ["plugin", "remove", `${id}@${id}`, "--json"], dryRun);
    bestEffort(
      command,
      ["plugin", "marketplace", "remove", id, "--json"],
      dryRun,
    );
  }
  removeCodexAgents(dryRun);
  removeCodexHooks(dryRun);
  return { status: "removed" };
}

function installClaude(dryRun) {
  const command = commandPath("claude");
  if (!command) throw new InstallError("没有检测到 Claude Code CLI");
  const installedRoot = stageDistribution(dryRun);
  for (const id of [pluginId, ...legacyPluginIds]) {
    bestEffort(
      command,
      ["plugin", "uninstall", `${id}@${id}`, "--scope", "user"],
      dryRun,
    );
    bestEffort(command, ["plugin", "marketplace", "remove", id], dryRun);
  }
  run(
    command,
    ["plugin", "marketplace", "add", installedRoot, "--scope", "user"],
    dryRun,
  );
  run(
    command,
    ["plugin", "install", `${pluginId}@${marketplace}`, "--scope", "user"],
    dryRun,
  );
  return { status: "installed", pluginRef: `${pluginId}@${marketplace}` };
}

function uninstallClaude(dryRun) {
  const command = commandPath("claude");
  if (!command) throw new InstallError("没有检测到 Claude Code CLI");
  for (const id of [pluginId, ...legacyPluginIds]) {
    bestEffort(
      command,
      ["plugin", "uninstall", `${id}@${id}`, "--scope", "user"],
      dryRun,
    );
    bestEffort(command, ["plugin", "marketplace", "remove", id], dryRun);
  }
  return { status: "removed" };
}

function cursorTarget(id = pluginId) {
  return join(homedir(), ".cursor", "plugins", "local", id);
}

function installCursor(dryRun) {
  const target = cursorTarget();
  if (!dryRun) {
    mkdirSync(dirname(target), { recursive: true });
    for (const legacyId of legacyPluginIds) {
      rmSync(cursorTarget(legacyId), { recursive: true, force: true });
    }
    const pending = join(
      dirname(target),
      `.${pluginId}.${process.pid}.pending`,
    );
    rmSync(pending, { recursive: true, force: true });
    try {
      copyPackedFiles(pending);
      requirePackedFiles(
        pending,
        [
          ".cursor-plugin/plugin.json",
          "hooks/hooks-cursor.json",
          "skills/semantic-preflight/SKILL.md",
          "agents/semantic-boundary-explorer.md",
        ],
        "Cursor 插件",
      );
      rmSync(target, { recursive: true, force: true });
      renameSync(pending, target);
    } catch (error) {
      rmSync(pending, { recursive: true, force: true });
      throw error instanceof InstallError
        ? error
        : new InstallError(`无法安装 Cursor 插件：${error.message}`);
    }
  }
  return { status: "installed", pluginRef: target };
}

function uninstallCursor(dryRun) {
  if (!dryRun) {
    for (const id of [pluginId, ...legacyPluginIds]) {
      rmSync(cursorTarget(id), { recursive: true, force: true });
    }
  }
  return { status: "removed" };
}

function runProvider(host, action, dryRun) {
  if (action === "install") {
    return host === "codex"
      ? installCodex(dryRun)
      : host === "claude-code"
        ? installClaude(dryRun)
        : installCursor(dryRun);
  }
  return host === "codex"
    ? uninstallCodex(dryRun)
    : host === "claude-code"
      ? uninstallClaude(dryRun)
      : uninstallCursor(dryRun);
}

function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes("--dry-run");
  const positional = args.filter((item) => item !== "--dry-run");
  const action = positional[0] || "install";
  const target = positional[1] || "all";
  if (
    !new Set(["install", "uninstall"]).has(action) ||
    (target !== "all" && !hosts.includes(target))
  ) {
    process.stderr.write(
      "用法：node bin/install.mjs <install|uninstall> <all|codex|cursor|claude-code> [--dry-run]\n",
    );
    return 1;
  }
  const selected = target === "all" ? hosts : [target];
  const state = loadState();
  const results = {};
  for (const host of selected) {
    const detected = detect(host);
    if (!detected) {
      results[host] = {
        status: target === "all" ? "skipped" : "manual_action",
        detected: false,
        reason:
          host === "codex"
            ? "系统未安装 Codex"
            : host === "claude-code"
              ? "系统未安装 Claude Code"
              : "系统未安装 Cursor",
      };
      continue;
    }
    try {
      const result = runProvider(host, action, dryRun);
      results[host] = { ...result, detected: true };
      if (!dryRun) {
        if (action === "install")
          state.providers[host] = { status: "installed" };
        else delete state.providers[host];
      }
    } catch (error) {
      results[host] = { status: "failed", reason: error.message };
    }
  }
  if (!dryRun) {
    cleanupDistribution(state, false);
    persistState(state);
    removeLegacyState(false);
  }
  process.stdout.write(
    `${JSON.stringify({ action, target, dryRun, results }, null, 2)}\n`,
  );
  return Object.values(results).some((result) =>
    ["failed", "manual_action"].includes(result.status),
  )
    ? 1
    : 0;
}

process.exitCode = main();
