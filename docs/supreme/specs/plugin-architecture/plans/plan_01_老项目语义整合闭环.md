---
schema_version: 3
lifecycle: superseded
supersedes: null
slug: plugin-architecture/semantic-consolidation
goal: 为 Echo Semantic 增加面向老项目的语义资产盘点、候选归并、受控删除和行为等价验证闭环。
ships: 新增资产与归并候选产物、受控删除授权和行为等价证据门禁，并通过 Codex、Cursor、Claude Code 的统一语义工作流阻止缺少依据的清理。
verify: npm test && npm run verify；同时通过重复候选、批准删除、未批准删除和行为不等价的端到端测试夹具。
design_ref: docs/supreme/specs/plugin-architecture/design.md
delivery_ref: null
todos:
  - id: architecture-and-contracts
    files:
      - docs/supreme/specs/plugin-architecture/design.md
      - docs/adr/0002-semantic-consolidation.md
      - skills/semantic-contract/references/semantic-artifact-contract.md
    summary: 收敛语义整合架构和长期对象合同
    verify: 设计、ADR 和对象合同明确四项能力的边界、状态、证据和人工裁决点。
  - id: asset-inventory-and-consolidation
    files:
      - skills/semantic-discover/scripts/inventory.py
      - skills/semantic-discover/SKILL.md
      - skills/semantic-consolidate/SKILL.md
      - skills/semantic-diff/SKILL.md
      - skills/semantic-status/SKILL.md
      - skills/semantic-status/scripts/status.py
      - tests/test_inventory.py
      - tests/status.test.mjs
      - .echo-semantic/assets/.gitkeep
    summary: 生成语义资产和候选归并报告
    verify: 给定重复实现、多个入口和未知动态调用的夹具时，输出稳定资产身份、候选簇、canonical 候选和 needs_review 限制。
  - id: controlled-repair-and-delete
    files:
      - skills/semantic-repair/SKILL.md
      - skills/semantic-preflight/SKILL.md
      - skills/semantic-preflight/scripts/preflight.py
      - scripts/preflight_contract.py
      - hooks/entry.mjs
      - hooks/hooks.json
      - runtime/route.mjs
      - tests/test_preflight.py
      - tests/test_preflight_contract.py
      - tests/hooks.test.mjs
      - tests/route.test.mjs
    summary: 把批准的修复和删除绑定到预检与 Hook
    verify: 没有批准修复引用或删除路径不在授权范围时，编辑前 Hook 和停止门禁均阻断；批准的小切片可继续并保留重试能力。
  - id: equivalence-verification-and-gates
    files:
      - skills/semantic-verify/SKILL.md
      - skills/semantic-contract/scripts/verify_semantic.py
      - action.yml
      - tests/test_equivalence.py
    summary: 验证删除前后的行为等价证据
    verify: 删除候选缺少逐场景等价证据、命令结果或限制说明时严格校验失败；覆盖场景的证据齐全且工程命令通过时门禁放行。
  - id: host-docs-and-self-baseline
    files:
      - .codex-plugin/plugin.json
      - .cursor-plugin/plugin.json
      - scripts/validate-plugin.mjs
      - package.json
      - scripts/validate-package.mjs
      - README.md
      - docs/concepts.md
      - docs/command-reference.md
      - docs/ci-integration.md
      - docs/faq.md
      - .echo-semantic/README.md
      - .echo-semantic/baseline.md
      - .echo-semantic/maps/map.semantic-workflow.md
      - .echo-semantic/maps/map.semantic-consolidation.md
      - .echo-semantic/behaviors/behavior.semantic-consolidation.md
      - .echo-semantic/evidence/evidence.semantic-consolidation.md
      - tests/manifests.test.mjs
    summary: 接入三端发现、文档、分发和插件自身基线
    verify: 三端清单发现新增 Skill，分发包包含长期对象合同而不包含运行态，插件自身基线和文档能描述并通过新增闭环。
artifact_id: plan:459402ac-b4be-42a7-a33f-c3d4d3f6cec0
design_revision: sha256:34180cdcaf6ff6132a3400719b84a02d2cefa70e5ae2fb31648091299e49f06d
---

## Approach

在现有 `semantic-discover`、`semantic-diff`、`semantic-audit`、`semantic-verify` 链路上增加两个用户入口：`semantic-consolidate` 负责把资产盘点结果归并为带证据的候选和人工决策，`semantic-repair` 负责把已批准的替换、重构和删除切片绑定到 `semantic-preflight`、编辑前 Hook、Stop 和 CI。资产使用新的 `asset` 对象；候选归并复用 `Finding` 生命周期；行为等价复用 `Evidence`，但增加 before/after revision、场景矩阵、命令结果和限制字段。静态扫描只产生候选，不自动宣称等价或删除；动态调用、反射和运行环境无法确定时保持 `needs_review`。

