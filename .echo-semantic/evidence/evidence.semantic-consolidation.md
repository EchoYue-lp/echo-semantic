---
schema_version: 1
id: evidence.semantic-consolidation
kind: evidence
observed_at: source:a4ecee189e667f957010fc16cdd97b3fbd01d12b5cdea339d40a96add5ffdc7b
source_refs:
  - skills/semantic-discover/scripts/inventory.py#scan
  - skills/semantic-consolidate/scripts/consolidate.py#write_finding
  - hooks/entry.mjs#isDeleteTool
  - skills/semantic-contract/scripts/verify_semantic.py#validate_change_evidence
supports: [map.semantic-consolidation, behavior.semantic-consolidation]
limitations:
  - 静态扫描不能证明反射、动态注册、配置路由和运行时可达性
  - 行为等价只覆盖 Evidence 中列出的场景和工程命令
---

# 老项目语义整合证据

## 支持的结论

扫描器能生成稳定 Asset 身份和同名候选；归并 CLI 能写入等待人工决策的 Finding；删除差异需要 repair 和等价 Evidence。

## 来源与范围

证据来自当前源码 revision、Git 路径、语义对象合同、Hook 事件和项目工程命令结果。

## 已知缺口

语言特有 AST、运行时追踪、动态插件加载和生产流量覆盖需要采用方提供额外证据；未知项不得解释成没有调用。
