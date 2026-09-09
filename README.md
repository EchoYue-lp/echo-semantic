# Echo Coding Semantic Governance

`echo-coding-semantic-governance` 是面向 Coding Agent 的项目无关语义治理插件。它把生成前预检、语义基线、
增量影响分析、定向审查和确定性验证组合成一条可按风险升级的开发链路，并适配 Codex、Cursor 和 Claude Code。

插件不替代 formatter、Lint、类型检查、单元测试、契约测试或集成测试。Skill 负责需要判断的工作，Hook 负责
生命周期接线，校验器和 CI 负责确定性阻断。

## 为什么不是流式提示

单个 Skill 只能影响模型当下的一轮决策，不能证明它被加载、不能阻止越界写入，也不能在上下文压缩后恢复未决事项。
因此插件把约束拆成四层：

- `semantic-preflight` 记录任务级复用、边界、风险、允许路径和验证要求；编辑前 Hook 以它为准阻断越界路径。
- `runtime/route.mjs` 按宿主能力和 Git 差异选择 `bootstrap`、`fast`、`standard`、`strict` 或 `idle`，不要求每个任务都走同样深度。
- PreCompact 保存带仓库、分支和证据摘要的短期任务继续包；resume 只恢复仍可信的包，失效时降级而不放宽门禁。
- Stop 和 GitHub Action 重新运行确定性校验器；高风险路径必须有同次语义对象和 design/ADR 依据，最终结果不依赖模型是否“记得”执行 Skill。

这使插件具备“生成前约束、生成中范围控制、压缩后可恢复、生成后可反证、合并时再验证”的闭环，同时不建立数据库、常驻进程或第二套长期语义权威。

## 能力

| 入口 | 用途 |
| --- | --- |
| `semantic-preflight` | 写代码前完成复用、边界、允许路径、设计权威和验证矩阵预检 |
| `semantic-status` | 汇总基线、路由、预检、开放 Finding、失效 Audit 和下一步 Frontier |
| `semantic-discover` | 建立或修复项目自己的 `semantic/` 基线 |
| `semantic-diff` | 将代码差异映射到能力、规则、失效审查和验证范围 |
| `semantic-audit` | 对高风险边界执行有界、可反证的只读审查 |
| `semantic-decide` | 只处理无法由证据决定的产品预期和风险接受 |
| `semantic-verify` | 校验语义材料、变更依据和工程验证证据 |
| `semantic-contract` | 为其它语义 Skill 提供唯一对象合同和确定性校验器 |

三个只读 Agent 分别负责边界发现、能力闭合复核和风险审查。宿主不能发现专用 Agent 时，Skill 会降级为宿主已有的
只读探索或审查能力，不改变长期材料的唯一写入者。

## 安装

要求：Node.js 20+、Python 3.9+、[`uv`](https://docs.astral.sh/uv/)。

克隆仓库后执行：

```bash
node bin/install.mjs install all
```

也可以只安装一个宿主：

```bash
node bin/install.mjs install codex
node bin/install.mjs install cursor
node bin/install.mjs install claude-code
```

安装器优先调用宿主原生插件命令；Cursor 使用其本地插件目录。安装时会覆盖本插件对应的宿主安装内容，结果记录在
`~/.echo-coding-semantic-governance/install-state.json`，卸载只撤回该状态中由本插件拥有的路径和注册项：

```bash
node bin/install.mjs uninstall all
```

`all` 会逐个检测 Codex、Cursor 和 Claude Code 是否已安装。未检测到的宿主返回 `skipped`，不影响其它宿主；显式指定
未安装的宿主则返回 `manual_action`。从另一份克隆运行安装也会直接覆盖本插件对应内容，不比较来源路径。

可以单独查看三端能力和版本探测结果：

```bash
npm run probe
```

Codex 与 Claude Code 安装后需要新建会话。Cursor 安装后需要重新加载窗口。Hook 是否运行仍受宿主版本、项目信任和
本地策略控制，因此仓库合并约束必须同时接入 CI。

## 项目采用

1. 调用 `semantic-discover`，在目标仓库建立 `semantic/`。
2. 每个代码任务在生成前调用 `semantic-preflight`。
3. 代码形成首个差异后调用 `semantic-diff`，高风险时进入 `semantic-audit`。
4. 上下文压缩前由 Hook 保存继续包，恢复时由 Hook 校验证据并重新注入 Frontier。
5. 提交前调用 `semantic-verify`，并运行项目原有工程门禁。

生成前预检状态只保存在目标仓库的 Git 私有目录中，不进入版本控制，也不成为第二份语义权威。

会话开始时插件运行 `runtime/route.mjs`，先调用宿主运行时探测，再按当前项目和宿主能力选择 `bootstrap`、`fast`、`standard`、`strict` 或 `idle` 路由；
需要查看完整状态时调用 `semantic-status`：

```bash
uv run skills/semantic-status/scripts/status.py --root /absolute/project/path
```

`semantic-status` 展示的是当前可行动 Frontier，不是新的事实源：它会明确指出基线结构是否有效、预检新鲜度、继续包可信度、
运行时探测是否可信、开放 Finding、失效 Audit、当前路由和唯一下一入口。完整语义关系和变更证据仍由
`semantic-verify` 与 CI 确定性校验。

## GitHub Actions

项目可以在工作流中加入最终门禁：

```yaml
- uses: astral-sh/setup-uv@v7
- uses: EchoYue-lp/echo-coding-semantic-governance@main
  with:
    root: .
    base: ${{ github.event.pull_request.base.sha || github.event.before }}
```

正式使用时应固定到发布标签或提交，不要长期跟踪 `main`。Action 会检查语义结构、当前源码摘要、源码引用、路径分类、
生成前允许范围以及高风险差异的语义和设计依据。

## 开发验证

```bash
npm test
npm run verify
```

## 边界

- 不提供数据库、常驻服务或第二套任务运行时。
- 当前不提供 MCP Server；本地文件和 Git 已足以完成确定性校验。
- Hook 不修改业务代码，也不自动生成语义结论。
- 只有项目自己的 `semantic/` 保存 Capability、Behavior、Rule、Evidence、Finding 和 Audit。
