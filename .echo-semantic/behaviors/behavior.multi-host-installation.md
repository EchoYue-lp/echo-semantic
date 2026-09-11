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
observed_at: source:cfb2215be6b5497724b8b10c53de409983cd8364d67ef818959a5cc3247600ac
code_refs:
  - bin/install.mjs#function main
  - bin/install.mjs#function packedRelativePaths
  - bin/install.mjs#function copyPackedFiles
  - bin/install.mjs#function stageDistribution
  - bin/install.mjs#function installCursor
  - hooks/hooks.json#SessionStart
  - .codex-plugin/plugin.json#echo-semantic
  - .cursor-plugin/plugin.json#echo-semantic
  - .claude-plugin/plugin.json#echo-semantic
rule_refs: [rule.single-semantic-authority]
evidence_refs: [evidence.host-installation]
finding_refs: []
---

# 多宿主安装行为

## 重要承诺

一次安装可以独立处理 Codex、Cursor 和 Claude Code，并只卸载本插件拥有的内容。

## 当前行为

GitHub 仓库、插件 ID 和 marketplace 名统一为 `echo-semantic`；Codex 与 Claude Code 使用按发布白名单生成的用户级分发副本接入原生 marketplace，Cursor 使用同一白名单复制到 `~/.cursor/plugins/local/echo-semantic` 普通目录。当前 Cursor 会拒绝指向该目录之外的符号链接。

## 期望行为

重复安装幂等；跨克隆来源变化直接覆盖本插件对应宿主内容，不撤回其它宿主；`all` 先检测宿主，单宿主缺失返回 `manual_action`。
安装 `echo-semantic` 时清理旧 ID `echo-coding-semantic-governance` 的宿主注册和本地投影，并清理旧版本用户级 Hook，避免两个身份或两套 Hook 来源并存。

## 触发、结果与副作用

用户运行安装器后写入宿主注册、必要投影和插件私有安装状态。Codex 与 Claude Code 共用可覆盖的干净分发副本；该副本不是项目语义权威。

## 失败、重试与恢复

provider 返回独立状态；安装器不维护事务性迁移，单个宿主失败不隐藏其它宿主结果，最后一个原生渠道卸载后删除分发副本，完整卸载删除私有状态目录。
GitHub 仓库重命名会重定向普通 Git 操作，但旧 GitHub Action `uses:` 地址不会重定向，使用方必须显式更新。

## 证据

本机 Codex、Claude Code 安装可见；Cursor 复制为 `~/.cursor/plugins/local` 下普通目录，符号链接会被当前 Cursor 拒绝。窗口重载后的真实 Hook 事件仍待新会话验收。

## 裁决记录

当前没有风险接受记录。
