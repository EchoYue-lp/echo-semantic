# 变更记录

本项目遵循语义化版本。每个正式版本必须记录用户可感知变化、合同变化、迁移要求、验证边界和已知限制；开发过程不把
`+codex.<timestamp>` cachebuster 提交为项目版本。

## Unreleased

### 语义连续性门禁

- `semantic-diff`、`semantic-verify` 和确定性校验器新增多前置 revision 语义义务比较，覆盖 merge、rebase、squash、cherry-pick 和重构；
- 候选结果必须保留 Behavior、Rule、Capability 场景、未决 Finding、未知项及其验证依赖，或提供可验证替代/退役 Evidence；
- 引用内容签名同时保护 blob、执行位、symlink 类型、锚点和路径角色，阻断测试移出 runner、依赖缩减和旧实现覆盖；
- Action 可选接收 merge-base、target、source、result 并输出确定性 JSON 报告；旧单基准门禁保持兼容；
- 不新增自动 Git merge Skill，不修改 Codex、Cursor、Claude Code 的 Hook、Agent 和 manifest 适配。

### 待决定

- 首次公开分发前选择并添加明确的开源许可证。

## 0.2.0 - 2026-09-11

本版本把插件从“语义治理门禁”推进到“老项目语义整合闭环”，并完成 Codex、Cursor 的安装回归与文档同步。

### 老项目语义整合

- 新增 `semantic-discover` 资产盘点：生成稳定 Asset 身份，识别文件、符号、入口、状态权威、协议、测试消费者、文档和动态未知；
- 新增 `semantic-consolidate`：将重复实现、平行状态权威和包装链形成候选 Finding，要求按候选簇选择 canonical owner；
- 新增 `semantic-repair`：把替换关系、调用方切换、删除范围、回滚点和行为等价证据绑定到受控修复切片；
- 行为等价 Evidence 绑定删除前后 revision、删除路径、逐场景结果和工程命令；动态未知、未闭合 Discovery 或 `needs_review` Asset 阻断删除；
- Delete 编辑前 Hook、Stop 和 CI 共同执行高风险受控删除门禁，不接受静态无引用或单个旧 Evidence 作为删除依据。

### 路由与任务范围

- 无明确任务且工作树无变化时进入 `maintenance`，依次提供全仓资产盘点、状态汇总、候选归并、定向审查和验证；
- 明确任务只处理 `semantic-preflight` 允许路径；预检记录 `scope: task`，任务 id 与宿主输入匹配后才进入任务范围路由；
- 目录路径盘点支持递归范围，批准归并要求 `--candidate-id` 与候选簇内的 canonical Asset。

### 多宿主与发布文档

- 版本源、三端 manifest、Claude marketplace、Action、安装缓存检查和测试期望统一升级为 `0.2.0`；
- README、概念、命令参考、CI、宿主支持、发布指南和安全说明同步版本与新能力；
- 架构主流程、维护路由、宿主生命周期、高风险归并和安装卸载 Mermaid 图同步到当前执行链路；
- Codex Agent 投影和 Cursor 专用事件协议保持不变，Cursor 仍使用本地普通目录镜像。

### 验证边界

- `npm run verify` 通过，包含格式/Lint、插件与分发合同、47 个 Node 测试、24 个 Python 测试、语义自测和严格快照；
- Codex 安装脚本返回 `installed`，Cursor 安装脚本返回 `installed`；Cursor 窗口由维护者手工检查；
- Claude Code 登录后的完整生命周期和公开许可证仍是后续发布工作，不把静态或安装证据描述为完整运行时覆盖。

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
