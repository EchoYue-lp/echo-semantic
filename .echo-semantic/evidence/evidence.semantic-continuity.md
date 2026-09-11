---
schema_version: 1
id: evidence.semantic-continuity
kind: evidence
observed_at: source:502233233033ff11554f18edff940878414cd522bf58d94de3481b7721d84f11
source_refs:
  - skills/semantic-contract/scripts/verify_semantic.py#source_digest_at_revision
  - skills/semantic-contract/scripts/verify_semantic.py#extract_obligations
  - skills/semantic-contract/scripts/verify_semantic.py#compare_continuity
  - skills/semantic-contract/scripts/verify_semantic.py#validate_resolution_for_obligation
  - tests/test_continuity.py#ContinuityTests
  - action.yml#continuity-merge-base
supports: [map.semantic-continuity, behavior.semantic-continuity, rule.semantic-obligation-preservation]
limitations:
  - 只保护已经进入语义对象或其验证依赖的义务
  - 动态运行时事实无法闭合时返回 unknown
  - 历史被压平且 revision 与报告均丢失后不能事后恢复
---

# 语义连续性实现证据

## 支持的结论

校验器能够从 Git tree 读取多前置版本，重算历史源码摘要，提取稳定语义义务，比较规范化指纹并验证替代/退役处置。

## 来源与范围

证据来自 verifier、Action、临时 Git DAG 回归、设计和 ADR 0003。

## 已知缺口

未建模行为和动态运行时调用仍需采用方补充 Behavior、Rule、场景或 Evidence。
