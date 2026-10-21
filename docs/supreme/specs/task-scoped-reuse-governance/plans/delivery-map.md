---
schema_version: 1
artifact: delivery-map
design_ref: docs/supreme/specs/task-scoped-reuse-governance/design.md
outcomes:
  daily-reuse:
    ships: 日常开发在有无语义基线时均完成一次有依据的复用检查、轻量写入准入和影响范围内验证，保持全项目治理可显式调用。
    depends_on: []
  full-scan-candidates:
    ships: 全项目扫描在一致源码快照上生成可追溯报告与待确认候选，确认并核对当前源码后才能更新正式语义基线。
    depends_on:
      - daily-reuse
  scheduled-scan:
    ships: 提供用户自行配置外部定时调用的接入说明与验收方法；是否启用、周期、目标仓库和执行环境由用户决定，插件不内置固定调度。
    depends_on:
      - full-scan-candidates
design_revision: sha256:5921aaf8205e3fdc1f6399492f8ce13b708b4b1421d5c9f791be78f9cd85cda6
---
