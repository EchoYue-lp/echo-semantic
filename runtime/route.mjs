#!/usr/bin/env node

import { checkPreflightRecord } from "./preflight-contract.mjs";
import { createHash } from "node:crypto";
import {
  closeSync,
  constants,
  existsSync,
  fstatSync,
  lstatSync,
  openSync,
  readFileSync,
  readlinkSync,
  readSync,
  realpathSync,
} from "node:fs";
import { dirname, extname, resolve, sep } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { loadCapabilities } from "./capabilities/load.mjs";
import { probeHost } from "./capabilities/probe.mjs";
import {
  readProjectJson,
  writeProjectJson,
  writeVisibleStatus,
} from "./project-state.mjs";

const pluginId = "echo-semantic";
const pluginRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const pluginVersion = JSON.parse(
  readFileSync(resolve(pluginRoot, "package.json"), "utf8"),
).version;
const hookEvidenceLifetimeMs = 24 * 60 * 60 * 1000;
const hookEvents = {
  "session-start": "sessionStart",
  "pre-edit": "preEdit",
  "pre-compact": "preCompact",
  stop: "stop",
};
const directoryGitExec =
  "import os,sys; os.fchdir(3); os.execvp('git', ['git', *sys.argv[1:]])";

function git(root, args, directoryFd = null) {
  const bytes = gitBytes(root, args, directoryFd);
  return bytes === null ? null : bytes.toString("utf8").trim();
}

function gitBytes(root, args, directoryFd = null) {
  const command = directoryFd === null ? "git" : "python3";
  const commandArgs =
    directoryFd === null
      ? ["-C", root, ...args]
      : ["-c", directoryGitExec, ...args];
  const result = spawnSync(command, commandArgs, {
    timeout: 10_000,
    maxBuffer: 64 * 1024 * 1024,
    ...(directoryFd === null
      ? {}
      : { stdio: ["ignore", "pipe", "pipe", directoryFd] }),
  });
  return result.status === 0 ? result.stdout : null;
}

function gitStatus(root, directoryFd = null) {
  return gitBytes(
    root,
    ["status", "--porcelain=v1", "-z", "--untracked-files=all"],
    directoryFd,
  );
}

function nulRecords(buffer) {
  const records = [];
  for (let start = 0; start < buffer.length; ) {
    const end = buffer.indexOf(0, start);
    if (end < 0) throw new Error("Git 输出缺少 NUL 分隔符");
    records.push(buffer.subarray(start, end));
    start = end + 1;
  }
  return records;
}

function changedPathBuffers(status) {
  if (status === null) return [];
  const records = nulRecords(status);
  const paths = [];
  const seen = new Set();
  const append = (value) => {
    const key = value.toString("hex");
    if (!seen.has(key)) {
      seen.add(key);
      paths.push(value);
    }
  };
  for (let index = 0; index < records.length; index += 1) {
    const record = records[index];
    if (record.length < 3) throw new Error("Git 状态记录无效");
    append(record.subarray(3));
    if (/[RC]/.test(record.subarray(0, 2).toString("ascii"))) {
      const source = records[++index];
      if (!source) throw new Error("Git 重命名记录缺少来源路径");
      append(source);
    }
  }
  return paths;
}

function selectedStatus(status, paths) {
  if (status === null || paths === null) return status;
  const selected = new Set(
    paths.map((path) => Buffer.from(path).toString("hex")),
  );
  const records = nulRecords(status);
  const output = [];
  for (let index = 0; index < records.length; index += 1) {
    const record = records[index];
    const group = [record];
    if (/[RC]/.test(record.subarray(0, 2).toString("ascii")))
      group.push(records[++index]);
    if (!group.every(Buffer.isBuffer)) throw new Error("Git 重命名记录不完整");
    if (
      selected.has(record.subarray(3).toString("hex")) ||
      (group[1] && selected.has(group[1].toString("hex")))
    ) {
      for (const item of group) output.push(item, Buffer.from([0]));
    }
  }
  return Buffer.concat(output);
}

function statusSummary(status) {
  if (status === null) return null;
  const summary = { staged: 0, unstaged: 0, untracked: 0 };
  const records = nulRecords(status);
  for (let index = 0; index < records.length; index += 1) {
    const xy = records[index].subarray(0, 2).toString("ascii");
    if (xy === "??") summary.untracked += 1;
    else {
      if (xy[0] !== " ") summary.staged += 1;
      if (xy[1] !== " ") summary.unstaged += 1;
    }
    if (/[RC]/.test(xy)) index += 1;
  }
  return summary;
}

