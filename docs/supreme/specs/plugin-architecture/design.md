---
title: Echo Semantic 项目架构与状态流转设计
artifact: design
carrier: markdown
---

# Echo Semantic 项目架构与状态流转设计

## 文档定位

本文描述 `echo-semantic` 的完整目标架构和当前实现约束，是项目架构、状态流转、生命周期与失败降级的统一说明。

当前发布版本为 `0.2.0`；本版本的架构图示覆盖仓库维护、资产盘点、候选归并、受控修复和行为等价验证闭环。

- [ADR 0001](../../../adr/0001-multi-host-layered-enforcement.md) 记录为什么采用“Skill 判断、Hook 接线、校验器与 CI 阻断”的架构决策；
- 本文描述该决策落地后的完整系统形态，不替代 ADR；
- [多宿主适配](../../../multi-host-adapters.md) 保存 Codex、Cursor、Claude Code 的适配差异；
- 采用方项目自己的 design/ADR 和 `.echo-semantic/` 仍是业务语义权威，插件文档不保存采用方事实。

## 问题与目标

单独依靠 Skill 只能影响模型当前一轮行为，无法证明 Skill 一定被加载，也无法在工具执行、上下文压缩和合并时提供确定性约束。
单独依靠 Hook 又不能完成能力复用、产品预期、状态权威和架构边界等需要语义判断的工作。

本项目的目标是建立一个项目无关的 Coding Agent 语义治理控制面：

1. 没有明确任务时盘点 Baseline 覆盖的已完成代码，执行仓库级语义维护；
2. 有明确任务时确认复用关系、唯一状态权威、允许修改路径和验证矩阵；
3. 根据仓库基线、宿主能力、任务范围和当前差异选择合适的治理深度；
4. 在宿主支持时，于编辑前阻断超出预检范围的写入和未授权删除；
5. 在上下文压缩前保存有证据约束的短期恢复线索；
6. 在任务停止和 CI 合并时重新执行确定性语义验证；
7. 让 formatter、Lint、类型、单元、契约和集成测试继续拥有实现质量权威。

## 目标行为

- 未采用语义基线的项目进入 `bootstrap`，先建立或修复 `.echo-semantic/`；
- 已采用项目必须在修改前拥有与当前仓库、HEAD 和任务匹配的 `semantic-preflight`；
- 文档、配置、测试等低风险变化走 `fast`，普通非源码变化走 `standard`，生产源码、协议、迁移和治理控制面变化走 `strict`；
- 高风险变化必须同时更新语义对象，架构类变化还必须绑定并更新正式 design/ADR；
- 没有明确任务且没有新工作树变化时进入 `maintenance`，建议执行全仓盘点、状态汇总、定向审查和验证；
- 明确任务只允许其 `semantic-preflight` 路径和语义引用参与修复，不把全仓候选混入任务差异；
- 任何短期状态失效都只能导致重新预检或降级，不能放宽编辑和停止门禁；
- Hook 缺失、宿主不支持或未取得真实会话证据时，由 Stop 和 CI 收口，不宣称完整运行时覆盖。

## 范围与非目标

### 范围

- Codex、Cursor、Claude Code 的插件清单、安装、Skill、只读 Agent 和 Hook 适配；
- Capability、Behavior、Rule、Evidence、Finding、Audit、Discovery 的 Markdown 合同；
- `semantic-preflight`、风险路由、任务继续包和状态汇总；
- 语义资产盘点、候选归并、受控修复和行为等价 Evidence；
- 严格快照、源码引用、路径分类、高风险依据和 CI 变更门禁。

### 非目标

- 不提供数据库、常驻服务或独立任务执行器；
- 不替代 Coding Agent 的编码、规划和普通代码审查能力；
- 不把预检、路由或继续包升级为业务状态权威；
- 不复制采用方已有的 design/ADR、任务系统、测试系统或工程规范；
- 不提供形式化行为等价证明、无监督 Git merge 或无监督批量删除；
- 当前不提供 MCP Server；本地文件和 Git 足以完成现有确定性验证。

## 系统边界

