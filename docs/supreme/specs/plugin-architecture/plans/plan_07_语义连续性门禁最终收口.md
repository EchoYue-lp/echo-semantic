---
schema_version: 3
supersedes: plan:06d5cf48-9670-4294-b799-10ee4ec99b10
slug: plugin-architecture/semantic-continuity-gate-final
goal: 实现跨 merge、rebase、squash、cherry-pick 和重构的语义连续性门禁，阻断未经解释的语义义务丢失。
ships: 在现有 semantic-diff、semantic-verify、verifier 和 CI Action 中交付多前置 revision
  义务比较、无自引用的可验证替代/退役处置、确定性报告和 Git DAG 回归。
verify: npm run verify；连续性 Git DAG 场景覆盖
  missing、conflicted、unknown、替代、退役、代码移动和测试同失；Codex/Cursor/Agent 适配文件零行为变化。
design_ref: docs/supreme/specs/plugin-architecture/design.md
delivery_ref: null
todos:
  - id: continuity-contract-engine
    files:
      - skills/semantic-contract/scripts/verify_semantic.py
      - skills/semantic-contract/references/semantic-artifact-contract.md
      - skills/semantic-contract/SKILL.md
      - tests/test_continuity.py
    summary: 实现多 revision 语义义务提取、指纹、比较和无自引用的防伪处置合同。
    verify: Git DAG 连续性核心场景通过。
  - id: continuity-cli-ci
    files:
      - skills/semantic-contract/scripts/verify_semantic.py
      - action.yml
      - tests/manifests.test.mjs
    summary: 把连续性比较接入兼容旧调用的 verifier CLI 和 GitHub Action。
    verify: CLI 与 Action 完整/部分输入场景通过。
  - id: continuity-guidance-tests-baseline
    files:
      - skills/semantic-diff/SKILL.md
      - skills/semantic-verify/SKILL.md
      - skills/semantic-contract/SKILL.md
      - skills/semantic-contract/references/semantic-artifact-contract.md
      - README.md
      - CHANGELOG.md
      - docs/ci-integration.md
      - docs/command-reference.md
      - tests/test_continuity.py
      - tests/manifests.test.mjs
      - package.json
      - .echo-semantic/baseline.md
      - .echo-semantic/maps/map.semantic-continuity.md
      - .echo-semantic/maps/map.semantic-workflow.md
      - .echo-semantic/behaviors/behavior.semantic-continuity.md
      - .echo-semantic/rules/rule.semantic-obligation-preservation.md
      - .echo-semantic/evidence/evidence.semantic-continuity.md
      - .echo-semantic/evidence/evidence.semantic-workflow.md
    summary: 同步 Skill、文档、完整回归矩阵和插件自身语义基线。
    verify: npm run verify 及宿主适配零行为变化检查通过。
artifact_id: plan:904efd48-bacc-49de-8949-80d72d0a119b
lifecycle: superseded
design_revision: sha256:f93bda0efc002bff0aeb6d9729c3e618c22577f269252428b8f1462a846087f4
---
## Approach

复用现有语义对象、Git revision 读取和校验器，新增字段感知的语义义务提取、规范化指纹与多前置版本连续性比较。长期处置 Evidence 使用 source:<digest> 绑定结果源码，机器报告记录实际 result commit，避免内容寻址自引用。

## Global Constraints

- 候选结果必须保留全部仍有效的前置语义义务，或提供防伪的明确替代/退役处置。
- 前置 revision 事实直接从 Git tree 读取，结果 Baseline 不能覆盖父版本事实。
- 长期 Evidence 不得写入包含自身的结果 commit SHA，结果源码使用 source:<digest> 绑定。
- 稳定身份下的代码移动不能误报；源码/测试/Evidence 同时消失必须阻断。
- 高风险 missing、conflicted、unknown 失败关闭。
- .codex-plugin、.cursor-plugin、.claude-plugin、.agents、agents、hooks、runtime/capabilities 和 bin/install.mjs 保持不动。

