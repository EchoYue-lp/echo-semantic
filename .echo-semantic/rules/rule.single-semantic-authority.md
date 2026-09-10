---
schema_version: 1
id: rule.single-semantic-authority
kind: rule
status: verified
expectation: inferred
risk: high
primary_focus: state_authority
focus: [contract_evidence]
observed_at: source:0601ac04b1ed498782b4462cee66859c92500770eb0a401cf53e3072fdac7214
behavior_refs:
  [behavior.preflight-before-write, behavior.multi-host-installation]
code_refs:
  - docs/adr/0001-multi-host-layered-enforcement.md#决策
  - skills/semantic-contract/references/semantic-artifact-contract.md#语义材料合同
evidence_refs: [evidence.semantic-workflow]
finding_refs: []
---

# 单一语义权威

## 不变量或唯一权威

项目 `.echo-semantic/` 是业务语义与当前运行态的唯一项目目录；Skill、Hook、安装状态和生成视图不能重新拥有第二份业务事实。

## 适用行为

适用于预检、发现、差异、审查、验证和多宿主投影。

## 当前实现

七个 Skill 共享一份合同，三个 manifest 只引用同一目录；预检、路由和继续包位于同一 `.echo-semantic/`，仅运行态文件被排除出 Git。

## 期望行为

新增宿主和工具时继续使用适配器，不复制语义对象模型。

## 证据

静态合同测试核对 Skill 集合、manifest 路径和项目专属术语。

## 裁决记录

ADR 0001 已采纳该不变量。
