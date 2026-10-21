---
schema_version: 1
id: evidence.lifecycle-hooks
kind: evidence
observed_at: source:4aee3f15c46918de495f7bfe0a3f4c45ddd24af4d2875cbb000e6becb5766912
source_refs:
  - hooks/entry.mjs#observationRecovery
  - tests/native-hook-binding.test.mjs#Stop无起始观察保留未归属任务并只读结束
  - tests/native-hook-binding.test.mjs#pending拒写反馈提供本仓inspect和实际提问接续
  - tests/native-hook-binding.test.mjs#unknown拒写反馈仅诊断不把空观察当裁决
  - hooks/entry.mjs#checkpointBinding
  - tests/native-hook-binding.test.mjs#checkpointFixture
  - skills/semantic-contract/scripts/verify_semantic.py#content_at_revision
  - skills/semantic-contract/scripts/verify_semantic.py#observe_reference_digests
  - skills/semantic-contract/scripts/verify_semantic.py#validate_task
  - tests/test_task_validation.py#TaskHistoricalReferenceTests
  - hooks/entry.mjs#repeatedVerification
  - hooks/entry.mjs#verificationScope
  - tests/hooks.test.mjs#Baseline必须显式全项目验证
  - hooks/hooks.json#SessionStart
  - hooks/plugin-entry.mjs#function run
  - hooks/entry.mjs#checkEditScope
  - hooks/entry.mjs#function isCursorEditTool
  - hooks/entry.mjs#function deny
  - hooks/entry.mjs#function stop
  - hooks/entry.mjs#function sessionIdFromInput
  - hooks/entry.mjs#function patchTargets
  - hooks/entry.mjs#function approvedDelete
  - hooks/entry.mjs#function writeSessionSnapshot
  - hooks/entry.mjs#function writeStopDedupe
  - hooks/hooks-cursor.json#preToolUse
  - tests/hooks.test.mjs#Cursor 按官方工具名识别写入路径，并放行只读工具
  - tests/hooks.test.mjs#Cursor 官方会话字段建立快照并对相同失败只 followup 一次
  - tests/hooks.test.mjs#并发会话的快照和失败去重记录互不覆盖
  - hooks/entry.mjs#checkpoint
  - runtime/project-state.mjs#writeVisibleStatus
  - runtime/project-state.mjs#ensureProjectStateIgnored
  - runtime/project-state.mjs#updateProjectJson
  - runtime/project-state.mjs#readProjectBytes
  - runtime/continuation.mjs#readContinuation
  - runtime/continuation.mjs#writeContinuation
  - runtime/route.mjs#currentHookEvidence
  - runtime/route.mjs#observeWorktree
  - runtime/session-state.mjs#decideSessionChanges
  - scripts/session-changes.mjs
  - skills/semantic-preflight/SKILL.md#已有差异处置
  - tests/session-changes.test.mjs
  - tests/hooks.test.mjs#已有差异首次询问
  - tests/hooks.test.mjs#结构化补丁按补丁头逐路径检查
  - tests/hooks.test.mjs#范围外编辑
  - tests/manifests.test.mjs#Codex 与 Claude Code 共用原生 Hook，Cursor 保留专用事件名
  - tests/route.test.mjs#仅检测到宿主安装不能启用运行时门禁
  - tests/continuation.test.mjs#PreCompact 保存继续包，resume 只恢复仍可信的任务
  - tests/project-state.test.mjs#拒绝通过符号链接写出项目目录
  - tests/project-state.test.mjs#拒绝覆盖已被 Git 跟踪的运行态文件
  - tests/project-state.test.mjs#项目状态更新锁拒绝覆盖竞争写并恢复陈旧锁
  - tests/project-state.test.mjs#双进程状态更新不丢记录
  - tests/project-state.test.mjs#运行态 JSON 读取拒绝仓外最终符号链接
  - tests/route.test.mjs#工作树指纹拒绝
  - tests/route.test.mjs#子模块目录竞态不能重新授权仓外根
  - tests/route.test.mjs#路由预检读取拒绝仓外 symlink 即使没有 taskId
  - skills/semantic-contract/scripts/verify_semantic.py#run_self_test
  - docs/supreme/specs/plugin-architecture/design.md#宿主生命周期时序
supports:
  [
    behavior.preflight-before-write,
    behavior.post-change-verification,
    rule.high-risk-evidence,
    rule.engineering-tools-own-style,
  ]
