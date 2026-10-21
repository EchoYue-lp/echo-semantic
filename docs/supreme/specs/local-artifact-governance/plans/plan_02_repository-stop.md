---
schema_version: 4
slug: local-artifact-governance/repository-stop
outcome:
  summary: 显式全项目验证通过后Stop能生成真实范围收据并结算Baseline任务，普通任务保持局部验证。
  acceptance:
    - 真实源码Hook夹具覆盖task拒绝Baseline、repository通过、范围错配和失效收据。
    - npm test和npm run verify通过；最终严格源码与保护差异核对通过。
out_of_scope:
  - 安装插件、改写宿主缓存或宣称GUI验收
  - 提交、推送、发布和SDK存量清理
design_ref: docs/supreme/specs/local-artifact-governance/design.md
design_sections:
  - ref: design.md § 显式全项目 Stop 结算补充设计
    digest: sha256:0ba832da05795ab0d9940749132e65278d654515c4f1f34406446c9266b1fbcc
delivery_ref: null
todos:
  - id: explicit-scope
    summary: 预检显式记录并校验完成范围，局部默认不变。
    files:
      - scripts/preflight_contract.py
      - skills/semantic-preflight/scripts/preflight.py
      - runtime/route.mjs
      - tests/test_preflight.py
      - tests/test_preflight_contract.py
    acceptance:
      - 旧记录默认task；无效范围和显式范围错配失败。
  - id: verified-stop
    summary: 全项目完成校验与Hook收据绑定真实范围和内容。
    files:
      - skills/semantic-contract/scripts/verify_semantic.py
      - hooks/entry.mjs
      - tests/hooks.test.mjs
      - tests/test_task_validation.py
      - runtime/project-state.mjs
    acceptance:
      - Baseline只有显式repository记录完成严格校验后才能结算。
      - 失败不消费预检、不产生成功收据，重入和内容变化仍受现有保护。
  - id: scope-docs
    summary: 完成范围和证据限制同步到现有文档与语义材料。
    files:
      - skills/semantic-preflight/SKILL.md
      - skills/semantic-contract/SKILL.md
      - skills/semantic-contract/references/semantic-artifact-contract.md
      - docs/command-reference.md
      - .echo-semantic
    acceptance:
      - 明确源码验证、安装与真实宿主验收边界。
artifact_id: plan:83f6b7a7-4ae8-49fa-9fb7-fe6d9891d274
lifecycle: completed
---
