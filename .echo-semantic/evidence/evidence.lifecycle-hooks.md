---
schema_version: 1
id: evidence.lifecycle-hooks
kind: evidence
observed_at: source:b04e31debc80dcbb65d993c8d17b7aedd4aa5d6abf5033cb977cef682f25f91c
source_refs:
  - hooks/entry.mjs#handleWorkspace
  - hooks/entry.mjs#runBoundRepositories
  - runtime/project-state.mjs#updateWorkspaceSessionJson
  - runtime/session-state.mjs#loadWorkspaceSession
  - tests/native-hook-binding.test.mjs#multiRepositoryFixture
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
  - skills/semantic-contract/scripts/verify_semantic.py#run_git
  - skills/semantic-contract/scripts/verify_semantic.py#added_lines
  - tests/test_binary_diff.py#BinaryDiffTests
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

当前header用于合并后引用核对；下列各日期与隔离候选段落保留原执行身份，其“当前/本轮”、安装状态和测试数属于原任务。原Git/source观察见evidence.semantic-continuity的历史身份表，不由新摘要推导为本次原生Hook或采用方验收。

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

## 无损差异解码回归

2026-10-15 的有界修复复用 `skills/semantic-contract/scripts/verify_semantic.py` 中 `run_git`、`added_lines` 和原 `infer_signals`，
只为文本读取增加可逆 `surrogateescape`。`tests/test_binary_diff.py` 六项具名测试验证 tracked/untracked 非 UTF-8 字节原样回编码、
相邻公开接口和状态风险不丢失、中文 emoji 路径不变、二进制协议路径仍受约束、显式 blob 保持 bytes，以及 Git 错误仍抛出。
原公共版本基线为 8ecb51f9119a96ac9fa09ffc500f1a3dea299fdb；这是校验器输入与风险证据修复，不宣称新会话或 GUI 重载 Hook 已验收。

## 历史引用 Hook 回放的 CI 环境隔离

2026-10-21，`main@8c3f3b95b2d625f14b1b26a1f4faa47bc7f739b8` 的 Main CI 中 Node 146 项通过，Python 149 项仅两项历史收据 Hook 回放失败。原 Python 夹具使用实际 Codex 探针；CI 没有 Codex 版本，首次 Stop 后的收据重用被生产门禁拒绝。失败运行是 GitHub Actions `39573501367`，不表示历史内容漂移检查失效。

本机以 PATH 前置的 `codex` 返回失败复现相同两项失败；修复后同环境两项通过。夹具复用既有 Node 测试的宿主替身模式，在自身临时 Git 目录内提供 `codex` 命令，并只向 Hook 子进程传递显式 PATH。生产 `detected/version` 要求、真实 Git 历史读取、首次及正常重入成功、历史漂移或旧收据缺字段后拒绝的断言均保留。Node 的版本仅作夹具宿主身份，不是实际 Codex 版本或原生宿主验收。

原件位于 `.echo-semantic/local/ci-history-hook-host-probe-01a1442d/` 的 `missing-host-red.log`、`missing-host-green.log` 与后续工程检查日志，仅当前工作区可用。完整工程、远端 CI 及安装验收按各自实际结果报告。

## 通用多仓库工作区源码验证

2026-10-22，基于 main@7536db0b896eef31873d0e4c998961db03516df3 的工作树实现。hooks/entry.mjs 复用实际路径解析、逐仓准入与 Stop，runtime/session-state.mjs 扩展会话路由，runtime/project-state.mjs 复用锁、原子替换及安全读写，为非 Git 父目录提供仅限会话路由的专用写入。tests/native-hook-binding.test.mjs 与 tests/project-state.test.mjs 覆盖一次父目录启动、首次接入、三仓结算、部分失败重试、已有差异保护、宿主隔离、子目录恢复、损坏路由及九仓准入。

旧实现两项反例均失败，首轮修复六项定向回归全部通过。执行原件位于忽略目录 .echo-semantic/local/multi-repository-workspace/workspace-red.log 和 workspace-green.log，仅当前工作区可用。后续完整工程门禁和最终审查以本任务最终执行结果为准；这些进程夹具不证明安装版或 Codex、Cursor、Claude Code 新会话已验收，不自动安装或发布。