```mermaid
flowchart TB
  User[开发者]

  subgraph Hosts["Coding Agent 宿主"]
    Codex[Codex]
    Cursor[Cursor]
    Claude[Claude Code]
  end

  subgraph Adapters["宿主适配层"]
    Manifests[插件与 Marketplace 清单]
    HostHooks[三端 Hook 配置]
    HostAgents[只读 Agent 投影]
    Installer[按渠道安装器]
  end

  subgraph Control["共享语义控制面"]
    Entry[Hook 统一入口]
    Capability[宿主能力合同与探测]
    Router[风险路由]
    Continuation[任务继续包]
    Status[语义状态与 Frontier]
  end

  subgraph Judgment["模型判断层"]
    Skills[十个语义 Skill]
    Reviewers[三个只读审查 Agent]
  end

  subgraph Authorities["采用方权威"]
    Semantic[项目 .echo-semantic/]
    Design[项目 design 与 ADR]
    Runtime[.echo-semantic 运行态]
    Engineering[Formatter、Lint、类型与测试]
  end

  subgraph Gates["确定性门禁"]
    Verifier[语义合同校验器]
    Action[GitHub Action 或项目 CI]
  end

  User --> Hosts
  Hosts --> Adapters
  Adapters --> Control
  Control --> Judgment
  Judgment --> Semantic
  Judgment --> Design
  Control --> Runtime
  Semantic --> Verifier
  Design --> Verifier
  GitPrivate --> Verifier
  Engineering --> Action
  Verifier --> Action
```

宿主适配层只转换发现方式、事件名称、输入输出字段和安装投影。路由、状态合同、Skill 正文和语义对象模型只有一套共享实现。

## 仓库结构

```text
echo-semantic/
├── .agents/                    # Codex Marketplace
├── .codex-plugin/              # Codex 插件清单
├── .cursor-plugin/             # Cursor 插件清单
├── .claude-plugin/             # Claude Code 插件与 Marketplace 清单
├── agents/                     # 三个只读语义 Agent
├── bin/                        # 多宿主安装与卸载入口
├── hooks/                      # Codex/Claude 原生 Hook、Cursor 映射和共享入口
├── runtime/                    # 能力探测、风险路由和任务继续包
├── skills/                     # 十个语义 Skill 真理源
├── scripts/                    # 插件与设计合同校验
├── .echo-semantic/             # 插件自身的语义基线
├── tests/                      # Node 与 Python 回归测试
├── docs/                       # 用户文档、设计和 ADR
├── action.yml                  # 可复用 GitHub Action
└── README.md                   # GitHub 项目入口
```

## 组件职责

| 组件       | 主要路径                                                           | 职责                                                               | 不拥有的内容                 |
| ---------- | ------------------------------------------------------------------ | ------------------------------------------------------------------ | ---------------------------- |
| 插件清单   | `.codex-plugin/`、`.cursor-plugin/`、`.claude-plugin/`、`.agents/` | 声明插件 ID、展示信息和 Skill/Agent 入口                           | 业务语义和路由策略           |
| 安装器     | `bin/install.mjs`                                                  | 检测宿主、按渠道安装/卸载、覆盖当前版本、清理旧 ID 投影            | 事务协调和业务状态           |
| Hook 入口  | `hooks/entry.mjs`                                                  | 统一解析三端事件，接入路由、编辑范围、压缩恢复和停止验证           | 语义判断和长期材料写入       |
| 能力矩阵   | `runtime/capabilities/`                                            | 保存静态宿主能力合同并探测当前安装与版本                           | 真实会话已经成功的结论       |
| 风险路由   | `runtime/route.mjs`                                                | 根据基线、宿主探测、任务范围和 Git 差异计算治理深度                | 持久任务阶段和人工决策       |
| 继续包     | `runtime/continuation.mjs`                                         | 保存并校验短期任务恢复线索及证据摘要                               | 完整对话、审批状态和长期事实 |
| 状态视图   | `skills/semantic-status/`                                          | 汇总结构、新鲜度、开放问题和唯一下一入口                           | 完整语义验证结论             |
| 语义 Skill | `skills/`                                                          | 完成维护、发现、盘点、归并、预检、差异、修复、审查、裁决和验证协作 | 宿主生命周期强制执行         |
| 只读 Agent | `agents/`                                                          | 独立探索边界、复核能力闭合、挑战高风险假设                         | 长期材料写入权               |
| 校验器     | `skills/semantic-contract/scripts/verify_semantic.py`              | 校验快照、引用、分类、关系、删除依据和等价 Evidence                | 业务预期裁决和代码风格       |
| CI Action  | `action.yml`                                                       | 在独立环境重跑最终语义门禁                                         | 取代项目自己的工程测试       |