## Global Constraints

- `.echo-semantic/` 仍是采用方长期语义事实的唯一权威；产品和架构选择仍归采用方 design/ADR，当前任务不建立第二知识库。
- 不引入数据库、常驻服务、MCP Server、独立任务运行时或隐藏遥测；扫描器使用 Node/Python 现有短进程和项目提供的工程命令。
- `skills/`、`agents/`、`hooks/`、`scripts/` 的可读内容使用中文；`semantic-consolidate`、`semantic-repair`、路径和字段名作为固定协议标识保持原样；不使用 `Worker` 表示执行角色。
- 任何删除都必须绑定已批准的 repair/Finding、明确路径或符号范围、替换关系、回滚点和行为等价证据；无法确认的产品预期必须进入 `semantic-decide`。
- 静态候选、覆盖测试和等价证据只证明已检查的场景，不输出“安全”“绝对等价”或“没有缺陷”；未知动态路径必须阻断删除或保持 `needs_review`。
- formatter、Lint、类型、单元、契约、集成和 CI 仍是实现质量权威；语义校验器只验证结构、引用、快照、变更依据和证据闭合。
- 长期语义对象提交 Git，运行态仍只限于既有 `.echo-semantic/status.md`、`status.json`、`preflight.json`、`route.json`、`continuation.json` 五个文件并写入 `.git/info/exclude`。
- 宿主适配继续保持薄层；新增入口必须同时接入 Codex、Cursor、Claude Code 的发现清单，真实宿主生命周期证据与静态清单验证分开报告。

## Files

- Modify: `docs/supreme/specs/plugin-architecture/design.md` — 增加老项目语义整合目标、边界、状态流和验收标准。
- Create: `docs/adr/0002-semantic-consolidation.md` — 记录资产、归并、受控删除和等价证据的架构取舍。
- Modify: `skills/semantic-contract/references/semantic-artifact-contract.md` — 定义 `asset` 对象以及 Finding/Evidence 的归并和等价字段。
- Create: `skills/semantic-discover/scripts/inventory.py` — 生成稳定资产身份、来源和候选线索。
- Modify: `skills/semantic-discover/SKILL.md` — 把资产盘点纳入发现完成条件。
- Create: `skills/semantic-consolidate/SKILL.md` — 归并候选、canonical owner 和人工决策入口。
- Modify: `skills/semantic-diff/SKILL.md` — 追踪候选簇、删除影响和 stale 关系。
- Modify: `skills/semantic-status/SKILL.md` — 展示资产、候选、待修复和等价验证 Frontier。
- Modify: `skills/semantic-status/scripts/status.py` — 汇总新增对象和阻断原因。
- Create: `skills/semantic-repair/SKILL.md` — 编排批准后的修复、替换和受控删除。
- Modify: `skills/semantic-preflight/SKILL.md` — 增加 repair 引用、删除目标和回滚要求。
- Modify: `skills/semantic-preflight/scripts/preflight.py` — 记录受控删除参数和语义引用。
- Modify: `scripts/preflight_contract.py` — 校验删除授权、修复引用和高风险信号。
- Modify: `hooks/entry.mjs` — 阻断未授权 Delete，并在 Stop 时传递删除证据门禁。
- Modify: `hooks/hooks.json` — 为 Claude Code 编辑前 Hook 纳入 Delete 事件。
- Modify: `runtime/route.mjs` — 在严格路由中加入归并和修复入口。
- Modify: `skills/semantic-verify/SKILL.md` — 定义删除和等价证据收口。
- Modify: `skills/semantic-contract/scripts/verify_semantic.py` — 校验资产、删除差异、归并决策和逐场景等价证据。
- Modify: `action.yml` — 在 CI 中启用删除和等价证据门禁。
- Modify: `.codex-plugin/plugin.json` — 补充归并和修复的默认入口文案。
- Modify: `.cursor-plugin/plugin.json` — 暴露新增 Skill 路径。
- Modify: `scripts/validate-plugin.mjs` — 扩展静态 Skill 合同集合。
- Modify: `package.json` — 发布资产对象目录和新增 Skill 资源。
- Modify: `scripts/validate-package.mjs` — 检查资产目录和新增资源进入分发包。
- Modify: `README.md` — 更新能力表、主工作流和老项目采用说明。
- Modify: `docs/concepts.md` — 更新对象、状态和删除证据概念。
- Modify: `docs/command-reference.md` — 增加盘点、归并、修复和等价验证命令。
- Modify: `docs/ci-integration.md` — 说明删除差异的 CI 门禁和证据要求。
- Modify: `docs/faq.md` — 说明候选不是自动删除、静态无引用不是运行时不可达。
- Modify: `.echo-semantic/README.md` — 更新插件自身对象合同说明。
- Modify: `.echo-semantic/baseline.md` — 更新新增路径、映射和当前源码快照。
- Modify: `.echo-semantic/maps/map.semantic-workflow.md` — 连接新增入口和现有工作流。
- Create: `.echo-semantic/maps/map.semantic-consolidation.md` — 记录老项目整合能力图。
- Create: `.echo-semantic/behaviors/behavior.semantic-consolidation.md` — 记录候选归并和人工裁决行为。
- Create: `.echo-semantic/evidence/evidence.semantic-consolidation.md` — 记录扫描、删除和等价验证限制。
- Create: `.echo-semantic/assets/.gitkeep` — 保持资产对象目录可被合同校验和分发。
- Create: `tests/test_inventory.py` — 覆盖资产身份、候选线索和未知区。
- Create: `tests/test_equivalence.py` — 覆盖删除前后等价证据门禁。
- Modify: `tests/test_preflight.py` — 覆盖受控删除预检参数。
- Modify: `tests/test_preflight_contract.py` — 覆盖删除授权和修复引用合同。
- Modify: `tests/hooks.test.mjs` — 覆盖 Delete 阻断、批准删除和 Stop 重试。
- Modify: `tests/route.test.mjs` — 覆盖严格路由的新入口。
- Modify: `tests/status.test.mjs` — 覆盖新增 Frontier。
- Modify: `tests/manifests.test.mjs` — 覆盖三端新增 Skill 发现。

