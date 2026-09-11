---
schema_version: 1
id: behavior.post-change-verification
kind: behavior
status: verified
expectation: inferred
risk: high
primary_focus: failure_concurrency
focus: [contract_evidence, time_lifecycle]
boundary: boundary.lifecycle-enforcement
observed_at: source:cfb2215be6b5497724b8b10c53de409983cd8364d67ef818959a5cc3247600ac
code_refs:
  - hooks/entry.mjs#function stop
  - hooks/entry.mjs#function deny
  - hooks/entry.mjs#function isCursorEditTool
  - skills/semantic-contract/scripts/verify_semantic.py#validate_change_evidence
  - action.yml#执行语义治理门禁
  - runtime/route.mjs#computeRoute
  - runtime/continuation.mjs#writeContinuation
  - hooks/entry.mjs#checkpoint
rule_refs: [rule.high-risk-evidence, rule.engineering-tools-own-style]
evidence_refs: [evidence.lifecycle-hooks]
finding_refs: []
---

# 变更后验证行为

## 重要承诺

采用语义基线的项目在 Agent 停止和 CI 合并前都要通过确定性语义校验。

## 当前行为

Hook 检查预检状态并运行严格校验；Action 在独立环境重新检查最终 Git 差异；PreCompact 保存带证据摘要的任务继续包，
resume 只恢复仍匹配当前仓库和分支的继续包。相同 HEAD、完整工作树内容指纹和插件版本的重复 Stop 会复用新鲜成功验证收据，
避免宿主重入在预检消费后再次阻断；一旦任一条件变化仍要求新的预检。Codex 与 Claude Code 停止失败返回 `decision: block` 且退出码 2；
Cursor 停止失败只发送 `followup_message` 且退出码 0，不能阻断会话结束。编辑前 Cursor 使用 `permission`，其它宿主仍用 `decision`。

## 期望行为

任何 Hook 配置、信任或宿主差异都不能被当作 CI 通过证据。

## 触发、结果与副作用

Claude Code 与 Cursor 在编辑前触发路径检查，三个宿主在停止前验证；只读取仓库与 `.echo-semantic/` 运行态。
Codex 与 Claude Code 失败时阻断当前动作；Cursor 编辑前用 `permission: deny` 阻断，停止失败只能追加 followup。

## 失败、重试与恢复

每个事件独立执行；失败 Stop（包括宿主重入标记）保留预检状态并可连续重试，成功或无变化 Stop 消费当前任务预检和继续包；
恢复和压缩事件不消费预检状态。继续包超过有效期、分支变化或证据摘要变化时降级为无恢复上下文。

## 证据

Node 测试覆盖会话输出和范围外编辑阻断，校验器自测覆盖失效引用与未分类路径。

## 裁决记录

当前没有风险接受记录。
