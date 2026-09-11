---
schema_version: 1
id: map.host-distribution
kind: capability_map
title: Codex、Cursor 与 Claude Code 分发
risk: medium
observed_at: source:502233233033ff11554f18edff940878414cd522bf58d94de3481b7721d84f11
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
    status: mapped
    source_refs:
      [bin/install.mjs#installCursor, bin/install.mjs#function copyPackedFiles]
    evidence_refs: [evidence.host-installation]
    unknown: 窗口重载后的真实 sessionStart / preToolUse / stop 事件
    next_step: 重新加载 Cursor 窗口并在新会话执行显式探针
---

# 多宿主分发

## 能力范围

覆盖 GitHub 仓库地址、三宿主 manifest、marketplace、安装、更新、卸载、Agent 投影和所有权记录。

## 入口与输出

统一安装器按宿主返回 `installed`、`removed`、`skipped`、`failed` 或 `manual_action`。

## 行为关系

Codex 和 Claude Code 从按发布白名单生成的用户级分发副本使用原生 marketplace；Cursor 使用同一白名单在 `~/.cursor/plugins/local` 生成普通目录镜像。

## 状态与数据流

安装状态保存在用户目录，只记录本插件拥有的注册项和路径。分发副本是可覆盖、可删除的安装投影，不保存项目语义事实。

## 策略来源与优先级

宿主原生命令优先于配置合并；Codex Agent 和 Hook 的必要投影由安装器拥有。

## 生命周期与失败路径

当前宿主安装直接覆盖本插件对应内容；`all` 对未安装宿主返回 `skipped`，不抹掉其它宿主的独立结果。

## 权限与敏感信息

安装器不读取凭据，不覆盖非本插件拥有的 Agent、Hook 或 Cursor 路径。

## 用户侧投影

README 提供统一仓库地址、安装命令和每个宿主的重载要求；CI 文档提供新的 GitHub Action 引用地址。

## 场景处置清单

Codex 已取得安装和入口执行证据；Claude Code 已取得安装及认证失败前事件证据，完整登录会话仍待验收；Cursor 改为实目录镜像以通过当前宿主的符号链接限制，运行时仍待窗口重载后的新会话验收；跨克隆覆盖和悬空链接已有回归证据。

## 未展开项

发布标签、公开 marketplace 收录和 Windows 真实宿主验收尚未执行。
