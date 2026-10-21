---
schema_version: 4
slug: plugin-architecture/historical-reference-continuity
outcome:
  summary: 交付共享历史观察解析与严格逐项文稿存储迁移，保持真实丢义务阻断并完成工具Git交付
  acceptance:
    - npm test
    - npm run verify
    - 原正负连续性矩阵和SDK391真实对照可复核，不把未迁移项伪判通过
out_of_scope:
  - SDK源码/档案删除及义务迁移
  - installed缓存/插件registry版本发布
  - 非documentation历史存储豁免或全局忽略父错误
design_ref: docs/supreme/specs/plugin-architecture/design.md
design_sections:
  - ref: design.md § 历史引用观察与受控文稿存储迁移
    digest: sha256:0069abe4ccf4e9e0ccb16186be31afb5570985490d30ae613cfb31b4a416b683
delivery_ref: null
todos:
  - id: historical-observation
    summary: 共享kind-aware引用观察并保Git失败语义
    files:
      - skills/semantic-contract/scripts/verify_semantic.py
      - tests/test_audit_observations.py
    acceptance:
      - 双challenge异rev与topfallback红绿，原错误仍阻断
  - id: bound-storage-migration
    summary: typed issue及完整resolution后精确处置父文稿存储缺失
    files:
      - skills/semantic-contract/scripts/verify_semantic.py
      - tests/test_continuity.py
      - skills/semantic-contract/references/semantic-artifact-contract.md
    acceptance:
      - 正例真实通过，字段/角色/ADR/result/未映射负例阻断
  - id: delivery
    summary: 同步正式合同/自有语义依据并独审/门禁/Git交付
    files:
      - docs/adr/0003-semantic-continuity-gate.md
      - .echo-semantic
      - docs/command-reference.md
    acceptance:
      - 全部适用门禁通过，真实新main/CI与未覆盖宿主边界分开报告
artifact_id: plan:aef5af96-503e-4103-b338-a3f1934b518c
lifecycle: completed
---
## Notes

只承接已批准A+B，临时日志在任务local，不作为正式来源。
