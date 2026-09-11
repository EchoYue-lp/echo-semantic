# 命令参考

除宿主原生命令外，以下命令都在 `echo-semantic 0.2.0` 仓库根目录运行。目标项目参数应使用绝对路径，减少工作目录歧义。

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
`hookEvidence`。没有明确任务且没有工作树变化时为 `maintenance`；明确任务通过有效预检后按任务范围路由。手工运行不会伪造 Hook 事件证据。
路由结果同时写入目标仓库 `.echo-semantic/route.json`，并更新 `status.md` 和 `status.json`。

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

增加 `--write` 才写入 `.echo-semantic/assets/` 和 Discovery；静态重复只形成候选，不自动合并或删除。

## 候选归并

将候选写成等待人工决策的 Finding：

```bash
uv run skills/semantic-consolidate/scripts/consolidate.py \
  --root /absolute/project/path --boundary <已有 boundary id> --write
```

候选默认是 `defer`，确认 canonical owner 后才能进入 `semantic-repair`。批准归并时使用 `--candidate-id` 和属于该候选簇的
`--canonical-asset`，避免把一个实现误套到其它候选。

## 受控修复与删除

在已批准 Finding 上记录删除授权：

```bash
uv run skills/semantic-preflight/scripts/preflight.py record \
  --root /absolute/project/path \
  --kind refactor --risk high \
  --allow src \
  --reuse finding.consolidation.example \
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

最小示例：

```bash
uv run skills/semantic-preflight/scripts/preflight.py record \
  --root /absolute/project/path \
  --kind feature \
  --risk medium \
  --allow src \
  --allow tests \
  --reuse existing.capability \
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
