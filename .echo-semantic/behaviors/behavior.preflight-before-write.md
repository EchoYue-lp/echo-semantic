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
observed_at: source:4aee3f15c46918de495f7bfe0a3f4c45ddd24af4d2875cbb000e6becb5766912
code_refs:
  - skills/semantic-preflight/SKILL.md#已有差异处置
  - skills/semantic-preflight/SKILL.md#机器记录
  - scripts/session-changes.mjs
  - hooks/entry.mjs#sessionContext
  - hooks/entry.mjs#checkEditScope
  - skills/semantic-preflight/scripts/preflight.py#def record
  - scripts/record-preflight.mjs
  - scripts/check-preflight.py
  - scripts/preflight_contract.py#validate_preflight
rule_refs: [rule.single-semantic-authority, rule.high-risk-evidence]
evidence_refs: [evidence.semantic-workflow, evidence.task-scoped-reuse]
finding_refs: []
---

# 生成前预检行为

实际编辑仓库由以原生 cwd 解释的完整目标集合确定；父仓预检不授权独立子 Git 仓库。跨根必须沿同一会话读取目标仓可信观察、差异裁决和预检；缺失或冲突会话仍拒绝。多根补丁与符号链接路径整体拒绝，普通单仓行为保持。成功准入后只追加生命周期路由绑定，不回填旧快照或解除已有差异保护。

## 重要承诺

代码生成前必须记录复用点、唯一权威、允许路径、风险和验证要求。

## 当前行为

Skill 完成语义判断，脚本将结构化结果写入 `.echo-semantic/preflight.json` 并拒绝不完整的高风险声明；读取时重新核对语义对象存在性和 design/ADR 当前摘要。

调查从目标实现和直接消费者开始，未知或高风险才扩大；同一任务以 taskId 和路径增量 check，不续期、不跨任务复用。同一任务的风险和高风险信号不得降级。无引用不读语义材料，有引用按合同文件名直接定位；下一次检查重新读取。schemaVersion: 2 绑定搜索范围、候选路径/符号、复用决定、固定或可修改依据；Node 准入复用 Python 完整合同。没有基线也要检查记录，无任务等待，不自动全项目建库。

首次发现已有差异时，盘点入口输出路径状态和嵌套仓库 revision 摘要；助手必须先展示事实、判断与当前任务的重叠关系，再给出带理由的唯一推荐并等待用户裁决。结构化多文件补丁从补丁头提取全部路径，逐项执行已有差异保护、预检范围和删除授权检查。

## 期望行为

低风险保持轻量，高风险不能缺少语义依据和 design/ADR。

## 触发、结果与副作用

任何代码任务触发；唯一持久副作用是当前仓库 Git 私有预检状态。

## 失败、重试与恢复

输入不完整、语义对象不存在、权威文件不存在或设计摘要变化时返回非零；补齐事实后重新记录会原子替换旧状态。

## 证据

预检脚本单元测试覆盖低风险记录和高风险拒绝；Hook 与处置 CLI 测试覆盖具体差异展示、嵌套仓库摘要、推荐合同以及结构化补丁逐路径检查。

## 裁决记录

当前期望来自 ADR 0001 和插件目标，尚无人类单独修改。
