---
name: semantic-diff
description: >-
  将代码分支、提交或工作树差异映射为语义变化、影响闭包、失效审查和验证矩阵；仅在已经形成实际差异且项目存在
  `.echo-semantic/` 基线时使用，不负责首次建库、生成前预检或泛化代码审查。
---

# 语义增量分析

## 工作流

1. 调用 `semantic-contract`，校验基线和源码引用；基线不存在或失效时转入 `semantic-discover`。
2. 记录基准 revision、目标 revision 和未提交状态。
3. 通过路径、符号、公共契约、序列化字段、资产身份和调用关系定位直接影响对象。
4. 沿共享状态权威、生命周期、外部副作用、适配边界、候选簇和 Evidence 关系扩展影响闭包。
5. 无法映射的重要变化进入局部 `semantic-discover`，不得解释成“无语义影响”。
6. 更新当前行为、候选簇、源码快照和引用，只让实际受影响的 Audit 视角变为 `stale`。
7. 输出语义变化、影响对象、未映射变化和最终工程验证矩阵。

## 路由

- 纯排版或注释变化经实际分析后只刷新引用，不扩大审查。
- 高风险失效、残余风险、新 Finding 或事故关联进入 `semantic-audit`。
- 其它变化直接进入 `semantic-verify`。

## 语义连续性模式

merge、rebase、squash、cherry-pick、重构或整文件覆盖可能丢失前置版本已有行为时，读取共同基准、一个或多个前置 revision
和候选结果，形成语义义务矩阵。义务包括 Behavior、Rule、Capability Map 的 `mapped`/`needs_review` 场景、未决 Finding、
Discovery 未知项及其 Evidence/Asset 依赖。

比较必须区分 `preserved`、`replaced`、`retired`、`conflicted`、`missing` 和 `unknown`。模型可以提出映射或解释，但不能把
源码文本合并成功、结果分支测试通过或结果 Baseline 已更新当作义务保全证据。替代、退役和双侧冲突解决必须引用结果中的
`semantic_continuity` Evidence；其余结果交给 `semantic-verify` 确定性阻断。

本 Skill 不创建第二套 diff、任务队列、状态机或架构目录。
