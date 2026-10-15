# 语义材料合同

- 合同标识：`echo-semantic`
- 合同版本：`1`
- 载体：带 YAML 前置元数据的 Markdown

合同只规定可确定验证的结构和 Git 事实。源码与机器契约说明当前行为；人确认的期望说明应该如何；Audit 只说明
在指定 revision 上检查过哪些故障假设。三者不得互相替代。

## 目录

```text
.echo-semantic/
├── README.md
├── baseline.md
├── maps/
├── behaviors/
├── rules/
├── evidence/
├── findings/
├── audits/
├── discovery/
└── assets/
```

除 `README.md` 与 `baseline.md` 外，每个 Markdown 文件只保存一个对象，文件名必须等于对象 `id`。
尚无对象的目录可以包含一个空 `.gitkeep`，不得在其中保存说明或状态。

## 通用字段

所有对象必须包含：

```yaml
schema_version: 1
id: <小写稳定标识>
kind: <对象类型>
```

稳定标识只使用小写字母、数字、点和连字符。源码版本使用 40 位 Git revision，或
`source:<64 位 sha256>` 表示当前未提交源码摘要。

源码引用使用 `<仓库相对路径>` 或 `<仓库相对路径>#<锚点>`。当前快照引用必须在工作树存在；历史 Git revision
引用必须在对应 Git tree 中存在；带锚点时，目标内容必须包含该锚点。禁止绝对路径和 `..`。

## 基线

`.echo-semantic/baseline.md` 保存：

```yaml
schema_version: 1
id: baseline.repository
kind: baseline
source_snapshot:
  base_revision: <40 位 Git revision>
  content_digest: <64 位 sha256>
inventory_closure: open
behavior_model_closure: open
map_refs: []
regions: []
boundaries: []
coverage: []
```

正文必须包含：`源码快照`、`仓库区域`、`能力图与边界`、`覆盖网格`、`未知与缺口`、`闭合结论`。

区域 `path` 使用仓库相对文件或目录前缀，状态只能是 `in_scope`、`supporting`、`generated_or_vendor` 或
`excluded`。`excluded` 必须给出 `reason`、`risk`、`recheck_when`。当 `inventory_closure: closed` 时，每个非
`.echo-semantic/` 长期语义文件必须且只能命中一个区域；每个 `in_scope` 区域必须有八个风险视角的覆盖格。

`source_snapshot.content_digest` 对 Git 已跟踪和未忽略未跟踪文件计算，排除 `.echo-semantic/`。严格验证要求摘要与当前
工作树一致；`base_revision` 必须存在且是当前 `HEAD` 的祖先。摘要提供精确当前性，revision 提供可恢复谱系，避免
语义文件包含自身提交标识形成循环。

## Capability Map

`.echo-semantic/maps/<id>.md` 包含 `title`、`risk`、`observed_at`、边界及对象引用，并通过 `scenarios` 保存场景处置。
每个场景必须有 `source_refs`；`mapped` 至少引用 Behavior、Rule、Evidence 或 Finding；`needs_review` 必须有
`unknown` 和 `next_step`；`excluded` 必须有理由、风险和复查条件。

正文必须包含：`能力范围`、`入口与输出`、`行为关系`、`状态与数据流`、`策略来源与优先级`、`生命周期与失败路径`、
`权限与敏感信息`、`用户侧投影`、`场景处置清单`、`未展开项`。

## Behavior 与 Rule

Behavior 保存重要行为承诺，Rule 保存不变量和唯一权威。两者包含 `status`、`expectation`、`risk`、唯一
`primary_focus`、`focus`、`observed_at`、源码引用和关系引用。

- `status`：`needs_review`、`verified`、`stale`；
- `expectation`：`unknown`、`inferred`、`human_confirmed`；
- `risk`：`low`、`medium`、`high`。

Behavior 正文包含：`重要承诺`、`当前行为`、`期望行为`、`触发、结果与副作用`、`失败、重试与恢复`、`证据`、
`裁决记录`。Rule 正文包含：`不变量或唯一权威`、`适用行为`、`当前实现`、`期望行为`、`证据`、`裁决记录`。