## 状态权威与存储

| 状态或材料                            | 位置                                      | 生命周期                         | 权威级别         | 失效策略                             |
| ------------------------------------- | ----------------------------------------- | -------------------------------- | ---------------- | ------------------------------------ |
| Capability、Behavior、Rule 等长期事实 | `.echo-semantic/`                         | 随 Git 版本演进                  | 项目语义唯一权威 | 摘要、引用或关系失效即阻断验证       |
| 产品与架构决策                        | 项目 design/ADR                           | 随 Git 版本演进                  | 产品和架构权威   | 内容摘要变化后重新绑定               |
| 用户可见状态                          | `.echo-semantic/status.md`、`status.json` | 每个生命周期事件更新             | 用户可见运行投影 | 共享 revision 检测中断不一致         |
| 任务预检                              | `.echo-semantic/preflight.json`           | 最长 24 小时、绑定当前 HEAD      | 当前任务写入合同 | 过期、仓库或 HEAD 不匹配即无效       |
| 风险路由                              | `.echo-semantic/route.json`               | 每次 SessionStart 或显式计算刷新 | 可丢弃计算结果   | HEAD、工作树摘要或时间失效时重新计算 |
| 任务继续包                            | `.echo-semantic/continuation.json`        | 最长 7 天、绑定任务/分支/证据    | 可丢弃恢复线索   | 任一证据摘要变化即忽略               |
| 安装状态                              | `~/.echo-semantic/install-state.json`     | 用户级安装期间                   | 安装器记录       | 全部卸载后删除                       |
| 原生宿主分发副本                      | `~/.echo-semantic/distribution/`          | Codex 或 Claude Code 已安装期间  | 可覆盖安装投影   | 最后一个原生渠道卸载后删除           |
| 宿主注册与缓存                        | Codex、Cursor、Claude Code 用户目录       | 由宿主管理                       | 安装投影         | 重装覆盖，卸载撤回                   |
| 工程验证结果                          | 项目工具与 CI                             | 每次变更重新产生                 | 实现质量权威     | 任何失败均不得以语义材料替代         |

`.echo-semantic/` 是唯一项目目录；长期语义 Markdown 提交 Git，5 个运行态文件由 `.git/info/exclude` 排除。删除运行态文件最多要求重新预检、重新路由或丢失恢复提示。

用户目录中的 `distribution/` 只是按发布白名单生成的插件安装副本，不保存项目事实，也不是第二套语义权威。

目录本身必须是项目根下的普通目录，不能是符号链接；5 个运行态文件不得被 Git 跟踪。违反任一条件时写入失败，避免把运行态写到项目外或污染提交。插件发布包必须包含 `.echo-semantic/` 的长期语义材料。

## 主工作流

