# ADR 0001：多宿主分层语义治理

## 状态

已采纳。

## 背景

单独的 Skill 可以让 Coding Agent 在生成前搜索复用点、识别状态权威并规划验证，但 Skill 仍是模型侧指令，
不能证明每次都被加载和执行。只建设 Hook 又无法可靠完成能力归并、产品预期和架构取舍。把整套材料复制到每个
业务仓库还会形成多份协议和维护漂移。

Codex、Cursor 和 Claude Code 都支持 Skill；三者也提供不同形态的生命周期 Hook。Cursor 与 Claude Code 可以
在插件中同时携带 Skill、Agent 和 Hook；Codex 使用插件清单发现 Skill，并通过其生命周期配置接入 Hook。

## 候选方案

1. 每个项目复制一套 Skill：上手直接，但合同、脚本和宿主差异会持续漂移。
2. 只提供 Hook 和静态规则：阻断能力较强，但无法完成需要语义判断的发现、影响分析和裁决。
3. 建立独立多宿主插件，以 Skill 负责判断、Hook 负责生命周期接线、校验器与 CI 负责确定性约束（采用）。

## 决策

1. `skills/` 保存八个流程入口，`agents/` 保存三个只读角色；三个宿主清单只映射同一真理源。
2. 项目自己的 `semantic/` 保存唯一长期语义事实，插件不保存业务 Capability、Rule 或状态权威。
3. `semantic-preflight` 将任务标识、允许路径、边界结论、设计摘要和风险声明写入 Git 私有目录，不进入版本控制；PreCompact 以同一任务状态生成带证据摘要的继续包，resume 只恢复仍匹配仓库、分支和证据的包；会话开始、无变化 Stop 或成功 Stop 会消费旧记录，失败 Stop 保留给同一任务重试。
4. Hook 在会话开始注入最小路由提示和可信 Frontier，Claude Code 与 Cursor 在编辑工具执行前检查允许路径，PreCompact 保存恢复线索，停止前运行确定性校验；Codex 的编辑前事件覆盖不足时由 Stop、PreCompact 和 CI 收口。未采用 `semantic/` 的项目不被阻断。
5. `runtime/route.mjs` 同时读取静态能力合同和 `probeHost` 运行时结果；探测失败或停止 Hook 未验证时强制进入 `bootstrap`，路由状态区分声明能力与运行时探测，不把静态清单当真实会话证据。
6. GitHub Action 提供与宿主无关的最终门禁；项目原有 formatter、Lint、类型、测试和契约工具继续拥有代码质量权威。
7. 新公共 API、新状态权威、新协议、跨服务迁移和未映射生产路径必须具有同次语义依据；架构变化还必须绑定并更新正式设计或 ADR。
8. 当前不引入 MCP Server、数据库或常驻进程。出现跨进程语义查询需求后，再以只读适配形式评估 MCP。
9. 安装器是插件分发工具，不承担事务性来源迁移。安装和卸载按宿主渠道直接覆盖本插件对应内容；`all` 先检测宿主是否存在，
   未安装宿主返回 `skipped`，显式指定未安装宿主返回 `manual_action`。完整卸载删除插件私有状态目录。
10. 对外展示名使用 `Echo Semantic`，GitHub 仓库、三宿主插件 ID 和 marketplace 名统一为 `echo-semantic`。安装新 ID 时
    直接清理旧插件 ID 的宿主注册、Hook、Agent、Cursor 链接和安装状态；旧 GitHub Action 地址不提供重命名兼容承诺。

## 影响

- 插件可以独立安装和升级，项目材料不会因宿主变化而复制。
- Hook 的实时覆盖受宿主版本、信任和事件能力影响，因此不能替代 CI。
- 采用项目需要建立 `semantic/` 基线；未采用项目只获得 Skill，不承担停止门禁。
- 低风险变化只需要短预检、路径范围和项目原有工程验证；高风险变化才要求更新语义对象和设计权威。

## 参考

- Claude Code Plugins 与 Hooks 官方文档。
- Cursor Plugins 与 Hooks 官方文档。
- Codex Plugins、Skills 与 Hooks 官方文档和当前 CLI 能力。
