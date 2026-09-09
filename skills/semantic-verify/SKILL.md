---
name: semantic-verify
description: >-
  验证语义材料结构、源码引用、当前快照、路径分类、高风险变更依据和 Finding 关闭条件，并核对项目实际运行的
  formatter、Lint、类型、单元、契约与集成验证；仅在已有语义材料或解决候选时使用。
---

# 语义验证

语义验证补充工程门禁，不替代 formatter、Lint、类型检查、单元测试、契约测试、集成测试或发布验证。

## 三层验证

1. **结构**：调用 `semantic-contract` 检查对象、引用、路径分类和源码快照。
2. **语义**：对照实现、人的期望、Rule、Evidence、Finding、Audit 和 design/ADR，处置未映射变化与失效单元。
3. **执行**：按 `semantic-diff` 的矩阵运行项目原有工程命令，记录命令、revision、退出码和覆盖范围。

## 状态门禁

- `risk_accepted` 必须有人类裁决；
- `resolved` 必须有修复、验证和复审证据；
- 快照漂移、未分类路径、失效源码引用、失败命令和证据缺口都保持未完成；
- `examined` 只表示列出的故障假设已检查，不表示没有缺陷。

高风险差异还要运行 `semantic-contract` 提供的变更依据校验。Skill 提示词、代码阅读或单次审查都不能单独作为
机器门禁通过证据。
