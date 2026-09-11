---
name: semantic-repair
description: >-
  编排已批准的语义归并、替换、重构和删除切片，将 repair 引用、删除范围、回滚点和行为等价证据绑定到预检、Hook、Stop 与 CI；
  不执行未经批准的批量删除。
---

# 受控语义修复

本 Skill 把人工确认后的归并决定转换为可执行的小切片，重点保护真实调用方、唯一状态权威和失败恢复。

## 入口门禁

- 读取已解析的 `consolidation_candidate` Finding，状态必须表示已批准的 `merge`、`migrate` 或 `retire` 决定。
- 读取受影响 Behavior、Rule、Evidence、design/ADR 和当前 HEAD；缺少任一项时停止。
- 为每个切片在 Finding 中明确 `delete_paths`、`replacement_refs`、`rollback_ref`、替换实现、调用方切换顺序和验证命令。

## 执行顺序

1. 先让真实生产调用方指向 canonical owner；
2. 再删除旧注册、旧实现、旧协议字段、无效测试和过时文档；
3. 每个切片单独运行项目工程工具和行为等价场景；
4. 更新 repair Finding、Evidence、Behavior 和 Discovery 引用；
5. 完成后调用 `semantic-verify`，由 Stop/CI 重新检查最终差异。

删除必须通过 `semantic-preflight` 的 `repairRefs` 和 `deletePaths` 授权。编辑前 Hook 只允许命中授权路径；Shell 批量删除无法被
编辑前 Hook 捕获时，必须由 Stop/CI 的删除差异门禁阻断。

删除对应的 `behavior_equivalence` Evidence 必须绑定 `before_revision`、`after_revision`、`deleted_paths` 和逐场景
`matched` 结果；任何 Discovery `unresolved` 或 Asset `needs_review` 都会阻断删除，直到未知项被闭合。

## 失败与回滚

- 等价场景失败、动态路径未知、调用方仍指向旧实现或工程命令失败时保持 Finding 未完成；
- 不把静态无引用解释成运行时不可达；
- 保留可回滚提交或明确恢复步骤，不通过删除语义对象或关闭 CI 绕过失败；
- `resolved` 只有在修复、验证和复审证据齐全后才允许。

本 Skill 不替人决定是否删除能力，也不创建常驻服务、任务队列或第二套修复状态机。
