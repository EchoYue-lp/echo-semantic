# 命令参考

## 显式全项目完成与 Stop

普通任务预检默认 `verificationScope: task`。用户明确要求 Baseline 更新或全项目完成验证时，在原 record 参数中增加 `--verification-scope repository`；旧记录缺少该字段时仍按 task 处理。该选项不扩大 allowedPaths、不自动建库或扫描。

```bash
uv run skills/semantic-contract/scripts/verify_semantic.py --root <仓库绝对路径> \
  --repository-scope --task-id <预检任务标识> --base <预检基准> \
  --session-id <真实宿主会话标识> --require-change-evidence
```

这个完成入口输出 JSON：scope=repository，repositorySnapshot 绑定全仓源码，contentDigest 绑定任务及正式语义材料。必须与预检范围匹配，并完成严格校验。Stop 自动选择有效预检声明的完成入口，成功才保存范围收据并消费预检；单独运行 `--strict-snapshot` 不会生成 Stop 收据。失败保留预检，不手动填写收据。已安装旧插件需经正常安装流程更新，源码夹具执行不能代替 GUI/新会话加载验收。

repository 收据重入会真实重验完整材料和任务依据，包括被 Git 忽略的文件；普通 task 收据保持轻量。内部只读检查入口 `--repository-receipt-check` 可与 `--task-evidence-stdin` 配合，从 stdin 接收原收据的路径摘要映射，不能混用任务、基准或连续性参数；该命令不会生成成功收据。瞬时身份观察和项目状态锁防止验证后内容变化或新任务记录被旧 Stop 结算。

task 报告及成功收据另存 `referenceDigests`，按 revision/path 记录历史摘要；旧 task 收据缺少该字段不能重用，明确 `{}` 表示没有历史引用。`--reference-receipt-check --task-evidence-stdin` 只读重验真实 Git 内容。存在历史依据时，repository 的 `taskEvidenceDigests` 使用 `{files,references}` 信封，旧纯文件映射继续兼容；当前同名文件不能替代历史依据。

## 本地产物与提交检查

在插件根目录执行目录准备，或将脚本路径替换为已安装插件的绝对路径：

```bash
node scripts/artifacts.mjs prepare --root <仓库绝对路径> --task-id <安全任务标识>
```

返回 `.echo-semantic/local/<task-id>/` 的绝对路径，设置 `.git/info/exclude` 并核对忽略生效。任务标识为至多 128 字符的安全单目录名；不接受路径分隔符、冒号、末尾点及 Windows 保留名。遇到已跟踪产物、符号链接或忽略失败时拒绝，不覆盖文件。日志、结果和临时文件共享目录，不自动清理。

只有已获暂存/提交授权时才执行相应 Git 动作；以下检查本身不会执行它们：

```bash
python3 scripts/artifact_contract.py --root <仓库绝对路径> --staged
python3 scripts/artifact_contract.py --root <仓库绝对路径> --base <Git基准>
```

`--staged` 核对索引身份，`--base` 核对当前 HEAD tree；工作区文件不能替代候选版本。输出 JSON 的 errors 非空退出 1，输入/Git 观察失败退出 2，只有 warnings 退出 0。明确运行态/local 路径阻断，普通疑似日志仅提示；清理删除允许，合法 fixture 不按后缀禁止。现有 GitHub Action 先执行候选产物检查，不自动安装 Git Hook。

除宿主原生命令外，以下命令都在 `echo-semantic 0.5.0` 仓库根目录运行。目标项目参数应使用绝对路径，减少工作目录歧义。

## 安装器

```text
node bin/install.mjs <install|uninstall> <all|codex|cursor|claude-code> [--dry-run]
```

示例：

```bash
node bin/install.mjs install all
node bin/install.mjs install codex
node bin/install.mjs uninstall cursor
node bin/install.mjs install all --dry-run
```

结果状态：

| 状态            | 含义                           |
| --------------- | ------------------------------ |
| `installed`     | 该宿主已覆盖安装当前插件       |
| `removed`       | 当前与旧 ID 的注册和投影已删除 |
| `skipped`       | `all` 模式下未检测到该宿主     |
| `manual_action` | 显式渠道未检测到宿主           |
| `failed`        | 宿主命令或文件操作失败         |

只出现 `installed`、`removed` 或 `skipped` 时退出码为 0；`manual_action` 或 `failed` 返回非零。

## 宿主能力探测

探测全部宿主：

```bash
npm run probe
```

探测指定宿主：

