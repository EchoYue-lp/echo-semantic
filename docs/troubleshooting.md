# 故障排查

先确定失败属于哪一层：安装、宿主发现、Hook 生命周期、任务短期状态、语义材料，还是项目工程工具。不要用另一层的成功结果替代失败层证据。

## 快速诊断

在插件仓库运行：

```bash
npm run probe
npm test
npm run verify
```

在目标项目运行：

```bash
git status --short
git rev-parse HEAD
uv run /path/to/echo-semantic/skills/semantic-status/scripts/status.py \
  --root /absolute/project/path
```

## 插件没有出现在 Codex

检查：

```bash
codex plugin list --json
codex plugin marketplace list --json
```

重新覆盖安装：

```bash
node bin/install.mjs install codex
```

安装后必须新建 Codex 任务。已经运行的任务不会热加载新插件版本或新 Skill 命名空间。

## 界面仍显示旧名称

当前插件应显示：

```text
Echo Semantic    echo-semantic
```

安装器会删除旧插件 ID `echo-coding-semantic-governance`、旧 marketplace、旧 Hook、旧 Agent 和旧安装状态。若界面仍缓存旧项：

1. 运行 `node bin/install.mjs install codex`；
2. 确认 `codex plugin list --json` 只包含 `echo-semantic`；
3. 关闭旧任务并新建任务；
4. 仍未刷新时重启 Codex 应用。

## Skill 没有自动触发

Skill 是模型可见指导，不是无条件函数调用。先确认：

- 插件已安装并启用；
- 当前会话是在安装后新建；
- 需求确实匹配对应 Skill 描述；
- 项目指令没有禁止或覆盖该流程。

可以显式提出：

```text
请先使用 semantic-preflight，再开始修改。
```

最终强约束仍由 Hook、校验器和 CI 提供。

## Hook 没有触发

宿主版本、配置、项目信任和事件支持都会影响 Hook。按 [宿主支持](host-support.md) 区分静态清单、安装可见、入口可执行和真实生命周期证据。

Codex 的插件详情页应显示 Echo Semantic 的“钩子”区块，Hook 设置页应把对应条目归入“来自插件 / Echo Semantic”。也可以检查：

```bash
codex plugin list --json
test -f ~/.echo-semantic/distribution/hooks/hooks.json
```

若 Hook 仍出现在“用户配置”，它来自旧版本写入的 `~/.codex/hooks.json`。重新运行 `node bin/install.mjs install codex` 会在
保留其它用户 Hook 的前提下清理旧投影，并从插件内 `hooks/hooks.json` 重新安装。Codex 当前没有稳定的编辑前工具名覆盖，
不应仅依靠 PreToolUse 保证每次写文件前阻断。

## “当前任务没有语义预检记录”

常见原因：

- 尚未执行 `semantic-preflight`；
- 明确启动了新会话，旧记录被消费；
- 记录位于另一个 Git 仓库；
- 插件从旧 ID 重命名后，旧私有目录不再使用。

重新执行 `semantic-preflight`，不要手工伪造 JSON。

## “语义预检记录已超过 24 小时”

预检绑定当时的需求、HEAD 和允许路径。重新检查当前差异、复用点和风险后生成新记录。不要延长时间戳绕过新鲜度检查。

## “预检基准与变更基准不一致”

`--base` 必须等于预检中的 `baseRevision`，通常是任务开始时的 HEAD。检查：

```bash
git rev-parse HEAD
uv run skills/semantic-preflight/scripts/preflight.py check --root /absolute/project/path
```

如果任务期间合入了新提交，重新执行预检。

## “变化超出预检允许路径”

实际差异包含未声明路径。先判断它是需求扩展、生成副作用还是无关改动：

- 需求确实扩大：重新预检并说明原因；
- 工具生成了额外文件：把生成路径和验证加入预检；
- 与任务无关：不要把它包装进当前交付。

不要把允许路径直接扩大到整个仓库。

## “内容摘要不一致”

