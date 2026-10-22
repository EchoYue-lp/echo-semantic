---
schema_version: 1
id: behavior.post-change-verification
kind: behavior
status: verified
expectation: inferred
risk: high
primary_focus: failure_concurrency
focus: [contract_evidence, time_lifecycle]
boundary: boundary.lifecycle-enforcement
observed_at: source:f35ccedfafd943243f47d1f64ea2f7c78cd6d2f9ce860ee473f0aea9e8ae1909
code_refs:
  - hooks/entry.mjs#runBoundRepositories
  - hooks/entry.mjs#handleWorkspace
  - runtime/session-state.mjs#loadWorkspaceSession
  - hooks/entry.mjs#checkpointBinding
  - tests/native-hook-binding.test.mjs#checkpointFixture
  - skills/semantic-contract/scripts/verify_semantic.py#validate_task
  - skills/semantic-contract/scripts/verify_semantic.py#content_at_revision
  - skills/semantic-contract/scripts/verify_semantic.py#observe_reference_digests
  - hooks/entry.mjs#repeatedVerification
  - tests/test_task_validation.py#TaskHistoricalReferenceTests
  - hooks/entry.mjs#function stop
  - hooks/entry.mjs#function deny
  - hooks/entry.mjs#function isCursorEditTool
  - skills/semantic-contract/scripts/verify_semantic.py#validate_change_evidence
  - skills/semantic-contract/scripts/verify_semantic.py#run_git
  - skills/semantic-contract/scripts/verify_semantic.py#added_lines
  - tests/test_binary_diff.py#BinaryDiffTests
  - action.yml#执行语义治理门禁
  - runtime/route.mjs#computeRoute
  - runtime/route.mjs#observeWorktree
  - runtime/session-state.mjs#decideSessionChanges
  - runtime/continuation.mjs#writeContinuation
  - hooks/entry.mjs#checkpoint
  - runtime/project-state.mjs#prepareTaskArtifactDirectory
  - scripts/artifact_contract.py#check_artifacts
rule_refs: [rule.high-risk-evidence, rule.engineering-tools-own-style]
evidence_refs: [evidence.lifecycle-hooks, evidence.task-scoped-reuse]
finding_refs: []
---

# 变更后验证行为

父工作根事件通过本会话成功准入的 repositoryBindings 路由到实际编辑仓库，Stop 与 PreCompact 重新检查根、HEAD、会话快照及任务身份后复用原结算。没有父起始观察时 routingOnly 仅作路由，不能生成父仓通过结论或消费其预检；多仓结果合成一份宿主输出，任何失败仍阻断。新 source=fork 建立观察，恢复不补造旧依据。非 Git 父目录只拥有路由，按工作区、宿主与原生会话隔离参与集合；只沿 cwd 父链恢复，不扫描其它项目。部分失败保留失败任务和原路由，已通过仓库可重验收据后参加重试；路由并发变化或执行预算耗尽不能宣称全体通过。

## 重要承诺

日常任务有无基线均在 Agent 停止前通过任务范围的确定性语义校验；项目要求的 CI 完整门禁独立执行。

只读待裁决会话可以结束但不能宣称完成验证或交付；已有差异先由用户选择处置策略，裁决不能代替预检和验证。

## 当前行为

已准入任务正常提交后，Stop/PreCompact 在原绑定根、同session和同task内核对共同Git谱系、当前有效预检base以及当前HEAD的已确认处置；全部根核验后通过既有API续接路由。HEAD保护、受保护差异及任务验证继续生效，原始快照不改，绑定刷新不充当完成收据。不要求采用方为了刷新绑定做额外源码编辑。


任务引用闭包继承对象与场景的源码 revision；历史 Git 引用在对应 tree 校验，并按 revision/path/blob 摘要进入签名。当前文件与历史 blob 分开绑定，历史已删除路径不进入当前 stat 观察。同 path 不同 revision 不互相覆盖，历史引用不授予 deletePaths。repository 收据在既有任务依据字段中分离 files/references，兼容纯文件映射；task 重用通过既有校验器的只读引用重验入口核对 referenceDigests，不把引用检查当作任务完成验证。无效 revision、锚点、当前或历史内容漂移继续拒绝。 缺少历史身份字段的旧 task 收据不能直接重用；新空映射与旧 repository 纯文件映射分别保留既有正常路径。

