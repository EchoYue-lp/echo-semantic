---
schema_version: 1
id: baseline.repository
kind: baseline
source_snapshot:
  base_revision: efd7c18252b749d0d1b399bfbf449bf081e69e8c
  content_digest: 1c5fa5c28a0ab233e3670eef7d4ee538b875b17dc762918f02f3b780bdd1ff71
inventory_closure: closed
behavior_model_closure: open
map_refs:
  - map.semantic-workflow
  - map.lifecycle-enforcement
  - map.host-distribution
regions:
  - path: .agents
    status: supporting
  - path: .claude-plugin
    status: supporting
  - path: .codex-plugin
    status: supporting
  - path: .cursor-plugin
    status: supporting
  - path: .github
    status: supporting
  - path: .gitignore
    status: supporting
  - path: AGENTS.md
    status: supporting
  - path: README.md
    status: supporting
  - path: action.yml
    status: in_scope
  - path: agents
    status: in_scope
  - path: bin
    status: in_scope
  - path: docs
    status: supporting
  - path: hooks
    status: in_scope
  - path: package.json
    status: supporting
  - path: scripts
    status: in_scope
  - path: runtime
    status: in_scope
  - path: skills
    status: in_scope
  - path: tests
    status: supporting
boundaries:
  - id: boundary.semantic-workflow
    map_ref: map.semantic-workflow
    risk: high
  - id: boundary.lifecycle-enforcement
    map_ref: map.lifecycle-enforcement
    risk: high
  - id: boundary.host-distribution
    map_ref: map.host-distribution
    risk: medium