## Reuse

- `skills/semantic-discover/SKILL.md` — 基线、路径分类和未知区 — 作为资产盘点的入口与事实边界。
- `skills/semantic-diff/SKILL.md` — 直接变化和影响闭包 — 作为归并候选、删除路径和 stale 传播的增量来源。
- `skills/semantic-audit/SKILL.md` — 边界 × 风险视角 × revision 审查 — 作为高风险归并和删除的只读复核，不新增第二种审查协议。
- `skills/semantic-verify/SKILL.md` — 三层验证与 Finding 关闭条件 — 作为等价证据和修复完成的收口。
- `skills/semantic-contract/scripts/verify_semantic.py` — 对象、关系、快照、路径和变更依据校验 — 扩展而非平行实现机器门禁。
- `hooks/entry.mjs#checkEditScope`、`hooks/entry.mjs#stop` — 现有编辑范围和 Stop 生命周期 — 增加删除授权检查，保留失败重试和宿主降级行为。
- `runtime/route.mjs#computeRoute` — 现有风险路由 — 仅在 strict 生产差异路径加入归并和修复入口。
- `scripts/preflight_contract.py`、`skills/semantic-preflight/scripts/preflight.py` — 当前任务合同和 HEAD 新鲜度 — 扩展 repair 引用与删除范围，不建立新运行态权威。
- `action.yml` — 独立 CI 语义门禁 — 复用 GitHub Action 收口删除和等价证据。

## Todos

### architecture-and-contracts

requirements:

- § 问题与目标
- § 范围与非目标
- 用户需求：四项能力必须服务于老项目 AI 代码整合，不移除现有语义治理能力。

interfaces:

- consumes: `docs/supreme/specs/plugin-architecture/design.md`、现有八类语义对象合同和 `.echo-semantic/` 单一权威规则
- produces: 新设计边界、ADR 决策和可供 verifier/Skills 共同读取的 `asset`、归并候选、repair 与行为等价字段合同

steps:

1. 更新架构设计和 ADR，明确资产身份、候选归并、canonical owner、人工裁决、修复状态、删除授权、等价场景和失败降级，并保留无数据库、无常驻服务、无第二权威的边界。
   verify: `design.md` 与 ADR 能分别说明目标行为、非目标、状态权威、生命周期、权限、失败恢复和验收标准
   expected: 新能力在现有 `discover → preflight → diff → audit → verify → CI` 链路中有唯一入口和明确退出条件，未引入平行任务状态机。