## Files
- Modify: `skills/semantic-contract/scripts/verify_semantic.py` — 实现或记录语义连续性门禁。
- Modify: `skills/semantic-contract/references/semantic-artifact-contract.md` — 实现或记录语义连续性门禁。
- Modify: `skills/semantic-contract/SKILL.md` — 实现或记录语义连续性门禁。
- Modify: `action.yml` — 实现或记录语义连续性门禁。
- Modify: `skills/semantic-diff/SKILL.md` — 实现或记录语义连续性门禁。
- Modify: `skills/semantic-verify/SKILL.md` — 实现或记录语义连续性门禁。
- Modify: `README.md` — 实现或记录语义连续性门禁。
- Modify: `CHANGELOG.md` — 实现或记录语义连续性门禁。
- Modify: `docs/ci-integration.md` — 实现或记录语义连续性门禁。
- Modify: `docs/command-reference.md` — 实现或记录语义连续性门禁。
- Create: `tests/test_continuity.py` — 实现或记录语义连续性门禁。
- Modify: `tests/manifests.test.mjs` — 实现或记录语义连续性门禁。
- Modify: `package.json` — 实现或记录语义连续性门禁。
- Modify: `.echo-semantic/baseline.md` — 实现或记录语义连续性门禁。
- Create: `.echo-semantic/maps/map.semantic-continuity.md` — 实现或记录语义连续性门禁。
- Modify: `.echo-semantic/maps/map.semantic-workflow.md` — 实现或记录语义连续性门禁。
- Create: `.echo-semantic/behaviors/behavior.semantic-continuity.md` — 实现或记录语义连续性门禁。
- Create: `.echo-semantic/rules/rule.semantic-obligation-preservation.md` — 实现或记录语义连续性门禁。
- Create: `.echo-semantic/evidence/evidence.semantic-continuity.md` — 实现或记录语义连续性门禁。
- Modify: `.echo-semantic/evidence/evidence.semantic-workflow.md` — 实现或记录语义连续性门禁。

## Reuse

- `verify_semantic.py` 的 Git/YAML/对象校验与旧单基准门禁保持独立复用。
- 现有语义对象作为义务和依赖来源，不建立新对象库。
- Action 现有 base 与 require-change-evidence 保持兼容，只追加可选连续性输入。
- Python 标准库、Git ls-tree/show 和 PyYAML 完成历史 tree 读取与确定性报告。

## Todos

### continuity-contract-engine

requirements:
- § 语义连续性门禁
- § 语义义务
- § 多前置版本比较
- § 允许的语义减少
- § 输出与权威

interfaces:
- consumes: merge-base、一个或多个 predecessor revision、result revision 及各版本语义对象
- produces: 稳定义务身份、规范化指纹、连续性矩阵和防伪处置验证

steps:

1. 用临时 Git DAG 固化语义义务丢失失败证据。
   verify: 定向 continuity 测试。
   expected: 结果遗漏任一父版本义务时稳定失败。

2. 实现 Git tree reader、历史源码摘要、义务提取、字段感知指纹和多前置比较，保持旧门禁独立。
   verify: 丢失、保留、分支冲突、代码移动、未知项和不可恢复 revision 场景。
   expected: 未经处置的 missing/conflicted/unknown 非零，正常保留通过。

3. 增加 semantic_continuity Evidence，使用 result_snapshot: source:<digest>，验证 replacement、等价 Evidence、decision authority、兼容影响和回滚。
   verify: 完整替代/退役通过，伪造决策、错误指纹与结果快照失败。
   expected: 只有明确替代或批准退役可以减少义务，且不存在 commit 自引用。

### continuity-cli-ci

requirements:
- § 多分支语义保全时序
- § 数据流与信任边界
- § 异常与降级

interfaces:
- consumes: continuity engine、现有 verifier CLI 与 Action
- produces: repeatable predecessor CLI、JSON report 和 Action 四点输入

steps:

1. 增加 continuity merge-base、predecessor、result、report 参数，部分输入拒绝，旧 CLI 不变。
   verify: CLI、报告确定性、浅历史和部分输入场景。
   expected: merge、PR merge ref、squash/rebase 前和单前置重构共用引擎。

2. Action 追加可选连续性输入并要求 revision 可恢复。
   verify: manifest 测试校验输入和透传。
   expected: 现有采用方无迁移，新门禁可显式启用。

### continuity-guidance-tests-baseline

requirements:
- § 关键取舍
- § 复用与实现约束
- § 验收标准
- § 已知限制

interfaces:
- consumes: 连续性 CLI/Action 与设计合同
- produces: Skill/用户文档、Git DAG 回归和插件自身语义基线

steps:

1. 同步 semantic-diff、semantic-verify、semantic-contract、README、CI/命令文档和 CHANGELOG。
   verify: 文档、Skill 和分发静态合同。
   expected: 明确这是语义义务门禁而非自动 Git merge。

2. 覆盖义务并集、冲突、替代、退役、测试同失、unknown、单前置重构和报告确定性。
   verify: npm test。
   expected: 设计验收场景可重复。

3. 更新 self-baseline 并执行最终门禁。
   verify: npm run verify。
   expected: 格式、Lint、合同、测试、自测与严格快照通过。