function pathInside(root, path) {
  const prefix = Buffer.concat([root, Buffer.from(sep)]);
  return root.equals(path) || path.subarray(0, prefix.length).equals(prefix);
}

function parentInside(root, path) {
  const parent = path.subarray(0, path.lastIndexOf(47));
  return pathInside(root, realpathSync(parent, { encoding: "buffer" }));
}

function sameFile(left, right) {
  return (
    left.dev === right.dev &&
    left.ino === right.ino &&
    left.size === right.size &&
    left.mode === right.mode &&
    left.mtimeMs === right.mtimeMs &&
    left.ctimeMs === right.ctimeMs
  );
}

function addFileContent(digest, path, expected, root) {
  const buffer = Buffer.allocUnsafe(64 * 1024);
  let descriptor;
  let total = 0;
  try {
    const canonical = realpathSync(path, { encoding: "buffer" });
    if (!pathInside(root, canonical)) return false;
    descriptor = openSync(
      canonical,
      constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0),
    );
    const opened = fstatSync(descriptor);
    // 读取前核对 fd 与仍在仓库根内的路径身份，阻止符号链接竞态越界。
    const currentPath = realpathSync(canonical, { encoding: "buffer" });
    const current = lstatSync(canonical);
    if (
      !currentPath.equals(canonical) ||
      !pathInside(root, currentPath) ||
      !opened.isFile() ||
      !current.isFile() ||
      !sameFile(opened, expected) ||
      !sameFile(opened, current)
    )
      return false;
    digest.update(`${expected.size}:`);
    while (true) {
      const count = readSync(descriptor, buffer, 0, buffer.length, null);
      if (count === 0) break;
      total += count;
      digest.update(buffer.subarray(0, count));
    }
    if (!sameFile(opened, fstatSync(descriptor))) return false;
  } catch {
    return false;
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
  }
  return total === expected.size;
}

function checkedDirectoryRoot(root, authorization, expected) {
  try {
    const canonical = realpathSync(root, { encoding: "buffer" });
    if (authorization && !pathInside(authorization, canonical)) return null;
    const current = lstatSync(canonical);
    if (
      !current.isDirectory() ||
      current.isSymbolicLink() ||
      (expected &&
        (current.dev !== expected.dev ||
          current.ino !== expected.ino ||
          current.mode !== expected.mode)) ||
      !realpathSync(root, { encoding: "buffer" }).equals(canonical)
    )
      return null;
    return canonical;
  } catch {
    return null;
  }
}

function openDirectoryBinding(canonical, authorization, expected) {
  if (process.platform === "win32") return null;
  let descriptor;
  let accepted = false;
  try {
    descriptor = openSync(
      canonical,
      constants.O_RDONLY |
        (constants.O_DIRECTORY ?? 0) |
        (constants.O_NOFOLLOW ?? 0),
    );
    const opened = fstatSync(descriptor);
    const current = lstatSync(canonical);
    const actual = realpathSync(canonical, { encoding: "buffer" });
    if (
      !opened.isDirectory() ||
      !current.isDirectory() ||
      current.isSymbolicLink() ||
      opened.dev !== expected.dev ||
      opened.ino !== expected.ino ||
      opened.mode !== expected.mode ||
      current.dev !== opened.dev ||
      current.ino !== opened.ino ||
      !actual.equals(canonical) ||
      !pathInside(authorization, actual)
    )
      return null;
    accepted = true;
    return descriptor;
  } catch {
    return null;
  } finally {
    if (!accepted && descriptor !== undefined) closeSync(descriptor);
  }
}