```mermaid
flowchart TD
  Request[插件触发或用户需求] --> Scope{是否有明确任务?}
  Scope -- 否 --> Maintenance[全仓语义维护]
  Scope -- 是 --> Classify[分类 bugfix / feature / refactor / contract / style]
  Maintenance --> DiscoverAll[semantic-discover 盘点已完成代码]
  DiscoverAll --> StatusAll[semantic-status 汇总资产与缺口]
  StatusAll --> ConsolidateAll[semantic-consolidate 形成候选]
  ConsolidateAll --> AuditAll[semantic-audit 定向审查]
  AuditAll --> VerifyAll[semantic-verify]
  Classify --> Baseline{存在有效 semantic 基线?}
  Baseline -- 否 --> Discover[semantic-discover]
  Discover --> BaselineReady[路径、边界与风险视角闭合]
  Baseline -- 是 --> Preflight
  BaselineReady --> Preflight[semantic-preflight]
  Preflight --> Reuse[确认复用、状态权威、允许路径与验证矩阵]
  Reuse --> Architecture{涉及公共 API、协议、状态权威或架构?}
  Architecture -- 是 --> Authority[绑定并更新正式 design / ADR]
  Architecture -- 否 --> Coding[AI 编码或文档变更]
  Authority --> Coding
  Coding --> Engineering[Formatter、Lint、类型与测试]
  Engineering --> Diff[semantic-diff]
  Diff --> Risk{当前差异风险}
  Risk -- fast --> Verify[semantic-verify]
  Risk -- standard --> Verify
  Risk -- strict --> Audit[定向 semantic-audit]
  Audit --> Decision{存在证据无法决定的问题?}
  Decision -- 是 --> Human[semantic-decide / 人工裁决]
  Human --> Verify
  Decision -- 否 --> Verify
  Verify --> CI[CI 最终门禁]
  CI --> Done[允许合并或交付]
```

流程不是固定瀑布线。`semantic-status` 根据当前事实给出 Frontier；低风险任务可以跳过正式审查，风险只能在差异出现后升级，不能因早期判断而降级。

## 路由决策

```mermaid
flowchart TD
  Start[读取项目与宿主] --> Scope{存在明确任务?}
  Scope -- 否 --> HasChanges{存在工作树变化?}
  HasChanges -- 否 --> Maintenance[maintenance]
  HasChanges -- 是 --> HasBaseline{存在 .echo-semantic/baseline.md?}
  Scope -- 是 --> HasBaseline
  HasBaseline -- 否 --> Bootstrap[bootstrap]
  HasBaseline -- 是 --> HostReady{宿主已探测、Skill 可用且 Stop 有新鲜事件证据?}
  HostReady -- 否 --> Bootstrap
  HostReady -- 是 --> Changed{存在工作树变化?}
  Changed -- 否 --> Idle[idle]
  Changed -- 是 --> High{命中高风险路径?}
  High -- 是 --> Strict[strict]
  High -- 否 --> FastOnly{全部为文档、配置、测试等快速路径?}
  FastOnly -- 是 --> Fast[fast]
  FastOnly -- 否 --> Standard[standard]
```

| 路由          | 进入条件                                            | 推荐入口                                                 | 必要收口                                           |
| ------------- | --------------------------------------------------- | -------------------------------------------------------- | -------------------------------------------------- |
| `bootstrap`   | 无基线、宿主/关键能力不可用，或 Stop 无新鲜事件证据 | `semantic-discover` 或 `semantic-preflight`              | `semantic-verify`                                  |
| `maintenance` | 没有明确任务且工作树没有新变化                      | `semantic-discover`、`semantic-status`、`semantic-consolidate`、`semantic-audit` | `semantic-verify`                                  |
| `idle`        | 有基线且工作树无变化                                | `semantic-preflight`                                     | 新任务开始前重新记录预检                           |
| `fast`        | 只有文档、配置、测试、示例等低风险路径              | `semantic-preflight`                                     | 工程验证和 `semantic-verify`                       |
| `standard`    | 有变化但未命中高风险路径，且不全是快速路径          | `semantic-preflight`、`semantic-diff`                    | `semantic-verify`                                  |
| `strict`      | 生产源码、未知源码、协议、迁移或治理控制面变化      | `semantic-preflight`、`semantic-diff`、`semantic-audit`  | 高风险依据、设计权威、工程验证和 `semantic-verify` |

静态能力矩阵只描述宿主声明能力，`runtimeProbe.detected` 也只描述安装存在。只有宿主真实触发的 Hook 才写入 `hookEvidence`；证据绑定
宿主、宿主版本、插件版本和 24 小时时间窗。Stop 没有新鲜事件证据时路由必须进入 `bootstrap`，对应 `enforcement` 也不能置真。
无明确任务且没有工作树变化时，`maintenance` 不依赖 Stop 事件证据，只提供仓库级语义入口；路由状态同时绑定计算时的 HEAD 和 Git porcelain 工作树摘要，
任一变化都会使 `semantic-status` 将旧路由标为不可信。