2. 扩展语义材料合同：增加 `asset` 对象；为 `Finding` 增加候选簇、canonical 决策和删除目标字段；为 `Evidence` 增加 before/after revision、场景矩阵、工程命令结果和限制字段；规定未知动态路径必须保持 `needs_review`。
   verify: `semantic-artifact-contract.md` 的字段、状态、引用类型和禁止绝对结论规则与设计/ADR 一致
   expected: 后续 Skill、Hook、verifier 和 CI 可以引用同一组长期对象，不需要再创建第二套候选或修复数据库。

### asset-inventory-and-consolidation

requirements:

- § 主工作流
- § 状态流转
- 用户需求：盘点老项目的语义资产并输出可审阅的候选归并，而不是只报告路径差异。

interfaces:

- consumes: `semantic-discover` 基线、Git 路径和源码快照；`architecture-and-contracts` 产出的 asset 字段合同
- produces: `.echo-semantic/assets/*.md`、归并候选 Finding、canonical owner 候选和 `semantic-status` 可读 Frontier

steps:

1. 实现语言无关的资产扫描器，稳定识别文件、公开符号、入口注册、状态存储、协议/序列化字段、测试消费者和文档引用；对无法静态确定的反射、动态注册、运行时配置和生成代码写入未知项与限制。
   verify: `tests/test_inventory.py` 的夹具可重复生成相同 asset ID、来源引用、消费者关系和未知列表
   expected: 同一 revision 重跑结果稳定；重复名称或相似实现只生成候选，不直接合并或删除。

2. 扩展 `semantic-discover` 和新增 `semantic-consolidate`，按资产身份、行为引用、状态权威、调用消费者和证据把候选聚类，要求人选择保留、合并、迁移、退役或暂缓，并把无法确定的产品差异交给 `semantic-decide`。
   verify: 候选 Finding 包含 candidate asset refs、canonical 候选、决策状态、影响范围、证据和未知限制
   expected: 归并结果可追溯到资产与源码 revision；没有人工决策的候选保持 open/needs_review，不会进入删除授权。

3. 扩展 `semantic-diff` 和 `semantic-status`，在分支或工作树变化后传播受影响候选、删除目标和 stale 证据，并显示待归并、待裁决和待验证 Frontier。
   verify: 差异命中候选资产时状态输出包含受影响 Finding 和唯一下一入口
   expected: 普通文档变化仍走轻量路径，生产源码或候选归并变化升级 strict，不因候选未命中而解释成无语义影响。

### controlled-repair-and-delete

requirements:

- § 高风险变更时序
- § 异常与降级
- § 权限与敏感信息
- 用户需求：删除 AI 生成的旧实现必须可控、可回滚并绑定明确授权。

interfaces:

- consumes: 已批准的归并 Finding、候选 asset refs、替换关系和 `semantic-preflight` 当前 HEAD
- produces: 带 repair 引用和 delete targets 的 preflight、编辑前 Delete 阻断结果、可重试的 Stop 失败原因

steps:

1. 扩展 `semantic-preflight` 记录 `repairRefs`、`deletePaths`/符号目标、替换实现、回滚点和 controlled-deletion 高风险信号；合同要求 repair 引用存在、状态已批准、HEAD/仓库新鲜且删除范围非空。
   verify: `tests/test_preflight.py` 与 `tests/test_preflight_contract.py` 覆盖缺失授权、过期 HEAD、越界路径、空删除范围和有效批准记录
   expected: 未经批准的删除预检无法被记录为有效；普通 refactor/bugfix 预检不被迫填写删除字段。

2. 扩展三端 Hook 生命周期：Claude Code `PreToolUse` 纳入 Delete；`hooks/entry.mjs#checkEditScope` 对删除工具同时检查有效 repair 引用和 delete targets；无法判定工具或路径时保守阻断或交给 Stop/CI 收口。
   verify: `tests/hooks.test.mjs` 覆盖 Cursor/Claude Delete 的允许、拒绝、仓库外路径和失败后重试
   expected: 未授权 Delete 返回明确原因；批准范围内的 Delete 只允许修改目标路径，已有 Write/Edit 范围规则保持不变。

3. 扩展 `runtime/route.mjs` 的 strict 路由和 Stop 变更收口，把候选归并和受控修复作为高风险入口；处理 Shell 批量删除无法被编辑前 Hook 捕获的情况。
   verify: `tests/route.test.mjs` 和 Stop 夹具能识别包含删除的工作树，并要求 repair/equivalence 证据
   expected: 编辑前漏捕获的删除不会绕过 Stop/CI；失败保留预检供修复重试，成功只消费当前任务短期状态。