```bash
node runtime/capabilities/probe.mjs codex
node runtime/capabilities/probe.mjs cursor claude-code
```

## 风险路由

```bash
node runtime/route.mjs \
  --root /absolute/project/path \
  --host codex \
  --event manual
```

输出包含 `route`、`scope`、`skills`、`changedPaths`、`highRiskPaths`、`enforcement`、静态 `capabilities`、安装探测 `runtimeProbe` 和真实事件
`hookEvidence`。没有明确任务且没有工作树变化时为 `idle`；`--scope repository` 才选择全项目维护；明确任务通过有效预检后按任务范围路由。手工运行不会伪造 Hook 事件证据。
路由结果同时写入目标仓库 `.echo-semantic/route.json`，并更新 `status.md` 和 `status.json`。

## 非 UTF-8 差异与风险识别

校验器的普通 Git 文本读取使用 UTF-8 `surrogateescape` 保留原字节；未跟踪文件的新增行采用相同规则。原文件包含非法 UTF-8 时，
差异仍参与路径和风险标记检查，不会因替换字符或忽略解码错误而隐藏相邻的公开接口、状态权威或协议变化。
`binary=True` 的 Git blob 读取仍返回原始 `bytes`，真正的二进制 diff 仍保留变更路径和协议义务；Git 命令失败仍返回非零。
该处理不修改项目文件、不改变正式语义材料的 UTF-8 要求，也不豁免任何路径或验证依据。

## 语义连续性门禁

比较共同基准、一个或多个前置版本与候选结果：

```bash
uv run skills/semantic-contract/scripts/verify_semantic.py \
  --root /absolute/project/path \
  --continuity-merge-base <merge-base> \
  --continuity-predecessor <target-revision> \
  --continuity-predecessor <source-revision> \
  --continuity-result <result-revision> \
  --continuity-report /absolute/path/continuity-report.json
```

所有连续性输入必须一起提供，`--continuity-predecessor` 可以重复。命令直接读取 Git tree，不 checkout 或修改分支；报告同时写入
stdout 和可选路径。只有 `preserved`、`replaced`、`retired` 通过，`missing`、`conflicted`、`unknown` 或不可恢复 revision
返回非零。普通单前置版本重构可以让 merge-base 与 predecessor 指向同一 revision。

## 语义状态

```bash
uv run skills/semantic-status/scripts/status.py \
  --root /absolute/project/path
```

输出基线结构、路由可信度、预检新鲜度、继续包可信度、对象计数、开放 Finding、失效 Audit 和下一入口。该命令不替代完整验证。

## 语义资产盘点

盘点整个仓库：

```bash
uv run skills/semantic-discover/scripts/inventory.py --root /absolute/project/path
```

只盘点明确任务路径：

```bash
uv run skills/semantic-discover/scripts/inventory.py \
  --root /absolute/project/path --path src/example.py
```

全项目盘点增加 `--write` 只保存独立 Discovery 扫描报告；局部 `--path` 只输出 task 报告，不写入全局材料。静态重复只形成候选，不自动合并或删除。

## 候选归并

查看候选并保存待人工确认的扫描报告：

```bash
uv run skills/semantic-consolidate/scripts/consolidate.py \
  --root /absolute/project/path --boundary <已有 boundary id> --write
```

写入只保存 `needs_review` 候选报告，`written_findings` 为空。实际用户确认并核对当前源码后，通过预检维护正式 Finding 和 canonical owner；正式批准与等价证据完成后才可进入 `semantic-repair`。CLI 的批准参数不能与报告保存混用。

## 受控修复与删除

在已批准 Finding 上记录删除授权：

```bash
uv run skills/semantic-preflight/scripts/preflight.py record \
  --root /absolute/project/path \
  --kind refactor --risk high \
  --allow src \
  --search src --reuse-decision new --reuse "已核对候选差异" \
  --verify "project test" \
  --repair-ref finding.consolidation.example \
  --delete-path src/legacy.py \
  --basis "已确认 canonical owner 和回滚点" \
  --semantic-ref finding.consolidation.example \
  --reuse-existing-boundary "复用现有能力边界"
```

删除工具会被编辑前 Hook 检查；Stop/CI 还会要求 repair Finding 和 `behavior_equivalence` Evidence。
repair Finding 需要在对象中声明 `delete_paths`、`replacement_refs` 和 `rollback_ref`；等价 Evidence 需要绑定删除前后版本和
`deleted_paths`，并逐场景保持 `matched`。

