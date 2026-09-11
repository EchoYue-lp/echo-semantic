---
schema_version: 3
lifecycle: superseded
supersedes: plan:459402ac-b4be-42a7-a33f-c3d4d3f6cec0
slug: plugin-architecture/semantic-consolidation-closeout
goal: 完成 Echo Semantic 面向老项目的语义资产盘点、候选归并、受控删除和行为等价验证闭环。
ships: 新增资产清单和归并候选产物、仓库维护与任务范围路由、受控删除授权、行为等价 Evidence 门禁，并保持 Codex、Cursor、Claude
  Code 现有适配兼容。
verify: npm test && npm run verify；通过无任务仓库维护、明确任务范围、重复候选、批准删除、未批准删除、行为不等价和宿主重入场景。
design_ref: docs/supreme/specs/plugin-architecture/design.md
delivery_ref: null
todos:
  - id: semantic-consolidation-closeout
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
    summary: 交付老项目语义整合闭环并完成验证
    verify: 所有新增场景和仓库规定的 npm 门禁通过，适配清单和 Agent 投影保持兼容。
artifact_id: plan:d45a3f8d-91a9-447f-9241-1db6b3402858
design_revision: sha256:269c0a13240d9fe0473555178f6e683fe96fa5d08956fdbcb99521d311f81be2
---

## Approach

复用现有 `.echo-semantic/` 唯一权威和 `discover → preflight → diff → audit → verify → CI` 链路。`semantic-discover` 生成稳定 Asset 和未知项，`semantic-consolidate` 将候选写成延后决策 Finding，`semantic-repair` 绑定批准的替换、删除范围和回滚点，`semantic-verify` 校验逐场景行为等价 Evidence。没有明确任务时路由到 `maintenance` 执行全仓语义维护；明确任务时只处理有效预检允许路径。

## Global Constraints

- 不建立第二套语义权威、数据库、常驻服务、MCP Server 或独立任务运行时。
- 静态相似、无引用和测试通过都不能单独证明等价或可删除；动态未知保持 `needs_review` 或阻断。
- Delete 必须绑定已批准 Finding、`repairRefs`、`deletePaths`、替换关系、回滚点和等价 Evidence。
- 现有 Codex、Cursor、Claude Code manifest、Agent 投影、事件字段和 Hook 输出协议保持兼容；仅追加必要 Skill/事件能力。
- `skills/`、`agents/`、`hooks/`、`scripts/` 的可读内容使用中文；工程测试仍是实现质量权威。

## Files

- Modify: `skills/semantic-contract/scripts/verify_semantic.py` — 校验 Asset、归并 Finding、删除差异和等价 Evidence。
- Create: `skills/semantic-discover/scripts/inventory.py` — 生成稳定资产清单和任务范围报告。
- Create: `skills/semantic-consolidate/scripts/consolidate.py` — 将候选簇写成等待人工决策的 Finding。
- Create: `skills/semantic-repair/SKILL.md` — 编排批准后的替换和受控删除。
- Modify: `hooks/entry.mjs` — 检查 Delete 授权和重复 Stop 验证收据。
- Modify: `runtime/route.mjs` — 提供 maintenance/task 范围路由和内容指纹。
- Create: `tests/test_inventory.py`, `tests/test_consolidate.py`, `tests/test_equivalence.py` — 覆盖资产、归并和等价门禁。
- Modify: `tests/hooks.test.mjs`, `tests/route.test.mjs` — 覆盖 Delete、Stop 重入、宿主范围和维护路由。

## Reuse

- `skills/semantic-discover/SKILL.md` — 复用基线、路径分类和未知区。
- `skills/semantic-diff/SKILL.md` — 复用差异影响闭包和 stale 传播。
- `skills/semantic-audit/SKILL.md` — 复用高风险边界和可证伪故障假设。
- `skills/semantic-verify/SKILL.md` — 复用三层验证和 Finding 关闭条件。
- `hooks/hooks.json`、`hooks/hooks-cursor.json` — 保持宿主事件映射，仅增加必要 Delete 覆盖。

## Todos

### semantic-consolidation-closeout

requirements:

- § 问题与目标
- § 目标行为
- § 主工作流
- § 验收标准
- 用户需求：完成老项目语义整合闭环，同时保持 Codex、Cursor 适配不被破坏。

interfaces:

- consumes: 当前 `.echo-semantic/`、Git 路径、现有 Skill/Hook/校验器和项目 design/ADR
- produces: Asset、候选 Finding、repair 授权、等价 Evidence、maintenance/task 路由和全量验证证据

steps:

1. 实现并校验资产盘点、候选归并、受控删除和行为等价 Evidence，所有未知动态路径保留未决状态。
   verify: 盘点输出稳定，候选默认 defer，未批准删除失败，完整等价证据才通过。
   expected: 老项目清理可以按证据和小切片执行，不发生无监督合并或批量删除。

2. 接入仓库维护与任务范围路由，维护现有宿主适配和 Agent 投影。
   verify: 无明确任务进入 maintenance；明确任务只使用允许路径；Codex、Cursor、Claude Code 原有清单和事件测试通过。
   expected: 插件单独触发执行全仓语义操作，明确任务不会扩大到无关代码。

3. 执行项目规定的格式、静态合同、Node/Python 测试、分发包、严格快照和宿主缓存入口验证。
   verify: `npm test && npm run verify`
   expected: 所有门禁通过，真实宿主生命周期证据与静态清单结果分开记录。
