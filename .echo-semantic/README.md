# 语义材料

本目录是该插件自身的语义事实入口，用于约束插件开发并验证校验器能够治理自身。

- `baseline.md`：当前源码快照、路径分类、边界和覆盖状态；
- `maps/`：能力与场景导航；
- `behaviors/`：重要行为承诺；
- `rules/`：不变量和唯一权威；
- `evidence/`：可复用证据；
- `findings/`、`audits/`、`discovery/`：问题、定向审查和发现证据。

`inventory_closure` 只表达当前路径与风险视角是否已有去向；`behavior_model_closure` 只表达能力场景是否已经充分展开。
两者都不表示插件没有缺陷。
