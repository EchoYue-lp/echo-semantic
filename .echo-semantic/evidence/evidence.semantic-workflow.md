---
schema_version: 1
id: evidence.semantic-workflow
kind: evidence
observed_at: source:79b3c35f6c483b536c72cc29cdf63e5f35299e128ff076923acc456f862c0e2b
source_refs:
  - .github/workflows/ci.yml#cache-dependency-glob
  - package.json#format:check
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
  - skills/semantic-contract/scripts/verify_semantic.py#run_git
  - skills/semantic-contract/scripts/verify_semantic.py#added_lines
  - tests/test_binary_diff.py#BinaryDiffTests
  - docs/command-reference.md#非 UTF-8 差异与风险识别
supports:
  [behavior.preflight-before-write, behavior.semantic-continuity, rule.single-semantic-authority, rule.semantic-obligation-preservation]
limitations:
  - Skill 是否自动触发仍由各宿主模型和发现机制决定
---

# 语义工作流证据

## 支持的结论

十个入口职责分离，生成前预检、状态 Frontier、发现、资产盘点、差异、候选归并、受控修复、审查、裁决和验证围绕同一对象合同协作；预检、Hook、状态视图和 CI
共享对象存在性与正式 design/ADR 摘要合同，压缩恢复只携带短期任务线索；连续性模式直接比较 Git tree 中的父版本义务和候选结果。

## 来源与范围

来源为 Skill 正文、架构收敛工作流、只读 Agent 合同和项目架构设计。

## 已知缺口

触发描述只能作为软发现，需要 Hook 和 CI 提供确定性约束。

## 本次输入修复的影响闭包

首个差异相对 public 8ecb51f9119a96ac9fa09ffc500f1a3dea299fdb 只改变已有 Git 文本解码，不新增状态权威、公共参数、宿主 Hook 或协议。
风险识别和 `validate_change_evidence` 继续使用同一个入口；连续性 Git blob 分支、摘要、缺失源码和原错误传播规则均保留。
六项反例回归及仓库 `npm test`、`npm run verify` 门禁分别提供输入行为与完整工程证据；失败结果保持失败，不以路径排除或修改负例文件取绿。

## CI 缓存输入绑定

PR 的原完整测试与语义门禁已通过，但 `setup-uv` 默认 glob 没有匹配本仓库文件，产生真实缓存失效警告。
`.github/workflows/ci.yml` 仅新增原 action 支持的两条 `cache-dependency-glob`，绑定 `package.json` 的验证命令/uvx 版本和
`skills/semantic-contract/scripts/verify_semantic.py` 的 PEP 723 PyYAML 声明，不改变校验器、`npm test`、`npm run verify` 或 action 版本。
`docs/command-reference.md` 和既有架构设计记录失效来源与可重建性质；本次局部配置不冒称新的远端 CI 已运行或原非法 UTF-8 字节有变化。
