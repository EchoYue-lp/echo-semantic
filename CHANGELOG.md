# 变更记录

本项目遵循语义化版本。每个正式版本必须记录用户可感知变化、合同变化、迁移要求、验证边界和已知限制；开发过程不把
`+codex.<timestamp>` cachebuster 提交为项目版本。

## Unreleased

### Cursor 宿主发现与合同

- Cursor 安装改为按 npm 发布白名单复制到 `~/.cursor/plugins/local/echo-semantic` 普通目录；当前 Cursor 会拒绝指向该目录之外的符号链接，因此不再把仓库 symlink 报告为已安装；
- Cursor `preToolUse` 按官方合同输出 `permission` / `user_message` / `agent_message`，并匹配 `Write|StrReplace|Delete|Edit`；
- Cursor `stop` 失败改为 `followup_message` 拉回校验，不再声称可以阻断会话结束；确定性阻断仍由编辑前检查和 CI 负责。

### 待决定

- 首次公开分发前选择并添加明确的开源许可证。

## 0.1.0 - 2026-09-10

首个可用版本，重点完成 Codex 插件稳定性，同时建立 Cursor、Claude Code 适配和项目无关的语义治理控制面。

### Codex 插件稳定性

- 使用 Codex 原生发现路径 `hooks/hooks.json` 提供 `SessionStart`、`PreCompact`、`PreToolUse` 和 `Stop`，Hook 设置页与插件详情可保留 Echo Semantic 来源归属；
- 安装器不再新增用户级 Hook，只精确清理旧版本在 `~/.codex/hooks.json` 中留下的 Echo Semantic 投影，并保留其它用户配置；
- 使用 npm 发布白名单生成 `~/.echo-semantic/distribution/` 干净分发副本，避免把项目运行态、Git 数据、开发缓存或 `.pyc` 带入 Codex 缓存；
- 支持从任意工作目录安装，分发副本先完整 staging 再替换；失败时保留仍被其它宿主使用的现有副本；
- 三个语义审查 Agent 以只读 TOML 投影安装到 Codex 用户目录，旧插件 ID 的 Agent、Hook、marketplace 和安装状态会被清理；
- 区分“检测到 Codex”与“真实 Hook 已触发”：`enforcement` 只由绑定宿主版本、插件版本和时间窗的事件证据启用，Stop 未验证时保持 `bootstrap`；
- 插件清单使用可读 UTF-8 中文，展示名为 `Echo Semantic`，插件 ID 与 marketplace 名均为 `echo-semantic`。

### 语义治理

- 提供 `semantic-preflight`、`semantic-status`、`semantic-discover`、`semantic-diff`、`semantic-audit`、`semantic-decide`、`semantic-verify` 和 `semantic-contract` 八个中文 Skill；
- 生成前预检记录复用关系、边界结论、允许路径、风险信号、验证矩阵和正式 design/ADR 摘要；语义引用或设计摘要变化后自动失效；
- 项目 `.echo-semantic/` 同时承载提交 Git 的长期语义材料，以及精确排除的五个可丢弃运行态文件；不再建立第二套项目状态目录；
- `semantic-diff`、定向 `semantic-audit` 和 `semantic-verify` 围绕同一 Capability、Behavior、Rule、Evidence、Finding 与 Audit 合同协作；
- 高风险变化要求同次语义依据，架构变化还必须绑定并更新正式 design/ADR；项目 formatter、Lint、类型、单元、契约和集成测试继续拥有实现质量权威；
- 路由支持 `bootstrap`、`idle`、`fast`、`standard` 和 `strict`，纯测试/示例变化保持轻量，治理控制面和生产代码变化进入严格路径。

### 多宿主与安装

- 提供 Codex、Cursor、Claude Code 三端 manifest、能力矩阵、事件适配和统一安装器；
- 支持按单一渠道或 `all` 安装/卸载，`all` 会检测对应宿主，未安装宿主独立返回 `skipped`；
- Codex 与 Claude Code 共用原生 `hooks/hooks.json`，Cursor 使用专用小写事件映射和本地插件链接；
- 跨克隆安装直接覆盖所选渠道，不维护来源冲突或迁移事务；最后一个原生宿主卸载后删除共享分发副本；
- 插件 ID 从 `echo-coding-semantic-governance` 收敛为 `echo-semantic`，安装时清理旧身份；旧 GitHub Action 地址不提供重命名兼容。

### 文档与质量

- 提供完整 README、快速开始、概念、宿主支持、适配说明、命令参考、CI 接入、故障排查、FAQ、安全、贡献和发布文档；
- 提供系统架构、状态流转、风险路由、生命周期和安装卸载流程图，以及 ADR 0001；
- 提供 manifest、分发包、安装器、Hook、路由、状态、预检和语义合同的 Node/Python 自动测试；
- 提供 GitHub Action，在 Pull Request 上执行与宿主无关的严格语义门禁。

### 已知验收边界

- Codex 原生插件安装、四类 Hook 发现结构和 SessionStart 入口已验证；
- Cursor 仍需在真实 GUI 中重载窗口并验证完整 Hook 生命周期；
- Claude Code 仍需在已登录会话中验证完整模型与 Hook 生命周期；
- 当前仓库尚未添加开源许可证，因此 `0.1.0` 版本成立，但不等同于已经完成公开授权或 marketplace 发布。
