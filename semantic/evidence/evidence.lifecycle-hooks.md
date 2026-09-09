---
schema_version: 1
id: evidence.lifecycle-hooks
kind: evidence
observed_at: source:677bbc9ea253c6fbb8c000981c28c7c3a94e5a8d4b0f7eb906169c77972c2d5f
source_refs:
  - hooks/entry.mjs#checkEditScope
  - hooks/entry.mjs#function stop
  - hooks/entry.mjs#checkpoint
  - runtime/continuation.mjs#readContinuation
  - runtime/continuation.mjs#writeContinuation
  - tests/hooks.test.mjs#范围外编辑
  - tests/continuation.test.mjs#PreCompact 保存继续包，resume 只恢复仍可信的任务
  - skills/semantic-contract/scripts/verify_semantic.py#run_self_test
  - docs/supreme/specs/plugin-architecture/design.md#宿主生命周期时序
supports:
  [
    behavior.post-change-verification,
    rule.high-risk-evidence,
    rule.engineering-tools-own-style,
  ]
limitations:
  - Cursor 真实窗口尚未重载验收
---

# 生命周期门禁证据

## 支持的结论

Hook 能注入最小上下文、在 Claude Code 与 Cursor 编辑前阻断预检范围外路径，并在采用语义基线的项目停止前运行校验器；
PreCompact 会保存带证据摘要的恢复包，resume 只恢复仍可信的包；连续编辑和连续失败 Stop 不会互相去重。

## 来源与范围

来源为共享 Hook/继续包实现、连续事件/恢复事件单元测试、校验器自测和本机 Codex/Claude 生命周期探针。

## 已知缺口

Cursor 仅完成安装清单和本地插件路径验证。
