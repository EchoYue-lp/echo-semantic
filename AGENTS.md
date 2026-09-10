# AGENTS.md

本仓库是项目无关的 Coding Agent 语义治理插件，支持 Codex、Cursor 和 Claude Code。

## 最高约束

- `skills/`、`agents/`、`hooks/` 和 `scripts/` 中的可读内容使用中文；固定协议名、路径和字段名保持原样。
- `skills/` 是 Skill 唯一真理源，`agents/` 是只读角色唯一真理源，宿主清单只做发现与路径映射。
- 不引入项目专属类型、状态、目录或产品策略；项目事实与运行态统一写入采用方自己的 `.echo-semantic/`，其中只有明确运行态文件不提交。
- 不把 Skill 提示词称为机器门禁。确定性约束由 Hook、校验器和 CI 执行。
- 不增加数据库、常驻服务或隐藏遥测，不读取或记录密钥与完整敏感日志。
- 新增宿主字段或 Hook 事件前先核对官方文档、当前 CLI 或真实加载证据。
- 代码与配置修改必须同步测试；所有 JSON、Skill frontmatter、manifest 路径和宿主投影必须可机器校验。
- 不使用 `Worker` 表示 Agent 执行角色，统一使用 `Subagent`。

## 验证

提交前执行：

```bash
npm test
npm run verify
```

真实宿主验收必须与静态清单验证分开报告。未完成新会话或 GUI 重载验证时，不得声称对应 Hook 已运行。
