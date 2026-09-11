# ADR 0002：老项目语义整合与受控清理

## 状态

已采纳

## 背景

AI coding 在老项目中容易产生多个表达同一业务概念的实现、包装层、平行状态权威和无法确认是否仍可达的代码。
原有 Echo Semantic 只能建立语义基线、分析差异和验证证据，不能把这些资产整理成可执行的收敛切片。

## 候选方案

1. 让模型直接扫描并批量删除相似代码；
2. 增加独立数据库或常驻分析服务，集中维护跨项目语义图；
3. 扩展现有 `.echo-semantic/` 合同，在同一项目权威中增加 Asset、候选 Finding、受控删除和行为等价 Evidence。

## 决策

采用方案 3。`semantic-discover` 生成可重复的 Asset 清单和未知项；`semantic-consolidate` 把候选转换为等待人工决策的
Finding；`semantic-repair` 把已批准的 canonical owner、替换关系、删除范围和回滚点绑定到 `semantic-preflight`、
编辑前 Hook、Stop 和 CI；`semantic-verify` 校验逐场景行为等价 Evidence。

静态相似、无调用方和测试通过都不能单独证明可以删除。动态注册、反射、配置路由和运行时差异必须保留为未知或阻断删除。
Git merge 仍由 Git 执行，Echo Semantic 只负责语义影响、候选归并和交付门禁。

## 影响

- 长期对象继续只写入采用方 `.echo-semantic/`，不建立跨项目知识库；
- 新增 Asset 目录、候选 Finding 字段、等价 Evidence 字段和删除差异门禁；
- 没有明确任务时使用 `maintenance` 路由，对 Baseline 覆盖代码执行全仓语义维护；明确任务时只处理预检允许路径；
- Codex、Cursor、Claude Code 的既有 manifest、Agent 投影和宿主事件合同保持不变，仅追加新 Skill 的发现入口；
- 不提供形式化等价证明、无监督批量删除、常驻服务、数据库或 MCP Server。

## 验收

资产身份在同一 revision 重跑稳定；候选 Finding 可追溯到资产和证据；未批准删除被编辑前 Hook 或 Stop/CI 阻断；
完整等价 Evidence 和项目工程门禁通过后才允许交付；`npm test` 与 `npm run verify` 通过。
