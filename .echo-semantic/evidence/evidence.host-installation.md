---
schema_version: 1
id: evidence.host-installation
kind: evidence
observed_at: source:502233233033ff11554f18edff940878414cd522bf58d94de3481b7721d84f11
source_refs:
  - bin/install.mjs#installCodex
  - bin/install.mjs#installClaude
  - bin/install.mjs#installCursor
  - bin/install.mjs#function packedRelativePaths
  - bin/install.mjs#function copyPackedFiles
  - bin/install.mjs#function stageDistribution
  - scripts/validate-package.mjs#分发包内容校验通过
  - scripts/validate-plugin.mjs#Claude marketplace version 与 package.json 不一致
  - tests/installer.test.mjs#Cursor 单渠道安装、覆盖和卸载
  - tests/installer.test.mjs#Codex 重命名安装清理旧 Hook、Agent 和状态
  - tests/installer.test.mjs#分发 staging 失败时保留现有副本
  - docs/host-support.md#验证等级
  - docs/ci-integration.md#推荐 Pull Request 工作流
supports: [behavior.multi-host-installation]
limitations:
  - Windows 宿主尚未执行真实安装
  - Cursor 窗口已由维护者手工检查；完整运行时 Hook 证据仍需按宿主版本记录
  - 当前 Cursor 拒绝指向 `plugins/local` 之外的符号链接，安装必须使用普通目录镜像
---

# 多宿主安装证据

## 支持的结论

安装器能够使用 Codex 和 Claude Code 原生 marketplace，并以可逆普通目录镜像安装 Cursor 插件；三宿主真实卸载后没有本插件残留，随后重新安装成功。
跨克隆测试证明新来源可以直接覆盖 Cursor 内容，重命名回归证明新 `echo-semantic` 安装会删除旧用户 Hook、Agent 和安装状态，并改由插件原生 Hook 提供来源归属。分发包校验和安装回归确保长期语义材料随插件发布，同时从宿主分发副本排除项目运行态文件和 Python 缓存；staging 失败不会破坏仍被其它渠道使用的现有副本。当前 Cursor 日志已证明跨目录 symlink 会被 `loadUserLocalPlugin` 拒绝。

## 来源与范围

来源为安装器实现、幂等/跨克隆覆盖/零残留测试和本机宿主插件列表。

## 已知缺口

没有发布 marketplace 或版本标签，Windows 和 Claude Code 登录会话仍需后续验收；Cursor 窗口已完成手工检查。
