---
schema_version: 4
slug: task-scoped-reuse-governance/daily-reuse
outcome:
  summary: 日常开发在有无语义基线时均完成一次有依据的复用检查、轻量写入准入和影响范围内验证，保持全项目治理可显式调用。
  acceptance:
    - 新建无基线仓库和已有基线仓库的小功能任务，都可从预检到编辑再到完成；无任务会话保持等待，不自动执行全项目发现、归并或审计。
    - 缺少记录、无效或失效候选依据、跨任务授权与越界写入被拒绝；同一任务增量检查复用记录，工作区保护和高风险约束保持有效。
    - 普通任务及其局部盘点不计算全项目源码摘要，局部收据只能证明所列范围；全项目盘点与严格快照验证仍可显式调用且结果不能与任务收据混用。
    - npm test 与 npm run verify
      通过；用无关文件增长夹具验证读取范围，并分别报告静态/夹具结果与真实宿主验收，不能以未执行的宿主验收宣布通过。
out_of_scope:
  - 不实现 Delivery Map 中的 full-scan-candidates 与
    scheduled-scan；当前只保持既有全项目入口可用，不建立新的候选报告发布或外部定时部署链路。
  - 不自动更新采用方正式语义基线、业务重构或删除候选；插件仓库自身为最终工程检查所需的语义事实维护按实际差异处理。
  - 不把当前工作区已有未提交实现作为已验证交付；执行前核对并确定实际可写范围，不暂存、提交、安装或发布。
design_ref: docs/supreme/specs/task-scoped-reuse-governance/design.md
design_sections:
  - ref: design.md § 范围与非目标
    digest: sha256:a9fa660e1be6843c488a57c4d93e42756639c1464f4561fee65c20f58a1f30ac
  - ref: design.md § 日常任务入口与查找
    digest: sha256:7f5fd67dd0a236aa86482f610c9710c946fdbeca28221195a349424a43bcb5ed
  - ref: design.md § 复用决定
    digest: sha256:174e2a31f43b7b495c35c8b48c87629b0f5bc8ce49eec9eebabd9b90ae056f11
  - ref: design.md § 任务记录与增量检查
    digest: sha256:611bb8a30cb5187431ce8cd17c77fc11a6f14d4e1e628fc74a914c1a37b2b8ad
  - ref: design.md § 日常任务完成
    digest: sha256:001be7b74a0f1a6b44e97ecba9dcfef42c2734582f643b5ff4c9f0a01640180e
  - ref: design.md § 系统边界与数据流
    digest: sha256:dc03095af2de2347c6d5037d84a88e70ccf5a0c60558b75d1327ee0b40ad0ea2
  - ref: design.md § 复用与实现约束
    digest: sha256:e6bee28042f01d3c6efcc5984fce20d9c181b538debffeab19052eacab77b48a
