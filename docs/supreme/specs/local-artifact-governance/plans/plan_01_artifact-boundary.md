---
schema_version: 4
slug: local-artifact-governance/plan
outcome:
  summary: 插件统一本地产物并阻断明确不可提交的产物，长期Evidence保持精简可追溯。
  acceptance:
    - npm test 与 npm run verify 通过。
    - 任务范围检查完成；正式 Baseline 更新由显式全项目严格校验验证，未接管已有差异保持原样。
    - 目录准备、暂存区与候选tree、扫描摘要、引用和分发回归覆盖设计边界。
out_of_scope:
  - SDK存量删除或历史重写
  - 提交、推送、发布、安装宿主插件或Git Hook
  - 自动清理、自动归档上传和保留期限调度
design_ref: docs/supreme/specs/local-artifact-governance/design.md
design_sections:
  - ref: design.md § 目标行为
    digest: sha256:f3a795676d0172dbce6dca62625e5fe10f6ea3339748ebc16ee817cd5fe32960
  - ref: design.md § 核心结构与数据流方案
    digest: sha256:d0aa19f3271c8d490dc2f9c0f7694fd0052146a5234093ef18a0caeff3da0744
  - ref: design.md § 异常与边界场景
    digest: sha256:de80359a556f8a89d8b83d6c7e28db0005fba3e9fd6def86417ea12b42ea152b
  - ref: design.md § 验收标准
    digest: sha256:960b6a2b2034c529e7b1d63c708a6d4de19775f8854ae05c045e3fddedfce5b4
delivery_ref: null
todos:
  - id: local-output
    summary: 安全准备统一任务产物目录并自动忽略，扫描与源码身份不吸收本地产物。
    files:
      - runtime/project-state.mjs
      - scripts/artifacts.mjs
      - skills/semantic-contract/scripts/verify_semantic.py
      - tests/project-state.test.mjs
      - tests/test_artifacts.py
    acceptance:
      - 有效目录不增加Git产物，非法标识、符号链接、忽略失败和已跟踪路径明确失败。
      - local内容变化不改变源码摘要，也不能作为正式源码引用。
  - id: delivery-check
    summary: 同一确定性规则检查索引及候选提交并隔离分发。
    files:
      - scripts/artifact_contract.py
      - scripts/validate-package.mjs
      - .npmignore
      - action.yml
      - tests/test_artifacts.py
      - tests/artifacts.test.mjs
    acceptance:
      - 强制暂存、重命名和特殊路径可核对；清理删除及正常fixture通过。
      - 新疑似原始产物只提示；运行态和local确定阻断，分发无local内容。
  - id: workflow-closeout
    summary: 长期Evidence和任务收口规则同步到Skill、文档与受影响语义材料。
    files:
      - skills/semantic-preflight/SKILL.md
      - skills/semantic-verify/SKILL.md
      - skills/semantic-discover/SKILL.md
      - skills/semantic-contract/references/semantic-artifact-contract.md
      - README.md
      - docs
      - AGENTS.md
      - .echo-semantic
    acceptance:
      - 无需每轮归档原件，任务产物位置和原件不可获取限制明确。
      - 已有语义义务保留，最终设计和执行结果可审阅。
artifact_id: plan:90497556-60f3-47b1-b1cf-2deb4284627a
lifecycle: completed
---
