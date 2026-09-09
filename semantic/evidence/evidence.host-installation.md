---
schema_version: 1
id: evidence.host-installation
kind: evidence
observed_at: source:06fba8cfe0fd5119da378b2fed47d276171530e4fcfa3caf1248f3f247fb79a5
source_refs:
  - bin/install.mjs#installCodex
  - bin/install.mjs#installClaude
  - bin/install.mjs#installCursor
  - tests/installer.test.mjs#Cursor 单渠道安装、覆盖和卸载
supports: [behavior.multi-host-installation]
limitations:
  - Windows 宿主尚未执行真实安装
  - Cursor 需要重载窗口后验证运行时发现
---

# 多宿主安装证据

## 支持的结论

安装器能够使用 Codex 和 Claude Code 原生 marketplace，并以可逆链接覆盖安装 Cursor 插件；三宿主真实卸载后没有本插件残留，随后重新安装成功。跨克隆测试证明新来源可以直接覆盖 Cursor 内容。

## 来源与范围

来源为安装器实现、幂等/跨克隆覆盖/零残留测试和本机宿主插件列表。

## 已知缺口

没有发布 marketplace 或版本标签，Windows 和 Cursor GUI 仍需后续验收。
