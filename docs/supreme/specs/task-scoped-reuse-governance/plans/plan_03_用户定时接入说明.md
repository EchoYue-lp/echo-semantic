---
schema_version: 4
slug: task-scoped-reuse-governance/scheduled-scan
outcome:
  summary: 提供用户自行配置外部定时调用的接入说明与验收方法；是否启用、周期、目标仓库和执行环境由用户决定，插件不内置固定调度。
  acceptance:
    - 使用者可按文档通过通用外部调度与 cron 示例调用同一扫描入口；路径、周期和环境都是用户输入，不安装或启用任何真实定时任务。
    - 隔离仓库实测命令和示例脚本的成功、失效确认与报告保存；说明真实触发、退出码、结果与失败呈现的验收步骤，并区分静态扫描与 Agent 语义调查。
    - npm test、npm run verify 通过；完成版本与分发一致性检查后，只将本地新版安装到
      Codex，核对登记、启用状态和缓存内容，不以安装登记冒充新会话加载验收。
out_of_scope:
  - 不替用户配置周期、创建 cron/宿主自动任务或 CI 定时部署，不内置调度器。
  - 不安装或修改 Cursor、Claude Code 的插件登记与缓存；不提交、推送或公开发布。
  - 不自动确认扫描候选或修改采用方正式基线；真实宿主重载或新会话验收缺少现场证据时明确保留。
design_ref: docs/supreme/specs/task-scoped-reuse-governance/design.md
design_sections:
  - ref: design.md § 外部定时配置责任
    digest: sha256:639bf22a40929b07fcea3672c1e5efc0b24e1b1e6a00fea7926482d6d7d34fc9
  - ref: design.md § 全项目治理
    digest: sha256:468b72c1c2ea076e752b659abcb22574f8b2da6988eed438f92efd783e444066
  - ref: design.md § 范围与非目标
    digest: sha256:a9fa660e1be6843c488a57c4d93e42756639c1464f4561fee65c20f58a1f30ac
delivery_ref: docs/supreme/specs/task-scoped-reuse-governance/plans/delivery-map.md#scheduled-scan
todos:
  - id: user-configured-examples
    summary: 补齐通用调度和 cron 的可配置调用示例及验收步骤，将新文档接入现有入口。
    files:
      - docs/
      - README.md
      - skills/semantic-discover/SKILL.md
    acceptance:
      - 可复制的扫描包装示例只读取用户提供的插件路径、项目路径和工具环境；没有固定仓库或周期、自动确认或任务登记副作用。
      - 验收涵盖先手动运行、模拟调度环境、实际周期触发、相同快照幂等、源码变化、非零失败、报告过期、暂停与恢复；未部署的真实触发不能声称通过。
      - 关键命令与 POSIX cron 格式有可复核依据；通过临时仓库执行实际片段验证，长期报告与 stdout/stderr 保存边界明确。
  - id: codex-local-candidate
    summary: 同步新版本地候选元数据、迁移说明和分发验收，完成用户授权的 Codex 安装。
    files:
      - package.json
      - .codex-plugin/plugin.json
      - .cursor-plugin/plugin.json
      - .claude-plugin/plugin.json
      - .claude-plugin/marketplace.json
      - CHANGELOG.md
      - docs/
      - README.md
      - tests/manifests.test.mjs
      - bin/install.mjs
      - .echo-semantic/
    acceptance:
      - 新版本区分既有安装内容，版本测试与所有宿主源清单一致；记录预检 v2、扫描写入边界和旧收据失效，不创建公共 tag 或发布。
      - 调用现有 install codex 入口，仅改变本插件 Codex 安装；源、分发副本与 Codex 缓存一致，用户其他插件及
        Cursor/Claude Code 已安装副本保持。
      - 核对 Codex 已登记版本和 enabled 状态，沿用用户对启用的答复；无答复保留既有禁用状态。真实 Hook 加载另行报告。
artifact_id: plan:ed440382-48a1-4564-a51e-37b233065b82
lifecycle: completed
---

## Notes

前两个 Outcome 已有本对话独立审查与 100 Node、75 Python、完整 verify 成功证据。用户本轮明确授权补齐文档后安装到 Codex。本机 Codex CLI 0.162.0-alpha.17.2 的 plugin help 已核对；旧 Echo Semantic 0.4.0 当前 disabled。定时工作由用户配置，本 Plan 只交付接入示例与验收方法，不执行真实调度。
