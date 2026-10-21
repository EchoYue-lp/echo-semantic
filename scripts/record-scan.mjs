#!/usr/bin/env node
import { readSync } from "node:fs";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { withProjectStateLock } from "../runtime/project-state.mjs";

// 只发布一个不可覆盖的报告，不读取或写入日常任务运行态。
function main() {
  if (
    process.argv.length !== 6 ||
    process.argv[2] !== "--root" ||
    process.argv[4] !== "--python"
  )
    throw new Error("必须提供 root 与 Python 解释器");
  const root = resolve(process.argv[3]);
  const git = spawnSync("git", ["-C", root, "rev-parse", "--show-toplevel"], {
    encoding: "utf8",
    timeout: 10_000,
  });
  if (git.status !== 0 || resolve(git.stdout.trim()) !== root)
    throw new Error("扫描报告根不是 Git 仓库根");
  const bytes = Buffer.alloc(16 * 1024 * 1024 + 1);
  let length = 0;
  while (length < bytes.length) {
    const count = readSync(0, bytes, length, bytes.length - length, null);
    if (count === 0) break;
    length += count;
  }
  const text = bytes.subarray(0, length).toString("utf8");
  if (Buffer.byteLength(text) > 16 * 1024 * 1024)
    throw new Error("扫描报告超过大小限制");
  withProjectStateLock(root, () => {
    const validation = spawnSync(
      process.argv[5],
      [
        fileURLToPath(
          new URL(
            "../skills/semantic-discover/scripts/inventory.py",
            import.meta.url,
          ),
        ),
        "--root",
        root,
        "--validate-report-stdin",
        "--publish-report",
      ],
      {
        input: text,
        encoding: "utf8",
        timeout: 70_000,
        maxBuffer: 16 * 1024 * 1024,
      },
    );
    if (validation.status !== 0)
      throw new Error(
        validation.stdout.trim() ||
          validation.stderr.trim() ||
          "锁内扫描依据检查失败",
      );
    const result = JSON.parse(validation.stdout);
    if (
      result.structure !== "passed" ||
      result.current !== true ||
      result.reportPublished !== true ||
      !/^discovery\.scan\.[a-f0-9]{64}$/.test(result.report_id)
    )
      throw new Error("锁内扫描检查结果无效");
    const target = resolve(
      root,
      ".echo-semantic/discovery",
      `${result.report_id}.md`,
    );
    process.stdout.write(`${target}\n`);
  });
}

try {
  main();
} catch (error) {
  process.stderr.write(`扫描报告保存失败：${error.message}\n`);
  process.exitCode = 1;
}
