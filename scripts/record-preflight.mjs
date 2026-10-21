#!/usr/bin/env node

import { existsSync, readSync } from "node:fs";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import {
  MAX_PROJECT_STATE_BYTES,
  ensureProjectStateDirectory,
  projectStatePath,
  readProjectBytes,
  readProjectJson,
  withProjectStateLock,
  writeProjectJson,
} from "../runtime/project-state.mjs";

export function recordPreflight(root, payload, python = "python3") {
  const repository = spawnSync(
    "git",
    ["-C", root, "rev-parse", "--show-toplevel"],
    {
      encoding: "utf8",
      timeout: 10_000,
    },
  );
  if (
    repository.status !== 0 ||
    resolve(repository.stdout.trim()) !== resolve(root)
  )
    throw new Error("预检写入根不是当前 Git 仓库根");
  root = resolve(root);
  return withProjectStateLock(root, () => {
    ensureProjectStateDirectory(root);
    const previous = readProjectJson(root, "preflight.json");
    const head = spawnSync("git", ["-C", root, "rev-parse", "HEAD"], {
      encoding: "utf8",
      timeout: 10_000,
    });
    if (head.status !== 0) throw new Error("预检写入时无法取得当前 HEAD");
    const input = JSON.stringify(payload);
    if (Buffer.byteLength(input) > MAX_PROJECT_STATE_BYTES)
      throw new Error("预检输入超过 1 MiB");
    const validation = spawnSync(
      python,
      [
        fileURLToPath(new URL("./check-preflight.py", import.meta.url)),
        "--root",
        root,
        "--head",
        head.stdout.trim(),
      ],
      {
        input,
        encoding: "utf8",
        timeout: 15_000,
        maxBuffer: MAX_PROJECT_STATE_BYTES,
      },
    );
    if (validation.status !== 0) {
      let errors;
      try {
        errors = JSON.parse(validation.stdout);
      } catch {
        /* 非合同输出不能作为成功依据。 */
      }
      throw new Error(
        Array.isArray(errors) && errors.length
          ? errors.join("；")
          : "锁内完整预检合同校验失败",
      );
    }
    if (validation.stdout.trim() !== "[]")
      throw new Error("锁内预检校验结果不是成功合同");
    if (!previous && existsSync(projectStatePath(root, "preflight.json")))
      readProjectBytes(root, "preflight.json");
    if (
      previous?.taskId === payload.taskId &&
      previous.repositoryRoot === root
    ) {
      const ranks = { low: 0, medium: 1, high: 2 };
      if (
        (ranks[previous.risk] ?? 0) > ranks[payload.risk] ||
        Object.keys(payload.signals).some(
          (name) => previous.signals?.[name] === true && !payload.signals[name],
        )
      )
        throw new Error("同一任务的风险与高风险信号不得降级");
    }
    return writeProjectJson(root, "preflight.json", payload);
  });
}

function main() {
  if (
    process.argv.length !== 6 ||
    process.argv[2] !== "--root" ||
    process.argv[4] !== "--python"
  )
    throw new Error(
      "用法：node scripts/record-preflight.mjs --root <仓库绝对路径> --python <调用方 Python>；预检 JSON 从标准输入传入",
    );
  const bytes = Buffer.allocUnsafe(MAX_PROJECT_STATE_BYTES + 1);
  let length = 0;
  while (length < bytes.length) {
    const count = readSync(0, bytes, length, bytes.length - length, null);
    if (count === 0) break;
    length += count;
  }
  if (length > MAX_PROJECT_STATE_BYTES) throw new Error("预检输入超过 1 MiB");
  recordPreflight(
    process.argv[3],
    JSON.parse(bytes.subarray(0, length).toString("utf8")),
    process.argv[5],
  );
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  try {
    main();
  } catch (error) {
    process.stderr.write(`语义预检写入失败：${error.message}\n`);
    process.exitCode = 1;
  }
}
