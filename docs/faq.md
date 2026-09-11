# 常见问题

## 为什么不只提供一个 Skill？

Skill 适合复用分析、边界判断和风险审查，但不能证明每次都被加载。`echo-semantic` 用 Hook 接入生命周期，用校验器和 CI 检查可以确定的结构与 Git 事实。

## 插件能保证 AI 生成的代码没有缺陷吗？

不能。它能让复用、状态权威、公共契约、风险和验证要求更早显式化，并阻断缺少依据的高风险变化。业务正确性仍依赖设计、代码审查和项目测试。

## 它会替代 formatter、Lint、类型检查或测试吗？

不会。语义 Skill 不模拟工程工具；`semantic-verify` 只核对实际执行的工程验证证据。

## 每个项目都必须提交 `.echo-semantic/` 吗？

只有采用语义治理的项目需要。插件发现但未采用的项目不会被 Stop 门禁阻断；要获得持续追踪和 CI 能力，应把项目自己的 `.echo-semantic/` 纳入版本控制。

## `.echo-semantic/` 会不会成为第二套架构文档？

不会。正式 design/ADR 继续决定产品和架构；`.echo-semantic/` 连接当前行为、规则、证据和审查状态。预检只引用设计权威，不复制它。

## 为什么还需要 `semantic-preflight`？

事后审查只能发现已经生成的重复和架构偏差。预检在写入前要求 Agent 先查已有 Capability、Rule、API、实现和测试，并限定允许路径与验证矩阵。

## 没有明确任务时会发生什么？

插件单独触发且没有工作树变化时采用 `maintenance` 路由，执行当前 Baseline 覆盖代码的资产盘点、状态汇总、定向审查和验证；
一旦存在明确任务，预检会把范围收窄到该任务的允许路径。

## 盘点会自动删除重复代码吗？

不会。盘点只产生 Asset 和候选 Finding；只有人工确认 canonical owner、补齐替换关系、回滚点和行为等价证据后，
`semantic-repair` 才能授权删除。静态无引用不等于运行时不可达。

## 为什么有六种路由？

所有任务走同样深度会让文档修正和协议迁移成本相同。路由保留共同的预检与验证收口，只让高风险差异进入定向 Audit 和正式设计门禁。

## `bootstrap` 是失败状态吗？

不是。它表示缺少可靠 Baseline 或宿主能力证据，应先建立基线或显式执行预检和验证。它是保守入口，不是错误码。

## 路由是不是一套任务状态机？

不是。路由按当前基线、宿主探测和工作树重新计算，是可丢弃结果。项目任务、设计审批和 Coding Agent 自身生命周期不由插件接管。

## 为什么继续包只保存摘要和引用？

恢复需要知道阶段、Frontier 和证据是否变化，不需要复制完整对话或源码。摘要约束可防止过期上下文被继续使用，同时避免建立新的持久化系统。

## 支持哪些语言？

路径分类与对象合同不限制语言。公共 API 启发式当前覆盖 Rust、TypeScript/JavaScript、Python、Go 和 Java；其它常见源码后缀会保守标记为未知生产代码并进入高风险路径。

## 支持 monorepo 吗？

支持一套 Git 根级 Baseline。校验范围始终是整个 Git 仓库；当前不支持同一个 Git 根内多套互相独立的 Baseline。

## 可以只使用本地 Hook，不接 CI 吗？

可以，但约束更弱。Hook 受宿主版本、配置、信任和事件覆盖影响，公共团队项目应接入 CI。

## 插件需要数据库或 MCP 吗？

当前不需要。本地文件、Git 和短进程已覆盖状态与验证需求。出现明确跨进程查询需求后再评估只读 MCP，不能为了形式完整提前增加服务。

## Echo Semantic 与 Supreme 是什么关系？

两者可以独立使用，也可以组合：

- Supreme 管理 brainstorm、design、plan、build、debug、review 等工程阶段；
- Echo Semantic 管理 Capability、Behavior、Rule、状态权威、增量影响和高风险证据。

Echo Semantic 不复制 Supreme 的工程阶段状态，Supreme 也不替代项目的语义基线。

## GitHub 仓库名和插件 ID 是否一致？

一致。GitHub 仓库名、插件 ID 和 marketplace 名都是 `echo-semantic`，展示名是 `Echo Semantic`。旧插件 ID
`echo-coding-semantic-governance` 只保留在安装器的清理兼容列表中。

## 可以把 `.echo-semantic/` 当作生成文档随时重建吗？

不建议。Discovery 可以修复和扩大基线，但 Behavior 中人的确认期望、Finding 的处置证据和 Audit 的 revision 记录具有长期价值。应像代码一样审查和版本化。
