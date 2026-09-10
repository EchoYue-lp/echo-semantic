# 多宿主适配

本插件采用一个共享语义控制面和三个宿主适配器。宿主适配器只负责发现、生命周期输入输出和安装投影，不复制 Skill 正文或
语义对象模型。

| 宿主        | Skill             | Agent          | 编辑前 Hook                                  | 停止 Hook | 安装方式              |
| ----------- | ----------------- | -------------- | -------------------------------------------- | --------- | --------------------- |
| Codex       | manifest          | TOML 投影      | 当前版本不稳定，交由 Stop/PreCompact/CI 收口 | 支持      | CLI + 用户 hooks.json |
| Cursor      | manifest          | 原生目录       | 支持 `preToolUse`                            | 支持      | 本地插件链接          |
| Claude Code | manifest/默认目录 | 原生插件 Agent | 支持 `PreToolUse`                            | 支持      | marketplace CLI       |

运行时能力快照位于 `runtime/capabilities/`，由 `runtime/capabilities/probe.mjs` 输出宿主安装/版本/生命周期事实，再由
`runtime/route.mjs` 选择 `bootstrap`、`fast`、`standard`、`strict` 或 `idle` 路由；
`semantic-status` 汇总路由、基线闭合、预检和 Frontier。
路由状态同时保存静态 `capabilities` 与本次 `runtimeProbe`；只有探测到宿主且启动探针通过时，`enforcement` 才标为可用，
否则按最保守的 `bootstrap` 处理。探测成功不等于已经完成真实会话验收，resume、compact 和 GUI 重载仍需单独证据。
能力未知时采用最保守的 `bootstrap`/串行路径，不把静态清单当作真实会话证据。

## Hook 分层

- SessionStart：只注入当前路由、宿主能力、可信继续包和下一入口；不注入完整 Skill 正文。
- PreToolUse：有 `.echo-semantic/` 基线时检查当前任务预检和允许路径。
- PreCompact：保存当前任务的短期继续包，证据摘要变化后自动失效。
- Stop：有变化时运行严格语义校验；失败保留任务预检，成功消费它。
- CI：重新读取 Git 差异、语义材料和工程测试结果，作为最终门禁。

`semantic-status` 对基线和私有状态只做结构与可信度检查，并明确标出 `validStructure`、`trusted` 和失效原因；
完整语义关系、源码引用和变更证据仍以 `semantic-verify`/CI 为唯一确定性权威。

## 状态边界

- 项目 `.echo-semantic/`：长期语义事实；
- 项目 `.echo-semantic/`：长期语义材料和当前任务运行态；
- 用户安装目录：宿主安装结果；
- 项目 design/ADR：架构权威；
- 项目 formatter、Lint、类型和测试：代码质量权威。
