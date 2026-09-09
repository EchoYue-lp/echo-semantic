---
schema_version: 1
id: map.host-distribution
kind: capability_map
title: Codex、Cursor 与 Claude Code 分发
risk: medium
observed_at: source:06fba8cfe0fd5119da378b2fed47d276171530e4fcfa3caf1248f3f247fb79a5
boundary_refs: [boundary.host-distribution]
behavior_refs: [behavior.multi-host-installation]
rule_refs: [rule.single-semantic-authority]
evidence_refs: [evidence.host-installation]
finding_refs: []
audit_refs: []
related_map_refs: [map.semantic-workflow, map.lifecycle-enforcement]
scenarios:
  codex-install:
    status: mapped
    source_refs: [bin/install.mjs#installCodex]
    evidence_refs: [evidence.host-installation]
  claude-install:
    status: mapped
    source_refs: [bin/install.mjs#installClaude]
    evidence_refs: [evidence.host-installation]
  cursor-install:
    status: needs_review
    source_refs: [bin/install.mjs#installCursor]
    unknown: 窗口重载后插件与 Hook 是否由当前 Cursor 版本完整发现
    next_step: 在运行中的 Cursor 重载窗口并执行显式探针
---

# 多宿主分发

## 能力范围

覆盖三宿主 manifest、marketplace、安装、更新、卸载、Agent 投影和所有权记录。

## 入口与输出

统一安装器按宿主返回 `installed`、`skipped`、`failed`、`rolled_back` 或 `manual_action`。

## 行为关系

Codex 和 Claude Code 使用原生 marketplace；Cursor 使用用户本地插件链接。

## 状态与数据流

安装状态保存在用户目录，只记录本插件拥有的注册项和路径。

## 策略来源与优先级

宿主原生命令优先于配置合并；Codex Agent 和 Hook 的必要投影由安装器拥有。

## 生命周期与失败路径

当前宿主安装直接覆盖本插件对应内容；`all` 对未安装宿主返回 `skipped`，不抹掉其它宿主的独立结果。

## 权限与敏感信息

安装器不读取凭据，不覆盖非本插件拥有的 Agent、Hook 或 Cursor 路径。

## 用户侧投影

README 提供统一命令和每个宿主的重载要求。

## 场景处置清单

Codex、Claude Code 已取得安装与生命周期证据；Cursor 安装完成，运行时仍待重载验收；跨克隆覆盖和悬空链接已有回归证据。

## 未展开项

发布标签、公开 marketplace 收录和 Windows 真实宿主验收尚未执行。
