---
schema_version: 1
id: behavior.multi-host-installation
kind: behavior
status: needs_review
expectation: inferred
risk: medium
primary_focus: time_lifecycle
focus: [permission_external, data_durability]
boundary: boundary.host-distribution
observed_at: source:06fba8cfe0fd5119da378b2fed47d276171530e4fcfa3caf1248f3f247fb79a5
code_refs:
  - bin/install.mjs#function main
  - .codex-plugin/plugin.json#echo-coding-semantic-governance
  - .cursor-plugin/plugin.json#echo-coding-semantic-governance
  - .claude-plugin/plugin.json#echo-coding-semantic-governance
rule_refs: [rule.single-semantic-authority]
evidence_refs: [evidence.host-installation]
finding_refs: []
---

# 多宿主安装行为

## 重要承诺

一次安装可以独立处理 Codex、Cursor 和 Claude Code，并只卸载本插件拥有的内容。

## 当前行为

Codex 与 Claude Code 使用原生 marketplace；Cursor 使用指向当前克隆的用户级链接。

## 期望行为

重复安装幂等；跨克隆来源变化直接覆盖本插件对应宿主内容，不撤回其它宿主；`all` 先检测宿主，单宿主缺失返回 `manual_action`。

## 触发、结果与副作用

用户运行安装器后写入宿主注册、必要投影和插件私有安装状态。

## 失败、重试与恢复

provider 返回独立状态；安装器不维护事务性迁移，单个宿主失败不隐藏其它宿主结果，完整卸载删除私有状态目录。

## 证据

本机 Codex、Claude Code 安装可见；Cursor 链接可见，窗口重载验收仍待完成。

## 裁决记录

当前没有风险接受记录。