limitations:
  - Cursor 窗口已手工检查；完整事件证据仍需按宿主版本记录，stop 只能 followup，不能阻断会话结束
  - 本次只按会话隔离起始快照和失败去重；preflight、continuation、route 与可见 status 仍是项目级当前任务状态，不支持多个写任务在同一工作树独立结算
  - 锁持有者不可信、仍存活或 recovery guard 无法取得时，运行态更新有界失败并保留旧记录，不自动删除或覆盖状态
  - 继续包原有 packet/evidence 读取未纳入本次 fd 路径边界改造，仍需单独审查；本次安全读取证据只覆盖快照、去重、路由、预检与 Stop 结算
  - 脏 submodule 的 nested Git 只在 POSIX 目录 fd 和 python3 fchdir 能力可用时执行；能力缺失时指纹不可用且不走路径 fallback，未完成其它原生平台验收
  - 首轮提问与无 Hook 的写入/交付由助手遵循 Skill 执行，不是全面机器门禁；命令只校验答复依据字段与观察一致，不能认证人类答复真实性
---

# 生命周期门禁证据

本地 native-hook-binding-fix 修复的正式回归位于 tests/native-hook-binding.test.mjs，覆盖 Codex/Claude 环境别名、父工作根与独立子 Git 根、会话缺失/不一致、跨根补丁、dirty 接管保护及 Stop 完成验证。原始运行结果存于忽略目录 .echo-semantic/local/native-hook-binding-fix/，仅当前工作区可用。本机 Codex 0.162.0-alpha.17.2 内嵌 schema 确认 session_id/cwd/turn_id 和 fork；官方网页本轮不可访问。夹具结果与原生事件验收分别报告，不据此声称 CLI/SDK 原现场恢复。

本轮性能回归覆盖编辑观察不读取无关差异内容、宿主缓存按身份与有效期失效、停止仍做完整观察；显式夹具基准单独测量路由耗时和读取成本。这些是本地测试证据，不代表真实宿主 Hook 已执行。

## 支持的结论

Codex 与 Claude Code 的 Hook 位于宿主原生发现路径并共享入口，安装后可保留插件来源；Hook 能注入最小上下文、在 Claude Code 与 Cursor 编辑前阻断预检范围外路径，并在采用语义基线的项目停止前运行校验器；
PreCompact 会保存带证据摘要的恢复包，resume 只恢复仍可信的包。会话起始快照和缺少预检的失败去重按宿主会话 ID 隔离；相同内容与结算证据的重入 Stop 不重复阻断，内容、预检、继续包或验证收据变化后重新判定。安装探测不会被当作生命周期通过，`enforcement` 只由绑定宿主版本、插件版本和时间窗的真实 Hook 事件证据启用。

已有差异不再默认忽略：首次盘点注入助手询问指令，未裁决只读且写入 Hook 拒绝，Stop 保留待裁决、未验证，不制造循环。裁决在原快照按会话保存；保留保护已有路径，接管指定路径仍须验证，只读拒绝写入。旧观察/错误会话不接受答复；恢复保留原依据，保护内容变化需重新裁决。

盘点 CLI 提供中文状态分类和有界嵌套仓库摘要，不输出完整文件内容；Skill 和 SessionStart 要求提问先展示具体差异、任务重叠判断和唯一推荐理由。Codex 结构化补丁从补丁头提取所有新增、更新、删除和移动路径，逐项复用保护、范围及 repair 删除授权，无法解析路径时保守拒绝。

本次快照、去重、路由、预检与 Stop 结算读取拒绝符号链接和超过 1 MiB 的内容；差异文件读取在仓库真实根内验证路径与已打开 fd 的身份后执行，拒绝中间目录越界和最终 symlink 竞态。子模块递归继承最初授权根，nested Git 绑定已验证目录 fd 后通过 fchdir 执行，不使用可变路径；路由预检读取复用同一安全接口。陈旧锁只在 recovery guard 下确认可信持有 PID 已退出后回收；活或未知持有者不会被年龄规则删除。

## 来源与范围

来源为共享 Hook/继续包实现、连续事件/恢复事件单元测试、校验器自测和本机 Codex/Claude 生命周期探针。

## 已知缺口

历史引用修复当前仅在明示隔离候选中验证；正式受保护源码、安装 cache、P/S 与 SDK canonical pin 尚未改变。原件位于正式工作区忽略目录 `.echo-semantic/local/historical-reference-candidate/`，仅当前工作区可用，不作为正式源码引用。

Cursor 已完成安装清单、本地插件路径和窗口级手工检查；完整生命周期事件仍需按版本记录。

## 显式全项目 Stop 修复验证

2026-10-15 源码 Hook 夹具通过：默认 task 仍拒绝 Baseline，显式 repository 经过真实严格校验生成范围收据；任务错配、忽略材料/引用/任务依据变化、验证后源码变化，以及并发新预检/继续包均被拒绝，保留新记录且不覆盖旧收据。独立复审无剩余 findings。

