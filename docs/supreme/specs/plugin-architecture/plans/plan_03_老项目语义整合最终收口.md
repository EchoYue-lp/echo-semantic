---
schema_version: 3
lifecycle: completed
supersedes: plan:d45a3f8d-91a9-447f-9241-1db6b3402858
slug: plugin-architecture/semantic-consolidation-final
goal: 完成 Echo Semantic 面向老项目的语义资产盘点、候选归并、受控删除和行为等价验证闭环。
ships: 新增资产清单和归并候选产物、仓库维护与任务范围路由、受控删除授权、行为等价 Evidence 门禁，并保持 Codex、Cursor、Claude
  Code 现有适配兼容。
verify: npm test && npm run verify；通过无任务仓库维护、明确任务范围、重复候选、批准删除、未批准删除、行为不等价和宿主重入场景。
design_ref: docs/supreme/specs/plugin-architecture/design.md
delivery_ref: null
todos:
  - id: semantic-consolidation-final
    files:
      - skills/semantic-contract/scripts/verify_semantic.py
      - skills/semantic-discover/scripts/inventory.py
      - skills/semantic-consolidate/scripts/consolidate.py
      - skills/semantic-repair/SKILL.md
      - hooks/entry.mjs
      - runtime/route.mjs
      - tests/test_inventory.py
      - tests/test_consolidate.py
      - tests/test_equivalence.py
      - tests/hooks.test.mjs
      - tests/route.test.mjs
    summary: 完成老项目语义整合闭环并通过最终门禁
    verify: 所有新增场景、静态合同、三端清单和仓库规定的 npm 门禁通过。
artifact_id: plan:e73dd1b2-85d2-4a68-8305-cb8ed1ba89ae
design_revision: sha256:80f6771b62b1aea3d410675fa325d2fee18129ede1a82c13bf8c550fa3a22ed4
---

## Design Binding Evidence

`design_revision` 使用 Supreme `computeDesignRevision` 对 `design_ref` 设计源包的路径和内容摘要计算，不等同于单文件
`sha256sum`。交付前使用 `plan-artifact.mjs validate` 校验该绑定和章节引用。

## Approach

在现有 `.echo-semantic/` 单一权威和共享宿主控制面上完成 Asset 盘点、候选 Finding、受控 Delete 和行为等价 Evidence。没有明确任务时使用 `maintenance` 执行全仓已完成代码的语义操作；明确任务时只读取当前预检允许路径。Codex、Cursor、Claude Code 的 Agent/manifest 投影保持兼容。

## Global Constraints

- 不引入数据库、常驻服务、MCP Server 或第二任务状态机。
- 静态候选和测试结果不构成绝对等价；动态未知保持 `needs_review` 或阻断删除。
- 删除必须绑定已完成 Finding、`repairRefs`、`deletePaths`、替换关系、回滚点和等价 Evidence。
- 只追加必要的 Skill/Hook 能力，不重写现有宿主事件和 Agent 适配。

## Files

- Modify: `skills/semantic-contract/scripts/verify_semantic.py` — 校验 Asset、候选、删除差异和等价 Evidence。
- Create: `skills/semantic-discover/scripts/inventory.py` — 生成全仓或任务范围资产清单。
- Create: `skills/semantic-consolidate/scripts/consolidate.py` — 生成等待人工决策的候选 Finding。
- Create: `skills/semantic-repair/SKILL.md` — 规范批准后的替换和删除。
- Modify: `hooks/entry.mjs`, `runtime/route.mjs` — 执行范围路由和删除/Stop 门禁。
- Create: `tests/test_inventory.py`, `tests/test_consolidate.py`, `tests/test_equivalence.py`; Modify: `tests/hooks.test.mjs`, `tests/route.test.mjs` — 覆盖新增场景。

## Reuse

- `skills/semantic-discover/SKILL.md`、`skills/semantic-diff/SKILL.md`、`skills/semantic-audit/SKILL.md`、`skills/semantic-verify/SKILL.md` — 复用现有语义生命周期。
- `hooks/hooks.json`、`hooks/hooks-cursor.json` — 保持现有宿主适配和 Agent 投影。

## Todos

### semantic-consolidation-final

requirements:
- § 问题与目标
- § 目标行为
- § 主工作流
- § 验收标准
- 用户需求：本次迭代必须完成四项能力并保持 Codex、Cursor 适配不被破坏。

interfaces:
- consumes: 最终设计、当前语义合同、Git 路径和现有宿主适配
- produces: 资产清单、候选 Finding、删除授权、等价 Evidence、维护/任务路由和最终验证证据

steps:

1. 完成四项能力及其合同、文档、测试和 self-baseline，同步当前源码摘要。
   verify: Asset、候选、删除和等价证据均可由 verifier 读取，未知动态路径不会自动放行。
   expected: 老项目可以按候选、人工决策、修复切片和等价证据逐步收敛。

2. 执行最终工程和语义门禁。
   verify: `npm test && npm run verify`
   expected: 全部格式、合同、测试、分发、自测和严格快照通过，宿主适配回归保持通过。
