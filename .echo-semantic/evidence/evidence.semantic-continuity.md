---
schema_version: 1
id: evidence.semantic-continuity
kind: evidence
observed_at: 8ecb51f9119a96ac9fa09ffc500f1a3dea299fdb
source_refs:
  - skills/semantic-contract/scripts/verify_semantic.py#source_digest_at_revision
  - skills/semantic-contract/scripts/verify_semantic.py#extract_obligations
  - skills/semantic-contract/scripts/verify_semantic.py#compare_continuity
  - skills/semantic-contract/scripts/verify_semantic.py#validate_resolution_for_obligation
  - tests/test_continuity.py#ContinuityTests
  - action.yml#continuity-merge-base
supports: [map.semantic-continuity, behavior.semantic-continuity, rule.semantic-obligation-preservation]
limitations:
  - 只保护已经进入语义对象或其验证依赖的义务
  - 动态运行时事实无法闭合时返回 unknown
  - 历史被压平且 revision 与报告均丢失后不能事后恢复
---

# 语义连续性实现证据

## 支持的结论

校验器能够从 Git tree 读取多前置版本，重算历史源码摘要，提取稳定语义义务，比较规范化指纹并验证替代/退役处置。

## 来源与范围

证据来自 verifier、Action、临时 Git DAG 回归、设计和 ADR 0003。

## 已知缺口

未建模行为和动态运行时调用仍需采用方补充 Behavior、Rule、场景或 Evidence。


## 本轮历史观察与精确存储迁移

本轮实现仍在原verifier内：source_reference_observations复用普通/连续性引用分组，Audit观察错误真实原版10例6失败，修复后14例（含Git ownedpipe回收）通过；历史迁移首轮原版6例5错误，typed issue/replacement合同后正负矩阵补齐。临时原件位置为.echo-semantic/local/historical-reference-continuity/，不作为正式source_refs，不提交raw包；最终工程结论以最后门禁收据为准。

SDK真实0ebe采用方案例的公开22e snapshot391原错误，本轮解析精去95但严格依赖碰撞诊断新增91，当前387不是连续性通过。34组125变体涉及合法多锚/源码与文稿同bytes不同role，原last-write不能证明保全；逐项表只在local，原报告保历史。后继完整聚合表示重算330=原296+34typed碰撞，原95解析错精确移除，125qualified变体与251原历史依赖均保；仅34原歧义聚合指纹改变，普通单变体ID/FP不改，未迁移原SDK仍BLOCK。Bdocumentation-only不豁免其余强consumer，当前SDK迁移未实施、未知/业务及宿主限制未因此关闭。全结果缺current、历史原Git/blob/锚不可恢复、错误父FP/场景/ADR、selfreplacement/错误kind/无mapping或少一引用都继续失败。

同根因由实际Git夹具证明，不把当前测试数推所有采用方仓库通过。新增tests/test_audit_observations.py与HistoricalStorageMigrationTests保真实双父、两个Eq before绑定、同SHA两ref分别映射、结果角色缓存及active/inactive控制Evidence区分；旧UTF8测试与原连续性用例保留。Skill/Action/Hook/manifest/registry版本与宿主运行行为没有新增协议或发布；公共扩展是语义材料中严格可选historical_reference_migrations、current_reference_replacements、source_dependency_variant_replacements三个字段。


## 本次真实实现与文档输入

当期唯一实现skills/semantic-contract/scripts/verify_semantic.py包括source_reference_observations、replacement_consumer_errors、apply_historical_reference_migrations、resolve_dependency_collisions，回归在tests/test_audit_observations.py及tests/test_continuity.py。正式公共可选字段与报告在skills/semantic-contract/references/semantic-artifact-contract.md和docs/command-reference.md；docs/adr/0003-semantic-continuity-gate.md、docs/supreme/specs/plugin-architecture/design.md及docs/supreme/specs/plugin-architecture/plans/plan_09_历史引用与存储迁移.md承接已批准决策/计划。package.json仅把新增测试加入原Ruff名单，不新增执行器或依赖。

这些新源码/测试路径只在本轮真实候选工作树存在，不塞入旧8ec观察的source_refs。该旧header/原执行正文仍为历史依据，原Git原件保持可恢复；本段仅本次当前实现scope和本任务local原收据的定位，不改历史为新运行。最终完整工程和新官方工具自身strict/change结论待sourcefreeze之后实际收取。