在源码摘要 `acfdfa056098b902ca938bf7368c7d3a935d804e7ef38d236f41656efab2f0bf` 的执行源码上使用缓存工具（`UV_OFFLINE=1`）运行 `npm test`、`npm run verify`，退出码均为 0；Node 108、Python 84 项，格式、分发、校验器自测和严格快照通过。当前仓库 `--repository-scope` 入口实际返回 passed、scope=repository、globalClosure=not_checked。随后仅更新计划完成状态与语义身份，最终快照另行核对。

原件在 `.echo-semantic/local/01a13d99-48f0-7d21-9463-953cb68bb555/` 的 `stop-final-npm-test.log`、`stop-final-npm-verify.log`、`stop-complete-races.log` 和 `stop-root-report.json`，仅当前工作区可用，不随长期材料提交。此结论覆盖源码及进程夹具，不表示当前安装版、GUI 或新会话已经运行修复后的 Hook；安装需独立授权及核对。

### 历史引用隔离候选

同一组真实 Git fixture 在未修校验器上 9 项中 7 项失败、2 项拒绝场景通过；候选补齐 task/repository 历史引用、同 path 两 revision、当前碰撞、锚点与 invalid revision、未授权删除、当前漂移及 Git replace 历史漂移。额外 task Stop 隔离夹具验证首次通过、正常重入通过、历史内容漂移后拒绝。 升级夹具还验证：缺少历史身份字段的旧 task 收据拒绝重用，明确空映射正常重用；未修 Hook 控制切片对历史漂移和旧收据各真实失败 1 项，最终同场景通过。当前候选完整 npm run verify 为 Node 125/Python 95 通过，校验器自测、Ruff 与 Prettier 通过；正式源码接管、安装及采用方原生收口仍独立验收。

同一未修隔离起点的 3 项 Stop 重用测试在当前 Homebrew Node 动态链接环境失败；复制可执行文件导致缺少 libnode 并 SIGABRT，宿主版本探测为空。候选测试夹具在 POSIX 链接原可执行文件，保留原准入断言，同 3 项恢复通过。该对照不倒推旧环境或旧宿主证据。

### 正常checkpoint续接隔离候选

正式现场记录是采用方原生Stop报告旧准入HEAD与当前clean checkpoint不一致，现有同会话处置及预检已正规更新；不据此声称实际原生task_id已捕获。隔离夹具复现真实准入、正常commit、官方refresh/decide与当前预检后Stop/PreCompact仍拒绝。修复继续使用既有会话与预检权威，在原绑定HEAD可恢复且与当前HEAD有共同Git谱系、同session当前处置/同task当前预检有效时续接路由；缺少任一依据、错误事件task、无共同Git历史HEAD均拒绝，不补原始快照。原件位于正式工作区忽略目录 `.echo-semantic/local/stop-checkpoint-candidate/`，仅该工作区可用；隔离通过不表示采用方原生Stop已恢复或正式安装已更新。

### 合法squash交付续接隔离反例

两commit任务分支经真实 `git merge --squash` 回main，结果tree等于任务最终tree，任务分支正常删除；旧准入commit不是main祖先。旧候选同会话官方refresh/decide与当前PF后Stop仍失败，5个场景中4个保护反例通过、1个合法续接失败。修正只用共同Git谱系作为附加边界，当前HEAD必须有同会话已确认处置与同task当前PF；不能据共同祖先自动接受checkout。原件为集成候选忽略目录的 squash-control-red.log；修复后与原checkpoint/历史引用矩阵一起验证。此证据不属于P的原生Stop通过。

### 本仓缺观察与待裁决恢复

无本会话起始观察、无已准入绑定且存在未归属预检或继续包时，Stop 按既有只读设计结束，保留原件与其它会话绑定，状态仍为 blocked/未验证；不调用完成校验、不补造快照、不生成成功收据。明确的任务冲突与绑定失效继续拒绝，写前准入和已有差异保护保持原检查。

pending 拒写反馈给出实际仓库、原生会话及官方 inspect 参数和可执行的 POSIX 命令，要求展示 presentation、必要时正规 refresh、使用宿主可用提问工具询问，或在正文直接提问后等待明确答复。unknown 观察只提供诊断，禁止用空或旧指纹裁决，先恢复正常宿主 SessionStart；有效 readonly 不重复询问。该反馈不自动调用提问工具，也不证明模型实际展示了问题。

本仓回归先在原实现上取得 3/3 失败，局部修复后相关 5 项通过；同时覆盖无观察 Stop 首次与重入保留其它任务原件、可执行 inspect 的真实输出、引号会话标识、空观察不补快照、真实验证失败及会话别名冲突。完整输出保存在 `.echo-semantic/local/pending-stop-recovery-01a15d45/`；独立功能对照为 `.echo-semantic/local/stop-recovery-01a15d45/unowned-stop-control-{red,green}.json`，仅当前工作区可用，均不是原生宿主执行证明。