### equivalence-verification-and-gates

requirements:

- § 数据流与信任边界
- § 关键取舍
- § 验收标准
- 用户需求：删除前必须验证替换前后的可观察行为等价，且明确验证范围与剩余未知。

interfaces:

- consumes: repair Finding、Before/After revision、Behavior 场景、项目工程命令结果和 `semantic-audit`/`semantic-decide` 证据
- produces: 等价 Evidence、删除差异验证结果、Stop/CI 可确定阻断和可审阅限制列表

steps:

1. 在 `semantic-verify` 与 `verify_semantic.py` 中实现等价 Evidence 校验：每个删除目标必须关联受影响 Behavior、before/after revision、场景矩阵、实际命令与退出结果、覆盖范围和限制；不把静态无引用当作运行时不可达。
   verify: `tests/test_equivalence.py` 覆盖缺 Evidence、revision 不匹配、场景遗漏、失败命令、动态未知和完整证据
   expected: 任何删除目标缺少逐场景证据或限制说明都失败；完整证据只说明测试覆盖范围内匹配，不输出绝对安全结论。

2. 让 CI Action 和 Stop 在检测到删除、替换公共入口、状态权威或协议时自动要求变更依据和等价 Evidence；保持项目 formatter、Lint、类型、单元、契约和集成测试为独立必需门禁。
   verify: `action.yml` 与 verifier 参数/退出码一致，删除失败原因包含目标、缺少的语义对象和下一步入口
   expected: 本地 Hook、独立 CI 和手工 verifier 对同一差异得出一致阻断结论，CI 不接受 `continue-on-error` 或删除材料来绕过失败。

### host-docs-and-self-baseline

requirements:

- § 仓库结构
- § 组件职责
- § 复用与实现约束
- § 已知限制
- 用户需求：新增能力必须对三端可发现、可解释、可验证，且不改变现有宿主边界。

interfaces:

- consumes: 前四个 Todo 的 Skill、对象合同、Hook、verifier 和状态输出
- produces: 三端清单/分发包、文档、插件自身 `.echo-semantic/` 基线和全量回归证据

steps:

1. 将 `semantic-consolidate`、`semantic-repair` 接入 Codex/Cursor/Claude Code 的发现投影，更新静态合同、分发包白名单和安装回归；保持 Agent 只读角色边界，不把修复 Skill 伪装成强制执行器。
   verify: `tests/manifests.test.mjs`、`scripts/validate-plugin.mjs` 和 `scripts/validate-package.mjs` 能发现新增入口并排除运行态文件
   expected: 三端看到相同 Skill 真理源；包内包含长期对象合同和资产目录，不包含五个运行态文件或 Python 缓存。

2. 更新 README、概念、命令、CI、FAQ 和插件自身语义材料，描述候选、人工裁决、受控删除、等价证据和静态/运行时限制；同步 self-baseline 的源码摘要、路径分类、Capability Map、Behavior、Rule、Evidence 和 discovery。
   verify: 文档与 `.echo-semantic/` 严格快照校验通过，内容没有“安全”“绝对等价”之类绝对结论
   expected: 新会话可以从文档和状态输出找到盘点、归并、修复、验证的唯一入口；插件自身 behavior model 和新增对象关系闭合到真实实现。

3. 在干净依赖环境执行仓库规定的全量门禁，并分别记录静态清单结果、Hook 真实宿主证据和 CI 结果；不把尚未完成的 GUI/新会话验收写成已验证。
   verify: `npm test && npm run verify`
   expected: Node/Python 回归、格式检查、插件合同、分发包检查、语义自测和严格快照全部通过；真实宿主缺口仍单独列出。

## Decisions

- 四项能力作为一个完整交付结果，不拆成只交付盘点或只交付删除的临时 Plan；单独盘点结果不能闭合用户要解决的架构整合问题。
- 不新增独立 `semantic-inventory` Skill；资产盘点扩展 `semantic-discover`，减少入口分裂；候选归并和受控修复各有一个明确入口。
- 不实现自动 Git merge 或无监督批量删除；“语义合并”指候选归并、canonical owner 决策和变更影响分析，Git 合并仍由 Git 执行并由 Echo Semantic 门禁复核。
- 不追求形式化行为等价证明；以 Behavior 场景、前后 revision、工程命令结果、覆盖范围和限制组成可反证证据，动态未知项必须阻断删除或请求人工裁决。
- 复用现有 Finding 的 open/resolved/risk_accepted 生命周期和 Evidence 的限制字段，不创建第二套修复数据库或任务状态机。
