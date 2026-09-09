---
schema_version: 1
id: map.semantic-workflow
kind: capability_map
title: 语义工作流与只读复核
risk: high
observed_at: source:1c5fa5c28a0ab233e3670eef7d4ee538b875b17dc762918f02f3b780bdd1ff71
boundary_refs: [boundary.semantic-workflow]
behavior_refs: [behavior.preflight-before-write]
rule_refs: [rule.single-semantic-authority]
evidence_refs: [evidence.semantic-workflow]
finding_refs: []
audit_refs: []
related_map_refs: [map.lifecycle-enforcement, map.host-distribution]
scenarios:
  local-change:
    status: mapped
    source_refs: [skills/semantic-preflight/SKILL.md#生成前语义预检]
    behavior_refs: [behavior.preflight-before-write]
  architecture-change:
    status: mapped
    source_refs: [skills/semantic-preflight/workflows/architecture-convergence.md#绑定权威]
    rule_refs: [rule.single-semantic-authority]
  independent-review:
    status: mapped
    source_refs: [agents/semantic-risk-reviewer.md#语义风险审查]
    evidence_refs: [evidence.semantic-workflow]
  route-selection:
    status: mapped
    source_refs: [runtime/route.mjs#computeRoute]
    rule_refs: [rule.single-semantic-authority]
---

# 语义工作流

## 能力范围

覆盖生成前预检、基线发现、增量影响、定向审查、人工裁决和语义验证。

## 入口与输出

每个用户意图由一个独立 Skill 触发，输出回到同一套项目 `semantic/` 对象。

## 行为关系

预检先于代码生成，差异形成后进入增量分析，高风险单元才进入审查。

## 状态与数据流

长期事实只写项目 `semantic/`；任务预检和风险路由只写 Git 私有状态。

## 策略来源与优先级

项目指令和正式 design/ADR 高于 Skill 默认；人的确认期望高于实现推断。

## 生命周期与失败路径

基线或合同失败时停止增量写入；证据不足保持未知，不伪造闭合。

## 权限与敏感信息

三个专用 Agent 只读，不记录密钥或完整敏感日志。

## 用户侧投影

用户只在真实产品取舍和风险接受时参与裁决。

## 场景处置清单

局部变化、架构变化和独立复核均已映射到稳定入口。

## 未展开项

更多语言或宿主专属代码符号解析按实际采用需求扩展。
