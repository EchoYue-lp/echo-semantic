---
schema_version: 1
id: evidence.semantic-workflow
kind: evidence
observed_at: source:4aee3f15c46918de495f7bfe0a3f4c45ddd24af4d2875cbb000e6becb5766912
source_refs:
  - skills/semantic-contract/SKILL.md#语义材料合同
  - skills/semantic-contract/references/semantic-artifact-contract.md#语义材料合同
  - scripts/governance_contract.py#validate_design_authority
  - scripts/preflight_contract.py#validate_preflight
  - tests/preflight-contract.test.mjs#Node 与 Python 共享预检合同 fixture
  - skills/semantic-preflight/SKILL.md#预检
  - skills/semantic-discover/SKILL.md#完成条件
  - agents/semantic-capability-reviewer.md#能力闭合复核
  - runtime/route.mjs#computeRoute
  - runtime/continuation.mjs#checkpointFromPreflight
  - runtime/capabilities/load.mjs#loadCapabilities
  - runtime/capabilities/probe.mjs#probeHost
  - skills/semantic-status/scripts/status.py#status
  - README.md#架构总览
  - docs/supreme/specs/plugin-architecture/design.md#系统边界
  - skills/semantic-contract/scripts/verify_semantic.py#compare_continuity
  - scripts/artifact_contract.py#check_artifacts
  - tests/test_artifacts.py#ArtifactTests
  - tests/artifacts.test.mjs
supports:
  [behavior.preflight-before-write, behavior.semantic-continuity, rule.single-semantic-authority, rule.semantic-obligation-preservation]
limitations:
  - Skill 是否自动触发仍由各宿主模型和发现机制决定
  - 产物检查精确阻断运行态与 local 路径，其它命名的原始产物只能提供启发式提示
  - 本轮未执行新会话或 GUI 重载，不证明已安装版本的 Hook 已运行
---

# 语义工作流证据

## 支持的结论

十个入口职责分离，生成前预检、状态 Frontier、发现、资产盘点、差异、候选归并、受控修复、审查、裁决和验证围绕同一对象合同协作；预检、Hook、状态视图和 CI
通过 Python 完整合同核对任务依据，确定性校验器核对正式 design/ADR 摘要，压缩恢复只携带短期任务线索；连续性模式直接比较 Git tree 中的父版本义务和候选结果。

## 来源与范围

来源为 Skill 正文、架构收敛工作流、只读 Agent 合同和项目架构设计。

本地产物边界由目录准备、Git 索引/候选 tree 检查、打包排除及测试共同表达。原始验证输出保存在任务 local 目录，长期材料只保留结论和限制；具体执行结果以本轮实际退出状态为准，测试源码存在本身不证明执行通过。

## 已知缺口

触发描述只能作为软发现，需要 Hook 和 CI 提供确定性约束。

## 本轮产物治理验证

2026-10-15 在 `main@8ecb51f9119a96ac9fa09ffc500f1a3dea299fdb` 加未提交源码上执行 `npm test` 与 `npm run verify`，实际退出码均为 0：Node 107 项、Python 82 项通过，格式、分发校验、校验器自测和全项目严格快照检查通过。完整命令执行时源码摘要为 `71dcbbc22f6fd67a07d5bb8e45ce2dfdb6746a2f87e864fdaee3c578d4b1e5d1`；随后只更新计划完成状态与语义验证记录，最终快照另经严格校验，执行源码未变。本对象 `observed_at` 与 Baseline 绑定最终源码身份；Git HEAD 单独不能表示全部已测内容。

原始输出位于 `.echo-semantic/local/01a13d99-48f0-7d21-9463-953cb68bb555/final-npm-test.log` 和同目录 `final-npm-verify.log`，仅当前工作区可用，不随本 Evidence 提交或分发。任务范围入口因 Baseline 更新要求显式全项目校验，本轮使用完整严格校验覆盖；不宣称获得局部成功收据或全项目行为模型闭合。独立复审无剩余 findings；未安装新插件、未执行真实宿主重载或远端 CI，不以静态测试代替对应证据。
