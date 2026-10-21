---
schema_version: 4
slug: session-aware-stop-gate/plan
design_ref: docs/supreme/specs/2026-09-17-session-aware-stop-gate/design.md
design_sections:
  - ref: design.md § 目标行为
    digest: sha256:8f3e1703be38f8c295ff52f8e10657619d7d37124116b7051de313de6ba70f5f
  - ref: design.md § 4. 失败场景
    digest: sha256:6781eac908e617839ff2d2a7a005fd9b9475fae1384612a3984d6dd371f776c0
  - ref: design.md § 系统边界
    digest: sha256:e1bb95a61f9e1dbce9493ce6b663ae3df5f5620ee01be999c26a7af6221c397e
  - ref: design.md § 设计方案与关键取舍
    digest: sha256:9c945197f0493d995e28375c55a1a4747dafae33c712a6282a908c181fa0258e
  - ref: design.md § 复用与实现约束
    digest: sha256:7b0f6438d4abd4ff4858339751f8796920ee848316b19cc0b167912856a4bacd
  - ref: design.md § 验收标准
    digest: sha256:b0cbcfea1ee33dfa78fcffcd4edc836b9ffabd1dce16811ba609d3303c8f05fb
delivery_ref: null
outcome:
  summary: Stop 门禁按会话起始快照区分已有差异与本轮修改，对相同失败的重入 Stop 去重，快照缺失时提示未验证并放行
  acceptance:
    - tests/hooks.test.mjs 中设计 §验收标准 的 10 个场景全部通过
    - npm test 与 npm run verify 通过
out_of_scope:
  - 不修改 semantic-preflight Skill 合同与 preflight.py 记录格式
  - 不修改已安装插件缓存与 distribution 发布
  - 不引入数据库、常驻服务或遥测
todos:
  - id: session-state-registry
    summary: 把会话快照和 Stop 去重运行态改为按规范化会话 ID 键控的有界记录，并通过 repo-local 短期锁和原子替换避免并发覆盖
    files:
      - hooks/entry.mjs
      - runtime/project-state.mjs
      - tests/hooks.test.mjs
      - tests/project-state.test.mjs
    acceptance:
      - 会话 A、B 交错启动与 Stop 时各自记录可读且互不覆盖
      - 写入时按设计保留期和最大会话数清理旧记录，锁失败不会静默覆盖状态
  - id: bounded-worktree-fingerprint
    summary: 工作树指纹组合 HEAD、原始 porcelain、索引 blob 元数据和已有差异路径内容，不读取无差异文件并支持含 submodule 的仓库
    files:
      - runtime/route.mjs
      - tests/hooks.test.mjs
      - tests/route.test.mjs
      - tests/status.test.mjs
    acceptance:
      - 本已脏文件、未跟踪文件、仅索引变化和 HEAD 变化均可区分
      - 干净 submodule 不使指纹退化为 null，指纹计算不读取无差异普通文件
  - id: host-input-normalization
    summary: 按当前宿主合同归一化 Codex、Claude Code 和 Cursor 的会话 ID、SessionStart 来源与 Stop 重入标识
    files:
      - hooks/entry.mjs
      - tests/hooks.test.mjs
    acceptance:
      - Codex、Claude Code 的 session_id/stop_hook_active 行为保持不变
      - Cursor 官方 session_id 与 conversation_id/loop_count payload 能建立快照、首次
        followup 并去重重入
  - id: stop-settlement
    summary: 修复待结算记录判定和证据绑定去重，使 resume、证据变化与验证重试保持阻断和可恢复语义
    files:
      - hooks/entry.mjs
      - tests/hooks.test.mjs
    acceptance:
      - resume 后存在 preflight 或 continuation 时不因指纹相等而放行
      - 去重记录绑定当前结算证据，内容、预检、继续包或验证收据变化后重新判定
  - id: semantic-evidence
    summary: 把生命周期 Evidence 与相关语义材料更新为实际的会话快照和失败去重行为，并刷新严格源码摘要
    files:
      - .echo-semantic/
    acceptance:
      - 语义材料不再声明连续失败 Stop 永不去重
      - strict snapshot 与语义合同验证通过
artifact_id: plan:208ae9b0-1ee1-42e3-8d24-08a4bd97eb07
lifecycle: completed
---