`.echo-semantic/baseline.md` 的 `source_snapshot.content_digest` 与当前非 `.echo-semantic/` 文件不一致。先运行 `semantic-diff` 确认受影响对象，
再更新 Baseline 和相关 `observed_at`。只替换摘要但不更新行为与证据，会把真实变化隐藏在新摘要后面。

## “未分类 Git 路径”

Baseline 的 `regions` 没有覆盖新文件。判断该路径是：

- `in_scope`：核心生产或治理路径；
- `supporting`：文档、测试或工程元数据；
- `generated_or_vendor`：生成物或第三方代码；
- `excluded`：明确排除，并提供理由、风险和复查条件。

每个路径必须且只能命中一个区域。

## “源码引用不存在”或“锚点不存在”

检查引用是否使用仓库相对路径，目标文件是否存在，`#锚点` 是否仍出现在文件内容中。历史引用必须在指定 Git revision 的 tree 中存在。

移动或重命名源码后，应更新所有受影响的 Behavior、Rule、Evidence、Finding 和 Audit 引用。

## “高风险变化没有同次更新语义对象”

生产源码、未知源码、协议、迁移或治理控制面发生变化，但当前差异没有同步更新 `.echo-semantic/`。运行 `semantic-diff`，把高风险路径写入受影响对象的源码引用或证据正文。

架构类变化还必须绑定并同次更新正式 design/ADR。

## Stop 一直被阻断

失败 Stop 会保留预检供重试，这是设计行为。读取完整错误，修复对应层后再次停止：

- 结构/引用/摘要错误：修复 `.echo-semantic/`；
- 路径越界：重新预检或缩小差异；
- 设计依据缺失：补充正式 design/ADR；
- `uv` 不可用：安装或修复 `uv`；
- 工程测试失败：修代码或测试。

不要通过删除 Hook 或关闭 CI 来把失败状态改成成功。

## 继续包没有恢复

继续包只有同时满足以下条件才可信：

- schema 和插件 ID 正确；
- taskId、仓库和分支匹配；
- 未超过 7 天；
- Baseline、语义对象和 design/ADR 的证据摘要未变化。

任一条件不满足都会静默忽略旧恢复提示，并根据当前事实重新计算路由。长期事实仍在 Git 管理的 `.echo-semantic/` 和 design/ADR 中。

## Cursor 安装后无变化

当前 Cursor 会拒绝指向 `~/.cursor/plugins/local` 之外的符号链接。确认安装结果是普通目录：

```bash
test -d ~/.cursor/plugins/local/echo-semantic
test ! -L ~/.cursor/plugins/local/echo-semantic
test -f ~/.cursor/plugins/local/echo-semantic/.cursor-plugin/plugin.json
```

然后执行 **Developer: Reload Window**。Customize → Plugins 应出现 Echo Semantic（Local）。

若日志仍有：

```text
loadUserLocalPlugin echo-semantic rejected: symlink target ... is outside .../plugins/local
```

重新运行 `node bin/install.mjs install cursor`。不要手工 `ln -s` 仓库。

Cursor 还会导入已启用的 Claude Code 插件。若界面或会话仍出现旧 ID `echo-coding-semantic-governance`，先卸载该 Claude 插件再重载窗口。

如果项目未被信任或当前 Cursor 版本不支持对应事件，Hook 可能不运行；保留 CI 门禁并记录真实验收缺口。

## Claude Code 安装后无变化

检查登录状态和插件列表：

```bash
claude --version
claude plugin list --json
```

安装后新建会话。认证失败前看到 Hook 进程启动，不等于完整模型会话已经通过。

## 获取更多帮助

提交 GitHub Issue 时提供：

- 操作系统与架构；
- 宿主名称和版本；
- 插件版本；
- 完整命令与退出码；
- 已脱敏的错误文本；
- 最小复现仓库或目录结构。

不要提交密钥、完整私有源码、未脱敏日志或个人路径中的敏感信息。安全问题按 [安全说明](../SECURITY.md) 私下报告。