## Evidence、Finding、Audit 与 Discovery

- Evidence 包含 `observed_at`、`source_refs`、`supports`、`limitations`，正文记录结论、来源和缺口。
- Finding 包含类型、状态、严重程度、风险视角、边界及证据引用；`resolved` 必须有修复、验证和复审证据，
  `risk_accepted` 必须有人类裁决引用。
- Audit 绑定边界、风险视角和 revision；每个故障假设必须有源码和 Evidence 引用。`examined` 不表示没有缺陷。
- Discovery 只保存指定快照的扫描范围、检查路径、候选对象和未决项，不反向定义长期语义。

Asset 使用 `assets/<id>.md`，描述一个可追踪的文件、符号、入口、状态权威、协议、测试消费者或文档资产。它必须包含
`title`、`asset_type`、`status`、`risk`、`observed_at`、`boundary_refs`、`code_refs`、`consumer_refs`、
`behavior_refs`、`rule_refs`、`evidence_refs` 和 `finding_refs`；候选资产可以用 `candidate_refs` 连接同一候选簇。

`Finding.type: consolidation_candidate` 表示重复实现、平行状态权威或包装链候选。它必须包含至少两个
`candidate_asset_refs`、`decision` 和（`merge`、`migrate`、`retire` 时）`canonical_asset_ref`。`defer` 或 `open` 不得作为删除授权。

用于受控删除的已解决 Finding 还必须声明 `delete_paths`、非空 `replacement_refs` 和 `rollback_ref`；每个删除路径必须由
Finding 自身覆盖，替换引用必须指向 Asset。预检的 `repairRefs` 只能引用这类 Finding。

行为等价 Evidence 使用 `evidence_type: behavior_equivalence`，记录 `before_revision`、`after_revision`、逐场景
`scenario_results`、非零即失败的 `command_results`、覆盖范围 `coverage` 和限制。删除场景还必须记录 `deleted_paths`，并将
`before_revision` 绑定包含原义务的前置 Git revision，`after_revision` 绑定候选结果源码摘要；每个场景必须为 `matched`。
替代或冲突处置必须让 Evidence 覆盖原义务在全部不同前置版本中的指纹，不能用一份只验证单侧行为的 Evidence 代表全部父版本。
它只证明已检查场景，不表示形式化等价。

## 语义连续性 Evidence

多前置版本保全以以下内容作为语义义务：Behavior、Rule、Capability Map 中 `mapped`/`needs_review` 场景、`open` 或
`risk_accepted` Finding、Discovery `unresolved`，以及它们引用的 Evidence 和 Asset。场景身份为
`<map-id>#scenario:<scenario-id>`；未知项身份为 `<discovery-id>#unresolved:<value>`。

义务指纹包含影响语义的结构化字段、规范化正文及当前引用的内容签名，排除 `observed_at`、`discovered_at`、`revision`、
`source_snapshot`、行号和纯路径定位字段。`*_refs` 等集合字段排序后计算；命令和其它有顺序含义的列表保持顺序。
受保护 Behavior、Rule、Asset、Capability 场景和被引用 Evidence 的源码引用会以“目标 blob 内容 + Git mode + 锚点 + 路径角色”多重签名
绑定到其义务指纹；被引用 Evidence 还会形成独立依赖义务。路径角色至少区分测试消费者、文档、协议、迁移、生产源码和治理控制面。
角色按目录和常见测试文件命名共同判断，角色指纹保留重复次数。同内容在同角色内移动不会误报；跨角色移动、同角色引用数量减少、
目标内容消失或改变时仍会阻断。对象把 `observed_at` 指回历史 revision
只能证明旧观察可恢复，不能替代候选结果中当前依赖的存在性检查。
Asset 的 `asset_type` 与实际路径角色共同进入指纹；旧的 `test_consumer` 等声明不能覆盖文件已经移出对应运行位置的事实。
为兼容 `0.2.0` 历史材料，既有 `source:<digest>` 算法保持不变；Git mode 与 symlink 类型只进入新增的连续性引用签名。
因此内容相同但 `100755` 被降为 `100644` 仍属于连续性变化，同时旧 revision 的 Baseline/`observed_at` 仍可恢复。