最终源码实现经独立 reviewer 复审通过；四项故障反例均先取得失败证据再修复，其中无提交子仓失败接入不污染已有路由。完整 npm test 和 npm run verify 的退出码均为 0，Node 158/158、Python 149/149，格式、分发清单、校验器自测及严格快照均通过。原件为 .echo-semantic/local/multi-repository-workspace/npm-test-final-retry.log、npm-verify-final.log、review-red.log、review-green-final.log、headless-red.log 和 headless-green.log；首轮完整测试的 157/158 与安装冒烟空输入问题保存在 npm-test-final.log，修复后的安装冒烟 installer-green.log 通过。生产准入未为测试放宽。源码版本身份由本对象 observed_at 绑定；旧未变对象仅将原 source 观察固定到等价 main@7536db0 Git revision，Baseline 仅维护源码摘要，覆盖与闭合结论不变。未安装或发布，未完成采用方新会话与 GUI 重载验收。

## 安装前旧父目录会话的首次接入缺口

2026-10-22 现场只读核对：invoice-app 父会话在安装前创建，父目录没有任何工作区运行态，目标后端只有另一个会话的快照；本会话仅调用 inspect/refresh 后停止，未触发真实 pre-edit。unknown 不是原生写入门禁已执行的证据，refresh 拒绝补造观察是正确保护。修复 hooks/entry.mjs 的旧会话首次接入分支，复用 runtime/session-state.mjs 工作区记录并标明 pre-edit 来源，scripts/session-changes.mjs 与 skills/semantic-preflight/SKILL.md 同步未知状态的接入指引。首次真实请求必拒绝落盘；既有快照、过期/缺失路由及未结算任务不覆盖，业务仓只读未修改。反例与验证原件保存在 .echo-semantic/local/old-session-first-admission/，采用方原会话仍需实际触发写前 Hook 才能完成原生验收。

本轮独立审查补充确定性并发反例：在无状态检查后、git status 观察时，由另一任务通过正式 CLI 写入预检。未修实现仍生成本会话快照；修复在子仓锁内重验原始状态，出现新预检即拒绝首次观察且不登记父观察集合，原预检字节保持不变。原件位于 old-session-first-admission/race-red.log 与 race-green.log。

旧会话修复最终独立复审通过；组合回归 17/17、最新四项接入/并发保护 4/4，完整 npm test 与 npm run verify 退出码均为 0（Node 162/162、Python 149/149）。原件位于 .echo-semantic/local/old-session-first-admission/npm-test-final.log、npm-verify-final.log、final-four.log；未修改业务仓或手工写入其会话记录。源码身份维护沿用前述仅元数据方案，原父会话真实 pre-edit 事件仍需由原会话执行，不以隔离夹具或静态安装核对冒充原生验收。

## 多仓库使用文档同步

同步 README、CHANGELOG、快速开始、FAQ、故障排查、命令参考、宿主矩阵、多宿主适配、核心概念、发布验收及主架构生命周期图。按既有实现区分 SessionStart 与旧父会话真实 pre-edit 首次接入，首次请求只观察并拒写；其它会话快照不授权本会话，已有本会话状态或待结算任务不得覆盖。文档显式区分安装可见、文件一致、入口夹具与原生事件验收，不把恢复问题转为必须切换单仓根。此次只改文档与必要源码身份元数据，未改运行时或测试逻辑；原件定位 .echo-semantic/local/multi-repository-docs-sync/。

## 干净会话提交后的 checkpoint 恢复

真实本仓提交推进后 Stop 报“仓库绑定已失效”，原会话 initialChanges 为 null；现有 refresh 仅支持初始 dirty 会话，导致无法走正式处置与当前预检链。隔离真实 Git 夹具先复现 Stop/PreCompact 两项失败，修复仅扩展既有 refresh：可信干净原观察、已推进 HEAD、共同历史与零当前差异全部满足才生成待裁决 checkpoint；原始观察字段不变。未推进、有新差异、无共同历史、不可恢复提交及未知会话继续拒绝，失败保留原记录。定向、完整工程与语义校验原件保存在忽略的 .echo-semantic/local/clean-checkpoint-stop/；夹具和安装一致性不替代后续真实宿主 Stop 验收。
