# CI 接入

Hook 提供本地反馈，CI 对最终 Git 差异提供独立门禁。公共项目应在 Pull Request 上运行 Echo Semantic，同时保留项目自己的
formatter、Lint、类型检查、单元测试、契约测试和集成测试。

## Action 输入

| 输入                      | 必填 | 默认值 | 含义                                     |
| ------------------------- | ---- | ------ | ---------------------------------------- |
| `root`                    | 否   | `.`    | 采用方 Git 仓库根目录                    |
| `base`                    | 是   | 无     | 用于增量分析的 40 位 Git 基准 revision   |
| `require-change-evidence` | 否   | `true` | 是否要求高风险差异具有同次语义与设计依据 |

启用高风险门禁时，`base` 不能为空，也不能是全零 revision。

## 推荐 Pull Request 工作流

```yaml
name: 语义与工程质量门禁

on:
  pull_request:

permissions:
  contents: read

jobs:
  verify:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v6
        with:
          fetch-depth: 0

      - uses: astral-sh/setup-uv@v7

      - name: 执行项目工程门禁
        run: |
          # 替换为项目自己的 formatter、Lint、类型和测试命令
          npm test

      - name: 执行 Echo Semantic 门禁
        uses: EchoYue-lp/echo-semantic@main
        with:
          root: .
          base: ${{ github.event.pull_request.base.sha }}
          require-change-evidence: "true"
```

正式发布后应把 `@main` 固定为发布标签或完整提交 SHA，避免上游变化未经评估直接进入门禁。

## 多分支语义连续性

PR 合并前需要保留完整历史，并计算真实 merge-base：

```yaml
- uses: actions/checkout@v6
  with:
    fetch-depth: 0

- name: 计算语义连续性基准
  shell: bash
  run: echo "CONTINUITY_BASE=$(git merge-base '${{ github.event.pull_request.base.sha }}' '${{ github.event.pull_request.head.sha }}')" >> "$GITHUB_ENV"

- name: 执行 Echo Semantic 门禁
  uses: EchoYue-lp/echo-semantic@main
  with:
    root: .
    base: ${{ github.event.pull_request.base.sha }}
    continuity-merge-base: ${{ env.CONTINUITY_BASE }}
    continuity-target: ${{ github.event.pull_request.base.sha }}
    continuity-source: ${{ github.event.pull_request.head.sha }}
    continuity-result: ${{ github.sha }}
    continuity-report: continuity-report.json
```

连续性输入将在包含本能力的正式版本发布后改为固定 tag；开发阶段示例使用 `@main`，生产采用方仍应固定到验收过的提交 SHA。

默认 PR checkout 的候选结果必须真实包含目标与来源分支的合并结果；若工作流 checkout 的只是来源分支，应先生成可验证的 merge
候选。squash 或 rebase 必须在来源分支仍可恢复时运行本门禁；历史压平且没有连续性报告后，无法事后恢复已经丢失的义务。

连续性门禁不对源码取并集。它保护父版本中已经建模的 Behavior、Rule、Capability 场景、未决 Finding、未知项和验证依赖；
替代、退役或双侧冲突解决需要 `semantic_continuity` Evidence。输入只提供一部分、revision 不可恢复或结果为
`missing`/`conflicted`/`unknown` 时失败关闭。

仓库从 `EchoYue-lp/echo-coding-semantic-governance` 重命名后，旧 GitHub Action 地址不会自动重定向。已有工作流必须把
`uses:` 显式更新为 `EchoYue-lp/echo-semantic@<ref>`；普通网页和 Git 操作的重定向不能作为 Action 兼容保证。

## 门禁检查内容

Action 会调用确定性校验器，检查：

1. `.echo-semantic/` 目录、对象和必填字段；
2. 当前源码摘要与 Baseline 是否一致；
3. 当前与历史源码引用是否可解析；
4. Git 路径是否全部且唯一分类；
5. 对象关系、Finding 关闭条件和 Audit revision；
6. 预检是否绑定同一仓库和 `base`；
7. 高风险信号是否已声明；
8. 高风险路径是否有同次语义依据；
9. 架构类变化是否绑定并更新正式 design/ADR。

删除路径还必须有已完成的 repair Finding、`deletePaths` 授权和绑定删除前后版本的 `behavior_equivalence` Evidence；Shell 删除也会在 CI 的差异门禁中被识别。
Discovery 未闭合的动态未知或 `needs_review` Asset 会阻断删除，避免把静态无引用误判为运行时不可达。

## 初次采用

第一次引入完整 `.echo-semantic/` 时仍应提供 Pull Request 的基准 SHA。若项目正在分阶段建立基线，可以暂时设置：

```yaml
require-change-evidence: "false"
```

这只关闭增量高风险依据检查，不会关闭结构、源码引用、路径分类和严格快照。基线闭合后应立即恢复 `true`。

## Push 工作流

Push 事件可使用 `${{ github.event.before }}` 作为 `base`，但新建分支或首次推送可能得到全零 SHA。公共项目优先把强门禁放在
Pull Request；若同时监听 Push，需要为全零 SHA 提供明确的基准选择逻辑，不能把它直接传给 Action。

## Monorepo

校验器以 `git rev-parse --show-toplevel` 识别仓库根。即使 `root` 指向子目录，路径分类和源码摘要仍覆盖整个 Git 仓库。

采用方式有两种：

- 一套根级 `.echo-semantic/` 治理整个 monorepo；
- 每个独立 Git 子仓库分别维护自己的 `.echo-semantic/`。

当前不支持在同一个 Git 根内维护多个互相独立的 Baseline。

## CI 失败处理

不要使用 `continue-on-error`、跳过高风险路径或删除语义对象来绕过失败。按照 [故障排查](troubleshooting.md) 修复快照、引用、
分类、预检或同次证据，再重新运行项目工程门禁和 Echo Semantic。
