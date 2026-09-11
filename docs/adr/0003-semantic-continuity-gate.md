# ADR 0003：多前置版本语义连续性门禁

## 状态

已采纳

## 背景

Git 只能判断文本和树对象如何合并。一次 merge、rebase、cherry-pick、squash、重构或整文件覆盖可以在没有文本冲突、
结果分支现有测试仍通过的情况下，丢失另一个前置版本已经实现的业务场景、生命周期、状态权威、规则、未决 Finding 或测试。

现有 Echo Semantic 能验证当前结果的 Baseline、源码引用、差异依据和受控删除，但单个 `base -> result` 的净差异不能证明
多个前置版本中的有效语义义务都进入了结果。结果分支也不能通过同步删除代码、测试和语义材料来重新定义父版本事实。

## 候选方案

1. 继续只验证最终结果，由代码审查或测试偶然发现丢失；
2. 对两个分支的源码或 AST 取并集，自动保留所有实现；
3. 比较 merge-base、所有前置版本和候选结果的稳定语义义务，只有保留、明确替代或批准退役才能通过；
4. 建立独立数据库或常驻服务，长期保存所有分支的语义图。

## 决策

采用方案 3。

`semantic-diff` 负责把各 revision 的 Behavior、Rule、Capability 场景、未决 Finding、Discovery 未知项及其源码、测试和
Evidence 依赖映射为稳定语义义务；`semantic-verify` 和 CI 负责确定性比较。普通修改比较一个前置版本，Git merge 比较
`merge-base`、目标分支、来源分支和候选结果。

候选结果必须保留所有仍有效义务。实现移动或重写可以使用稳定身份继续承载；减少义务只能通过两条路径：

- 新的 canonical 对象明确替代旧义务，并有覆盖原场景的等价或迁移 Evidence；
- 人的 Decision 明确批准退役，引用受影响义务、前置 revision、兼容影响和回滚策略。

两个前置版本对同一义务作出不同修改时形成语义冲突，即使 Git 没有文本冲突也不得静默选择一侧。无法恢复 revision、
动态调用无法闭合或对象映射不确定时返回 `unknown`；高风险比较失败关闭。

连续性比较报告作为命令输出或 CI Artifact，可由输入 revision 重算，不成为第二套长期权威。需要长期保存的替代、退役和
冲突解决事实继续写入采用方自己的 `.echo-semantic/`、design 和 ADR。

长期 `semantic_continuity` Evidence 使用排除 `.echo-semantic/` 的 `source:<digest>` 绑定候选结果源码；机器报告单独记录实际
result commit。不得把包含 Evidence 自身的 commit SHA 写进同一 Evidence，否则会形成不可解的内容寻址循环。

## 影响

- 不新增自动 Git merge Skill，不改变 Git 的源码合并职责；
- 扩展现有 `semantic-diff`、`semantic-verify`、语义合同、校验器和 Action，而不是建立平行工作流；
- PR 必须在来源分支仍可恢复时执行连续性门禁；squash/rebase 前保存带 revision 与对象指纹的报告；
- 测试和 Evidence 本身属于验证义务，不能与实现一起静默消失；
- 只运行结果分支剩余测试、只更新 Baseline 摘要或只依赖 LLM 判断均不能证明语义保全；
- 未建模的隐含行为只能由启发式升级为候选，不能获得形式化保证；动态未知保持阻断或 `needs_review`；
- Codex、Cursor、Claude Code 的 manifest、Agent 投影和 Hook 事件合同保持不变。

## 验收

构造 merge-base、目标分支、来源分支和候选结果夹具：两个分支分别新增不同高风险语义义务，结果遗漏任一义务时必须非零退出；
两侧对同一义务作出不同修改时必须报告语义冲突；稳定身份下的代码移动通过；有完整替代 Evidence 或退役 Decision 时通过；
前置测试与实现同时丢失、输入 revision 不可恢复或存在动态未知时阻断。普通单前置版本重构和 squash/rebase 前报告使用同一合同。
