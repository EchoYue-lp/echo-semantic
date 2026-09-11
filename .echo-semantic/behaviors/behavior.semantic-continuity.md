---
schema_version: 1
id: behavior.semantic-continuity
kind: behavior
status: verified
expectation: human_confirmed
risk: high
primary_focus: contract_evidence
focus: [state_authority, time_lifecycle, failure_concurrency]
boundary: boundary.semantic-continuity
observed_at: source:502233233033ff11554f18edff940878414cd522bf58d94de3481b7721d84f11
code_refs:
  - skills/semantic-contract/scripts/verify_semantic.py#extract_obligations
  - skills/semantic-contract/scripts/verify_semantic.py#compare_continuity
  - action.yml#continuity-merge-base
rule_refs: [rule.semantic-obligation-preservation]
evidence_refs: [evidence.semantic-continuity]
finding_refs: []
---

# 语义连续性行为

## 重要承诺

候选结果不能静默丢失任一前置版本仍有效的语义义务、未决问题或验证依赖。

## 当前行为

校验器读取 Git tree 中的共同基准、前置版本与结果，比较稳定身份和规范化指纹，并输出六种确定性状态。

## 期望行为

只有保留、带等价证据的替代或经 design/ADR 批准的退役允许通过；其它状态失败关闭。

## 触发、结果与副作用

命令只读取 Git 对象，可选写入 JSON 报告；不执行 Git merge、不 checkout 分支、不创建第二状态目录。

## 失败、重试与恢复

输入 revision 不可恢复、父版本摘要失效、义务冲突或处置证据不完整时返回非零；补齐历史和证据后可重复计算。

## 证据

临时 Git DAG 测试覆盖义务并集、分歧、代码移动、替代、退役、测试同失、未知项和报告确定性。

## 裁决记录

ADR 0003 已确认保护语义义务而不是源码并集。
