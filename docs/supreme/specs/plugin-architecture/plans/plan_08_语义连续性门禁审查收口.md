---
schema_version: 3
supersedes: plan:904efd48-bacc-49de-8949-80d72d0a119b
slug: plugin-architecture/semantic-continuity-review-closeout
goal: 实现跨 merge、rebase、squash、cherry-pick 和重构的语义连续性门禁，阻断未经解释的语义义务丢失。
ships: 交付多前置 revision 义务比较、防止自身替代和伪决策绕过的处置合同、内容身份移动、可审计报告、Action 接入和 Git DAG 回归。
verify: npm run verify；reviewer 的自身替代、伪 ADR、Evidence
  移动和报告缺失反例全部覆盖；Codex/Cursor/Agent 适配文件零行为变化。
design_ref: docs/supreme/specs/plugin-architecture/design.md
delivery_ref: null
todos:
  - id: continuity-contract-engine
    files:
      - skills/semantic-contract/scripts/verify_semantic.py
      - skills/semantic-contract/references/semantic-artifact-contract.md
      - skills/semantic-contract/SKILL.md
      - tests/test_continuity.py
    summary: 实现多 revision 义务比较、内容依赖和防伪处置合同。
    verify: Git DAG 核心与 reviewer 反例通过。
  - id: continuity-cli-ci
    files:
      - skills/semantic-contract/scripts/verify_semantic.py
      - action.yml
      - tests/manifests.test.mjs
    summary: 接入兼容旧调用的 CLI、报告和 Action。
    verify: CLI/Action 完整、部分和不可恢复输入测试通过。
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
      - .echo-semantic/discovery/discovery.initial-baseline.md
      - .echo-semantic/maps/map.semantic-continuity.md
      - .echo-semantic/maps/map.semantic-workflow.md
      - .echo-semantic/behaviors/behavior.semantic-continuity.md
      - .echo-semantic/rules/rule.semantic-obligation-preservation.md
      - .echo-semantic/evidence/evidence.semantic-continuity.md
      - .echo-semantic/evidence/evidence.semantic-workflow.md
    summary: 同步文档、回归和插件自身语义基线。
    verify: npm run verify 与宿主适配零行为变化检查通过。
artifact_id: plan:5dbace9e-fb94-4727-a738-4465ebbb15a1
lifecycle: completed
design_revision: sha256:fb1baaa865b3efb9ce0f4ed2d7b429f0c112fe2c3661430248bb16d292671d23
---
## Approach

复用现有语义对象、Git tree 读取和校验器，交付字段感知的义务指纹、多前置比较和防伪处置。Evidence 源码定位通过 blob 内容义务允许移动；双侧冲突只能由 resolved_conflict 加人的正式决策解决。

## Global Constraints

- 结果必须保留前置义务，或提供明确替代/批准退役。
- 双侧指纹冲突不得用 replaced 或自身替代绕过。
- 决策权威必须具备正式章节、批准状态、全部父 revision、义务、理由、兼容和回滚。
- Evidence 路径移动以内容身份保全，内容或依赖丢失仍阻断。
- 长期 Evidence 使用 source:<digest> 避免 commit 自引用。
- manifest、Agent、Hook、能力矩阵和安装器保持不动。

## Files
- Modify: `skills/semantic-contract/scripts/verify_semantic.py` — 实现、验证或记录连续性门禁。
- Modify: `skills/semantic-contract/references/semantic-artifact-contract.md` — 实现、验证或记录连续性门禁。
- Modify: `skills/semantic-contract/SKILL.md` — 实现、验证或记录连续性门禁。
- Modify: `action.yml` — 实现、验证或记录连续性门禁。
- Modify: `skills/semantic-diff/SKILL.md` — 实现、验证或记录连续性门禁。
- Modify: `skills/semantic-verify/SKILL.md` — 实现、验证或记录连续性门禁。
- Modify: `README.md` — 实现、验证或记录连续性门禁。
- Modify: `CHANGELOG.md` — 实现、验证或记录连续性门禁。
- Modify: `docs/ci-integration.md` — 实现、验证或记录连续性门禁。
- Modify: `docs/command-reference.md` — 实现、验证或记录连续性门禁。
- Create: `tests/test_continuity.py` — 实现、验证或记录连续性门禁。
- Modify: `tests/manifests.test.mjs` — 实现、验证或记录连续性门禁。
- Modify: `package.json` — 实现、验证或记录连续性门禁。
- Modify: `.echo-semantic/baseline.md` — 实现、验证或记录连续性门禁。
- Modify: `.echo-semantic/discovery/discovery.initial-baseline.md` — 实现、验证或记录连续性门禁。
- Create: `.echo-semantic/maps/map.semantic-continuity.md` — 实现、验证或记录连续性门禁。
- Modify: `.echo-semantic/maps/map.semantic-workflow.md` — 实现、验证或记录连续性门禁。
- Create: `.echo-semantic/behaviors/behavior.semantic-continuity.md` — 实现、验证或记录连续性门禁。
- Create: `.echo-semantic/rules/rule.semantic-obligation-preservation.md` — 实现、验证或记录连续性门禁。
- Create: `.echo-semantic/evidence/evidence.semantic-continuity.md` — 实现、验证或记录连续性门禁。
- Modify: `.echo-semantic/evidence/evidence.semantic-workflow.md` — 实现、验证或记录连续性门禁。

## Reuse

- verifier 的 Git/YAML/对象合同与旧单基准门禁保持独立复用。
- 现有语义对象作为义务来源，不建立新对象库。
- Action 旧输入保持兼容，连续性检查作为第二阶段。
- Git 和 Python 标准库读取历史 tree 并生成报告。

## Todos

### continuity-contract-engine

requirements:
- § 语义连续性门禁
- § 语义义务
- § 多前置版本比较
- § 允许的语义减少
- § 输出与权威

interfaces:
- consumes: merge-base、predecessor revisions、result revision 与语义对象
- produces: 义务指纹、六态矩阵、防伪 resolution 和可审计报告

steps:

1. 实现并验证历史 tree、源码摘要、义务提取、内容依赖、比较算法和处置合同。
   verify: Git DAG 定向测试。
   expected: missing/conflicted/unknown 阻断，保留/替代/退役通过。

2. 阻断自身替代与伪决策，允许稳定 Evidence 移动，报告输出 resolution 映射。
   verify: reviewer 反例回归。
   expected: Critical/Important 反例全部失败关闭。

### continuity-cli-ci

requirements:
- § 多分支语义保全时序
- § 数据流与信任边界
- § 异常与降级

interfaces:
- consumes: continuity engine 与旧 verifier/Action
- produces: repeatable predecessor CLI、JSON report 和 Action 四点输入

steps:

1. 接入 CLI 和 Action，部分输入拒绝且旧调用不变。
   verify: CLI、manifest、不可恢复 revision 与报告确定性测试。
   expected: PR、merge、squash/rebase 前和单前置重构可共用门禁。

### continuity-guidance-tests-baseline

requirements:
- § 关键取舍
- § 复用与实现约束
- § 验收标准
- § 已知限制

interfaces:
- consumes: 连续性引擎和公共合同
- produces: Skill/用户文档、完整回归和 self-baseline

steps:

1. 同步 Skill、README、CI、命令、CHANGELOG 和语义合同。
   verify: 静态合同和文档检查。
   expected: 明确这是义务门禁而非自动 Git merge。

2. 完成 Git DAG、Action、self-baseline 和最终门禁。
   verify: npm run verify。
   expected: 格式、Lint、合同、测试、自测与严格快照通过，宿主适配零变化。