function worktreeFingerprint(
  root,
  status,
  headRevision,
  parents = new Set(),
  authorization = null,
  expectedDirectory = null,
  selectedPaths = null,
) {
  // 递归只能继承最初授权根，目录检查必须先于任何 nested Git 调用。
  const canonicalRoot = checkedDirectoryRoot(
    root,
    authorization,
    expectedDirectory,
  );
  if (canonicalRoot === null) return null;
  const allowedRoot = authorization ?? canonicalRoot;
  root = canonicalRoot.toString("utf8");
  const identity = root;
  if (parents.has(identity)) return null;
  const lineage = new Set(parents);
  lineage.add(identity);
  const directoryFd = expectedDirectory
    ? openDirectoryBinding(canonicalRoot, allowedRoot, expectedDirectory)
    : null;
  if (expectedDirectory && directoryFd === null) return null;
  try {
    if (status === undefined) status = gitStatus(root, directoryFd);
    if (headRevision === undefined)
      headRevision = git(root, ["rev-parse", "HEAD"], directoryFd);
    if (status === null || headRevision === null) return null;
    const indexArgs = ["ls-files", "--stage", "-z"];
    const index = gitBytes(root, indexArgs, directoryFd);
    if (index === null) return null;
    const digest = createHash("sha256");
    // 长度分帧，文件名和内容均保持原始字节，避免转义和拼接歧义。
    const add = (value) => {
      const bytes = Buffer.isBuffer(value) ? value : Buffer.from(value);
      digest.update(`${bytes.length}:`);
      digest.update(bytes);
    };
    add("echo-semantic-worktree-v2");
    add(headRevision);
    add(status);
    const selected =
      selectedPaths === null
        ? null
        : new Set(
            selectedPaths.map((path) => Buffer.from(path).toString("hex")),
          );
    add(
      selected === null
        ? index
        : Buffer.concat(
            nulRecords(index)
              .filter((entry) =>
                selected.has(
                  entry.subarray(entry.indexOf(9) + 1).toString("hex"),
                ),
              )
              .flatMap((entry) => [entry, Buffer.from([0])]),
          ),
    );
    try {
      const names = changedPathBuffers(status).sort(Buffer.compare);
      for (const name of names) {
        add(name);
        const path = Buffer.concat([Buffer.from(`${resolve(root)}/`), name]);
        try {
          if (!parentInside(canonicalRoot, path)) return null;
          const stat = lstatSync(path);
          if (stat.isSymbolicLink()) {
            add("symlink");
            add(readlinkSync(path, { encoding: "buffer" }));
          } else if (stat.isFile()) {
            add(`file:${stat.mode & 0o111}`);
            if (!addFileContent(digest, path, stat, canonicalRoot)) return null;
            const after = lstatSync(path);
            if (
              !after.isFile() ||
              after.size !== stat.size ||
              after.mode !== stat.mode ||
              after.mtimeMs !== stat.mtimeMs ||
              after.ctimeMs !== stat.ctimeMs
            )
              return null;
          } else if (stat.isDirectory()) {
            const nestedRoot = path.toString("utf8");
            const nested = worktreeFingerprint(
              nestedRoot,
              undefined,
              undefined,
              lineage,
              allowedRoot,
              stat,
            );
            if (nested === null) return null;
            add("gitlink");
            add(nested);
          } else {
            return null;
          }
        } catch (error) {
          if (error.code !== "ENOENT") return null;
          add("missing");
        }
      }
      // Git 元数据在读取期间改变时，本次观察不可复用。
      if (
        git(root, ["rev-parse", "HEAD"], directoryFd) !== headRevision ||
        !selectedStatus(gitStatus(root, directoryFd), selectedPaths)?.equals(
          status,
        ) ||
        !gitBytes(root, ["ls-files", "--stage", "-z"], directoryFd)?.equals(
          index,
        )
      )
        return null;
    } catch {
      return null;
    }
    return digest.digest("hex");
  } finally {
    if (directoryFd !== null) closeSync(directoryFd);
  }
}

export function observeWorktree(root, paths = null) {
  root = resolve(git(root, ["rev-parse", "--show-toplevel"]) || root);
  const headRevision = git(root, ["rev-parse", "HEAD"]);
  const status = gitStatus(root);
  const changes = [];
  if (status !== null) {
    const records = nulRecords(status);
    for (let index = 0; index < records.length; index += 1) {
      const record = records[index];
      const names = [record.subarray(3)];
      if (/[RC]/.test(record.subarray(0, 2).toString("ascii")))
        names.push(records[++index]);
      for (const name of names) {
        if (!name || !Buffer.from(name.toString("utf8")).equals(name))
          throw new Error("Git 路径编码不可用于差异裁决");
        changes.push({
          path: name.toString("utf8"),
          status: record.subarray(0, 2).toString("ascii"),
        });
      }
    }
  }
  return {
    repositoryRoot: root,
    headRevision,
    changes,
    summary: statusSummary(status),
    worktreeFingerprint: worktreeFingerprint(
      root,
      selectedStatus(status, paths),
      headRevision,
      new Set(),
      null,
      null,
      paths,
    ),
  };
}

function changedPaths(root, suppliedStatus = undefined) {
  const status =
    suppliedStatus === undefined ? gitStatus(root) : suppliedStatus;
  return changedPathBuffers(status).map((path) => path.toString("utf8"));
}

