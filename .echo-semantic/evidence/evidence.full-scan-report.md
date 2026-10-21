---
schema_version: 1
id: evidence.full-scan-report
kind: evidence
observed_at: source:323d9d10e27ceb3a901d3b923bb58982aa6efcc4cbf919bfab17ad0abbd0ec18
source_refs:
  - skills/semantic-discover/scripts/inventory.py#def capture
  - skills/semantic-discover/scripts/inventory.py#def check_report
  - scripts/scan_contract.py#validate_scan_report
  - scripts/record-scan.mjs
  - tests/test_inventory.py#test_scan_detects_mid_analysis_change_and_does_not_publish
  - tests/test_inventory.py#test_save_preserves_formal_material_and_runtime_and_is_idempotent
  - tests/test_inventory.py#test_concurrent_publication_keeps_one_complete_report
  - tests/test_consolidate.py
  - docs/scheduled-scanning.md#示例一
  - scripts/artifacts.mjs
supports: [behavior.semantic-consolidation]
limitations:
  - 静态盘点不证明生产可达、行为等价或全项目行为闭合
  - 排除路径和不支持的解析保持未知，不读取已识别密钥内容
  - 并发和失效检查使用临时仓库夹具，不是实际宿主定时触发证据
---

# 全项目扫描候选报告证据

## 支持的结论

扫描从同一内容快照提取候选并检查变化。保存锁内再次核对当前扫描，用不可覆盖原子报告保留待确认线索；确认入口核对当前源码，不修改正式基线或任务记录。

外部定时接入由用户选择工具环境、项目、周期与任务标识；文档包装脚本通过 artifacts prepare 获取 ignored local/task 目录，完整 JSON、诊断和临时脚本留在本地产物或 CI Artifact。必要长期 Discovery 报告与完整运行输出分别管理，不自动设置调度器、确认候选或更新基线。

## 来源与范围

夹具覆盖中途源码变化、并发发布、固定内容损坏、过期确认和现有语义/任务运行态保护。旧归并 --write 只保存报告，不产生删除授权。

## 已知缺口

真正的 Agent 语义调查和后续基线维护依赖用户确认与工程证据；外部定时执行属于后续交付，未安装或验证新宿主会话。
