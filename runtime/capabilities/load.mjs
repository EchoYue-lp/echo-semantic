import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL(".", import.meta.url)));
const support = new Set(["supported", "degraded", "unsupported"]);
const unknown = {
  schemaVersion: 1,
  host: "unknown",
  install: "config-merge",
  skills: "unsupported",
  agents: "unsupported",
  hooks: { sessionStart: false, preToolUse: false, stop: false },
  lifecycle: {
    startup: "unsupported",
    resume: "unsupported",
    compact: "unsupported",
  },
};

export function validateCapabilities(value) {
  const errors = [];
  if (!value || typeof value !== "object" || Array.isArray(value))
    return ["能力文档必须是对象"];
  if (value.schemaVersion !== 1) errors.push("schemaVersion 必须是 1");
  if (typeof value.host !== "string" || !value.host)
    errors.push("host 不能为空");
  if (!["cli", "mirror", "config-merge"].includes(value.install))
    errors.push("install 无效");
  if (!["native", "manifest", "unsupported"].includes(value.skills))
    errors.push("skills 无效");
  if (!["native", "projection", "unsupported"].includes(value.agents))
    errors.push("agents 无效");
  if (
    !value.hooks ||
    typeof value.hooks !== "object" ||
    Array.isArray(value.hooks)
  ) {
    errors.push("hooks 必须是对象");
  } else {
    for (const key of ["sessionStart", "preToolUse", "stop"]) {
      if (typeof value.hooks[key] !== "boolean")
        errors.push(`hooks.${key} 必须是布尔值`);
    }
  }
  if (
    !value.lifecycle ||
    typeof value.lifecycle !== "object" ||
    Array.isArray(value.lifecycle)
  ) {
    errors.push("lifecycle 必须是对象");
  } else {
    for (const key of ["startup", "resume", "compact"]) {
      if (!support.has(value.lifecycle[key]))
        errors.push(`lifecycle.${key} 无效`);
    }
  }
  for (const key of Object.keys(value)) {
    if (
      ![
        "schemaVersion",
        "host",
        "install",
        "skills",
        "agents",
        "hooks",
        "lifecycle",
      ].includes(key)
    ) {
      errors.push(`能力文档包含未知字段：${key}`);
    }
  }
  return errors;
}

export function loadCapabilities(host) {
  const normalized = String(host || "unknown").toLowerCase();
  const file = resolve(root, `${normalized}.json`);
  if (!existsSync(file)) return { ...unknown, host: normalized };
  let value;
  try {
    value = JSON.parse(readFileSync(file, "utf8"));
  } catch (error) {
    throw new Error(`能力文档无法解析：${file}：${error.message}`);
  }
  const errors = validateCapabilities(value);
  if (errors.length)
    throw new Error(`能力文档无效：${file}：${errors.join("；")}`);
  return value;
}