预检脚本会写入 `scope: task` 和自动任务 id；若宿主提供稳定的任务/会话 id，可用 `--task-id` 传入同一值，便于后续会话继续识别任务范围。

## 生成前预检

### 已有差异处置

首次发现已有差异时先询问用户，未答复只读、不修改或交付。以下命令只盘点或记录明确答复，不进行提交、清理，也不生成验证成功收据。宿主会话标识来自 SessionStart，不按任务 id 猜测。

`inspect` 的 `presentation` 提供用户可见盘点所需的状态分类和嵌套仓库摘要。助手必须展示具体差异、判断与本任务的重叠关系，并给出一个带事实理由的推荐；不能只转述存在差异或把推荐当作用户答复。

```bash
node scripts/session-changes.mjs inspect --root <仓库绝对路径> --session-id <宿主会话标识>
node scripts/session-changes.mjs decide --root <仓库绝对路径> --session-id <宿主会话标识> \
  --fingerprint <inspect 当前指纹> --strategy preserve --basis <用户明确答复依据>
```

`--strategy` 为 `preserve`、`readonly` 或 `adopt`；仅 `adopt` 必须提供一个或多个 `--path <当前已有差异路径>`，其它路径保持保护。接管后仍需有效预检和完成验证，指纹变化后不能沿用旧答复。Skill 加载目录内也提供同名 `scripts/session-changes.mjs` 入口。

`decide --fingerprint` 必须使用询问前保存的 `questionFingerprint`。等待答复期间观察变化时，调用 `refresh --root <仓库绝对路径> --session-id <宿主会话标识>` 显式更新待裁决盘点，再询问用户；refresh 只撤销旧裁决并记录新观察，不授权写入，不更新原会话起始内容指纹。

最小示例：

```bash
uv run skills/semantic-preflight/scripts/preflight.py record \
  --root /absolute/project/path \
  --kind feature \
  --risk medium \
  --allow src \
  --allow tests \
  --search src --reuse-decision new --reuse "名称和行为检索未找到适用实现" \
  --verify "project test command" \
  --reuse-existing-boundary "扩展现有能力边界"
```

可用分类：`bugfix`、`feature`、`refactor`、`contract`、`style`。

高风险变化按实际情况增加：

```text
--public-api
--new-state-authority
--new-protocol
--cross-service-migration
--architecture-change
--unknown-production-code
--basis <依据>
--semantic-ref <对象 ID>
--design-authority <设计路径>
--adr <ADR 路径>
```

架构类变化至少绑定一个有效 design 或 ADR。新增边界使用 `--new-boundary-reason`，否则必须使用
`--reuse-existing-boundary`；两者互斥。

检查当前记录：

```bash
uv run skills/semantic-preflight/scripts/preflight.py check \
  --root /absolute/project/path
```

检查一个路径是否被允许：

```bash
uv run skills/semantic-preflight/scripts/preflight.py check \
  --root /absolute/project/path \
  --path src/example.rs
```

同一任务增量检查并只输出摘要（不写入、不续期）：

record 通过插件已要求的 Node 20+ 运行态模块复用项目锁，串行完成最新记录比较与写入；check 仍只需 Python 和 Git。

```bash
python3 skills/semantic-preflight/scripts/preflight.py check \
  --root /absolute/project/path --task-id <原任务标识> \
  --path src/example.rs --compact
```

任务不匹配、HEAD/设计权威变化、引用缺失或记录过期均拒绝；同一任务重新 record 不得降低风险或移除高风险信号。新增目标、授权、范围和依据变化仍须补充预检，不能仅凭 check 认定调查事实仍有效。

显式运行临时夹具基准：

```bash
npm run benchmark:preflight -- 7
```

输出路由与 CLI 检查的 p50/p95、路由 Git 调用数及读取字节；不测量真实宿主和助手调查，也不执行后台采集。详见 [性能优化设计](designs/preflight-performance.md)。

清除当前预检：

```bash
uv run skills/semantic-preflight/scripts/preflight.py clear \
  --root /absolute/project/path
```

## 语义验证

严格验证当前快照：

```bash
uv run skills/semantic-contract/scripts/verify_semantic.py \
  --root /absolute/project/path \
  --strict-snapshot
```

验证增量高风险依据：

```bash
uv run skills/semantic-contract/scripts/verify_semantic.py \
  --root /absolute/project/path \
  --strict-snapshot \
  --base <40 位基准 revision> \
  --require-change-evidence
```

校验器自测：

```bash
uv run skills/semantic-contract/scripts/verify_semantic.py --self-test
```