delivery_ref: docs/supreme/specs/task-scoped-reuse-governance/plans/delivery-map.md#daily-reuse
todos:
  - id: evidenced-reuse-contract
    summary: 沿用任务预检合同表达搜索范围、候选引用、采用或拒绝理由及验证依据，并让所有记录消费者一致核对相关内容与任务授权。
    files:
      - skills/semantic-preflight/scripts/preflight.py
      - scripts/preflight_contract.py
      - scripts/check-preflight.py
      - scripts/record-preflight.mjs
      - hooks/entry.mjs
      - runtime/route.mjs
      - runtime/continuation.mjs
      - skills/semantic-status/scripts/status.py
      - skills/semantic-contract/references/semantic-artifact-contract.md
      - tests/fixtures/preflight-contract.json
      - tests/test_preflight.py
      - tests/test_preflight_contract.py
      - tests/preflight-contract.test.mjs
      - tests/preflight-write.test.mjs
      - tests/continuation.test.mjs
      - tests/status.test.mjs
    acceptance:
      - 直接复用、扩展已有实现、候选不适用及未找到候选均有真实搜索范围和决定；可确定核对的路径/符号与相关内容身份有效，空泛字符串不能代替新合同要求的依据。
      - Python 完整合同、锁内 record、Node 编辑准入、route、status
        和继续包使用一致接受规则；依据变更、任务错配、过期、越界和同任务风险降级会被拒绝，check 不续期。
      - 旧字符串式预检和缺少范围身份的收据不能直接成为新合同的有效依据；保留已有差异裁决、恢复线索及失败后的可诊断状态，明确要求重建失效记录。
  - id: task-first-entry
    summary: 让有无基线的开发任务进入有界复用检查，无任务等待，编辑与恢复检查不依赖全项目治理入口。
    files:
      - runtime/route.mjs
      - hooks/entry.mjs
      - runtime/continuation.mjs
      - skills/semantic-status/scripts/status.py
      - skills/semantic-preflight/SKILL.md
      - skills/semantic-diff/SKILL.md
      - skills/semantic-discover/SKILL.md
      - tests/route.test.mjs
      - tests/hooks.test.mjs
      - tests/continuation.test.mjs
      - tests/status.test.mjs
    acceptance:
      - 缺少 baseline、干净工作树、没有匹配 taskId
        的旧记录和未知宿主证据均不产生自动全项目维护指令；明确任务从源码查找，没有任务保持等待。
      - 无基线任务也执行当前任务记录、路径、已有差异和删除授权检查；不能沿用当前无 baseline 分支直接绕过写入准入与待结算验证。
      - SessionStart、resume、PreCompact 和状态提示一致表达任务范围；高风险扩大相关消费者调查，不能因路由为 strict
        自动执行全项目归并或修复。
  - id: scoped-validation
    summary: 完成检查和局部盘点只核对本次实际差异及相关影响范围，并保持全项目校验与高风险授权的独立证明边界。
    files:
      - skills/semantic-contract/scripts/verify_semantic.py
      - skills/semantic-discover/scripts/inventory.py
      - hooks/entry.mjs
      - runtime/route.mjs
      - runtime/session-state.mjs
      - skills/semantic-contract/SKILL.md
      - skills/semantic-contract/references/semantic-artifact-contract.md
      - skills/semantic-verify/SKILL.md
      - skills/semantic-diff/SKILL.md
      - tests/test_inventory.py
      - tests/test_equivalence.py
      - tests/test_continuity.py
      - tests/hooks.test.mjs
      - tests/route.test.mjs
    acceptance:
      - 任务完成验证从实际差异及声明的相关依据核对范围，不把允许写入路径误当全部消费者；新增未映射影响保持未知并要求补查，而不是静默遗漏。
      - 普通任务不运行全局 validate_regions、无关对象闭合和
        source_digest；受影响引用失效会失败，无关基线或对象漂移单独报告，不阻断无关任务。
      - inventory 的显式路径盘点不再调用 source_digest(root, all_paths)，结果明确绑定局部范围；完整 scan
        的既有全局摘要和显式 --strict-snapshot 行为仍有效，局部签名不能冒充全局 source:<digest>。
      - 成功收据绑定验证范围、任务及当前相关内容；修改使相关证据失效，重复 Stop 仅复用同一范围的有效结果。失败、缺少快照或命令依据时不产生成功收据。
      - 公共契约、设计权威、repair 授权、行为等价及连续性门禁不因范围分流而被省略；引用不足或无法安全核对时明确失败并要求补充相关证据。
  - id: observable-cost-and-delivery
    summary: 用现有夹具、文档和插件自身语义事实证明日常链路开销有界且范围结论真实。
    files:
      - scripts/benchmark-preflight.mjs
      - tests/route.test.mjs
      - tests/hooks.test.mjs
      - tests/test_inventory.py
      - tests/test_preflight_contract.py
      - README.md
      - docs/command-reference.md
      - docs/getting-started.md
      - docs/concepts.md
      - docs/host-support.md
      - docs/designs/preflight-performance.md
      - .echo-semantic/
    acceptance:
      - 已有性能夹具覆盖预检、编辑、完成检查和 --path 局部盘点；增加无关源码或语义对象不会导致普通任务读取其全量内容，Git
        状态枚举与受保护差异核对单独统计。
      - 报告实际读取字节、Git 调用与阶段耗时，同时回归完整显式扫描；不把夹具数据转述为真实宿主或助手整体耗时改善。
      - 使用文档能区分日常任务、显式全项目治理和后续定时交付，旧性能设计中的全量 Stop 要求被明确限定；当前实现所需的插件自身语义材料与实际差异一致。
      - 按最终变更范围验证对应宿主已存在事件上的接线与完成行为；无新会话或 GUI 重载证据时列为未验收，不能以静态清单或模拟 Hook 替代。
artifact_id: plan:84184903-41c5-46d3-bc9f-04eef540ad2d
lifecycle: completed
---

## Notes

调查基于 main@8ecb51f9119a96ac9fa09ffc500f1a3dea299fdb 与当前已有未提交内容，提交标识不代表完整工作树。当前设计原入口为 docs/designs/task-scoped-reuse-governance.md；用户已确认将设计原文迁移至本主题 design.md，内容摘要保持不变；Plan 绑定当前标准入口。实现前应重新核对并明确已有差异的可写范围。

关键证据：route 的无差异分支和 sessionContext 会引导维护；无 baseline 的 pre-edit/Stop 分支提前放行；inventory.scan 即使 selected_paths 非空仍调用 source_digest(root, all_paths)；validate_repository 全局加载文档与路径分类，Stop 强制 strict-snapshot。第四项 Todo 用于证明前三项构成的同一日常结果，不是另一个独立交付。Delivery Map 的后续扫描结果复用本 Outcome 已划分的范围身份、验证边界与记录消费者兼容约束。
