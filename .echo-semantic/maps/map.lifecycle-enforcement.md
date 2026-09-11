---
schema_version: 1
id: map.lifecycle-enforcement
kind: capability_map
title: 生命周期 Hook 与确定性门禁
risk: high
observed_at: source:a4ecee189e667f957010fc16cdd97b3fbd01d12b5cdea339d40a96add5ffdc7b
boundary_refs: [boundary.lifecycle-enforcement]
behavior_refs: [behavior.post-change-verification]
rule_refs: [rule.high-risk-evidence, rule.engineering-tools-own-style]
evidence_refs: [evidence.lifecycle-hooks]
finding_refs: []
audit_refs: []
related_map_refs: [map.semantic-workflow, map.host-distribution]
scenarios:
  native-plugin-hooks:
    status: mapped
    source_refs:
      [hooks/hooks.json#SessionStart, hooks/plugin-entry.mjs#function run]
    evidence_refs: [evidence.lifecycle-hooks]
  verified-hook-enforcement:
    status: mapped
    source_refs: [runtime/route.mjs#currentHookEvidence]
    evidence_refs: [evidence.lifecycle-hooks]
  session-start:
    status: mapped
    source_refs: [hooks/entry.mjs#sessionContext]
    behavior_refs: [behavior.post-change-verification]
  edit-outside-scope:
    status: mapped
    source_refs: [hooks/entry.mjs#checkEditScope]
    rule_refs: [rule.high-risk-evidence]
  stop-verification:
    status: mapped
    source_refs: [hooks/entry.mjs#function stop]
    evidence_refs: [evidence.lifecycle-hooks]
  continuation-checkpoint:
    status: mapped
    source_refs:
      [hooks/entry.mjs#checkpoint, runtime/continuation.mjs#writeContinuation]
    behavior_refs: [behavior.post-change-verification]
    evidence_refs: [evidence.lifecycle-hooks]
  ci-verification:
    status: mapped
    source_refs: [action.yml#执行语义治理门禁]
    rule_refs: [rule.engineering-tools-own-style]
---

# 生命周期门禁

## 能力范围

覆盖会话提示、编辑范围检查、压缩恢复、停止前语义验证和 CI 最终阻断。

## 入口与输出

Codex 与 Claude Code 从 `hooks/hooks.json` 原生发现 Hook 并保留插件来源，Cursor 使用专用映射；宿主输入统一转换为上下文、允许或拒绝结果，Action 返回标准退出码。Cursor 编辑前输出 `permission`，停止失败输出 `followup_message`；Codex 与 Claude Code 继续使用 `decision: block`。

## 行为关系

Claude Code 与 Cursor 的编辑前 Hook 提供实时阻断，Codex 在 Stop 时检查；CI 对最终 Git 差异重新验证，三者不互相替代。

## 状态与数据流

Hook 只读取项目语义材料和当前任务预检；继续包和真实 Hook 事件证据位于同一 `.echo-semantic/` 目录，分别绑定证据摘要以及宿主/插件版本与时间窗，不建立业务数据库。

## 策略来源与优先级

项目是否存在 `.echo-semantic/baseline.md` 决定是否启用停止门禁；宿主信任策略继续生效。

## 生命周期与失败路径

校验器不可用、摘要漂移、引用失效、越界修改和缺少高风险依据都会返回非零；继续包失效只丢弃恢复上下文。宿主仅被检测到但没有对应真实 Hook 事件证据时，路由保持 `bootstrap` 且 `enforcement` 为 false。

## 权限与敏感信息

Hook 不上传内容；验收探针只有显式环境变量存在时才写入本地事件元数据。

## 用户侧投影

失败原因通过 stderr 和宿主阻断消息返回 Agent，便于修复后重试。

## 场景处置清单

会话开始、编辑前、PreCompact、停止前和 CI 五个生命周期点均有实现；预检状态和继续包在任务完成后失效。

## 未展开项

Cursor 当前缺少窗口重载后的真实事件证据。
