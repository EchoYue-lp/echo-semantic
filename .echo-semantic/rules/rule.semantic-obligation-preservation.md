---
schema_version: 1
id: rule.semantic-obligation-preservation
kind: rule
status: verified
expectation: human_confirmed
risk: high
primary_focus: contract_evidence
focus: [state_authority, time_lifecycle, failure_concurrency]
observed_at: source:e2f030c43982a0e5bdc363e45ef67e8cc189d9cdd59552c89dd647c8cc5fb97e
behavior_refs: [behavior.semantic-continuity]
code_refs:
  - skills/semantic-contract/scripts/verify_semantic.py#compare_continuity
  - skills/semantic-contract/scripts/verify_semantic.py#validate_resolution_for_obligation
  - docs/adr/0003-semantic-continuity-gate.md#决策
evidence_refs: [evidence.semantic-continuity]
finding_refs: []
---

# 语义义务保全

## 不变量或唯一权威

结果必须保留所有前置版本的有效语义义务，或提供可验证的明确替代或批准退役。

## 适用行为

适用于 merge、rebase、squash、cherry-pick、重构、整文件覆盖和其它可能减少行为的变更。

## 当前实现

义务按稳定对象/场景身份比较规范化指纹；结果 Baseline 不能覆盖从父 Git revision 读取的事实。

## 期望行为

`conflicted`、`missing`、`unknown` 和不可恢复历史失败关闭；测试与 Evidence 也属于受保护依赖。

## 证据

连续性报告、Git DAG 回归和 ADR 0003 共同约束实现。

## 裁决记录

退役和双侧冲突解决必须绑定人的 design/ADR 摘要、兼容影响与回滚方式。


## 原件与当前依赖

历史观察必须真实可恢复；Audit缺省revision只回退其顶层，不把显式空值回退。结果采用的迁移控制Evidence须有真实current引用，未采用的历史控制材料仍按原观察读取。历史存储resolution精确绑定issue、父指纹、原blob/mode/锚/角色、原/替义务、matched场景与正式批准authority；父文稿之外的错误不因存储迁移而放过。
