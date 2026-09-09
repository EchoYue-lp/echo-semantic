---
schema_version: 1
id: rule.high-risk-evidence
kind: rule
status: verified
expectation: inferred
risk: high
primary_focus: contract_evidence
focus: [state_authority, failure_concurrency]
observed_at: source:677bbc9ea253c6fbb8c000981c28c7c3a94e5a8d4b0f7eb906169c77972c2d5f
behavior_refs: [behavior.preflight-before-write, behavior.post-change-verification]
code_refs:
  - skills/semantic-contract/scripts/verify_semantic.py#infer_signals
  - skills/semantic-contract/scripts/verify_semantic.py#validate_change_evidence
  - scripts/governance_contract.py#validate_design_authority
evidence_refs: [evidence.lifecycle-hooks]
finding_refs: []
---

# 高风险证据门禁

## 不变量或唯一权威

新公共 API、状态权威、协议、跨服务迁移和架构变化不能只凭 Agent 声明通过。

## 适用行为

适用于生成前预检、增量分析、停止 Hook 和 CI Action。

## 当前实现

校验器识别 Rust、Python、Go、Java、TypeScript 和 JavaScript 公开声明，对未知源码保守升级，并要求同次语义对象和经路径、章节、摘要校验的 design/ADR 依据。

## 期望行为

启发式筛选只负责升级，不替代 Agent 对真实语义的判断；误报通过补充明确依据处理，不降低门禁。

## 证据

校验器自测覆盖失效引用和未分类路径，项目基线用于持续回归。

## 裁决记录

当前没有豁免或风险接受。
