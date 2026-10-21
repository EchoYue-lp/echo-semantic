# 变更记录

本项目遵循语义化版本。每个正式版本必须记录用户可感知变化、合同变化、迁移要求、验证边界和已知限制；开发过程不把
`+codex.<timestamp>` cachebuster 提交为项目版本。

## Unreleased

### 显式全项目完成验证

- 预检可显式选择 repository 完成范围，旧记录和普通任务仍默认 task；Stop 根据有效预检运行匹配的真实校验，解决 Baseline 全项目验证无法结算的问题。
- 全项目收据绑定任务、工作树、全仓源码身份和正式语义材料；失败不消费预检，不以手动填写收据代替执行。

### 本地产物与提交边界

- 日志和临时工作文件统一放入 `.echo-semantic/local/<task-id>/`，准备命令复用本地 Git 排除；不自动清理、上传或提交。
- 暂存区与候选提交检查阻断运行态/local，疑似原始日志仅提示；正式 fixture 不按后缀禁止。分发排除 local，语义引用不得将本地产物提升为源码权威。
- 长期 Evidence 提炼结论和原件引用，不要求整套运行归档；源码副本优先使用 Git revision 与路径追溯。

### 待决定

- 首次公开分发前选择并添加明确的开源许可证。

## 0.5.0 - 2026-10-12

本地候选版本，安装授权仅针对 Codex；未创建 tag 或公开发布。

### 宿主根、会话与交付续接

- 写前 Hook 根据真实编辑目标选择仓库根，成功准入才绑定同一宿主会话；拒绝跨根补丁、缺失或冲突会话及符号链接越界，Stop/PreCompact 复用该绑定。
- 正常 checkpoint 与 squash 交付后，在同会话已确认处置、同任务当前预检和可恢复共同 Git 历史均成立时续接；不补造起始快照，不凭共同祖先自动授权 checkout。
- 无起始观察且任务未归属当前会话时，Stop 保留原件并以 blocked/未验证结束；pending 写入反馈提供本仓 inspect 和实际提问的恢复步骤，unknown 观察先恢复正常 SessionStart。反馈不保证模型已弹出问题。

### 历史引用、收据与连续性

- task、全仓及连续性校验共用源码观察分组，包含 `consumer_refs` 和嵌套场景；Audit 每项 challenge 使用自己的 revision，仅缺省时继承顶层，显式无效值拒绝。
- 历史引用从实际 Git revision/path 读取并保存 `referenceDigests`；当前同名文件不能替代旧内容。旧 task 收据缺少历史身份时重新验证，repository 收据兼容旧文件摘要映射及 `{files,references}` 信封。
- 历史文稿迁移、当前消费者替代和依赖碰撞变体使用三个严格可选字段逐项绑定真实 issue、父指纹、等价场景与设计决策；缺失 Git/blob/锚点、结果树缺引用或未映射变体继续失败。
- Git 文本差异采用可逆 `surrogateescape`，非 UTF-8 字节不再导致风险识别丢失；二进制 blob 接口仍返回 bytes，Git 错误继续传播。
- `npm test` 通过 uv 显式提供校验器已有的 PyYAML 依赖；CI 缓存输入绑定验证命令与脚本依赖声明。未新增运行服务或依赖政策。

### 日常任务与复用

- 预检使用 `schemaVersion: 2`，保存搜索范围、候选路径/符号、复用决定与相关内容依据；固定依据变化或任务越界会拒绝，旧自由文本记录需要重新预检。
- 有无 Baseline 的任务均检查预检；没有明确任务时等待，不自动进入全项目建库、归并或审计。
- 日常完成检查及局部盘点读取任务范围和相关依据，不计算全项目源码摘要；局部结果与全局闭合分开。
- Node 消费者复用 Python 完整预检合同；旧版本或旧范围收据不沿用，插件版本变化要求重新验证。

### 全项目扫描与用户定时配置

