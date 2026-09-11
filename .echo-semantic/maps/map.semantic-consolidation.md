---
schema_version: 1
id: map.semantic-consolidation
kind: capability_map
title: 老项目语义资产整合
risk: high
observed_at: source:502233233033ff11554f18edff940878414cd522bf58d94de3481b7721d84f11
boundary_refs: [boundary.semantic-consolidation]
behavior_refs: [behavior.semantic-consolidation]
rule_refs: [rule.single-semantic-authority]
evidence_refs: [evidence.semantic-consolidation]
finding_refs: []
audit_refs: []
related_map_refs: [map.semantic-workflow]
scenarios:
  repository-maintenance:
    status: mapped
    source_refs:
      [
        runtime/route.mjs#computeRoute,
        skills/semantic-discover/SKILL.md#语义基线发现,
      ]
    behavior_refs: [behavior.semantic-consolidation]
  asset-inventory:
    status: mapped
    source_refs: [skills/semantic-discover/scripts/inventory.py#scan]
    evidence_refs: [evidence.semantic-consolidation]
  candidate-consolidation:
    status: mapped
    source_refs:
      [skills/semantic-consolidate/scripts/consolidate.py#write_finding]
    rule_refs: [rule.single-semantic-authority]
  controlled-repair:
    status: mapped
    source_refs: [skills/semantic-repair/SKILL.md#受控语义修复]
    behavior_refs: [behavior.semantic-consolidation]
---

# 老项目语义整合

## 能力范围

覆盖仓库级维护、资产盘点、候选归并、受控修复、删除授权和行为等价证据。

## 入口与输出

没有明确任务时由 `maintenance` 路由提示全仓操作；明确任务时由 `semantic-preflight` 限定路径。输出回到同一项目 `.echo-semantic/`。

## 行为关系

Asset 盘点产生候选，候选 Finding 经人工决策后才能进入 repair，删除必须有逐场景等价 Evidence。

## 状态与数据流

长期 Asset、Finding、Evidence 和 Behavior 提交 Git；预检和路由仍是短期运行态。

## 策略来源与优先级

采用方 design/ADR 和人的确认期望高于静态相似度；未知动态调用高于删除便利性。

## 生命周期与失败路径

缺少边界、消费者、替换关系、回滚点或等价证据时保持未决并阻断删除。

## 权限与敏感信息

扫描器只读取仓库；不上传源码、不记录密钥；删除仍受宿主 Hook 和 CI 门禁约束。

## 用户侧投影

用户看到候选、canonical owner、待裁决项、删除范围和验证限制，不看到绝对安全结论。

## 场景处置清单

仓库维护、明确任务、候选归并和受控删除均有对应入口和验证收口。

## 未展开项

语言特有 AST、动态运行时追踪和生产流量采样按采用方项目需求接入，未内置常驻服务。