Hook 检查 schemaVersion: 2 预检并运行 task 范围校验，不读取无关语义材料或全仓源码摘要；Action 在独立环境重新检查最终 Git 差异；PreCompact 保存带证据摘要的任务继续包，
resume 只恢复仍匹配当前仓库和分支的继续包。会话快照使用 HEAD、原始 porcelain、索引元数据和已有差异路径内容指纹，按会话 ID 隔离并有界保留；相同任务范围身份、HEAD、工作树指纹、插件版本、宿主及已知宿主版本的重复 Stop 会复用 schemaVersion: 2 新鲜成功验证收据，避免宿主重入在预检消费后再次阻断。版本未知或旧收据缺少宿主版本时不能复用，一旦任一条件变化仍要求新的预检。Codex 与 Claude Code 停止失败返回 `decision: block` 且退出码 2；
Cursor 停止失败只发送 `followup_message` 且退出码 0，不能阻断会话结束。编辑前 Cursor 使用 `permission`，其它宿主仍用 `decision`。

完成范围默认 task；预检显式声明 `verificationScope: repository` 时，Stop 选择绑定任务的全项目入口，保留原任务路径和保护差异约束，再运行真实全项目严格校验。Baseline 变化不会自动升级，手动严格校验也不能替代 Stop 收据。repository 成功收据额外绑定全仓源码身份和正式语义材料，范围错配、失效快照或任一失败均不生成新成功收据、不消费预检；全项目检查不表示行为模型闭合。

SessionStart 首次盘点已有暂存、未暂存和未跟踪差异并向助手注入首轮询问指令；未答复只读，真实写入 Hook 拒绝写入。用户通过明确答复选择接管指定差异、保留已有差异仅处理本轮范围或仅只读；未接管路径受保护，HEAD/保护内容变化需重新裁决。本轮新增路径不使无关裁决失效，接管仍走完整任务合同和相关范围验证，成功收据绑定该接管裁决。

任务原件统一保存在 `.echo-semantic/local/<task-id>/`，目录准备复用本地忽略；运行态和 local 不得被 Git 跟踪，不能作为正式源码引用。暂存检查读取索引并核对身份稳定，Action 在语义检查前核对候选 Git tree；确定路径阻断，疑似日志仅提示。长期 Evidence 提炼必要结果和限制，不要求复制完整原始归档。分发包排除 local，不自动采集日志、清理产物或执行 Git 提交。

## 期望行为

任何 Hook 配置、信任或宿主差异都不能被当作 CI 通过证据。

## 触发、结果与副作用

Claude Code 与 Cursor 在编辑前触发路径检查，三个宿主在停止前验证；只读取仓库与 `.echo-semantic/` 运行态。
Codex 与 Claude Code 失败时阻断当前动作；Cursor 编辑前用 `permission: deny` 阻断，停止失败只能追加 followup。

## 非 UTF-8 输入边界

普通 diff 和未跟踪源码通过可逆 `surrogateescape` 保留非法 UTF-8 字节，继续识别其相邻公开接口、状态权威和协议风险。
显式二进制读取保留 `bytes`，二进制差异保留路径义务；不替换、不忽略、不改写项目原文件，Git 失败仍报错。
`tests/test_binary_diff.py` 的六个具名回归覆盖这条增量边界；这不是新的宿主 Hook 实测或整项目行为复审。

## 失败、重试与恢复

每个事件独立执行；失败 Stop 保留预检状态并可连续重试。缺少预检时首次失败阻断并记录会话、工作树、失败原因和结算证据；相同失败的宿主重入只保留待处理状态，任一绑定输入变化后恢复完整判定。成功或无变化 Stop 消费当前任务预检和继续包；恢复和压缩事件不消费预检状态。继续包超过有效期、分支变化或证据摘要变化时降级为无恢复上下文。

初始已有差异的 startup 不清除旧待结算记录；resume/compact 保留同一会话原快照和裁决。待裁决只读 Stop 保留未验证状态和依据，不发送重复 followup；发现未授权变化时首次阻断，相同失败重入去重。不能取得可信观察时只能只读，不生成新成功收据。

## 证据

Node 测试覆盖三宿主会话输入、并发会话隔离、工作树指纹、失败去重和范围外编辑阻断；校验器自测覆盖失效引用与未分类路径。

## 裁决记录

当前没有风险接受记录。