## 状态流转

### 项目语义基线

```mermaid
stateDiagram-v2
  [*] --> NoBaseline
  state "未采用" as NoBaseline
  state "库存开放" as InventoryOpen
  state "库存闭合 / 行为开放" as BehaviorOpen
  state "行为模型闭合" as BehaviorClosed

  NoBaseline --> InventoryOpen: semantic-discover 建立基线
  BehaviorClosed --> BehaviorClosed: 无明确任务执行仓库级语义维护
  InventoryOpen --> BehaviorOpen: 路径、边界和覆盖网格闭合
  BehaviorOpen --> BehaviorClosed: 关键场景、规则和证据闭合
  BehaviorClosed --> BehaviorOpen: 行为或证据需要复核
  BehaviorOpen --> InventoryOpen: 新增未分类路径或失效边界
  InventoryOpen --> InventoryOpen: 修复快照与源码引用
```

`inventory_closure` 和 `behavior_model_closure` 只表达覆盖状态，不表示系统没有缺陷。任何未分类生产路径都会使严格验证失败。

### 任务预检

```mermaid
stateDiagram-v2
  [*] --> Absent
  state "不存在" as Absent
  state "有效" as Valid
  state "失效" as Invalid
  state "已消费" as Consumed

  Absent --> Valid: 记录分类、复用、允许路径和验证要求
  Valid --> Invalid: 超过 24 小时
  Valid --> Invalid: 仓库或 HEAD 不匹配
  Valid --> Invalid: 高风险依据或设计摘要变化
  Invalid --> Valid: 重新执行 semantic-preflight
  Valid --> Consumed: 明确的新会话启动
  Valid --> Consumed: 无变化 Stop
  Valid --> Consumed: Stop 验证成功
  Consumed --> Valid: 下一个任务重新预检
  Valid --> Valid: Stop 失败并保留供修复重试
```

### 任务继续包

```mermaid
stateDiagram-v2
  [*] --> Missing
  state "不存在" as Missing
  state "可信" as Trusted
  state "失效并忽略" as Stale
  state "已消费" as Cleared

  Missing --> Trusted: PreCompact 从有效预检生成
  Trusted --> Trusted: resume 匹配任务、仓库、分支和证据
  Trusted --> Stale: 超过 7 天
  Trusted --> Stale: schema、任务、仓库或分支不匹配
  Trusted --> Stale: semantic 对象或 design / ADR 摘要变化
  Stale --> Missing: 重新预检后生成新继续包
  Trusted --> Cleared: 明确新会话、无变化 Stop 或成功 Stop
  Cleared --> Trusted: 后续 PreCompact
```

继续包不保存完整对话或审批状态。它只携带阶段、路由、已完成项、未决 Frontier、下一入口和受摘要保护的证据引用。

## 宿主生命周期时序

