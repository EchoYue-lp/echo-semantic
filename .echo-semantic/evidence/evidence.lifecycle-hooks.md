---
schema_version: 1
id: evidence.lifecycle-hooks
kind: evidence
observed_at: source:0601ac04b1ed498782b4462cee66859c92500770eb0a401cf53e3072fdac7214
source_refs:
  - hooks/hooks.json#SessionStart
  - hooks/plugin-entry.mjs#function run
  - hooks/entry.mjs#checkEditScope
  - hooks/entry.mjs#function isCursorEditTool
  - hooks/entry.mjs#function deny
  - hooks/entry.mjs#function stop
  - hooks/hooks-cursor.json#preToolUse
  - tests/hooks.test.mjs#Cursor 按官方工具名识别写入路径，并放行只读工具
  - hooks/entry.mjs#checkpoint
  - runtime/project-state.mjs#writeVisibleStatus
  - runtime/project-state.mjs#ensureProjectStateIgnored
  - runtime/continuation.mjs#readContinuation
  - runtime/continuation.mjs#writeContinuation
  - runtime/route.mjs#currentHookEvidence
  - tests/hooks.test.mjs#范围外编辑
  - tests/manifests.test.mjs#Codex 与 Claude Code 共用原生 Hook，Cursor 保留专用事件名
  - tests/route.test.mjs#仅检测到宿主安装不能启用运行时门禁
  - tests/continuation.test.mjs#PreCompact 保存继续包，resume 只恢复仍可信的任务
  - tests/project-state.test.mjs#拒绝通过符号链接写出项目目录
  - tests/project-state.test.mjs#拒绝覆盖已被 Git 跟踪的运行态文件
  - skills/semantic-contract/scripts/verify_semantic.py#run_self_test
  - docs/supreme/specs/plugin-architecture/design.md#宿主生命周期时序
supports:
  [
    behavior.post-change-verification,
    rule.high-risk-evidence,
    rule.engineering-tools-own-style,
  ]
limitations:
  - Cursor 真实窗口尚未重载验收；stop 只能 followup，不能阻断会话结束
---

# 生命周期门禁证据

## 支持的结论

Codex 与 Claude Code 的 Hook 位于宿主原生发现路径并共享入口，安装后可保留插件来源；Hook 能注入最小上下文、在 Claude Code 与 Cursor 编辑前阻断预检范围外路径，并在采用语义基线的项目停止前运行校验器；
PreCompact 会保存带证据摘要的恢复包，resume 只恢复仍可信的包；连续编辑和连续失败 Stop 不会互相去重。安装探测不会被当作
生命周期通过，`enforcement` 只由绑定宿主版本、插件版本和时间窗的真实 Hook 事件证据启用。

## 来源与范围

来源为共享 Hook/继续包实现、连续事件/恢复事件单元测试、校验器自测和本机 Codex/Claude 生命周期探针。

## 已知缺口

Cursor 仅完成安装清单和本地插件路径验证。