coverage:
  - {region: skills, lens: trigger_input, status: covered, refs: [map.semantic-workflow]}
  - {region: skills, lens: result_side_effect, status: covered, refs: [behavior.preflight-before-write]}
  - {region: skills, lens: state_authority, status: covered, refs: [rule.single-semantic-authority]}
  - {region: skills, lens: data_durability, status: not_applicable, reason: Skill 不保存业务状态}
  - {region: skills, lens: time_lifecycle, status: covered, refs: [map.semantic-workflow]}
  - {region: skills, lens: failure_concurrency, status: covered, refs: [behavior.post-change-verification]}
  - {region: skills, lens: permission_external, status: not_applicable, reason: Skill 不新增权限边界}
  - {region: skills, lens: contract_evidence, status: covered, refs: [evidence.semantic-workflow]}
  - {region: agents, lens: trigger_input, status: covered, refs: [map.semantic-workflow]}
  - {region: agents, lens: result_side_effect, status: covered, refs: [rule.single-semantic-authority]}
  - {region: agents, lens: state_authority, status: covered, refs: [rule.single-semantic-authority]}
  - {region: agents, lens: data_durability, status: not_applicable, reason: 只读 Agent 不保存长期状态}
  - {region: agents, lens: time_lifecycle, status: covered, refs: [map.semantic-workflow]}
  - {region: agents, lens: failure_concurrency, status: covered, refs: [map.semantic-workflow]}
  - {region: agents, lens: permission_external, status: covered, refs: [rule.single-semantic-authority]}
  - {region: agents, lens: contract_evidence, status: covered, refs: [evidence.semantic-workflow]}
  - {region: hooks, lens: trigger_input, status: covered, refs: [map.lifecycle-enforcement]}
  - {region: hooks, lens: result_side_effect, status: covered, refs: [behavior.post-change-verification]}
  - {region: hooks, lens: state_authority, status: covered, refs: [rule.high-risk-evidence]}
  - {region: hooks, lens: data_durability, status: covered, refs: [evidence.lifecycle-hooks]}
  - {region: hooks, lens: time_lifecycle, status: covered, refs: [map.lifecycle-enforcement]}
  - {region: hooks, lens: failure_concurrency, status: covered, refs: [behavior.post-change-verification]}
  - {region: hooks, lens: permission_external, status: covered, refs: [map.lifecycle-enforcement]}
  - {region: hooks, lens: contract_evidence, status: covered, refs: [evidence.lifecycle-hooks]}
  - {region: scripts, lens: trigger_input, status: covered, refs: [map.lifecycle-enforcement]}
  - {region: scripts, lens: result_side_effect, status: covered, refs: [behavior.post-change-verification]}
  - {region: scripts, lens: state_authority, status: covered, refs: [rule.high-risk-evidence]}
  - {region: scripts, lens: data_durability, status: covered, refs: [evidence.lifecycle-hooks]}
  - {region: scripts, lens: time_lifecycle, status: covered, refs: [map.lifecycle-enforcement]}
  - {region: scripts, lens: failure_concurrency, status: covered, refs: [behavior.post-change-verification]}
  - {region: scripts, lens: permission_external, status: not_applicable, reason: 校验脚本不申请外部权限}
  - {region: scripts, lens: contract_evidence, status: covered, refs: [rule.high-risk-evidence]}
  - {region: runtime, lens: trigger_input, status: covered, refs: [map.semantic-workflow]}
  - {region: runtime, lens: result_side_effect, status: covered, refs: [behavior.post-change-verification]}
  - {region: runtime, lens: state_authority, status: covered, refs: [rule.single-semantic-authority]}
  - {region: runtime, lens: data_durability, status: not_applicable, reason: 路由状态不是业务持久化}
  - {region: runtime, lens: time_lifecycle, status: covered, refs: [map.lifecycle-enforcement]}
  - {region: runtime, lens: failure_concurrency, status: covered, refs: [behavior.post-change-verification]}
  - {region: runtime, lens: permission_external, status: not_applicable, reason: 路由器不申请外部权限}
  - {region: runtime, lens: contract_evidence, status: covered, refs: [evidence.semantic-workflow]}
  - {region: bin, lens: trigger_input, status: covered, refs: [map.host-distribution]}
  - {region: bin, lens: result_side_effect, status: covered, refs: [behavior.multi-host-installation]}
  - {region: bin, lens: state_authority, status: covered, refs: [rule.single-semantic-authority]}
  - {region: bin, lens: data_durability, status: covered, refs: [evidence.host-installation]}
  - {region: bin, lens: time_lifecycle, status: covered, refs: [map.host-distribution]}
  - {region: bin, lens: failure_concurrency, status: covered, refs: [behavior.multi-host-installation]}
  - {region: bin, lens: permission_external, status: covered, refs: [map.host-distribution]}
  - {region: bin, lens: contract_evidence, status: covered, refs: [evidence.host-installation]}
  - {region: action.yml, lens: trigger_input, status: covered, refs: [map.lifecycle-enforcement]}
  - {region: action.yml, lens: result_side_effect, status: covered, refs: [behavior.post-change-verification]}
  - {region: action.yml, lens: state_authority, status: covered, refs: [rule.high-risk-evidence]}
  - {region: action.yml, lens: data_durability, status: not_applicable, reason: Action 只读取检出内容}
  - {region: action.yml, lens: time_lifecycle, status: covered, refs: [map.lifecycle-enforcement]}
  - {region: action.yml, lens: failure_concurrency, status: covered, refs: [behavior.post-change-verification]}
  - {region: action.yml, lens: permission_external, status: covered, refs: [rule.engineering-tools-own-style]}
  - {region: action.yml, lens: contract_evidence, status: covered, refs: [evidence.lifecycle-hooks]}
---

# 插件语义基线

## 源码快照

基线绑定初始提交谱系和当前非 `semantic/` 内容摘要。摘要变化必须由 `semantic-diff` 更新。

## 仓库区域

运行时工作流、Hook、校验器、安装器和 Action 为主要范围；manifest、文档、测试和工程元数据为支撑范围。

## 能力图与边界

三个边界分别拥有语义工作流、生命周期执行和宿主分发，不共享第二状态权威。

## 覆盖网格

核心运行路径的八个风险视角已有明确去向；支撑文件通过区域分类进入增量影响检查。

## 未知与缺口

Cursor 需要窗口重载后的真实插件与 Hook 验收。Claude Code 当前 CLI 未登录，只验证了插件安装和认证失败前的生命周期事件。

## 闭合结论

路径库存已闭合。行为模型保持开放，直到三个宿主的更新、卸载和完整新会话链路都取得新鲜证据。
