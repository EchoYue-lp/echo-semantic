---
schema_version: 1
id: discovery.initial-baseline
kind: discovery
source_snapshot:
  base_revision: efd7c18252b749d0d1b399bfbf449bf081e69e8c
  content_digest: dc28a20c48961826c028d86b3b6bcef6c0951ac085fec34fc2ee936bf8270380
scope: 插件工作流、生命周期门禁、语义整合、连续性门禁和三宿主分发
inspected_paths:
  [
    skills,
    agents,
    hooks,
    scripts,
    bin,
    action.yml,
    .codex-plugin,
    .cursor-plugin,
    .claude-plugin,
  ]
candidate_refs:
  [map.semantic-workflow, map.lifecycle-enforcement, map.host-distribution, map.semantic-consolidation, map.semantic-continuity]
unresolved:
  - Cursor 完整 Hook 生命周期仍需按具体宿主版本、配置和信任状态记录
  - Windows 三宿主安装和卸载验收
---

# 首次基线发现

## 扫描范围

覆盖插件的用户入口、只读角色、Hook、校验器、安装器、宿主清单、Action、文档和测试。

## 候选事实

候选事实按语义工作流、生命周期门禁、老项目整合、语义连续性和多宿主分发归并。

## 归并结果

形成五个 Capability Map、五个 Behavior、四个 Rule 和五项可复用 Evidence。

## 未决项

Cursor 完整生命周期与 Windows 真实宿主证据尚未取得，行为模型保持开放。
