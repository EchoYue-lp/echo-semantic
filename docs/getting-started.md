# 快速开始（0.5.0）

本指南介绍安装 `echo-semantic 0.5.0`、选择单仓或多仓工作目录，以及完成首次接入、预检和验证。日常任务无需先建立完整语义基线；全项目建库由用户显式选择。

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

- Codex：新任务用于验证完整启动生命周期；继续旧父目录会话时须确认更新后的写前入口实际可用，并按下文首次接入；
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

## 选择工作目录与首次接入

单仓项目可在 Git 根打开；由多个独立 Git 子项目组成的项目可在共同父目录打开，父目录不必有 `.git`，也不需要为每个子仓另开会话。

1. 新会话由真实 SessionStart 建立工作区路由。旧父目录会话安装前没有路由时，重新读取已更新的 `semantic-preflight`，从真实写前 Hook 申请首次接入。
2. 首次申请必须拒绝落盘，只记录实际接入时刻的观察。它不表示原会话启动时已经观察过子仓，也不授权修改。
3. 按反馈对目标子仓执行 inspect。存在已有差异时先展示事实并处理必要裁决，再以子仓 Git 根记录预检。
4. 重试原修改。处理另一个 Git 子仓时分别接入和预检；单次补丁只属于一个 Git 根。
5. Stop / PreCompact 使用实际参与仓库集合逐仓处理。任何失败、路由损坏或未归属任务都必须如实保留，不能用其它仓通过代替。

`inspect` 的 unknown 不意味着必须换到单仓目录；`refresh` 不能为缺少首次观察的会话补快照。完整状态分支见[预检与恢复](command-reference.md#多仓库工作区的预检与恢复)。若实际 Hook 未加载，先处理宿主加载和信任问题，不能从安装成功推断事件已经执行。

## 显式选择全项目建库

仅当用户要求为项目建立完整语义基线时，执行以下流程；普通任务直接继续生成前预检。多个独立 Git 仓库分别拥有自己的基线，父目录路由不合并它们。


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

插件单独触发且没有明确任务时等待指令；全项目盘点、状态汇总、审查和验证由用户显式触发。日常任务有无基线均先查找相关能力并记录复用决定；
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

## 全项目扫描报告

使用 inventory.py --write 保存独立 Discovery 报告。扫描不覆盖正式 Asset、Finding 或基线；无 Baseline 也可运行 --check-report。实际用户确认后，通过 --confirm-report 核对当前源码，再用预检维护已确认语义材料并执行全项目验证。定时部署由用户自行配置，接入与验收方法见[用户定时扫描](scheduled-scanning.md)。
