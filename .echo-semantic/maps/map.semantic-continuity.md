---
schema_version: 1
id: map.semantic-continuity
kind: capability_map
title: 多前置版本语义连续性门禁
risk: high
observed_at: source:502233233033ff11554f18edff940878414cd522bf58d94de3481b7721d84f11
boundary_refs: [boundary.semantic-continuity]
behavior_refs: [behavior.semantic-continuity]
rule_refs: [rule.semantic-obligation-preservation]
evidence_refs: [evidence.semantic-continuity]
finding_refs: []
audit_refs: []
related_map_refs:
  [map.semantic-workflow, map.lifecycle-enforcement, map.semantic-consolidation]
scenarios:
  multi-predecessor-union:
    status: mapped
    source_refs:
      [skills/semantic-contract/scripts/verify_semantic.py#compare_continuity]
    behavior_refs: [behavior.semantic-continuity]
  semantic-fingerprint:
    status: mapped
    source_refs:
      [skills/semantic-contract/scripts/verify_semantic.py#semantic_fingerprint]
    rule_refs: [rule.semantic-obligation-preservation]
  explicit-resolution:
    status: mapped
    source_refs:
      [skills/semantic-contract/scripts/verify_semantic.py#validate_resolution_for_obligation]
    evidence_refs: [evidence.semantic-continuity]
  ci-continuity-gate:
    status: mapped
    source_refs: [action.yml#continuity-merge-base]
    rule_refs: [rule.semantic-obligation-preservation]
---

# 多前置版本语义连续性

## 能力范围

覆盖 merge、rebase、squash、cherry-pick、重构和覆盖写入后的语义义务保全。

## 入口与输出

输入共同基准、一个或多个前置 Git revision 和候选结果，输出确定性 JSON 义务矩阵与退出码。

## 行为关系

`semantic-diff` 映射义务，`semantic-verify`、校验器和 Action 阻断未经处置的语义减少。

## 状态与数据流

前置事实从 Git tree 读取；长期替代或退役证据继续进入项目 `.echo-semantic/`，机器报告只作为可重算 Artifact。

## 策略来源与优先级

稳定语义身份和人的 design/ADR 决策高于结果分支 Baseline、文本合并结果或剩余测试。

## 生命周期与失败路径

义务缺失、双侧冲突、动态未知、父版本不可恢复或防伪字段不匹配时失败关闭。

## 权限与敏感信息

比较器只读取本地 Git 对象和项目语义材料，不 checkout 分支、不修改源码、不上传内容。

## 用户侧投影

报告列出义务身份、父版本指纹、结果指纹、处置状态和可定位失败原因。

## 场景处置清单

义务并集、同义务分歧、明确替代、批准退役、测试同失和历史不可恢复均有确定性去向。

## 未展开项

未建模的隐含行为只能由启发式生成候选；动态运行时事实仍需采用方 Evidence。
