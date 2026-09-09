# 贡献指南

感谢参与 Echo Semantic。项目面向不同语言、不同代码库和不同 Coding Agent，因此贡献必须优先保持合同清晰、宿主适配薄、验证可复现。

## 开始之前

- 普通缺陷、功能和文档问题可以使用 GitHub Issue；
- 安全问题不要公开 Issue，按 [安全说明](SECURITY.md) 私下报告；
- 大型架构变化先说明目标、边界、替代方案和兼容影响，再开始实现；
- 不要在一个 Pull Request 中混入无关格式化、重命名或生成文件。

## 开发环境

需要：

- Node.js 20+；
- Python 3.9+；
- `uv`；
- Git；
- 至少一个宿主用于相关适配的真实验证。

获取代码并验证基线：

```bash
git clone https://github.com/EchoYue-lp/echo-coding-semantic-governance.git
cd echo-coding-semantic-governance
npm test
npm run verify
```

项目当前没有必须安装的 `node_modules` 依赖；格式工具通过 `npx` 和 `uvx` 按固定版本运行。

## 分支和提交

从最新 `main` 创建主题分支。推荐名称：

```text
feature/<name>/<topic>
fix/<name>/<topic>
docs/<name>/<topic>
refactor/<name>/<topic>
```

提交信息使用清晰的 Conventional Commit 风格，例如：

```text
feat: add host lifecycle adapter
fix: reject stale continuation evidence
docs: expand public architecture guide
```

每个提交只表达一个可审阅意图。不要用 `--no-verify` 绕过失败门禁。

## 变更前检查

实现前回答：

1. 这是 `bugfix`、`feature`、`refactor`、`contract` 还是 `style`？
2. 仓库里是否已有可复用 Skill、Rule、接口、实现或测试？
3. 变化属于语义工作流、生命周期门禁还是宿主分发边界？
4. 是否新增公共 API、协议、状态权威或迁移？
5. 允许修改哪些路径，需要运行哪些验证？

采用本插件自身开发时，先执行 `semantic-preflight` 并把记录留在 Git 私有目录。

## 架构边界

- `skills/` 是 Skill 唯一真理源；
- `agents/` 是只读角色唯一真理源；
- `hooks/entry.mjs` 是三宿主生命周期共享入口；
- `runtime/` 只保存宿主能力、风险路由和可丢弃继续包；
- `semantic/` 是本插件自身的长期语义事实；
- design/ADR 是产品和架构权威；
- formatter、Lint、类型和测试继续拥有实现质量权威。

禁止为单个宿主复制第二套路由、状态合同或语义对象模型。新增宿主只添加薄适配器和能力证据。

## 代码和文档要求

- 人类可读内容使用中文；固定协议名、路径和字段名保持原样；
- 不记录密钥、完整敏感日志或私有源码；
- 错误必须包含可定位原因，不能把失败静默解释为通过；
- 新增状态必须说明权威、生命周期、失效和清理；
- 修改 manifest、Hook、安装器、状态合同或验证器时同步更新设计、示例和测试；
- Mermaid 图必须有相邻正文或表格，使纯文本读者仍能理解。

## 测试

迭代时先运行相关测试，提交前运行完整验证：

```bash
npm test
npm run verify
```

修改插件清单时额外运行：

```bash
uv run --with 'PyYAML>=6,<7' python \
  /path/to/plugin-creator/scripts/validate_plugin.py .
claude plugin validate .
```

修改高风险路径时还要运行：

```bash
uv run skills/semantic-contract/scripts/verify_semantic.py \
  --root . \
  --strict-snapshot \
  --base <任务开始时的 40 位 revision> \
  --require-change-evidence
```

真实宿主验收与静态测试分开记录。未执行 Cursor 窗口重载、Claude Code 登录会话或 Codex 新任务时，不得声称相应生命周期已通过。

## Pull Request

Pull Request 描述至少包含：

- 问题和目标行为；
- 变更分类与风险；
- 复用的现有能力和唯一状态权威；
- 修改路径与明确未修改范围；
- 验证命令、退出结果和未验证项；
- 文档、示例、Skill 和宿主适配影响；
- 不兼容变化和迁移方式。

审查重点是行为回归、状态权威、失败恢复、跨宿主一致性和证据完整性，不以代码风格意见替代工程工具。

## 发布相关变更

修改插件 ID、manifest 版本、安装路径、状态 schema 或公共语义合同时，阅读 [发布指南](docs/releasing.md)。这类变化必须有迁移说明，且不能让旧插件和新插件同时出现在宿主中。
