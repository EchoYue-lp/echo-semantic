#!/usr/bin/env node

import {
  closeSync,
  constants,
  fstatSync,
  lstatSync,
  openSync,
  realpathSync,
} from "node:fs";
import { spawnSync } from "node:child_process";
import { resolve, sep } from "node:path";
import { parseArgs } from "node:util";
import { observeWorktree, readRoute } from "../runtime/route.mjs";
import {
  decideSessionChanges,
  loadSessionSnapshot,
  refreshSessionChanges,
  snapshotDisposition,
} from "../runtime/session-state.mjs";

const changeDisplayLimit = 50;
const nestedChangeDisplayLimit = 20;
const directoryGitExec =
  "import os,sys; os.fchdir(3); os.execvp('git', ['git', *sys.argv[1:]])";

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

function git(root, args, directoryFd = null) {
  const value = gitBytes(root, args, directoryFd);
  return value === null ? null : value.toString("utf8").trim();
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

function statusChanges(status) {
  const changes = [];
  const records = nulRecords(status);
  for (let index = 0; index < records.length; index += 1) {
    const record = records[index];
    if (record.length < 3) throw new Error("Git 状态记录无效");
    const status = record.subarray(0, 2).toString("ascii");
    const names = [record.subarray(3)];
    if (/[RC]/.test(status)) names.push(records[++index]);
    for (const name of names) {
      if (!name || !Buffer.from(name.toString("utf8")).equals(name))
        throw new Error("Git 路径编码不可用于差异展示");
      changes.push({ path: name.toString("utf8"), status });
    }
  }
  return changes;
}

function statusSummary(status) {
  const summary = { staged: 0, unstaged: 0, untracked: 0 };
  const records = nulRecords(status);
  for (let index = 0; index < records.length; index += 1) {
    const value = records[index].subarray(0, 2).toString("ascii");
    if (value === "??") summary.untracked += 1;
    else {
      if (value[0] !== " ") summary.staged += 1;
      if (value[1] !== " ") summary.unstaged += 1;
    }
    if (/[RC]/.test(value)) index += 1;
  }
  return summary;
}

function pathInside(root, path) {
  const prefix = Buffer.concat([root, Buffer.from(sep)]);
  return root.equals(path) || path.subarray(0, prefix.length).equals(prefix);
}

function sameDirectory(left, right) {
  return (
    left.dev === right.dev && left.ino === right.ino && left.mode === right.mode
  );
}

function openNestedBinding(root, relativePath) {
  if (process.platform === "win32") return null;
  let descriptor;
  let accepted = false;
  try {
    const authorization = realpathSync(root, { encoding: "buffer" });
    const supplied = Buffer.concat([
      authorization,
      Buffer.from(sep),
      Buffer.from(relativePath),
    ]);
    const expected = lstatSync(supplied);
    if (!expected.isDirectory() || expected.isSymbolicLink()) return null;
    const canonical = realpathSync(supplied, { encoding: "buffer" });
    if (!canonical.equals(supplied) || !pathInside(authorization, canonical))
      return null;
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
      !sameDirectory(opened, expected) ||
      !sameDirectory(opened, current) ||
      !actual.equals(canonical) ||
      !pathInside(authorization, actual)
    )
      return null;
    accepted = true;
    return {
      descriptor,
      identity: opened,
      root: canonical.toString("utf8"),
    };
  } catch {
    return null;
  } finally {
    if (!accepted && descriptor !== undefined) closeSync(descriptor);
  }
}

function changeStates(status) {
  if (status === "??") return ["未跟踪"];
  const labels = {
    M: "修改",
    T: "类型变化",
    A: "新增",
    D: "删除",
    R: "重命名",
    C: "复制",
    U: "冲突",
  };
  const states = [];
  if (status?.[0] && status[0] !== " ")
    states.push(`已暂存${labels[status[0]] ?? `状态 ${status[0]}`}`);
  if (status?.[1] && status[1] !== " ")
    states.push(`未暂存${labels[status[1]] ?? `状态 ${status[1]}`}`);
  return states.length ? states : ["状态未知"];
}