```mermaid
sequenceDiagram
  actor User as 开发者
  participant Host as Codex / Cursor / Claude Code
  participant Hook as hooks/entry.mjs
  participant Probe as Capability Probe
  participant Git as Git 与私有状态
  participant Runtime as Route / Continuation
  participant Verify as Semantic Verifier

  User->>Host: 新建或恢复会话
  Host->>Hook: SessionStart
  Hook->>Probe: 探测宿主、版本和声明能力
  Probe-->>Hook: runtimeProbe + capabilities
  Hook->>Git: 读取 baseline、工作树与短期状态
  Hook->>Runtime: 计算 bootstrap / idle / fast / standard / strict
  Runtime-->>Hook: maintenance / bootstrap / fast / standard / strict 路由与建议入口
  Hook->>Runtime: 按 taskId 读取可信继续包
  Hook-->>Host: 注入最小上下文与 Frontier

  alt maintenance：没有明确任务且工作树无变化
    Host->>Host: 执行全仓 discover、status、consolidate、audit、verify
  else task：预检与宿主 taskId 匹配
    Host->>Host: 只处理 semantic-preflight 允许路径
  end

  opt Cursor 或 Claude Code 支持编辑前 Hook
    Host->>Hook: PreToolUse(Edit / Write / Delete)
    Hook->>Git: 校验当前预检、HEAD 与 allowedPaths
    alt Delete 且 repair、canonical、等价 Evidence 全部有效
      Hook-->>Host: 允许已批准删除
    else 预检有效且路径允许
      Hook-->>Host: 允许工具执行
    else 缺失、失效或越界
      Hook-->>Host: 阻断并返回原因
    end
  end

  opt 宿主触发上下文压缩
    Host->>Hook: PreCompact
    Hook->>Git: 读取有效预检和证据引用
    Hook->>Runtime: 摘要 baseline、语义对象和 design / ADR
    Runtime->>Git: 原子写入 continuation.json
    Hook-->>Host: 允许继续压缩
  end

  User->>Host: 完成本轮任务
  Host->>Hook: Stop
  Hook->>Git: 检查基线、变化和预检
  alt 无基线或无变化
    Hook->>Git: 消费短期状态
    Hook-->>Host: 允许停止
  else 有变化且预检有效
    Hook->>Verify: strict snapshot + change evidence
    alt 校验通过
      Verify-->>Hook: 通过
      Hook->>Git: 消费 preflight 与 continuation
      Hook-->>Host: 允许停止
    else 校验失败
      Verify-->>Hook: 失败原因
      Hook-->>Host: 阻断并保留预检供重试
    end
  end
```

Codex 当前没有稳定的编辑前 Hook 覆盖，因此主要依靠 SessionStart、PreCompact、Stop 和 CI；Cursor、Claude Code 可在写入前增加即时路径阻断。

## 高风险变更时序

```mermaid
sequenceDiagram
  actor User as 开发者
  participant Agent as Coding Agent
  participant Preflight as semantic-preflight
  participant Authority as 项目 design / ADR
  participant Code as 代码与工程工具
  participant Diff as semantic-diff
  participant Consolidate as semantic-consolidate
  participant Repair as semantic-repair
  participant Audit as semantic-audit
  participant Verify as semantic-verify / CI

  User->>Agent: 提交需求
  Agent->>Preflight: 搜索 Capability、Rule、API、实现和测试
  Preflight-->>Agent: 复用结论、允许路径、风险信号、验证矩阵
  alt 公共 API、协议、状态权威、迁移或架构变化
    Agent->>Authority: 绑定并更新正式设计权威
    Authority-->>Preflight: 路径、类型和内容摘要
  end
  Agent->>Code: 在允许范围内生成或修改
  Code-->>Agent: Formatter、Lint、类型和测试结果
  Agent->>Diff: 映射实际差异与影响闭包
  Diff-->>Audit: 高风险边界和故障假设
  Audit-->>Agent: Finding、残余风险或已检查范围
  Agent->>Consolidate: 归并 Asset 候选并选择 canonical owner
  Consolidate-->>Agent: 候选簇、动态未知和延后决策
  alt 人工批准合并、迁移或退役
    Agent->>Repair: 绑定 repair、删除范围、回滚点和等价 Evidence
    Repair->>Code: 先切换调用方，再执行已批准小切片
    Code-->>Agent: 行为场景、工程命令和回滚证据
  else 暂缓或证据不足
    Consolidate-->>Agent: 保留 Finding，进入 semantic-decide 或补证据
  end
  Agent->>Verify: 快照、源码引用、路径分类和变更依据
  Verify-->>User: 允许交付或返回可定位阻断原因
```

`semantic-decide` 只在源码、契约和测试都无法确定产品期望或风险接受时进入，不负责替代正式架构设计。

## 安装与卸载时序

