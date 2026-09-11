# 快速开始

本指南完成三件事：安装 `echo-semantic`、让一个 Git 项目建立语义基线、把第一次代码变更接入生成前和生成后门禁。

## 前置条件

- Git；
- Node.js 20 或更高版本；
- Python 3.9 或更高版本；
- [`uv`](https://docs.astral.sh/uv/)；
- Codex、Cursor、Claude Code 中至少一个已安装宿主。

检查本机依赖：

```bash
git --version
node --version
python3 --version
uv --version
```

## 获取项目

```bash
git clone https://github.com/EchoYue-lp/echo-semantic.git
cd echo-semantic
```

GitHub 仓库名、插件 ID 和 marketplace 名统一使用 `echo-semantic`，展示名为 `Echo Semantic`。

## 安装插件

一键安装到所有已检测宿主：

```bash
node bin/install.mjs install all
```

只安装一个宿主：

```bash
node bin/install.mjs install codex
node bin/install.mjs install cursor
node bin/install.mjs install claude-code
```

`all` 会独立处理三个宿主：未安装的宿主返回 `skipped`，不影响其它宿主。显式安装一个不存在的宿主会返回
`manual_action` 和非零退出码。重复安装会覆盖本插件当前内容，并清理旧 ID `echo-coding-semantic-governance` 的注册和投影。

安装后：

- Codex：新建任务；
- Cursor：重新加载窗口；
- Claude Code：新建会话。

查看宿主探测结果：

```bash
npm run probe
```

探测到命令和版本不等于真实生命周期 Hook 已执行。完整证据还需要在新会话触发对应事件。

## 验证安装

Codex：

```bash
codex plugin list --json
```

输出中应有 `echo-semantic@echo-semantic`，并且 `installed`、`enabled` 均为 `true`。

Claude Code：

```bash
claude plugin list --json
```

Cursor 使用本地插件目录。当前 Cursor 会拒绝指向该目录之外的符号链接，因此安装器复制发布白名单文件，而不是链接仓库。macOS 和 Linux 可以检查：

```bash
test -d ~/.cursor/plugins/local/echo-semantic
test ! -L ~/.cursor/plugins/local/echo-semantic
test -f ~/.cursor/plugins/local/echo-semantic/.cursor-plugin/plugin.json
```

然后重新加载窗口，在 Customize → Plugins 中应看到 **Echo Semantic** 且带 Local 徽章。若仍只看到旧名称 `echo-coding-semantic-governance`，先从 Claude Code 卸载该旧 ID：Cursor 会导入已启用的 Claude 插件。

## 让项目采用语义治理

进入目标 Git 仓库，在 Coding Agent 中提出：

```text
请使用 semantic-discover 为当前仓库建立语义基线，覆盖所有 Git 路径、主要能力边界、状态权威、生命周期、规则和证据；未知项保持 needs_review，完成后运行严格快照验证。
```

Agent 应在目标项目创建：

```text
.echo-semantic/
├── README.md
├── baseline.md
├── maps/
├── behaviors/
├── rules/
├── evidence/
├── findings/
├── audits/
├── discovery/
└── assets/
```

将 `.echo-semantic/` 与项目代码一起纳入版本控制。它是项目长期语义事实，不属于插件安装目录。

插件单独触发且没有明确任务时，路由会对 Baseline 覆盖的已完成代码执行仓库级盘点、状态汇总、定向审查和验证；
有明确任务时，先用 `semantic-preflight` 限定本次行动项的允许路径。

## 完成第一次受治理变更

向 Agent 提交需求时明确调用生成前预检：

```text
请先使用 semantic-preflight，查找可复用的 Capability、Rule、公共接口、实现和测试，确认唯一状态权威、允许修改路径和验证矩阵，再开始实现。
```

形成实际差异后：

```text
请使用 semantic-diff 将当前差异映射到 Capability、Behavior、Rule、Evidence 和失效 Audit；高风险边界进入定向 semantic-audit。
```

完成工程测试后：

```text
请使用 semantic-verify 校验当前快照、源码引用、路径分类、变更依据和工程验证结果。
```

生成前预检、生成后语义验证和工程工具缺一不可。插件不会用语义材料代替 formatter、Lint、类型或测试。

## 接入 CI

本地流程跑通后，按照 [CI 接入](ci-integration.md) 将 `action.yml` 加入 Pull Request 工作流。CI 是独立于宿主模型和 Hook 的最终门禁。

## 卸载

卸载所有宿主：

```bash
node bin/install.mjs uninstall all
```

只卸载一个宿主：

```bash
node bin/install.mjs uninstall codex
node bin/install.mjs uninstall cursor
node bin/install.mjs uninstall claude-code
```

卸载插件不会删除任何采用方项目的 `.echo-semantic/`，也不会删除项目自己的 design、ADR 或工程配置。

## 下一步

- 阅读 [核心概念](concepts.md) 理解对象与路由；
- 阅读 [项目架构与状态流转设计](supreme/specs/plugin-architecture/design.md) 了解完整控制面；
- 遇到阻断时查看 [故障排查](troubleshooting.md)。