function pathKind(root, relativePath) {
  try {
    const stat = lstatSync(resolve(root, relativePath));
    if (stat.isSymbolicLink()) return "symlink";
    if (stat.isFile()) return "file";
    if (stat.isDirectory()) return "directory";
    return "other";
  } catch {
    return "missing";
  }
}

function nestedRepositoryDetails(root, relativePath) {
  const index = git(root, ["ls-files", "--stage", "--", relativePath]);
  const indexRevision =
    index?.match(/^160000\s+([0-9a-f]{40})\s+/)?.[1] ?? null;
  const binding = openNestedBinding(root, relativePath);
  const unavailable = () =>
    indexRevision
      ? {
          indexRevision,
          observationAvailable: false,
          reason: "无法绑定可信嵌套仓库目录身份",
        }
      : null;
  if (!binding) return unavailable();
  try {
    const nestedRoot = git(
      binding.root,
      ["rev-parse", "--show-toplevel"],
      binding.descriptor,
    );
    if (!nestedRoot || resolve(nestedRoot) !== binding.root)
      return unavailable();
    const status = gitBytes(
      binding.root,
      ["status", "--porcelain=v1", "-z", "--untracked-files=all"],
      binding.descriptor,
    );
    const headRevision = git(
      binding.root,
      ["rev-parse", "HEAD"],
      binding.descriptor,
    );
    const branch = git(
      binding.root,
      ["branch", "--show-current"],
      binding.descriptor,
    );
    if (status === null || headRevision === null) return unavailable();
    const observedChanges = statusChanges(status);
    const changes = observedChanges
      .slice(0, nestedChangeDisplayLimit)
      .map((change) => ({
        ...change,
        states: changeStates(change.status),
        kind: "path",
      }));
    const statusAfter = gitBytes(
      binding.root,
      ["status", "--porcelain=v1", "-z", "--untracked-files=all"],
      binding.descriptor,
    );
    if (
      statusAfter === null ||
      !statusAfter.equals(status) ||
      git(binding.root, ["rev-parse", "HEAD"], binding.descriptor) !==
        headRevision ||
      !sameDirectory(binding.identity, fstatSync(binding.descriptor)) ||
      git(root, ["ls-files", "--stage", "--", relativePath]) !== index
    )
      return unavailable();
    return {
      repositoryRoot: binding.root,
      branch: branch || null,
      indexRevision,
      headRevision,
      summary: statusSummary(status),
      changes,
      omittedChanges: Math.max(0, observedChanges.length - changes.length),
      observationAvailable: true,
    };
  } catch {
    return unavailable();
  } finally {
    closeSync(binding.descriptor);
  }
}

function presentationFor(observation) {
  const changes = observation.changes
    .slice(0, changeDisplayLimit)
    .map((change) => {
      const nestedRepository = nestedRepositoryDetails(
        observation.repositoryRoot,
        change.path,
      );
      return {
        ...change,
        states: changeStates(change.status),
        kind: nestedRepository
          ? "nested-repository"
          : pathKind(observation.repositoryRoot, change.path),
        ...(nestedRepository ? { nestedRepository } : {}),
      };
    });
  return {
    repositoryRoot: observation.repositoryRoot,
    summary: observation.summary,
    changes,
    omittedChanges: Math.max(0, observation.changes.length - changes.length),
    recommendationRules: {
      preserve:
        "已有差异与当前任务不重叠或位于独立仓库/worktree，保留全部差异并仅处理本轮范围",
      adopt:
        "当前任务必须修改已有差异中的明确路径，仅接管这些路径，其余继续保护",
      readonly:
        "无法可靠判断任务范围、差异来源或观察可信度，暂停修改和交付，仅做只读检查",
    },
    questionContract:
      "不得只说明存在已有差异；提问正文必须展示仓库根与计数、具体路径和状态、嵌套仓库的索引/当前 revision、与当前任务的重叠或隔离关系，并给出唯一推荐及事实理由。无法判断时推荐暂停修改仅只读。",
  };
}

