---
name: semantic-contract
description: >-
  为其它语义治理 Skill 提供唯一对象、引用、快照、路径分类和确定性变更门禁合同；仅在创建、更新或校验
  `.echo-semantic/` 材料时使用，不负责判断业务行为是否正确或替代普通代码审查。
---

# 语义材料合同

本 Skill 只处理可确定验证的结构和 Git 事实，不判断业务行为是否正确，不创建运行时存储或调度器；它会校验 Asset、归并候选、删除授权和等价 Evidence 的结构闭合。

## 工作流

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

## 输出

返回合同版本、检查范围、错误列表、退出码和不能证明的内容。通过只代表结构、引用、路径、快照和变更依据满足合同，
不代表业务正确、审查充分或仓库没有缺陷。