## 插件开发验证

```bash
npm test
npm run verify
```

`npm test` 运行静态插件合同、Node 测试和 Python 单元测试。`npm run verify` 还会运行格式检查、校验器自测和插件自身严格快照。

## 本地状态位置

```text
<project-root>/.echo-semantic/preflight.json
<project-root>/.echo-semantic/route.json
<project-root>/.echo-semantic/continuation.json
<project-root>/.echo-semantic/status.md
<project-root>/.echo-semantic/status.json
~/.echo-semantic/install-state.json
```

`.echo-semantic/` 中的长期语义 Markdown 正常提交；上述 5 个运行态文件由插件写入 `.git/info/exclude`，不进入提交。

## 有依据的复用记录与局部完成验证

`record` 必须提供 `--search` 和 `--reuse-decision reuse|extend|new`。`--candidate` 是 JSON 对象，包含 path、symbol、selected、reason；复用或扩展必须有选定候选，new 不能选定候选。`--evidence` 固定内容摘要，`--mutable-evidence` 标识任务可修改依据，不能越出 allowedPaths。语义引用自动按合同文件名定位并纳入依据；需修改这些对象时显式声明 mutable evidence。

```bash
uv run skills/semantic-contract/scripts/verify_semantic.py \
  --root /absolute/project/path --task-scope --task-id current-task \
  --base <预检基准> --require-change-evidence
```

存在已有差异时提供真实 `--session-id`；校验器核对已确认的会话保护策略。输出 JSON 为 task 范围，不运行全局路径分类或源码摘要。没有基线也可使用。显式全项目严格校验仍使用前文 `--strict-snapshot`，两者不能混用。CLI 不替代工程测试或语义审查。

## 扫描报告核对与基线维护

```bash
uv run skills/semantic-discover/scripts/inventory.py \
  --root /absolute/project/path --check-report <已保存报告绝对路径>

uv run skills/semantic-discover/scripts/inventory.py \
  --root /absolute/project/path --confirm-report <已保存报告绝对路径> \
  --confirmation "用户已明确确认报告中的候选和语义事实"
```

结构核对支持无 Baseline 项目。确认核对必须在用户真实答复后执行，报告或源码变化会拒绝；`baselineUpdated` 固定为 false。随后通过预检维护已确认语义材料，执行全项目严格和工程验证。旧 `--write` 不再覆盖 Asset、Finding 或 `discovery.semantic-assets.md`；脚本消费者应读取 `report_path`。长期扫描报告位于 `.echo-semantic/discovery/`，不排除提交，任务运行态保持不变。

通用外部调度与 cron 配置示例、模拟环境及真实触发验收见[用户定时扫描](scheduled-scanning.md)。周期、项目、工具环境和日志位置由用户配置。

## 插件仓库 CI 的 uv 缓存依据

本仓库 CI 的 `setup-uv` 缓存失效键显式匹配 `package.json` 和 `skills/semantic-contract/scripts/verify_semantic.py`：
前者保存 npm 验证脚本与 uvx Ruff 版本，后者的 PEP 723 头保存 PyYAML 依赖。默认 requirements/uv.lock glob 在本仓库没有对应文件，
不能作为缓存依赖依据。此设置只绑定缓存失效来源，不关闭缓存、测试或原始警告输出；实际 CI 结论仍以相应提交的完整日志为准。


## 历史引用迁移报告

连续性命令和退出规则保持原入口；Audit的每项challenge按其revision或顶层fallback恢复原Git。受控文稿存储迁移沿既有semantic_continuity.resolutions增加historical_reference_migrations，精确绑定snapshot issue、原父指纹、真实历史blob/锚/mode/角色、matched等价场景及批准ADR。详见唯一[材料合同](../skills/semantic-contract/references/semantic-artifact-contract.md)。报告保snapshot_diagnostics与resolved_historical_reference_migrations；原始诊断可保留而对应父文稿issue被合法解决，result缺current引用仍fatal。没有忽略父错误或将测试/源码改为文稿的选项，未映射问题继续非零。


强源码/测试consumer迁移使用同一resolution中严格的current_reference_replacements；碰撞组保聚合和每variant义务，用source_dependency_variant_replacements逐原ref绑定真实结果consumer。两者不是忽略错误选项，结果树/role/锚/SHA/mode及原完整Eq/ADR必须全部通过，未处置与结果歧义继续非零。报告补充source_dependency_collisions、resolved_source_dependency_collisions与resolved_current_reference_replacements；单variant旧ID/FP不改。