替代、退役或双侧冲突解决使用 `evidence_type: semantic_continuity`：

```yaml
evidence_type: semantic_continuity
merge_base_revision: <40 位 Git revision>
predecessor_revisions: [<40 位 Git revision>]
result_snapshot: source:<64 位 sha256>
resolutions:
  <义务身份>:
    disposition: replaced | retired | resolved_conflict
    predecessor_fingerprints:
      <predecessor revision>: <64 位指纹或 absent>
    replacement_ref: <结果义务身份>
    evidence_refs: [<behavior_equivalence Evidence>]
    decision_authorities:
      - kind: design | adr
        path: <仓库相对 Markdown 路径>
        content_digest: <64 位 sha256>
    compatibility_impact: <兼容影响>
    rollback_ref: <明确回滚方式>
```

`predecessor_revisions` 必须唯一且完整；每项父版本指纹必须与 Git tree 重算结果一致。`replaced` 的结果义务只能是
Behavior、Rule、Capability 场景或 Asset，不能使用 Evidence、Finding、Discovery unknown 或其它派生义务充当 canonical；
同时必须有等价 Evidence。
单前置重构要求 `merge_base_revision` 等于 predecessor；多前置比较必须与 `git merge-base --all --octopus` 得到的唯一真实
共同基准一致。过老祖先、不可恢复 revision 或多个最佳共同基准都失败关闭。
且 `replacement_ref` 不能等于被替代义务。`retired` 必须有 design/ADR 决策权威；双侧指纹冲突只能用
`resolved_conflict`，同时要求结果映射、等价 Evidence 和人的决策权威。决策路径、类型、内容摘要、明确批准状态、全部前置
revision、义务身份、产品理由、兼容影响和回滚策略必须可验证。
正式 `状态` / `Status` 章节必须只包含一个规范值：`已批准`、`已采纳`、`已确认`、`approved` 或 `accepted`。
否定、撤销、待确认、附带条件或包含额外说明的状态必须阻断，不能用背景、候选或决策正文中的批准字样替代批准状态。
长期 Evidence 使用 `source:<digest>` 绑定排除 `.echo-semantic/` 后的结果源码，避免写入包含自身的 commit SHA 形成循环。
执行连续性比较时，只有 `merge_base_revision`、排序后的 `predecessor_revisions` 和 `result_snapshot` 与本次四点输入完全一致的
Evidence 才能作为当前 resolution；历史 Evidence 继续保留用于审计，但不能参与当前候选选择，也不要求其结果摘要等于仓库当前源码。

连续性报告状态为 `preserved`、`replaced`、`retired`、`conflicted`、`missing` 或 `unknown`。只有前三种通过；其它状态和不可恢复
revision 必须返回非零。报告是可重算的命令输出或 CI Artifact，不是长期语义权威。

历史 tree 读取按 resolved revision 缓存结构，blob 通过 `git cat-file --batch` 流式处理并跨快照复用 `object_id -> sha256`；
只有语义文档和实际源码引用保留正文，不能按文件启动 Git 子进程，也不能把整个仓库 blob 正文常驻内存。

## 八个风险视角

`trigger_input`、`result_side_effect`、`state_authority`、`data_durability`、`time_lifecycle`、
`failure_concurrency`、`permission_external`、`contract_evidence`。

## 生成前预检

`semantic-preflight` 状态保存在 `.echo-semantic/preflight.json`，由 `.git/info/exclude` 排除，不进入 Git 提交。它必须记录 `scope: task`、分类、风险、允许路径、复用依据、
验证要求、基准 revision、高风险信号，以及“复用已有边界”或“新增边界理由”二选一的结论。受控删除额外记录 `repairRefs` 和 `deletePaths`，
把删除范围绑定到已完成 Finding。该状态只约束当前任务，
不定义项目架构或产品行为。记录必须包含任务标识、写入时间、仓库绝对路径和当前 `HEAD`；SessionStart、无变化 Stop
或成功 Stop 后失效，失败 Stop 保留用于同一任务修复重试。

