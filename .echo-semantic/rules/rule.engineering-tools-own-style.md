---
schema_version: 1
id: rule.engineering-tools-own-style
kind: rule
status: verified
expectation: inferred
risk: medium
primary_focus: contract_evidence
focus: [result_side_effect]
observed_at: source:bf04c0d2e6d1a8f73f691650b75a8d5d2b46656f799d3e88f9336e2da3b72091
behavior_refs: [behavior.post-change-verification]
code_refs:
  - skills/semantic-verify/SKILL.md#语义验证
  - package.json#verify
  - .github/workflows/ci.yml#执行插件合同和单元测试
evidence_refs: [evidence.lifecycle-hooks]
finding_refs: []
---

# 工程工具拥有代码质量

## 不变量或唯一权威

语义 Skill 不替代 formatter、Lint、类型检查、测试、契约检查和集成验证。

## 适用行为

适用于所有开发、验证和完成声明。

## 当前实现

`semantic-verify` 只核对项目实际工程命令和证据，CI 独立运行插件测试与语义门禁。

## 期望行为

新增语言时接入其成熟工程工具，不在语义校验器中重复实现风格检查器。

## 证据

`npm test` 与校验器自测是插件自身工程和语义验证的独立信号。

## 裁决记录

ADR 0001 已采纳该边界。