try {
  const { values, positionals, tokens } = parseArgs({
    args: process.argv.slice(2),
    allowPositionals: true,
    tokens: true,
    options: {
      root: { type: "string" },
      "session-id": { type: "string" },
      fingerprint: { type: "string" },
      strategy: { type: "string" },
      path: { type: "string", multiple: true },
      basis: { type: "string" },
    },
  });
  if (
    positionals.length !== 1 ||
    !["inspect", "refresh", "decide"].includes(positionals[0])
  )
    throw new Error(
      "使用 inspect 盘点、refresh 更新待裁决观察或 decide 记录用户明确答复",
    );
  const command = positionals[0];
  const seen = new Set();
  for (const token of tokens.filter((token) => token.kind === "option")) {
    if (token.name !== "path" && seen.has(token.name))
      throw new Error(`参数不能重复：--${token.name}`);
    if (command !== "decide" && !["root", "session-id"].includes(token.name))
      throw new Error(`该命令不接受参数：--${token.name}`);
    seen.add(token.name);
  }
  const root = values.root;
  const sessionId = values["session-id"];
  if (!root || !sessionId)
    throw new Error("必须提供 --root 与宿主 --session-id");
  const observation = observeWorktree(resolve(root));
  const repository = observation.repositoryRoot;
  if (command === "inspect") {
    const snapshot = loadSessionSnapshot(repository, sessionId);
    const receipt = readRoute(repository)?.verificationReceipt;
    console.log(
      JSON.stringify(
        {
          ...observation,
          presentation: presentationFor(observation),
          sessionId,
          questionFingerprint: snapshot?.initialChanges?.fingerprint ?? null,
          disposition: snapshot
            ? snapshotDisposition(repository, snapshot, observation)
            : {
                state: "unknown",
                message:
                  "没有可信会话起始快照，不得据此授权写入。多仓库父目录会话首次接入时，应由真实写前 Hook 申请接入；该首次请求只建立当前观察并拒绝落盘，再重新 inspect、处理必要差异裁决和预检。refresh 不能补造快照；普通单仓或已有状态丢失时必须恢复真实会话观察。非 Git 父目录本身不是切换到单仓会话的理由。",
              },
          priorVerification: {
            present: Boolean(receipt),
            matchesObservation:
              typeof observation.worktreeFingerprint === "string" &&
              receipt?.result === "passed" &&
              receipt.headRevision === observation.headRevision &&
              receipt.worktreeFingerprint === observation.worktreeFingerprint &&
              Date.now() - Date.parse(receipt.verifiedAt) >= 0 &&
              Date.now() - Date.parse(receipt.verifiedAt) <=
                24 * 60 * 60 * 1000,
          },
          verification: "本命令仅盘点，不表示验证通过，旧收据不代替裁决",
        },
        null,
        2,
      ),
    );
  } else if (command === "refresh") {
    const record = refreshSessionChanges(repository, sessionId);
    console.log(
      JSON.stringify(
        {
          sessionId,
          initialChanges: record.initialChanges,
          verification: "仅刷新待裁决盘点，不授权写入；必须重新询问用户",
        },
        null,
        2,
      ),
    );
  } else if (command === "decide") {
    const record = decideSessionChanges(
      repository,
      sessionId,
      values.fingerprint,
      values.strategy,
      values.path ?? [],
      values.basis,
    );
    console.log(
      JSON.stringify(
        {
          sessionId,
          decision: record.initialChanges.decision,
          verification: "裁决不是验证通过，不授权提交或清理",
        },
        null,
        2,
      ),
    );
  }
} catch (error) {
  console.error(`已有差异处置失败：${error.message}`);
  process.exitCode = 1;
}
