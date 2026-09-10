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
└── discovery/
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

## 八个风险视角

`trigger_input`、`result_side_effect`、`state_authority`、`data_durability`、`time_lifecycle`、
`failure_concurrency`、`permission_external`、`contract_evidence`。

## 生成前预检

`semantic-preflight` 状态保存在 `.echo-semantic/preflight.json`，由 `.git/info/exclude` 排除，不进入 Git 提交。它必须记录分类、风险、允许路径、复用依据、
验证要求、基准 revision、高风险信号，以及“复用已有边界”或“新增边界理由”二选一的结论。该状态只约束当前任务，
不定义项目架构或产品行为。记录必须包含任务标识、写入时间、仓库绝对路径和当前 `HEAD`；SessionStart、无变化 Stop
或成功 Stop 后失效，失败 Stop 保留用于同一任务修复重试。

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