```mermaid
sequenceDiagram
  actor User as 用户
  participant Installer as bin/install.mjs
  participant Detect as 宿主检测
  participant Host as Codex / Cursor / Claude Code
  participant Projection as Hook / Agent / 本地镜像
  participant State as ~/.echo-semantic

  User->>Installer: node bin/install.mjs install <channel | all>
  Installer->>Detect: 检查对应宿主是否存在
  alt all 且宿主未安装
    Detect-->>Installer: skipped
  else 显式渠道但宿主未安装
    Detect-->>Installer: manual_action
  else 宿主存在
    Installer->>State: 覆盖生成干净分发副本
    Installer->>Host: 删除 echo-semantic 与旧 ID 注册
    Installer->>Host: 从分发副本添加 marketplace 和插件
    Installer->>Projection: 安装原生 Hook、覆盖 Agent 或 Cursor 实目录镜像并清理旧用户 Hook
    Installer->>State: 写入该渠道 installed 状态
    Installer-->>User: installed
  end

  User->>Installer: uninstall <channel | all>
  Installer->>Host: 删除当前与旧 ID 注册
  Installer->>Projection: 删除本插件投影
  Installer->>State: 删除渠道状态；最后一个原生渠道卸载后删除分发副本
  Installer-->>User: removed
```

安装器不实现跨宿主事务。`all` 中一个宿主失败不会回滚已经成功的其它宿主，每个结果独立返回。

## 数据流与信任边界

1. 宿主事件是触发输入，不是项目事实；`hooks/entry.mjs` 只提取工作目录、事件来源、工具路径和任务标识。
2. Git 提供仓库根、HEAD、分支、工作树差异和私有状态路径，是当前性与谱系依据。
3. `.echo-semantic/` 提供长期行为事实；源码与 design/ADR 提供实现和期望依据。
4. Skill 可以提出、归并和复核语义结论，但只有校验器能确定结构、引用、摘要、路径分类、删除授权和等价 Evidence 是否成立。
5. Hook 的成功只证明本地事件入口返回成功；CI 必须在独立环境重新读取最终差异。
6. 真实宿主能力需要版本、配置、信任和生命周期事件证据；静态 manifest 不能单独证明 Hook 已运行。

## 异常与降级

| 场景                                             | 行为                                      | 是否放宽门禁                 |
| ------------------------------------------------ | ----------------------------------------- | ---------------------------- |
| 当前目录不是 Git 仓库                            | Hook 返回空结果，不创建项目状态           | 不适用                       |
| 项目没有 `.echo-semantic/baseline.md`            | 路由为 `bootstrap`；Stop 不阻断未采用项目 | 不建立伪基线                 |
| 没有明确任务且工作树无变化                       | 路由为 `maintenance`，执行全仓语义维护    | 不把结果写入任务预检         |
| 宿主未探测到、关键能力未知或 Stop 无新鲜事件证据 | 路由为 `bootstrap`                        | 否，最终依赖显式 Skill 和 CI |
| 预检缺失、过期、HEAD 不匹配                      | 编辑前或 Stop 返回阻断原因                | 否                           |
| 编辑路径超出 `allowedPaths`                      | 支持 PreToolUse 的宿主立即阻断            | 否                           |
| Codex 缺少稳定 PreToolUse                        | 不做虚假即时阻断声明                      | 否，由 Stop 和 CI 收口       |
| 继续包损坏、过期或证据变化                       | 忽略恢复包并重新判断 Frontier             | 否                           |
| `.echo-semantic/` 是符号链接                     | 拒绝写入运行态                            | 否                           |
| 运行态文件已被 Git 跟踪                          | 拒绝覆盖并要求解除跟踪                    | 否                           |
| `.git/info/exclude` 无法安全更新                 | 拒绝创建运行态                            | 否                           |
| 校验器或 `uv` 不可用                             | Stop 失败并保留预检                       | 否                           |
| 语义摘要、源码引用或路径分类失效                 | `semantic-verify` 和 CI 失败              | 否                           |
| 一个宿主安装失败                                 | 返回该宿主 `failed`，保留其它宿主结果     | 不影响其它渠道               |
| Hook 未被宿主信任或未触发                        | 不声称运行时已覆盖                        | 否，由 CI 提供最终信号       |

