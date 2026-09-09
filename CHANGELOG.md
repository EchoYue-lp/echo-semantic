# 变更记录

本项目使用语义化版本表达公共插件合同变化。开发阶段的 `+codex.<timestamp>` 仅用于本地 Codex 缓存刷新，不代表独立发布版本。

## Unreleased

### 文档

- 补充公共项目 README、文档索引、快速开始、核心概念、宿主支持、CI、命令参考、故障排查和常见问题；
- 增加完整项目架构、状态流转、生命周期和安装时序设计；
- 增加贡献指南、安全说明、社区行为规范和发布指南。

### 待决定

- 首个公共发布使用的开源许可证。

### 新增

- Codex、Cursor、Claude Code 三端插件清单与安装器；
- `semantic-preflight`、`semantic-status`、`semantic-discover`、`semantic-diff`、`semantic-audit`、`semantic-decide`、`semantic-verify` 和 `semantic-contract`；
- 三个只读语义探索与审查 Agent；
- 宿主能力矩阵、风险路由、任务继续包和生命周期 Hook；
- 语义对象合同、严格快照、源码引用、路径分类和高风险变更依据校验；
- GitHub Action 最终门禁。

### 变更

- 插件展示名由 `Echo Coding Semantic Governance` 缩短为 `Echo Semantic`；
- 插件 ID 由 `echo-coding-semantic-governance` 缩短为 `echo-semantic`；
- 安装新 ID 时自动清理旧 ID 的宿主注册和本地投影。
