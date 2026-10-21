---
schema_version: 4
slug: session-aware-stop-gate/existing-changes
design_ref: docs/supreme/specs/2026-09-17-session-aware-stop-gate/design.md
design_sections:
  - ref: design.md § 目标行为
    digest: sha256:50401c40d8b841579528629019d757fcb5b67ede338713812231f7d31510d3d0
  - ref: design.md § 系统边界
    digest: sha256:e1bb95a61f9e1dbce9493ce6b663ae3df5f5620ee01be999c26a7af6221c397e
  - ref: design.md § 复用与实现约束
    digest: sha256:7b0f6438d4abd4ff4858339751f8796920ee848316b19cc0b167912856a4bacd
  - ref: design.md § 验收标准
    digest: sha256:13be1fa3bb0c27dc65b153cd89db5b43d0683b937858eb371bcacc43cd948ea0
delivery_ref: null
outcome:
  summary: 首次发现已有差异主动询问处置策略，未回答只读待裁决，用户裁决按会话隔离且保护未接管路径
  acceptance:
    - 首次差异盘点、待裁决写入拒绝、只读 Stop 不循环及三种策略的机器回归通过
    - npm test 与 npm run verify 通过
out_of_scope:
  - 不自动提交、暂存、丢弃、清理、安装或发布
  - 不重构 continuation 恢复读取或把多个写任务完全会话化
  - 不新增宿主事件、数据库或第二状态权威
todos:
  - id: initial-disposition
    summary: 扩展现有快照承载初始差异盘点和处置策略，保留会话隔离、有界更新及恢复语义
    files:
      - runtime/route.mjs
      - runtime/session-state.mjs
      - hooks/entry.mjs
      - tests/hooks.test.mjs
      - tests/route.test.mjs
    acceptance:
      - 区分暂存、未暂存、未跟踪差异并绑定观察指纹，旧指纹和跨会话答复被拒绝
      - resume/compact 保留处置依据，保护路径变化重新待裁决
  - id: disposition-command-and-gates
    summary: 提供用户明确答复后的策略记录入口，Hook 注入首轮询问并执行待裁决/保护写入与停止检查
    files:
      - scripts/session-changes.mjs
      - hooks/entry.mjs
      - skills/semantic-preflight/SKILL.md
      - tests/hooks.test.mjs
    acceptance:
      - 未答复或只读拒绝写入；保留保护已有路径；接管指定路径仍要求预检
      - 只读待裁决 Stop 放行但保留未验证状态，不生成新收据或反复followup
  - id: disposition-evidence
    summary: 同步状态说明、语义材料、裁决命令与运行边界，完成严格复审
    files:
      - docs/concepts.md
      - docs/command-reference.md
      - .echo-semantic/
    acceptance:
      - Skill 明确未裁决不得修改或交付，不把提示词称为机器门禁
      - 语义结构、源码摘要及高风险依据通过校验
artifact_id: plan:e529ea8a-8e89-44b5-956b-c5807d7db09b
lifecycle: ready
---
