#!/usr/bin/env node

import { parseArgs } from "node:util";
import { resolve } from "node:path";
import { prepareTaskArtifactDirectory } from "../runtime/project-state.mjs";

try {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: { root: { type: "string" }, "task-id": { type: "string" } },
  });
  if (positionals.length !== 1 || positionals[0] !== "prepare")
    throw new Error(
      "使用 prepare --root <仓库根> --task-id <任务标识> 准备本地产物目录",
    );
  if (!values.root || !values["task-id"])
    throw new Error("必须提供 --root 和 --task-id");
  console.log(
    prepareTaskArtifactDirectory(resolve(values.root), values["task-id"]),
  );
} catch (error) {
  console.error(`本地产物目录准备失败：${error.message}`);
  process.exitCode = 1;
}
