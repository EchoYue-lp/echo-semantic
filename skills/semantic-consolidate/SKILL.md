---
name: semantic-consolidate
description: >-
  将语义资产盘点结果归并为可审阅的候选簇和 canonical owner 决策，覆盖重复实现、平行状态权威、包装链和过时代码；
  不自动合并或删除代码，证据不足时进入 semantic-decide。
---

# 语义候选归并

本 Skill 处理“多个实现是否表达同一语义”这一判断，不执行 Git merge，不直接修改业务代码。

## 入口门禁

- 先运行 `semantic-contract`，确认当前 Baseline、asset 对象和源码引用有效。
- 先读取 `semantic-discover` 的 Discovery 和 `.echo-semantic/assets/`，不得只按文件名判断重复。
- 每个候选必须绑定同一语义边界、源码 revision、调用消费者、状态权威和测试/运行证据。

## 候选分组

按以下信号形成候选簇，并保留信号来源：

1. 相同或近似稳定身份、公开符号和注册入口；
2. 相同 Behavior、协议字段、状态存储或外部副作用；
3. 调用方、权限、持久化和失败恢复路径重叠；
4. 包装层只做转换且没有重新拥有状态、重试或终态语义；
5. 静态相似但运行时路径或产品期望未知。

静态相似只能产生候选，不能直接得出等价结论。动态调用、反射、配置路由和生成代码无法确认时写入 `needs_review`。

## 决策

为每个候选写入 Finding，至少包含：

- `candidate_asset_refs`：候选资产；
- `canonical_asset_ref`：拟保留的唯一实现；
- `decision`：`keep`、`merge`、`migrate`、`retire` 或 `defer`；
- 当前行为差异、调用方、迁移顺序、删除目标和证据限制。

`merge`、`migrate` 和 `retire` 必须先经过人的期望确认；产品语义冲突或风险接受进入 `semantic-decide`。未决 Finding 不得被
`semantic-repair` 当作删除授权。

## 衔接

1. 候选形成后调用 `semantic-audit` 审查高风险边界；
2. 需要修改实现时进入正式 design/ADR 和 `semantic-preflight`；
3. 代码形成差异后调用 `semantic-diff`；
4. 删除或替换完成后调用 `semantic-repair` 和 `semantic-verify`。

本 Skill 不创建第二套候选数据库或架构文档。