- 扫描从一致内容快照提取静态线索，重验变化；独立 Discovery 报告在仓库锁内以安全目录描述符原子发布，不覆盖正式材料或任务运行态。
- 旧 `inventory.py --write` 和归并写入只保存候选报告，不直接生成或覆盖正式 Asset/Finding；消费者改用 `report_path`。用户确认后核对当前源码，再走正式语义维护。
- 提供用户配置外部调度、cron 调用示例和验收步骤；插件不内置周期、固定仓库或实际定时器。
- 静态盘点保留未知及排除项，不证明行为等价或全项目闭合；报告作为日常依据时不会展开所有内嵌候选源码。

### 验收与迁移边界

- 自动测试、临时仓库模拟和安装登记不替代用户的真实周期触发或 Codex 新会话加载验收。
- 安装到 Codex 不安装或更新 Cursor/Claude Code 的登记与缓存；源清单版本保持一致。
- 已有正式语义事实保留，旧任务记录重建。需要正式资产写入的旧脚本须迁移至用户确认后的维护流程。

## 0.4.0 - 2026-09-18

本地候选版本，新增任务增量预检与会话级已有差异处置；未创建 tag、推送或公开发布。

### 预检性能

- 调查从目标实现、已有地图和直接消费者开始，未知或高风险再扩大，不默认全仓调查；同任务增量 check 绑定 taskId 与路径，不续期、不跨任务复用；
- 编辑观察不计算全量工作树内容指纹，受保护差异仍逐次核对内容；仅编辑观察复用身份未变且五分钟内的成功宿主探测，停止重新探测；
- 无引用零读取，有引用共享单次校验索引；提供显式临时夹具基准，不增加后台采集或隐藏遥测；
- record 复用现有运行态锁，锁内重新执行完整共享合同并禁止同任务风险/信号降级，等待期间 repair 依据失效时拒绝覆盖旧记录。

### 已有差异与 Stop 收口

- 首轮发现已有未提交差异时盘点并主动询问用户接管、保留或只读策略；未答复只读，不将未提交直接视为缺陷；
- 盘点输出新增可展示的路径状态与嵌套仓库 revision 摘要；提问必须说明与当前任务的重叠关系并给出带事实理由的唯一推荐，禁止只提示“存在差异”；
- 按会话绑定起始观察及裁决，保留未接管路径保护，HEAD/保护内容变化重新询问；策略不表示验证通过，不授权提交或清理；
- 只读未裁决 Stop 保留待处理依据，不无限重入；成功收据绑定工作树、插件、宿主及已知宿主版本，旧字段或未知版本不复用；
- 运行态使用有界普通文件读取与可信 PID 锁恢复，保留既有连续性门禁及最终工程验证。

### 兼容与验收边界

- Python record 需要插件已要求的 Node 20+ 运行态；check 仍只需 Python 与 Git；安装包包含内部完整校验入口和变更记录；
- 版本更新使旧插件验证收据失效，需要重新验证；会话快照与去重记录仍是采用方不提交的短期状态；
- 自动测试、静态清单、夹具基准及 Codex 安装登记不替代真实宿主新会话、GUI 重载、Claude Code 登录生命周期或同事端到端耗时验收；
- 公开许可证及正式发布证据仍待完成，不把本地候选称为公共发布完成。

## 0.3.0 - 2026-09-12

本版本把老项目语义整合闭环推进为可在 merge、rebase、squash、cherry-pick 和重构后确定性执行的语义连续性门禁。

### 语义连续性门禁

- `semantic-diff`、`semantic-verify` 和确定性校验器新增多前置 revision 语义义务比较，覆盖 merge、rebase、squash、cherry-pick 和重构；
- 候选结果必须保留 Behavior、Rule、Capability 场景、未决 Finding、未知项及其验证依赖，或提供可验证替代/退役 Evidence；
- 引用内容签名同时保护 blob、执行位、symlink 类型、锚点和路径角色，阻断测试移出 runner、依赖缩减和旧实现覆盖；
- Action 可选接收 merge-base、target、source、result 并输出确定性 JSON 报告；旧单基准门禁保持兼容；
- 不新增自动 Git merge Skill，不修改 Codex、Cursor、Claude Code 的 Hook、Agent 和 manifest 适配。