function classify(paths) {
  const high = [];
  const protocol =
    /(^|\/)(contract|contracts|schema|schemas|protocol|protocols)(\/|$)|openapi|\.proto$|\.graphql$/i;
  const migration = /(^|\/)(migration|migrations)(\/|$)/i;
  const source = new Set([
    ".rs",
    ".py",
    ".go",
    ".java",
    ".ts",
    ".tsx",
    ".js",
    ".mjs",
    ".c",
    ".cpp",
    ".cs",
    ".swift",
    ".dart",
    ".scala",
    ".zig",
    ".ex",
    ".exs",
  ]);
  const control =
    /^(?:hooks|runtime|scripts|bin|\.echo-semantic)(?:\/|$)|^\.github\/workflows(?:\/|$)|^action\.ya?ml$/i;
  const lowRiskSource = /^(?:tests|test|examples)(?:\/|$)/i;
  for (const path of paths) {
    const suffix = extname(path).toLowerCase();
    if (control.test(path)) high.push({ path, reason: "governance-control" });
    else if (lowRiskSource.test(path)) continue;
    else if (protocol.test(path)) high.push({ path, reason: "protocol" });
    else if (migration.test(path)) high.push({ path, reason: "migration" });
    else if (source.has(suffix)) {
      high.push({
        path,
        reason: /(^|\/)(api|public|src|lib)(\/|$)/i.test(path)
          ? "production-source"
          : "unknown-production-source",
      });
    }
  }
  return high;
}

function isFastPath(path) {
  const suffix = extname(path).toLowerCase();
  return (
    /^(?:docs|tests|test|examples|\.github)\//i.test(path) ||
    [".md", ".json", ".yaml", ".yml", ".toml", ".txt"].includes(suffix)
  );
}

function currentTaskPreflight(root, headRevision, taskId) {
  if (typeof taskId !== "string" || !taskId.trim()) return null;
  try {
    const value = readProjectJson(root, "preflight.json");
    return value?.taskId === taskId &&
      checkPreflightRecord(value, root, { currentHead: headRevision })
        .length === 0
      ? value
      : null;
  } catch {
    return null;
  }
}

function writeState(root, value) {
  writeProjectJson(root, "route.json", value);
}

function currentHookEvidence(previous, host, runtimeProbe, now) {
  if (
    previous?.schemaVersion !== 1 ||
    previous?.pluginId !== pluginId ||
    previous?.host !== host ||
    !previous?.hookEvidence ||
    typeof previous.hookEvidence !== "object" ||
    Array.isArray(previous.hookEvidence)
  )
    return {};
  const hostVersion = runtimeProbe?.version ?? null;
  const evidence = {};
  for (const [name, value] of Object.entries(previous.hookEvidence)) {
    const observedAt = Date.parse(value?.observedAt);
    const age = now.getTime() - observedAt;
    if (
      Object.values(hookEvents).includes(name) &&
      value?.pluginVersion === pluginVersion &&
      (value?.hostVersion ?? null) === hostVersion &&
      Number.isFinite(observedAt) &&
      age >= 0 &&
      age <= hookEvidenceLifetimeMs
    ) {
      evidence[name] = value;
    }
  }
  return evidence;
}

