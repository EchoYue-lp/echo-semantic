---
schema_version: 1
id: discovery.initial-baseline
kind: discovery
source_snapshot:
  base_revision: efd7c18252b749d0d1b399bfbf449bf081e69e8c
  content_digest: cfb2215be6b5497724b8b10c53de409983cd8364d67ef818959a5cc3247600ac
scope: 插件工作流、生命周期门禁和三宿主分发
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
  [map.semantic-workflow, map.lifecycle-enforcement, map.host-distribution]
unresolved:
  - Cursor 窗口重载后的真实插件与 Hook 验收
  - Windows 三宿主安装和卸载验收
---

# 首次基线发现

## 扫描范围

覆盖插件的用户入口、只读角色、Hook、校验器、安装器、宿主清单、Action、文档和测试。

## 候选事实

候选事实按语义工作流、生命周期门禁和多宿主分发归并。

## 归并结果

形成三个 Capability Map、三个 Behavior、三个 Rule 和三项可复用 Evidence。

## 未决项

Cursor GUI 与 Windows 真实宿主证据尚未取得，行为模型保持开放。