### 文档、性能与兼容性

- README、概念、命令参考、CI、宿主支持、发布指南以及架构流程图和多分支时序图同步到 `0.3.0`；
- Git tree 读取按 revision 缓存，并使用流式 `git cat-file --batch` 复用 blob 摘要；普通 blob 不把完整正文常驻内存；
- 保持 `0.2.0` 的 `source:<digest>` 算法可恢复，Git mode 和 symlink 类型仅进入新增连续性引用签名；
- Codex、Cursor、Claude Code 的 manifest 只同步版本字段，Agent、Hook 事件、能力矩阵和安装器行为保持不变。

### 验证边界

- Git DAG 回归覆盖 merge commit、PR merge ref、squash/rebase 形候选、单前置重构、错误 merge-base、实现覆盖、测试角色变化和批准证据防伪；
- 静态合同和自动测试不能替代真实 GitHub Runner、Codex 新任务、Cursor 窗口重载或 Claude Code 登录会话验收；
- 未建模的动态注册和隐含产品行为仍需要 Discovery、Audit 与人的裁决，不能由连续性门禁事后恢复。

## 0.2.0 - 2026-09-11

本版本把插件从“语义治理门禁”推进到“老项目语义整合闭环”，并完成 Codex、Cursor 的安装回归与文档同步。

### 老项目语义整合

- 新增 `semantic-discover` 资产盘点：生成稳定 Asset 身份，识别文件、符号、入口、状态权威、协议、测试消费者、文档和动态未知；
- 新增 `semantic-consolidate`：将重复实现、平行状态权威和包装链形成候选 Finding，要求按候选簇选择 canonical owner；
- 新增 `semantic-repair`：把替换关系、调用方切换、删除范围、回滚点和行为等价证据绑定到受控修复切片；
- 行为等价 Evidence 绑定删除前后 revision、删除路径、逐场景结果和工程命令；动态未知、未闭合 Discovery 或 `needs_review` Asset 阻断删除；
- Delete 编辑前 Hook、Stop 和 CI 共同执行高风险受控删除门禁，不接受静态无引用或单个旧 Evidence 作为删除依据。

### 路由与任务范围

- 无明确任务且工作树无变化时进入 `maintenance`，依次提供全仓资产盘点、状态汇总、候选归并、定向审查和验证；
- 明确任务只处理 `semantic-preflight` 允许路径；预检记录 `scope: task`，任务 id 与宿主输入匹配后才进入任务范围路由；
- 目录路径盘点支持递归范围，批准归并要求 `--candidate-id` 与候选簇内的 canonical Asset。

### 多宿主与发布文档

- 版本源、三端 manifest、Claude marketplace、Action、安装缓存检查和测试期望统一升级为 `0.2.0`；
- README、概念、命令参考、CI、宿主支持、发布指南和安全说明同步版本与新能力；
- 架构主流程、维护路由、宿主生命周期、高风险归并和安装卸载 Mermaid 图同步到当前执行链路；
- Codex Agent 投影和 Cursor 专用事件协议保持不变，Cursor 仍使用本地普通目录镜像。

### 验证边界

- `npm run verify` 通过，包含格式/Lint、插件与分发合同、47 个 Node 测试、24 个 Python 测试、语义自测和严格快照；
- Codex 安装脚本返回 `installed`，Cursor 安装脚本返回 `installed`；Cursor 窗口由维护者手工检查；
- Claude Code 登录后的完整生命周期和公开许可证仍是后续发布工作，不把静态或安装证据描述为完整运行时覆盖。

## 0.1.0 - 2026-09-10

首个可用版本，重点完成 Codex 插件稳定性，同时建立 Cursor、Claude Code 适配和项目无关的语义治理控制面。

### Codex 插件稳定性

