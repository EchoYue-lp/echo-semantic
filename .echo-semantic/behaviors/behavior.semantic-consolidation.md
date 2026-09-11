---
schema_version: 1
id: behavior.semantic-consolidation
kind: behavior
status: verified
expectation: human_confirmed
risk: high
primary_focus: state_authority
focus: [contract_evidence, failure_concurrency]
boundary: boundary.semantic-consolidation
observed_at: source:dc28a20c48961826c028d86b3b6bcef6c0951ac085fec34fc2ee936bf8270380
code_refs:
  - runtime/route.mjs#computeRoute
  - skills/semantic-discover/scripts/inventory.py#scan
  - skills/semantic-consolidate/scripts/consolidate.py#write_finding
  - skills/semantic-repair/SKILL.md#受控语义修复
  - skills/semantic-contract/scripts/verify_semantic.py#validate_change_evidence
rule_refs: [rule.single-semantic-authority]
evidence_refs: [evidence.semantic-consolidation]
finding_refs: []
---

# 老项目语义整合行为

## 重要承诺

插件单独触发时维护 Baseline 覆盖的已完成代码；明确任务时只处理当前任务允许路径。静态候选不能直接删除代码。

## 当前行为

`maintenance` 路由提示全仓盘点、状态汇总、候选归并、定向审查和验证；Asset 盘点和候选归并输出可追溯对象；repair 和 Delete 需要授权。

## 期望行为

同一语义概念应逐步收敛到 canonical owner；未知动态路径、未确认产品差异和缺少等价证据的删除保持未决。

## 触发、结果与副作用

路由只产生入口建议；扫描器可写入采用方长期对象；Hook 只允许预检声明的路径和已批准的删除目标；Stop/CI 重新读取最终差异。

## 失败、重试与恢复

候选冲突、消费者不明、等价场景失败或工程命令失败时保留 Finding 并要求补证据，不自动降级为可删除。

## 证据

资产扫描、候选 Finding、Hook Delete 阻断、等价 Evidence 和严格校验器共同提供证据。

## 裁决记录

canonical owner、兼容期和是否退役能力由人确认；插件不替人决定删除产品能力。
