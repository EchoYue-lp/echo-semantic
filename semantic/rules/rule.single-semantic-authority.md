---
schema_version: 1
id: rule.single-semantic-authority
kind: rule
status: verified
expectation: inferred
risk: high
primary_focus: state_authority
focus: [contract_evidence]
observed_at: source:7dbea6934585778cf089603e25e10bd33043a781dd00fa3b11c9df5a9f158593
behavior_refs: [behavior.preflight-before-write, behavior.multi-host-installation]
code_refs:
  - docs/adr/0001-multi-host-layered-enforcement.md#决策
  - skills/semantic-contract/references/semantic-artifact-contract.md#语义材料合同
evidence_refs: [evidence.semantic-workflow]
finding_refs: []
---

# 单一语义权威

## 不变量或唯一权威

项目 `semantic/` 是业务语义唯一长期权威；Skill、Hook、安装状态和生成视图不能重新拥有业务事实。

## 适用行为

适用于预检、发现、差异、审查、验证和多宿主投影。

## 当前实现

七个 Skill 共享一份合同，三个 manifest 只引用同一目录；预检状态位于 Git 私有目录。

## 期望行为

新增宿主和工具时继续使用适配器，不复制语义对象模型。

## 证据

静态合同测试核对 Skill 集合、manifest 路径和项目专属术语。

## 裁决记录

ADR 0001 已采纳该不变量。