资产盘点遇到动态注册、反射、配置路由、插件入口或无法静态解析的调用时必须写入 Discovery 的 `unresolved` 或 Asset 的
`needs_review`。只要这些未知项尚未闭合，删除差异一律阻断。

## 高风险变更门禁

校验器根据代码差异确定性识别公共 API 声明、协议/Schema 路径、状态权威声明和迁移路径，并与预检声明对账。
当前内置识别 Rust、Python、Go、Java、TypeScript 和 JavaScript 的公开声明；已知源码后缀没有可靠规则时使用
`unknownProductionCode` 保守升级，不把未知语言默认为低风险。

- 高风险变化必须标记为 `high`，提供依据和语义对象引用；
- 高风险代码路径必须出现在同次修改的语义对象中；
- 状态权威、协议、跨服务迁移和架构变化必须绑定且更新正式 design/ADR；
- 新增生产路径必须被基线区域分类；
- 低风险变化只检查允许路径、当前快照和项目原有工程验证。

## 禁止结论

任何对象状态都不能使用 `clean`、`safe` 或其它绝对安全词。结构校验通过只证明合同成立，不证明业务正确、
审查充分、测试通过或系统没有缺陷。


### 历史观察与可选文稿存储迁移

普通引用与连续性共用观察分组。Audit challenge的revision存在时严格采用（显式null、空串、非法值不回退），缺少该键才采用顶层revision；其它对象采用observed_at。Git、blob或锚不可恢复仍失败；历史成功不自动豁免结果树引用。consumer_refs和等价scenario_results中的source_refs也须检查。

连续性snapshot的current_reference_issues为派生输出，不由采用方填报；保留errors文本，每条含issue_type（historical_current_reference_missing或historical_current_anchor_missing）、snapshot_revision、owner、owner_document_path、owner_document_sha256、owner_fingerprint、raw_reference、observed_revision、historical_content_sha256、historical_git_mode、historical_anchor、source_role、source_dependency（仅Evidence派生）和error_index。issue_id为除error_index之外这些实际身份字段的canonical JSON SHA256，绑定同一次snapshot/父指纹；不是错误文字、位置序号或任意新声明的hash。

只有历史commit/blob/mode/锚真实存在才形成这类issue；否则原错误不可迁移。Evidence缺当前原件时恢复owner#source:<历史SHA>义务，fingerprint仍content/anchor/mode/原role；同ID不同fingerprint冲突失败，不选最后一个。源角色使用原continuity_source_role，存储例外固定只documentation，不含任何declared:*、test_consumer、production_source、protocol或其它角色。源码、测试和其真实consumer仍走原完整替代合同或阻断，不把档案后缀当角色许可。

现有semantic_continuity.resolutions的每项可增加三个严格可选字段：historical_reference_migrations、current_reference_replacements、source_dependency_variant_replacements；不提供时保持原合同，提供任一字段时它必须为非空严格列表。resolution仅允许disposition、predecessor_fingerprints、replacement_ref、evidence_refs、decision_authorities、compatibility_impact、rollback_ref以及这三个字段；未知字段/拼写一律拒绝。

```yaml
historical_reference_migrations:
- issue_id: <64hex，真实snapshot issue>
  snapshot_revision: <40hex，原snapshot>
  owner: <原owner ID>
  owner_fingerprint: <64hex，原owner指纹>
  raw_reference: <原path#anchor>
  observed_revision: <40hex，实际历史commit>
  historical_content_sha256: <64hex>
  historical_git_mode: '100644'
  source_role: documentation
  replacement_ref: <同一resolution的合法canonical义务>
  equivalence_evidence_ref: <同一resolution.evidence_refs中的behavior_equivalence>
  scenario: <该Evidence中status为matched的确切键>
```

列表每项只能包含上述完整字段，重复issue、未知字段、缺字段或错类型失败。每个issue必须由其source_dependency（若有）否则其owner那一条resolution承接。先通过原全部父指纹/result source digest/替代类型/双方supports/全部matched场景/before和after覆盖检查，并实际处置为replaced（不能靠preserved快速路径），再核每个身份字段、replacement和确切等价场景。