## 关键取舍

### Skill、Hook 与 CI 分层

Skill 适合语义判断，Hook 适合生命周期接线，脚本和 CI 适合确定性阻断。把所有判断写成脚本会失去语义能力，只写 Skill 又缺少强制力。

### 项目材料单一权威

长期事实只进入采用方 `.echo-semantic/`，正式产品和架构选择只进入采用方 design/ADR。插件不维护第二份跨项目知识库；Asset、候选 Finding 和等价 Evidence 仍归入同一目录。

### 派生状态可丢弃

预检、路由和继续包位于 `.echo-semantic/`，绑定仓库事实并设置有效期；5 个运行态文件由 `.git/info/exclude` 排除。它们用于约束当前任务和恢复上下文。

### 按风险控制深度

所有任务都保留生成前和生成后收口，但只有高风险差异才要求定向 Audit 和正式设计依据，避免把轻量修改变成固定重流程。没有明确任务时，`maintenance` 对 Baseline 覆盖代码做全仓语义维护；明确任务时只处理预检允许路径。

### 不引入常驻控制服务

当前状态只需本地文件、Git 和短进程完成。数据库、daemon 和 MCP 会增加部署与状态一致性成本，但没有提供当前场景必需的新能力。

## 复用与实现约束

- 复用宿主原生插件、marketplace、Skill、Agent 和 Hook 机制，不建设自有插件运行时；
- 复用 Git 的 revision、branch、diff 和私有路径，不建设独立版本系统；
- 复用采用方 formatter、Lint、类型、测试和 CI，不在语义 Skill 中模拟代码质量工具；
- 复用正式 design/ADR，`semantic-decide` 不创建第二套架构仓库；
- 三端适配器保持薄，只处理事件和路径映射；共享运行时不得复制三份实现；现有 Codex、Cursor 的 Agent/manifest 投影保持兼容，新增能力不得改写其既有字段和事件合同；
- 新增宿主能力前必须获得官方合同、当前 CLI 或真实加载证据，未知能力默认保守降级。

## 权限与敏感信息

- 插件只读取当前仓库、`.echo-semantic/` 运行态和宿主本地配置，不上传项目内容；
- 验收探针只有显式设置环境变量时才写入事件元数据；
- 继续包只记录路径引用和摘要，不记录文件正文、完整对话、密钥或工具输出；
- 三个专用 Agent 以只读模式投影；
- 安装器只撤回当前插件 ID 和显式旧 ID 的注册与路径，不扫描删除其它插件内容。
- Codex 与 Claude Code 从 `hooks/hooks.json` 原生发现 Hook，并使用宿主注入的插件根路径；安装器不新增用户级 Hook，只清理旧版本投影。已有用户 Hook 配置无法解析时拒绝安装或卸载并保留原文件。

## 验收标准

1. README 能在不阅读源码的情况下说明定位、架构层次、任务范围、主工作流、状态权威和文档入口；
2. 正式设计包含架构图、任务流程图、路由图、状态图、生命周期时序图和安装时序图；
3. 图中的组件、事件、状态文件、有效期和失败行为与当前实现一致；
4. 三端 manifest 继续指向同一组 Skill、Agent 和 Hook 真理源；
5. `npm run verify` 通过格式、静态合同、Node/Python 测试、校验器自测和严格快照；
6. 高风险变更仍需执行 `--require-change-evidence`，文档不能成为绕过机器门禁的依据；
7. Asset、候选、删除和等价 Evidence 具有可校验关系，未知动态路径不会自动放行删除；
8. Codex、Cursor、Claude Code 的真实生命周期验收与静态清单验证分开报告，现有宿主和 Agent 适配行为保持兼容。

## 已知限制

- Codex 当前缺少稳定的编辑前 Hook 覆盖；
- Cursor 窗口级检查已完成；完整 Hook 生命周期证据仍需按具体宿主版本、配置和信任状态记录；
- Claude Code 仍需要登录后的完整模型会话验收；
- Mermaid 图由文档渲染器呈现，纯文本环境仍以相邻表格和正文为准。
