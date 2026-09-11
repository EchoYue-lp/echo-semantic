---
schema_version: 1
id: discovery.semantic-assets
kind: discovery
source_snapshot:
  base_revision: 4126cf7af446343ff578b8458f4664823f6d9e59
  content_digest: cfb2215be6b5497724b8b10c53de409983cd8364d67ef818959a5cc3247600ac
scope: Git 可见路径、公开符号、入口、状态权威、协议字段、测试消费者和文档引用
inspected_paths:
  - .agents/plugins/marketplace.json
  - .claude-plugin/marketplace.json
  - .claude-plugin/plugin.json
  - .codex-plugin/plugin.json
  - .cursor-plugin/plugin.json
  - .github/workflows/ci.yml
  - .gitignore
  - .npmignore
  - AGENTS.md
  - CHANGELOG.md
  - CODE_OF_CONDUCT.md
  - CONTRIBUTING.md
  - README.md
  - SECURITY.md
  - action.yml
  - agents/semantic-boundary-explorer.md
  - agents/semantic-capability-reviewer.md
  - agents/semantic-risk-reviewer.md
  - bin/install.mjs
  - docs/README.md
  - docs/adr/0001-multi-host-layered-enforcement.md
  - docs/adr/0002-semantic-consolidation.md
  - docs/ci-integration.md
  - docs/command-reference.md
  - docs/concepts.md
  - docs/faq.md
  - docs/getting-started.md
  - docs/host-support.md
  - docs/multi-host-adapters.md
  - docs/releasing.md
  - docs/supreme/specs/plugin-architecture/design.md
  - docs/supreme/specs/plugin-architecture/plans/plan_01_老项目语义整合闭环.md
  - docs/troubleshooting.md
  - hooks/entry.mjs
  - hooks/hooks-cursor.json
  - hooks/hooks.json
  - hooks/plugin-entry.mjs
  - package.json
  - runtime/capabilities/claude-code.json
  - runtime/capabilities/codex.json
  - runtime/capabilities/cursor.json
  - runtime/capabilities/load.mjs
  - runtime/capabilities/probe.mjs
  - runtime/capabilities/schema.json
  - runtime/continuation.mjs
  - runtime/project-state.mjs
  - runtime/route.mjs
  - scripts/governance_contract.py
  - scripts/preflight_contract.py
  - scripts/validate-package.mjs
  - scripts/validate-plugin.mjs
  - skills/semantic-audit/SKILL.md
  - skills/semantic-consolidate/SKILL.md
  - skills/semantic-consolidate/scripts/consolidate.py
  - skills/semantic-contract/SKILL.md
  - skills/semantic-contract/references/semantic-artifact-contract.md
  - skills/semantic-contract/scripts/verify_semantic.py
  - skills/semantic-decide/SKILL.md
  - skills/semantic-diff/SKILL.md
  - skills/semantic-discover/SKILL.md
  - skills/semantic-discover/scripts/inventory.py
  - skills/semantic-preflight/SKILL.md
  - skills/semantic-preflight/references/routing-cases.md
  - skills/semantic-preflight/scripts/preflight.py
  - skills/semantic-preflight/workflows/architecture-convergence.md
  - skills/semantic-repair/SKILL.md
  - skills/semantic-status/SKILL.md
  - skills/semantic-status/scripts/status.py
  - skills/semantic-verify/SKILL.md
  - tests/continuation.test.mjs
  - tests/fixtures/preflight-contract.json
  - tests/hooks.test.mjs
  - tests/installer.test.mjs
  - tests/manifests.test.mjs
  - tests/preflight-contract.test.mjs
  - tests/project-state.test.mjs
  - tests/route.test.mjs
  - tests/status.test.mjs
  - tests/test_consolidate.py
  - tests/test_equivalence.py
  - tests/test_inventory.py
  - tests/test_preflight.py
  - tests/test_preflight_contract.py
candidate_refs: []
unresolved:
  - skills/semantic-discover/scripts/inventory.py
  - tests/test_inventory.py
---

# 语义资产发现

## 扫描范围

已扫描 Git 可见路径。

## 候选事实

已记录资产身份和同名符号候选。

## 归并结果

候选只等待人工归并，不自动删除。

## 未决项

动态注册、反射和运行时配置保持未知。
