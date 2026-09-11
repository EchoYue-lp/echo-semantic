---
schema_version: 1
id: behavior.preflight-before-write
kind: behavior
status: verified
expectation: inferred
risk: high
primary_focus: state_authority
focus: [trigger_input, contract_evidence]
boundary: boundary.semantic-workflow
observed_at: source:dc28a20c48961826c028d86b3b6bcef6c0951ac085fec34fc2ee936bf8270380
code_refs:
  - skills/semantic-preflight/SKILL.md#机器记录
  - skills/semantic-preflight/scripts/preflight.py#def record
  - scripts/preflight_contract.py#validate_preflight
rule_refs: [rule.single-semantic-authority, rule.high-risk-evidence]
evidence_refs: [evidence.semantic-workflow]
finding_refs: []
---

# 生成前预检行为

## 重要承诺

代码生成前必须记录复用点、唯一权威、允许路径、风险和验证要求。

## 当前行为

Skill 完成语义判断，脚本将结构化结果写入 `.echo-semantic/preflight.json` 并拒绝不完整的高风险声明；读取时重新核对语义对象存在性和 design/ADR 当前摘要。

## 期望行为

低风险保持轻量，高风险不能缺少语义依据和 design/ADR。

## 触发、结果与副作用

任何代码任务触发；唯一持久副作用是当前仓库 Git 私有预检状态。

## 失败、重试与恢复

输入不完整、语义对象不存在、权威文件不存在或设计摘要变化时返回非零；补齐事实后重新记录会原子替换旧状态。

## 证据

预检脚本单元测试覆盖低风险记录和高风险拒绝。

## 裁决记录

当前期望来自 ADR 0001 和插件目标，尚无人类单独修改。