- 使用 Codex 原生发现路径 `hooks/hooks.json` 提供 `SessionStart`、`PreCompact`、`PreToolUse` 和 `Stop`，Hook 设置页与插件详情可保留 Echo Semantic 来源归属；
- 安装器不再新增用户级 Hook，只精确清理旧版本在 `~/.codex/hooks.json` 中留下的 Echo Semantic 投影，并保留其它用户配置；
- 使用 npm 发布白名单生成 `~/.echo-semantic/distribution/` 干净分发副本，避免把项目运行态、Git 数据、开发缓存或 `.pyc` 带入 Codex 缓存；
- 支持从任意工作目录安装，分发副本先完整 staging 再替换；失败时保留仍被其它宿主使用的现有副本；
- 三个语义审查 Agent 以只读 TOML 投影安装到 Codex 用户目录，旧插件 ID 的 Agent、Hook、marketplace 和安装状态会被清理；
- 区分“检测到 Codex”与“真实 Hook 已触发”：`enforcement` 只由绑定宿主版本、插件版本和时间窗的事件证据启用，Stop 未验证时保持 `bootstrap`；
- 插件清单使用可读 UTF-8 中文，展示名为 `Echo Semantic`，插件 ID 与 marketplace 名均为 `echo-semantic`。

### 语义治理

- 提供 `semantic-preflight`、`semantic-status`、`semantic-discover`、`semantic-diff`、`semantic-audit`、`semantic-decide`、`semantic-verify` 和 `semantic-contract` 八个中文 Skill；
- 生成前预检记录复用关系、边界结论、允许路径、风险信号、验证矩阵和正式 design/ADR 摘要；语义引用或设计摘要变化后自动失效；
- 项目 `.echo-semantic/` 同时承载提交 Git 的长期语义材料，以及精确排除的五个可丢弃运行态文件；不再建立第二套项目状态目录；
- `semantic-diff`、定向 `semantic-audit` 和 `semantic-verify` 围绕同一 Capability、Behavior、Rule、Evidence、Finding 与 Audit 合同协作；
- 高风险变化要求同次语义依据，架构变化还必须绑定并更新正式 design/ADR；项目 formatter、Lint、类型、单元、契约和集成测试继续拥有实现质量权威；
- 路由支持 `bootstrap`、`idle`、`fast`、`standard` 和 `strict`，纯测试/示例变化保持轻量，治理控制面和生产代码变化进入严格路径。

### 多宿主与安装

- 提供 Codex、Cursor、Claude Code 三端 manifest、能力矩阵、事件适配和统一安装器；
- 支持按单一渠道或 `all` 安装/卸载，`all` 会检测对应宿主，未安装宿主独立返回 `skipped`；
- Codex 与 Claude Code 共用原生 `hooks/hooks.json`，Cursor 使用专用小写事件映射和本地插件链接；
- 跨克隆安装直接覆盖所选渠道，不维护来源冲突或迁移事务；最后一个原生宿主卸载后删除共享分发副本；
- 插件 ID 从 `echo-coding-semantic-governance` 收敛为 `echo-semantic`，安装时清理旧身份；旧 GitHub Action 地址不提供重命名兼容。

### 文档与质量

- 提供完整 README、快速开始、概念、宿主支持、适配说明、命令参考、CI 接入、故障排查、FAQ、安全、贡献和发布文档；
- 提供系统架构、状态流转、风险路由、生命周期和安装卸载流程图，以及 ADR 0001；
- 提供 manifest、分发包、安装器、Hook、路由、状态、预检和语义合同的 Node/Python 自动测试；
- 提供 GitHub Action，在 Pull Request 上执行与宿主无关的严格语义门禁。

### 已知验收边界

- Codex 原生插件安装、四类 Hook 发现结构和 SessionStart 入口已验证；
- Cursor 仍需在真实 GUI 中重载窗口并验证完整 Hook 生命周期；
- Claude Code 仍需在已登录会话中验证完整模型与 Hook 生命周期；
- 当前仓库尚未添加开源许可证，因此 `0.1.0` 版本成立，但不等同于已经完成公开授权或 marketplace 发布。
