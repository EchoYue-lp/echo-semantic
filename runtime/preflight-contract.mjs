import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

// Node 与 CLI 复用同一完整合同；只核对任务列出的依据，不扫描全项目。
export function checkPreflightRecord(
  state,
  root,
  { currentHead, currentTime = Date.now(), phase = "check" } = {},
) {
  if (!state || state.schemaVersion !== 2 || !currentHead)
    return ["缺少当前版本任务预检"];
  const result = spawnSync(
    process.platform === "win32" ? "py" : "python3",
    [
      ...(process.platform === "win32" ? ["-3"] : []),
      fileURLToPath(new URL("../scripts/check-preflight.py", import.meta.url)),
      "--root",
      root,
      "--head",
      currentHead,
      "--phase",
      phase,
      "--now",
      String(currentTime),
    ],
    {
      input: JSON.stringify(state),
      encoding: "utf8",
      timeout: 10_000,
      maxBuffer: 1024 * 1024,
    },
  );
  try {
    const errors = JSON.parse(result.stdout);
    return result.status === 0 && Array.isArray(errors) && errors.length === 0
      ? []
      : Array.isArray(errors) && errors.length
        ? errors
        : ["完整任务合同检查失败"];
  } catch {
    return ["完整任务合同校验器不可用"];
  }
}
