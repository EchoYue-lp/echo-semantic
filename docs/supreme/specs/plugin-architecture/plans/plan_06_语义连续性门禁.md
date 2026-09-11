---
schema_version: 3
supersedes: null
slug: plugin-architecture/semantic-continuity-gate
goal: 实现跨 merge、rebase、squash、cherry-pick 和重构的语义连续性门禁，阻断未经解释的语义义务丢失。
ships: 在现有 semantic-diff、semantic-verify、verifier 和 CI Action 中交付多前置 revision
  义务比较、可验证替代/退役处置、确定性报告和 Git DAG 回归。
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
    summary: 实现多 revision 语义义务提取、指纹、比较和防伪处置合同。
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
artifact_id: plan:06d5cf48-9670-4294-b799-10ee4ec99b10
lifecycle: superseded
design_revision: sha256:38185e097fc6ba3b1b167a5368975c8d7f27da7282efc7c7f89a60116bb2b048
---
## Approach

复用现有语义对象、Git revision 读取和校验器，新增字段感知的语义义务提取、规范化指纹与多前置版本连续性比较。semantic-diff 负责映射，semantic-verify、verifier 和 Action 负责确定性阻断；不新增自动 Merge Skill、宿主 Hook、Agent 或状态目录。

## Global Constraints

- 候选结果必须保留全部仍有效的前置语义义务，或提供防伪的明确替代/退役处置。
- 前置 revision 事实直接从 Git tree 读取，结果 Baseline 不能覆盖父版本事实。
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

- `verify_semantic.py` 的 `run_git`、文档解析、对象校验、关系校验和现有单基准变更门禁：复用 Git/YAML/合同权威，连续性比较保持独立。
- Capability Map 场景、Behavior、Rule、Finding、Discovery、Evidence 和 Asset：作为义务与验证依赖来源，不建立新对象库。
- `action.yml` 现有 base 与 require-change-evidence：保持兼容，只追加可选连续性输入。
- Python 标准库、Git ls-tree/show 和现有 PyYAML：读取历史 tree 与生成确定性报告，不增加依赖。

## Todos

### continuity-contract-engine

requirements:
- § 语义连续性门禁
- § 语义义务
- § 多前置版本比较
- § 允许的语义减少
- § 输出与权威

interfaces:
- consumes: merge-base、一个或多个 predecessor revision、result revision 及各版本 .echo-semantic 对象
- produces: 稳定义务身份、规范化指纹、preserved/replaced/retired/conflicted/missing/unknown 矩阵和非零门禁结果

steps:

1. 先建立临时 Git DAG 失败夹具，证明两个前置版本分别新增义务而结果遗漏一项时当前校验器不能阻断。
   verify: 定向运行 continuity 测试，预期新断言在实现前失败。
   expected: 获得语义丢失的稳定失败证据。

2. 在 verifier 中实现 Git tree 语义对象读取、历史源码摘要校验、义务提取、字段感知指纹和多前置版本比较，保持 validate_change_evidence 旧路径不变。
   verify: 丢失、保留、单侧修改、双侧相同/不同修改、代码移动、未知项和不可恢复 revision 夹具。
   expected: 未经处置的 missing/conflicted/unknown 返回非零，正常保留与稳定移动通过。

3. 扩展 semantic_continuity Evidence 合同，校验父 revision、义务指纹、replacement、等价/迁移 Evidence、decision authority 摘要、兼容影响和回滚信息。
   verify: 完整替代与退役通过，空值、伪造决策、错误指纹和丢失 canonical 失败。
   expected: 语义减少只有明确替代或经人批准退役两条可验证路径。

### continuity-cli-ci

requirements:
- § 多分支语义保全时序
- § 数据流与信任边界
- § 异常与降级

interfaces:
- consumes: continuity engine、现有 verifier CLI 与 Action base 门禁
- produces: repeatable predecessor CLI、JSON report、Action 四点比较输入和部分输入拒绝

steps:

1. 为 verifier 增加 continuity merge-base、predecessor、result 和 report 参数；连续性参数部分提供时拒绝，旧 CLI 不变。
   verify: CLI 正常、部分输入、浅历史和报告确定性场景。
   expected: 本地、merge commit、PR merge ref 和 squash/rebase 前检查使用同一引擎。

2. 为 Action 追加可选 continuity 输入并要求相关 revision 可恢复，保留原 base 与 require-change-evidence 语义。
   verify: manifest 测试校验新输入、完整参数透传和部分输入失败。
   expected: 现有采用方无迁移，新门禁可在 PR 合并前显式启用。

### continuity-guidance-tests-baseline

requirements:
- § 关键取舍
- § 复用与实现约束
- § 验收标准
- § 已知限制

interfaces:
- consumes: 连续性 CLI/Action 和设计约束
- produces: Skill 使用合同、用户文档、完整回归矩阵和插件自身语义基线

steps:

1. 更新 semantic-diff、semantic-verify、semantic-contract、README、CI/命令文档和 CHANGELOG，明确语义义务门禁而非自动 Git merge。
   verify: 文档、Skill frontmatter、分发包和宿主适配静态合同。
   expected: 用户可以配置四点比较，且不会误解为源码合并器。

2. 用临时 Git DAG 覆盖义务并集、冲突、替代、退役、测试/Evidence 同失、Finding/unknown、单前置重构和确定性报告。
   verify: npm test 与新增 Python 测试。
   expected: 所有设计验收场景都有可重复证据。

3. 更新插件自身 Capability、Behavior、Rule、Evidence、源码摘要和引用，执行完整工程与语义门禁。
   verify: npm run verify。
   expected: self-baseline、格式、Lint、静态合同、测试、自测和严格快照全部通过。