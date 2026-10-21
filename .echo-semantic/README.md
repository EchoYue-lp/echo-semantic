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

本目录中必要的长期 Markdown 材料用于约束 Echo Semantic 自身开发，随代码版本管理。根级 `status.md`、`status.json`、
`preflight.json`、`route.json`、`continuation.json`、`session-snapshot.json`、`stop-dedupe.json` 是可丢弃运行态，和 `local/` 一起由 `.git/info/exclude` 排除，不得提交。

日志、完整结果、临时脚本、补丁、源码副本和中间清单统一放在 `local/<task-id>/`，不属于语义对象或正式源码引用；长期 Evidence 只提炼必要结论和原件位置。目录准备使用插件 `scripts/artifacts.mjs prepare`，CI 产物沿用 Artifact。不自动清理或上传本地产物。