export function computeRoute(
  root,
  host = "unknown",
  event = "manual",
  {
    probe = probeHost,
    observedEvent = null,
    now = () => new Date(),
    scope = "auto",
    taskId = null,
    observation = "full",
  } = {},
) {
  if (!["full", "edit"].includes(observation)) throw new Error("无效观察深度");
  if (observation === "edit" && event !== "pre-edit")
    throw new Error("轻量观察仅供编辑准入使用");
  root = resolve(git(root, ["rev-parse", "--show-toplevel"]) || root);
  const previous = readRoute(root);
  const capabilities = loadCapabilities(host);
  let runtimeProbe = null;
  try {
    runtimeProbe = probe(
      host,
      observation === "edit" ? { previous: previous?.runtimeProbe } : {},
    );
  } catch (error) {
    runtimeProbe = { detected: false, error: error.message };
  }
  const baseline = existsSync(resolve(root, ".echo-semantic/baseline.md"));
  const headRevision = git(root, ["rev-parse", "HEAD"]);
  const taskPreflight = currentTaskPreflight(root, headRevision, taskId);
  const taskScoped =
    scope === "task" || (scope === "auto" && Boolean(taskPreflight));
  const worktreeStatus = gitStatus(root);
  const paths = changedPaths(root, worktreeStatus);
  if (observation === "edit" && (!headRevision || worktreeStatus === null))
    throw new Error("无法取得当前编辑准入观察");
  const high = classify(paths);
  const currentTime = now();
  const hookEvidence = currentHookEvidence(
    previous,
    host,
    runtimeProbe,
    currentTime,
  );
  const observedKey = hookEvents[observedEvent];
  if (observedKey) {
    hookEvidence[observedKey] = {
      observedAt: currentTime.toISOString(),
      pluginVersion,
      hostVersion: runtimeProbe?.version ?? null,
    };
  }
  const stopVerified = Boolean(hookEvidence.stop);
  const conservative =
    capabilities.host === "unknown" ||
    capabilities.hooks.stop !== true ||
    capabilities.skills === "unsupported" ||
    runtimeProbe?.detected !== true ||
    !stopVerified;
  let route = "idle";
  let skills = [];
  if (scope === "repository") {
    route = "maintenance";
    skills = [
      "semantic-discover",
      "semantic-status",
      "semantic-consolidate",
      "semantic-audit",
      "semantic-verify",
    ];
  } else if (paths.length === 0 && !taskScoped) {
    route = "idle";
  } else if (conservative || !baseline) {
    route = "bootstrap";
    skills = ["semantic-preflight", "semantic-verify"];
  } else if (paths.length > 0 && high.length > 0) {
    route = "strict";
    skills = [
      "semantic-preflight",
      "semantic-diff",
      "semantic-audit",
      "semantic-verify",
    ];
  } else if (paths.length > 0) {
    if (paths.every(isFastPath)) {
      route = "fast";
      skills = ["semantic-preflight", "semantic-verify"];
    } else {
      route = "standard";
      skills = ["semantic-preflight", "semantic-diff", "semantic-verify"];
    }
  } else {
    skills = ["semantic-preflight"];
  }
  const state = {
    schemaVersion: 1,
    pluginId,
    repositoryRoot: root,
    headRevision,
    worktreeDigest:
      worktreeStatus === null
        ? null
        : createHash("sha256").update(worktreeStatus).digest("hex"),
    observation,
    worktreeFingerprint:
      observation === "edit"
        ? null
        : worktreeFingerprint(root, worktreeStatus, headRevision),
    initialChangeSummary: statusSummary(worktreeStatus),
    host,
    scope: scope === "repository" ? "repository" : "task",
    verificationScope:
      scope === "repository"
        ? "repository"
        : (taskPreflight?.verificationScope ?? "task"),
    event,
    route,
    skills,
    changedPaths: paths,
    highRiskPaths: high,
    hookEvidence,
    verificationReceipt: previous?.verificationReceipt ?? null,
    enforcement: {
      preEdit:
        Boolean(hookEvidence.preEdit) && capabilities.hooks.preToolUse === true,
      stop: stopVerified && capabilities.hooks.stop === true,
      continuation:
        Boolean(hookEvidence.preCompact) &&
        capabilities.lifecycle.compact !== "unsupported",
    },
    capabilities,
    runtimeProbe,
    updatedAt: currentTime.toISOString(),
  };
  writeState(root, state);
  if (observation === "full")
    writeVisibleStatus(root, {
      state: "ready",
      event,
      host,
      route,
      next: skills,
      message:
        runtimeProbe?.detected !== true
          ? "宿主安装状态未确认，采用保守路径"
          : stopVerified
            ? "路由已计算，停止 Hook 具有新鲜事件证据"
            : "停止 Hook 尚无新鲜事件证据，采用保守路径",
    });
  return state;
}

export function readRoute(root) {
  const value = readProjectJson(root, "route.json");
  return value?.schemaVersion === 1 ? value : null;
}

function main() {
  const args = process.argv.slice(2);
  const rootIndex = args.indexOf("--root");
  const hostIndex = args.indexOf("--host");
  const eventIndex = args.indexOf("--event");
  const scopeIndex = args.indexOf("--scope");
  const root = resolve(
    rootIndex >= 0 ? args[rootIndex + 1] || process.cwd() : process.cwd(),
  );
  const host = hostIndex >= 0 ? args[hostIndex + 1] || "unknown" : "unknown";
  const event = eventIndex >= 0 ? args[eventIndex + 1] || "manual" : "manual";
  const scope = scopeIndex >= 0 ? args[scopeIndex + 1] : "auto";
  if (!["auto", "task", "repository"].includes(scope))
    throw new Error("scope 必须是 auto、task 或 repository");
  const result = computeRoute(root, host, event, { scope });
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
