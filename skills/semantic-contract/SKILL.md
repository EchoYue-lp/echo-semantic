---
name: semantic-contract
description: >-
  为其它语义治理 Skill 提供唯一对象、引用、快照、路径分类和确定性变更门禁合同；仅在创建、更新或校验
  `.echo-semantic/` 材料时使用，不负责判断业务行为是否正确或替代普通代码审查。
---

# 语义材料合同

本 Skill 只处理可确定验证的结构和 Git 事实，不判断业务行为是否正确，不创建运行时存储或调度器；它会校验 Asset、归并候选、删除授权、等价 Evidence 和语义连续性 Evidence 的结构闭合。

## 日常任务验证

本地产物位于 `.echo-semantic/local/<task-id>/`，不是语义对象或源码引用，且不得被 Git 跟踪。确定性产物检查复用 `scripts/artifact_contract.py`：`--staged` 读取索引，`--base <revision>` 读取候选提交。运行态与 local 路径阻断；疑似原始日志仅提示。正常 JSON、XML 或日志格式 fixture 仍按项目契约维护。长期 Evidence 的详细规则见材料合同。

有无基线均使用任务入口，不读取全仓摘要或无关对象：

```bash
uv run scripts/verify_semantic.py --root <仓库绝对路径> --task-scope \
  --task-id <当前任务标识> --base <预检基准> --require-change-evidence
```

存在已有差异时增加 `--session-id <真实宿主会话标识>`，复用会话策略核对受保护差异；不得自行传入排除路径绕过检查。输出 JSON 明确 `scope: task`、实际变化、相关依据、内容签名和 `globalClosure: not_checked`。局部通过不代表全项目闭合。未记录的消费者与动态入口仍需要调查，机器不会证明调查充分。

Baseline 更新或明确的全项目完成任务，预检 record 须显式提供 `--verification-scope repository`，然后用 `--repository-scope` 替换 `--task-scope`，保持 task-id、base 和 session-id。校验器先核对任务授权、保护差异和同次高风险依据，再运行全项目严格结构/引用/快照校验，输出 `scope: repository` 和 `repositorySnapshot`，内容签名额外绑定全仓源码与正式语义材料。范围必须与预检一致，不自动扩大普通任务；没有 Baseline 时失败而不建库。该结果仍不证明行为模型全局闭合。

## 显式全项目工作流

1. 创建或解释语义对象时读取 [语义材料合同](references/semantic-artifact-contract.md)。
2. 在本 Skill 根目录校验目标仓库：

```bash
uv run scripts/verify_semantic.py --root <仓库绝对路径> --strict-snapshot
```

3. 校验代码差异和高风险依据：

```bash
uv run scripts/verify_semantic.py --root <仓库绝对路径> --strict-snapshot \
  --base <基准 revision> --require-change-evidence
```

4. 修改校验器后运行：

```bash
uv run scripts/verify_semantic.py --self-test
```

5. 对多前置版本执行连续性门禁：

```bash
uv run scripts/verify_semantic.py --root <仓库绝对路径> \
  --continuity-merge-base <共同基准> \
  --continuity-predecessor <目标分支> \
  --continuity-predecessor <来源分支> \
  --continuity-result <候选结果> \
  --continuity-report <报告路径>
```

连续性模式直接读取 Git tree，输出稳定义务身份、规范化指纹和处置状态；不执行 Git merge，不把机器报告保存成第二套长期权威。

## 输出

返回合同版本、检查范围、错误列表、退出码和不能证明的内容。通过只代表结构、引用、路径、快照和变更依据满足合同，
不代表业务正确、审查充分或仓库没有缺陷。

## 扫描报告合同

独立 Discovery `scan_report` 不要求正式基线。使用 `inventory.py --check-report` 核对内嵌候选、路径身份、快照、范围与仓库身份；实际用户确认后使用 `--confirm-report` 重算当前源码。完整校验器同时检查报告结构，但报告不成为正式资产或行为闭合证据。后续基线维护继续通过预检、正式语义验证与工程验证。
