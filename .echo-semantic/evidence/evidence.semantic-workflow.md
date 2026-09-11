---
schema_version: 1
id: evidence.semantic-workflow
kind: evidence
observed_at: source:502233233033ff11554f18edff940878414cd522bf58d94de3481b7721d84f11
source_refs:
  - skills/semantic-contract/SKILL.md#语义材料合同
  - skills/semantic-contract/references/semantic-artifact-contract.md#语义材料合同
  - scripts/governance_contract.py#validate_design_authority
  - scripts/preflight_contract.py#validate_preflight
  - tests/preflight-contract.test.mjs#Node 与 Python 共享预检合同 fixture
  - skills/semantic-preflight/SKILL.md#预检
  - skills/semantic-discover/SKILL.md#完成条件
  - agents/semantic-capability-reviewer.md#能力闭合复核
  - runtime/route.mjs#computeRoute
  - runtime/continuation.mjs#checkpointFromPreflight
  - runtime/capabilities/load.mjs#loadCapabilities
  - runtime/capabilities/probe.mjs#probeHost
  - skills/semantic-status/scripts/status.py#status
  - README.md#架构总览
  - docs/supreme/specs/plugin-architecture/design.md#系统边界
  - skills/semantic-contract/scripts/verify_semantic.py#compare_continuity
supports:
  [behavior.preflight-before-write, behavior.semantic-continuity, rule.single-semantic-authority, rule.semantic-obligation-preservation]
limitations:
  - Skill 是否自动触发仍由各宿主模型和发现机制决定
---

# 语义工作流证据

## 支持的结论

十个入口职责分离，生成前预检、状态 Frontier、发现、资产盘点、差异、候选归并、受控修复、审查、裁决和验证围绕同一对象合同协作；预检、Hook、状态视图和 CI
共享对象存在性与正式 design/ADR 摘要合同，压缩恢复只携带短期任务线索；连续性模式直接比较 Git tree 中的父版本义务和候选结果。

## 来源与范围

来源为 Skill 正文、架构收敛工作流、只读 Agent 合同和项目架构设计。

## 已知缺口

触发描述只能作为软发现，需要 Hook 和 CI 提供确定性约束。
