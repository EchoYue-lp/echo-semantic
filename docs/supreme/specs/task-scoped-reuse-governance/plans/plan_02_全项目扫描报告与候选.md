---
schema_version: 4
slug: task-scoped-reuse-governance/full-scan-candidates
outcome:
  summary: 全项目扫描在一致源码快照上生成可追溯报告与待确认候选，确认并核对当前源码后才能更新正式语义基线。
  acceptance:
    - 无基线和已有基线仓库都能显式扫描并保存报告，候选、未知项、覆盖和限制可审阅；扫描不改变正式基线或业务文件。
    - 并发、源码变化、中断、损坏报告和过期确认不产生完整成功或基线更新依据。
    - 确认入口核对报告与当前源码，有效结果才衔接正式语义维护；语义判断、用户授权与工程验证仍独立执行。
    - npm test 与 npm run verify 通过；扫描保护与既有日常任务回归均通过，夹具和真实宿主验收分别报告。
out_of_scope:
  - 不实现 scheduled-scan，不配置实际周期、宿主自动任务或 CI 定时部署。
  - 不自动决定 canonical owner、重构或删除业务代码，不自动生成或覆盖 Baseline/Capability
    Map/Behavior/Rule。
  - 不提交、推送、安装或发布；保留此前实现及其他已有差异。
design_ref: docs/supreme/specs/task-scoped-reuse-governance/design.md
design_sections:
  - ref: design.md § 范围与非目标
    digest: sha256:a9fa660e1be6843c488a57c4d93e42756639c1464f4561fee65c20f58a1f30ac
  - ref: design.md § 全项目治理
    digest: sha256:468b72c1c2ea076e752b659abcb22574f8b2da6988eed438f92efd783e444066
  - ref: design.md § 系统边界与数据流
    digest: sha256:dc03095af2de2347c6d5037d84a88e70ccf5a0c60558b75d1327ee0b40ad0ea2
  - ref: design.md § 异常与边界场景
    digest: sha256:7acef7aa0bb277e4cc6d5c2a4ab148513cc1fdd72d976250b8bddf1f1cfd05c0
  - ref: design.md § 复用与实现约束
    digest: sha256:e6bee28042f01d3c6efcc5984fce20d9c181b538debffeab19052eacab77b48a
delivery_ref: docs/supreme/specs/task-scoped-reuse-governance/plans/delivery-map.md#full-scan-candidates
todos:
  - id: consistent-inventory
    summary: 资产、消费者和重复候选从同一份安全读取的源码快照提取，显式区分完整、局部及未知覆盖。
    files:
      - skills/semantic-discover/scripts/inventory.py
      - scripts/preflight_contract.py
      - tests/test_inventory.py
      - tests/test_consolidate.py
    acceptance:
      - 本轮一致内容产生资产、消费者、候选与摘要；变化中的 HEAD、索引、路径集合或内容使扫描未完成。
      - 报告保留路径身份、重复信号和风险线索；不支持的语言、动态入口、二进制和不可读路径不能静默标为行为闭合。
      - 局部盘点仍只读相关内容，局部摘要不能冒充全项目快照。
  - id: candidate-report-boundary
    summary: 原子保存独立 Discovery 扫描报告，兼容写入入口只产生待确认候选，报告校验与确认核对才衔接正式语义维护。
    files:
      - skills/semantic-discover/scripts/inventory.py
      - skills/semantic-consolidate/scripts/consolidate.py
      - skills/semantic-contract/scripts/verify_semantic.py
      - skills/semantic-contract/references/semantic-artifact-contract.md
      - runtime/project-state.mjs
      - scripts/record-preflight.mjs
      - tests/test_inventory.py
      - tests/test_consolidate.py
      - tests/test_equivalence.py
    acceptance:
      - 报告复用 Discovery 表达并保存在 .echo-semantic/，无基线也能独立机器校验；嵌入候选不冒充正式 Asset 或
        canonical owner。
      - 保存复用 repo-local 协调，单个报告原子且不覆盖已保存报告；失败或中断不改变任务记录、继续包、route 和收据。
      - 旧 --write 与归并写入不绕过确认直接覆盖正式材料；待确认候选不能成为删除授权。
      - 确认核对拒绝损坏、跨仓库、非全项目或过期报告；通过只给出正式基线维护依据，不自动更新业务或基线。
  - id: scan-contract-and-evidence
    summary: 同步扫描 Skill、命令文档和插件自身语义证据，并验证报告保护与日常流程组合行为。
    files:
      - skills/semantic-discover/SKILL.md
      - skills/semantic-consolidate/SKILL.md
      - skills/semantic-contract/SKILL.md
      - README.md
      - docs/command-reference.md
      - docs/getting-started.md
      - docs/concepts.md
      - docs/faq.md
      - scripts/validate-package.mjs
      - package.json
      - .echo-semantic/
      - tests/test_inventory.py
      - tests/test_consolidate.py
    acceptance:
      - 文档可指导手动扫描、保存、查看、校验与确认核对；基线维护步骤明确，定时调度属于后续交付。
      - 失败与竞态保持已有正式材料和任务运行态，报告持久保存但不记录密钥或完整日志。
      - 报告合同通过、严格全项目校验和局部任务完成分别表达；不以静态盘点宣布行为闭合。
artifact_id: plan:c2ce146f-2f3a-4e9e-8d6d-4b29b6617876
lifecycle: completed
---

## Notes

前置日常结果已有代码及 verify-final-completed.log 的 100 Node、68 Python、自测与严格快照通过证据。本轮在 main@8ecb51f 的现有未提交工作区增量实施。inventory.scan 多次读取工作树，--write 覆盖资产与 discovery.semantic-assets；consolidate --write 直接写 Finding。新写入收敛为独立报告，确认核对后复用既有人工语义维护、预检与验证流程；本 Plan 不承诺自动建库。
