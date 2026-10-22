---
schema_version: 1
id: map.lifecycle-enforcement
kind: capability_map
title: 生命周期 Hook 与确定性门禁
risk: high
observed_at: source:f35ccedfafd943243f47d1f64ea2f7c78cd6d2f9ce860ee473f0aea9e8ae1909
boundary_refs: [boundary.lifecycle-enforcement]
behavior_refs: [behavior.post-change-verification]
rule_refs: [rule.high-risk-evidence, rule.engineering-tools-own-style]
evidence_refs: [evidence.lifecycle-hooks]
finding_refs: []
audit_refs: []
related_map_refs: [map.semantic-workflow, map.host-distribution]
scenarios:
  multi-repository-workspace:
    status: mapped
    source_refs: [hooks/entry.mjs#handleWorkspace, runtime/session-state.mjs#loadWorkspaceSession, runtime/project-state.mjs#updateWorkspaceSessionJson, tests/native-hook-binding.test.mjs#multiRepositoryFixture]
    behavior_refs: [behavior.post-change-verification]
    evidence_refs: [evidence.lifecycle-hooks]
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
  session-stop-attribution:
    status: mapped
    source_refs:
      [hooks/entry.mjs#function writeSessionSnapshot, runtime/project-state.mjs#updateProjectJson]
    behavior_refs: [behavior.post-change-verification]
    evidence_refs: [evidence.lifecycle-hooks]
  existing-changes-disposition:
    status: mapped
    source_refs: [runtime/session-state.mjs#decideSessionChanges, scripts/session-changes.mjs#presentationFor, hooks/entry.mjs#sessionContext]
    behavior_refs: [behavior.post-change-verification]
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
  local-artifact-boundary:
    status: mapped
    source_refs: [runtime/project-state.mjs#prepareTaskArtifactDirectory, scripts/artifact_contract.py#check_artifacts, tests/test_artifacts.py#ArtifactTests]
    behavior_refs: [behavior.post-change-verification]
    evidence_refs: [evidence.semantic-workflow]
  explicit-repository-stop:
    status: mapped
    source_refs: [hooks/entry.mjs#verificationScope, skills/semantic-contract/scripts/verify_semantic.py#repository_scope, scripts/preflight_contract.py#verificationScope, tests/hooks.test.mjs#Baseline必须显式全项目验证]
    behavior_refs: [behavior.post-change-verification]
    evidence_refs: [evidence.lifecycle-hooks]
---

# 生命周期门禁

非 Git 父目录可作为多仓库工作区，SessionStart 仅建立路由身份；安装前旧会话可由真实 pre-edit 首次建立当下路由，首个请求必须拒绝落盘；真实 pre-edit 首次接入建立子仓观察，观察时间不冒充父会话启动时间。子仓独立预检、差异裁决和准入，Stop/PreCompact 逐仓验证并汇总失败。workspace 路由不是仓库快照或授权；损坏或缺失路由不能静默退回单仓通过。跨仓单次补丁和符号链接歧义继续拒绝。

## 能力范围

覆盖会话提示、编辑范围检查、压缩恢复、停止前语义验证和 CI 最终阻断。

## 入口与输出

Codex 与 Claude Code 从 `hooks/hooks.json` 原生发现 Hook 并保留插件来源，Cursor 使用专用映射；宿主输入统一转换为上下文、允许或拒绝结果，Action 返回标准退出码。Cursor 编辑前输出 `permission`，停止失败输出 `followup_message`；Codex 与 Claude Code 继续使用 `decision: block`。

## 行为关系

Claude Code 与 Cursor 的编辑前 Hook 提供实时阻断，Codex 在 Stop 时检查；CI 对最终 Git 差异重新验证，三者不互相替代。

## 状态与数据流

Hook 只读取项目语义材料、当前任务预检和 Git 已报告的差异路径；继续包、按会话隔离的起始快照/失败去重记录和真实 Hook 事件证据位于同一 `.echo-semantic/` 目录，分别绑定内容或证据摘要以及宿主/插件版本与时间窗，不建立业务数据库。

## 策略来源与优先级

项目是否存在 `.echo-semantic/baseline.md` 决定是否启用停止门禁；宿主信任策略继续生效。

## 生命周期与失败路径

校验器不可用、摘要漂移、引用失效、越界修改和缺少高风险依据都会返回非零；继续包失效只丢弃恢复上下文。相同缺预检失败的重入 Stop 不重复阻断，但内容或结算证据变化后恢复判定；并发会话分别读取自己的快照和去重记录。宿主仅被检测到但没有对应真实 Hook 事件证据时，路由保持 `bootstrap` 且 `enforcement` 为 false。

## 权限与敏感信息

Hook 不上传内容；工作树指纹不读取无差异文件，差异内容在真实仓库根与 fd 身份校验后只进入内存摘要且不写入运行态或日志；用户可见盘点只投影路径、状态、revision 和数量，不输出完整差异内容。快照、去重、路由、预检与 Stop 结算读取拒绝 symlink 和超过 1 MiB 的内容。继续包原有读取边界仍需单独审查。验收探针只有显式环境变量存在时才写入本地事件元数据。

## 用户侧投影

失败原因通过 stderr 和宿主阻断消息返回 Agent，便于修复后重试；已有差异裁决先展示具体事实、与当前任务的重叠判断及带理由的唯一推荐，再请求用户选择。

## 场景处置清单

会话开始、编辑前、PreCompact、停止前和 CI 五个生命周期点均有实现；预检状态和继续包在任务完成后失效。

## 未展开项

Cursor 当前缺少窗口重载后的真实事件证据。