存储迁移即使disposition=replaced也须正式批准design/ADR，复用原decision_authority_errors：文件位于结果树、类型和SHA正确、批准状态唯一明确、含全部父revision/原义务/理由/兼容/回滚；另须具名issue_id、owner与原snapshot_revision。不是Admin提案或一个approved字符串。resolved_conflict继续受原冲突合同约束，自身replaced、Evidence充canonical或无业务等价均失败。

报告snapshot_diagnostics完整保各merge_base/predecessor/result原errors及typed issues。只有完整合法且显式匹配的父documentation issue才从终态errors移入resolved_historical_reference_migrations，保原issue、适用snapshot_roles、处置/Evidence/场景定位；重复/无映射/非法mapping及其它原错误继续fatal。相同revision出现在父和result也不会豁免result；所有结果current缺失始终失败。总passed仍要求errors为空且全部义务合法保留/替代/退役，不以新增loss0、已恢复tag或某个resolution无reasons冒全部通过。

此功能不授权采用方删除档案、业务代码或语义义务，不修改风险/状态/角色来求绿。272个文稿和另外24个强consumer是一次采用方案例的不同角色，不是工具固定数量或自动清理目标。


### 非文稿强替代与歧义依赖

`current_reference_replacements`是resolution的另一严格可选列表：采用historical_reference_migrations的所有identity字段，另加replacement_source_ref、replacement_content_sha256（64hex）、replacement_git_mode。只允许原plain非documentation角色（declared:*仍拒绝）；B文稿locator例外不扩大。所有原fullresolution/Eq/ADR检查相同，另从结果canonical owner确切引用与等价matched场景共同列出的replacement_source_ref读真实Git blob/mode/锚，声明SHA/mode相符且原continuity_path_role必须等原role。生产/测试不得用文稿或declared字段假扮同角色。authority还须具名真实replacement ref。报告单独保存resolved_current_reference_replacements；result缺引用及无映射仍fatal。

同owner#source:SHA有多个不同(content/anchor/mode/role)指纹时形成`source_dependency_collisions`。仅碰撞组的旧ID指纹是sorted全部variant指纹的canonical JSON SHA256；每variant的义务ID为旧ID#variant:<原完整FP>，fingerprint等原完整FP。相同variant多个rawref逐条保存；普通单variant ID/FP完全不变，禁止last-write/择一。typed collision包含snapshot_revision、owner、dependency_id、aggregate_fingerprint、variants（fingerprint/content_sha256/anchor/git_mode/source_role/obligation/references[raw_reference,actual_revision]）、collision_id和error_index；collision_id为除error_index之外真实身份canonical JSON SHA256。

原聚合resolution必须resolved_conflict，各variant必须各实际replaced，全套原父FP/Eq/afterdigest/正式批准ADR逐条通过。每variant另提供严格source_dependency_variant_replacements列表，字段恰为snapshot_revision、collision_id、variant_obligation、variant_fingerprint、raw_reference、source_role、replacement_ref、replacement_source_ref、replacement_content_sha256、replacement_git_mode、equivalence_evidence_ref、scenario。每原rawref唯一mapping、原variant及collision身份精同；当前canonical/具名matched场景/真实Gitrole的核验复用上段同一helper，aggregate无默认role，docs/test/prod不能互换。ADR具名collision、owner、全部variant/聚合义务、所有父revision及兼容/回滚；任一缺失仍fatal，不能只写approved字符串。

只解base/predecessor且所有variant真实完整替代的那一项typed collision；result原歧义始终fatal，原snapshot错误保留，resolved_source_dependency_collisions保存明确处置。孤mapping/未知字段/重复身份/少任何variant或rawref/角色SHA模式锚错误/无authority/未matched继续失败。旧source ID表达不足被明确揭示，不自动重写全部源身份或将所有历史归档视为文稿。


### 本地产物运行态

`.echo-semantic/local/<task>/`是已准备的任务本地产物目录，和根级运行态文件一样不提交，不作为source_refs/code_refs/consumer_refs，不参与正式对象收集；目录及根条目不可符号链接，local根不可普通文件，任何被Git跟踪的local后代失败。只接受精确local目录，不放宽其它未声明根条目。历史Git若错误跟踪本地产物也不能把它冒正式依赖。
