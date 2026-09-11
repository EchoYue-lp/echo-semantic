# 语义材料

本目录是该插件自身的语义事实入口，用于约束插件开发并验证校验器能够治理自身。

- `baseline.md`：当前源码快照、路径分类、边界和覆盖状态；
- `maps/`：能力与场景导航；
- `behaviors/`：重要行为承诺；
- `rules/`：不变量和唯一权威；
- `evidence/`：可复用证据；
- `findings/`、`audits/`、`discovery/`、`assets/`：问题、定向审查、发现证据和语义资产。

`inventory_closure` 只表达当前路径与风险视角是否已有去向；`behavior_model_closure` 只表达能力场景是否已经充分展开。
两者都不表示插件没有缺陷。

本目录中的长期 Markdown 材料用于约束 Echo Semantic 自身开发，必须随代码提交 GitHub。仅根级 `status.md`、`status.json`、
`preflight.json`、`route.json`、`continuation.json` 是可丢弃运行态，由 `.git/info/exclude` 精确排除，不得提交。
