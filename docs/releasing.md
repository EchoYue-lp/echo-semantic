# 发布指南

本文面向维护者，定义公共发布前需要满足的证据。它不替代 GitHub 仓库保护规则和宿主 marketplace 的正式发布流程。

当前发布目标为 `0.3.0`。本版本交付多前置 revision 语义连续性门禁及对应文档/图示，版本号、三端 manifest、marketplace、Action 与测试必须作为一个变更集验收。

## 版本策略

- 当前项目版本为 `0.3.0`，正式提交和 tag 使用不带开发后缀的语义化版本；
- `+codex.<timestamp>` 只允许作为本地未提交的 Codex 开发 cachebuster；提交、PR 和发布前必须恢复为目标正式版本；
- `.codex-plugin/plugin.json`、`.cursor-plugin/plugin.json`、`.claude-plugin/plugin.json`、`.claude-plugin/marketplace.json` 和 `package.json` 必须保持版本一致；
- 每个正式版本必须在 `CHANGELOG.md` 记录 Codex 稳定性、用户可感知变化、合同或迁移影响、验证边界和已知限制；
- 插件 ID、状态 schema、语义合同或安装布局发生不兼容变化时，必须记录迁移和旧路径退出。

## 发布前检查

1. 更新 `CHANGELOG.md`，把 Unreleased 内容归入目标版本；
2. 确认 README、快速开始、宿主支持、命令参考和故障排查与当前行为一致；
3. 确认 `.echo-semantic/baseline.md` 摘要、源码引用和路径分类有效；
4. 运行完整插件门禁：

```bash
npm run verify
```

5. 运行插件清单验证：

```bash
uv run --with 'PyYAML>=6,<7' python \
  /path/to/plugin-creator/scripts/validate_plugin.py .
claude plugin validate .
```

6. 使用任务开始时的基准 revision 运行高风险证据门禁：

```bash
uv run skills/semantic-contract/scripts/verify_semantic.py \
  --root . \
  --strict-snapshot \
  --base <40 位基准 revision> \
  --require-change-evidence
```

7. 在干净检出中验证一键安装、按渠道安装和一键卸载；
8. 分别记录 Codex 新任务、Cursor 窗口重载、Claude Code 登录会话的真实生命周期证据；
9. 等待 GitHub CI 全部通过；
10. 核对远端 tag 指向的提交与本地验收提交一致。

## 0.3.0 对账

- 版本源：`package.json`、三个宿主 manifest 和 `.claude-plugin/marketplace.json` 均为 `0.3.0`；
- 用户文档：README、核心概念、快速开始、宿主支持、适配说明、命令参考和本文均以 `0.3.0` 作为当前版本；
- 图示：架构主流程和开发流程包含 continuity 节点，多分支时序图包含 merge-base、全部 predecessor、候选结果、工程验证和失败关闭；
- 连续性回归：merge commit、PR merge ref、squash/rebase 形候选和单前置重构均有 Git DAG 夹具，错误或不可恢复 revision 阻断；
- 兼容性：`0.2.0` 的源码摘要算法保持可恢复；三端 Agent、Hook 事件、能力矩阵和安装器没有行为变化；
- 宿主验收：既有 Codex 安装与 Cursor 窗口证据继续按原范围报告；真实 GitHub Runner 和新版本宿主生命周期仍需发布时单独验收。

## 发布证据分层

| 证据         | 必须记录                                                       |
| ------------ | -------------------------------------------------------------- |
| 静态合同     | manifest、Skill、Agent、Hook 路径和版本一致                    |
| 自动测试     | 命令、revision、退出码和测试数量                               |
| 语义门禁     | 严格快照和高风险依据结果                                       |
| 安装验收     | 每个宿主的 `installed`、`skipped`、`failed` 或 `manual_action` |
| 生命周期验收 | 宿主版本、事件、工作目录和结果，不记录敏感正文                 |
| 发布确认     | GitHub CI、tag、远端 commit SHA                                |

## 当前发布阻断项

首次面向公众发布前必须由项目所有者选择并添加明确的开源许可证。GitHub 仓库公开可见不等于自动授权他人复制、修改或分发。

## 回滚

若发布后发现问题：

1. 停止推荐有问题的版本；
2. 发布修复版本或撤回对应 marketplace 版本；
3. 在 `CHANGELOG.md` 记录影响和替代版本；
4. 安全问题按 `SECURITY.md` 处理；
5. 不复用已经发布的版本号指向不同内容。
