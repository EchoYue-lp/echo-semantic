---
schema_version: 1
id: rule.semantic-obligation-preservation
kind: rule
status: verified
expectation: human_confirmed
risk: high
primary_focus: contract_evidence
focus: [state_authority, time_lifecycle, failure_concurrency]
observed_at: source:502233233033ff11554f18edff940878414cd522bf58d94de3481b7721d84f11
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
