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
        uses: EchoYue-lp/echo-coding-semantic-governance@main
        with:
          root: .
          base: ${{ github.event.pull_request.base.sha }}
          require-change-evidence: "true"
```

正式发布后应把 `@main` 固定为发布标签或完整提交 SHA，避免上游变化未经评估直接进入门禁。

## 门禁检查内容

Action 会调用确定性校验器，检查：

1. `semantic/` 目录、对象和必填字段；
2. 当前源码摘要与 Baseline 是否一致；
3. 当前与历史源码引用是否可解析；
4. Git 路径是否全部且唯一分类；
5. 对象关系、Finding 关闭条件和 Audit revision；
6. 预检是否绑定同一仓库和 `base`；
7. 高风险信号是否已声明；
8. 高风险路径是否有同次语义依据；
9. 架构类变化是否绑定并更新正式 design/ADR。

## 初次采用

第一次引入完整 `semantic/` 时仍应提供 Pull Request 的基准 SHA。若项目正在分阶段建立基线，可以暂时设置：

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

- 一套根级 `semantic/` 治理整个 monorepo；
- 每个独立 Git 子仓库分别维护自己的 `semantic/`。

当前不支持在同一个 Git 根内维护多个互相独立的 Baseline。

## CI 失败处理

不要使用 `continue-on-error`、跳过高风险路径或删除语义对象来绕过失败。按照 [故障排查](troubleshooting.md) 修复快照、引用、
分类、预检或同次证据，再重新运行项目工程门禁和 Echo Semantic。
