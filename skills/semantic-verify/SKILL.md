---
name: semantic-verify
description: >-
  验证语义材料结构、源码引用、当前快照、路径分类、高风险变更依据和 Finding 关闭条件，并核对项目实际运行的
  formatter、Lint、类型、单元、契约与集成验证；仅在已有语义材料或解决候选时使用。
---

# 语义验证

语义验证补充工程门禁，不替代 formatter、Lint、类型检查、单元测试、契约测试、集成测试或发布验证。

## 三层验证

1. **结构**：日常调用 `semantic-contract` 的任务范围检查，核对实际差异及相关引用闭包；用户显式要求全项目治理时再检查完整对象、路径分类和严格快照。
2. **语义**：对照实现、人的期望、Rule、Evidence、Finding、Asset、Audit 和 design/ADR，处置未映射变化与失效单元。
3. **执行**：按 `semantic-diff` 的矩阵运行项目原有工程命令，记录命令、revision、退出码和覆盖范围。

## 产物与长期证据

验证强度与原件是否进入 Git 分开判断。原始日志、完整结果、XML、进程快照、临时脚本、候选补丁、源码副本和中间清单统一写到 `.echo-semantic/local/<task-id>/`，或沿用 CI Artifact；不按命令次数创建长期 Evidence 或归档包，不要求归档 manifest。只为 Finding 修复与关闭、重要行为和公共契约、长期维护限制创建或更新相关 Evidence。

执行证据保留对象及场景、源码版本或内容身份、命令、必要环境、真实退出状态、关键结论、覆盖限制和原件定位。本地原件注明仅当前工作区可用，CI 原件指向具体运行及 Artifact；哈希只核对身份，不替代原件或证明命令已执行。原件失效时如实注明限制，不能伪造可恢复性或据此宣称新的验证通过。

任务收口将有效反例整理为正式回归测试，必要输入整理为精简脱敏 fixture；优先通过 Git revision 和路径引用源码，不复制旧源码和候选源码。保留本地产物，不自动清理或设置保留期限。目录名 evidence 或 docs 不能成为提交理由。

已获提交授权时，在暂存后运行 `python3 <插件路径>/scripts/artifact_contract.py --root <仓库绝对路径> --staged`；CI 用 `--base <Git基准>` 检查候选提交。确定运行态/local 路径失败，疑似日志只提示，正常 fixture 不按后缀禁止。检查不执行暂存、提交或安装 Git Hook，也不能保证识别任意命名的原始产物。

## 状态门禁

- `risk_accepted` 必须有人类裁决；
- `resolved` 必须有修复、验证和复审证据；
- 任务相关引用失效、失败命令和证据缺口保持未完成；全项目快照漂移和未分类路径在全项目治理结果中保持未完成，不自动使无关任务进入建库；
- `examined` 只表示列出的故障假设已检查，不表示没有缺陷。
- 删除变化还必须有已完成 repair Finding、授权 `deletePaths` 和 `behavior_equivalence` Evidence；逐场景结果不是 `matched` 时保持未完成。
- 连续性比较只允许 `preserved`、`replaced` 和 `retired`；`conflicted`、`missing`、`unknown` 或不可恢复 revision 必须失败关闭。
- 结果分支不能通过同步删除代码、测试和语义材料来覆盖父版本事实；连续性门禁直接读取 Git tree 中的前置语义义务。
- 替代必须绑定结果义务和等价 Evidence；退役与双侧冲突解决必须绑定可验证的 design/ADR 摘要、兼容影响和回滚信息。

高风险差异还要运行 `semantic-contract` 提供的变更依据校验。Skill 提示词、代码阅读或单次审查都不能单独作为
机器门禁通过证据。
