# 用户自行配置定时扫描

插件提供扫描入口，不内置定时器。用户决定是否启用、周期、目标仓库、执行环境、任务标识和暂停方式；安装插件不会创建任何 cron、宿主自动任务或 CI 任务。运行输出通过现有 artifacts 入口保存在项目 `.echo-semantic/local/<task-id>/`，或使用 CI Artifact。

下面的示例用于配置指导。插件作者在临时仓库验证命令和脚本片段，不能据此声称用户的真实定时器已触发。

## 先选择扫描内容

定时调用 `inventory.py --write` 执行确定性的静态盘点，保存重复候选、消费者线索、排除项和未知项。它不调用模型、不自动确认候选、不修改正式 Asset、Finding、Baseline 或业务代码。

需要 Coding Agent 深入调查行为、状态权威、生产调用关系或失败恢复时，由用户配置外部 Agent 任务执行 `semantic-discover` 的报告阶段。任务提示中明确只生成报告与候选，实际人工确认后再维护正式基线。Agent 调查费用、权限和调度由用户的执行环境管理；静态报告不等于这项调查已完成。

## 配置输入

| 输入 | 由谁决定 | 核对方式 |
| --- | --- | --- |
| 插件路径 | 用户 | 路径内存在 `skills/semantic-discover/scripts/inventory.py`，使用当前版本分发内容 |
| 项目路径 | 用户 | Git 仓库根，已有可读取的 HEAD；没有语义基线也能扫描 |
| 工具环境 | 用户 | Node 20+、Git、Python 3.9+ 和 uv 可用，调度环境能找到它们 |
| 周期和时区 | 用户 | 查看实际调度器的配置与时区，以真实触发时间验收 |
| 任务标识与产物 | 用户 | 为本次运行选择安全任务标识；使用 artifacts prepare 返回的 ignored local/task 目录或 CI Artifact，不把完整结果和日志提交 |
| 暂停与恢复 | 用户 | 使用外部调度器自身的停用与启用功能 |

扫描保存需要执行环境支持安全的目录描述符发布。当前报告保存上限为单文件 8 MiB、总读取 128 MiB、报告 16 MiB；密钥路径、符号链接、二进制和不支持的解析会排除或标为未知。先手动核对环境，缺少能力时保持失败，不切换到不安全写入方式。

## 示例一：任何外部调度器调用同一脚本

把下面临时包装脚本保存到 `.echo-semantic/local/<task-id>/` 或由 CI 任务生成。它没有仓库默认值或固定周期，缺少输入会直接失败。

```sh
#!/bin/sh
set -eu

: "${ECHO_SCAN_PLUGIN_ROOT:?请设置插件绝对路径}"
: "${ECHO_SCAN_PROJECT_ROOT:?请设置项目绝对路径}"
: "${ECHO_SCAN_UV:?请设置 uv 可执行文件绝对路径}"
: "${ECHO_SCAN_TASK_ID:?请设置安全任务标识}"

test -f "$ECHO_SCAN_PLUGIN_ROOT/skills/semantic-discover/scripts/inventory.py"
test -d "$ECHO_SCAN_PROJECT_ROOT"
cd "$ECHO_SCAN_PROJECT_ROOT"

ECHO_SCAN_ARTIFACT_DIR=$(node "$ECHO_SCAN_PLUGIN_ROOT/scripts/artifacts.mjs" prepare \
  --root "$ECHO_SCAN_PROJECT_ROOT" --task-id "$ECHO_SCAN_TASK_ID")
printf '%s\n' "$ECHO_SCAN_ARTIFACT_DIR"
exec "$ECHO_SCAN_UV" run \
  "$ECHO_SCAN_PLUGIN_ROOT/skills/semantic-discover/scripts/inventory.py" \
  --root "$ECHO_SCAN_PROJECT_ROOT" --write \
  > "$ECHO_SCAN_ARTIFACT_DIR/scan-result.json" \
  2> "$ECHO_SCAN_ARTIFACT_DIR/scan-errors.log"
```

先用已配置的终端试运行。以下路径都是占位符，用户替换后才执行：

```sh
export ECHO_SCAN_PLUGIN_ROOT='/用户选择的插件路径'
export ECHO_SCAN_PROJECT_ROOT='/用户选择的项目路径'
export ECHO_SCAN_UV='/用户选择的uv路径'
export ECHO_SCAN_TASK_ID='<用户选择的安全任务标识>'
/bin/sh '/用户选择的脚本路径/run-echo-scan.sh'
```

外部调度器配置同样的四个环境变量和命令。任务标识使用字母、数字、点、下划线或连字符，不含路径分隔符；artifacts prepare 会核对路径安全与 Git 忽略规则，失败时不继续扫描。调度环境的 `PATH` 必须包含 Node、Git 和 Python 所在目录，不能假设终端中的版本管理器或 shell 启动配置已经加载。第一次运行 uv 时需要依赖已缓存或允许正常安装依赖；扫描程序不需要 OpenAI API 密钥。

成功返回退出码 0，包装脚本 stdout 只给出 artifacts prepare 返回的产物目录。目录内 `scan-result.json` 是完整扫描 JSON，其中 `report_path` 指向项目 `.echo-semantic/discovery/discovery.scan.<摘要>.md`；诊断写入 `scan-errors.log`。只有明确需要长期候选报告时保留 Discovery 的必要结论与引用；完整 JSON、日志、临时脚本和中间清单留在 ignored local/task 或 CI Artifact，不随语义材料整套提交。

## 示例二：用户编辑 cron 配置

周期由用户填写。下列内容是格式模板，不是可直接安装的 crontab；本插件不执行 `crontab` 写入。

```text
<分钟> <小时> <月内日> <月份> <周内日> /bin/sh '/用户选择的路径/scan-job.sh'
```

用户在自己的 local/task 或 CI `scan-job.sh` 中设置工具搜索路径和上述四个输入变量，再调用包装脚本。路径可能包含空格时保留引号。示意内容如下，所有占位路径由用户替换：

```sh
#!/bin/sh
set -eu

PATH='/用户选择的Node目录:/用户选择的Git目录:/用户选择的Python目录:/usr/bin:/bin'
export PATH
ECHO_SCAN_PLUGIN_ROOT='/用户选择的插件路径'
ECHO_SCAN_PROJECT_ROOT='/用户选择的项目路径'
ECHO_SCAN_UV='/用户选择的uv路径'
ECHO_SCAN_TASK_ID='<用户选择的安全任务标识>'
export ECHO_SCAN_PLUGIN_ROOT ECHO_SCAN_PROJECT_ROOT ECHO_SCAN_UV ECHO_SCAN_TASK_ID

exec /bin/sh '/用户选择的脚本路径/run-echo-scan.sh'
```

同一任务标识下的示例输出保留最近一次结果。需要历史日志或允许运行重叠时，用户为每次运行选择不同任务标识，或配置串行执行，避免并发覆盖同一任务日志。CI 可把返回目录作为 Artifact 上传；完整输出不作为长期语义事实。不要把完整源码、会话日志或密钥复制到调度日志。

cron 格式、默认执行环境和 `%` 的处理以 [POSIX crontab](https://pubs.opengroup.org/onlinepubs/9799919799/utilities/crontab.html) 及本机实现为准。cron 的命令字段中 `%` 有特殊含义，不能仅用 shell 引号处理；含 `%` 的路径尽量放进上面的脚本文件，避免直接写入 cron 命令字段。用户时区和停机、休眠期间的补跑策略由实际调度器决定。

## 验收步骤

1. **确认输入与环境。** 在用户指定的项目根运行 Git、Node、Python、uv 版本检查。先运行包装脚本，记录命令、所用插件版本、退出码、返回产物目录与 `report_path`；核对产物目录处于 `.echo-semantic/local/<task-id>/` 且被 Git 忽略，或由 CI Artifact 管理。
2. **核对报告。** 检查 JSON 的 `scope: repository`、`analysis: static`、`result: completed`、`globalClosure: not_checked`，阅读候选、排除项和未知项。运行下面的报告合同检查；退出码应为 0。
3. **模拟调度环境。** 用与调度器相同的工具搜索路径和环境变量运行脚本，确认没有依赖交互式 shell。故意漏掉一个必需变量，脚本应返回非零；旧报告与正式材料应保持。
4. **验证一次真实触发。** 用户配置自己选择的周期，等待实际触发，核对外部调度器记录、执行时间、退出码与结果文件。只有这一步有现场证据，才可报告真实定时调用通过；模拟脚本或安装登记不能替代。
5. **检查幂等与变化。** 不改源码再次运行，报告身份应相同，不覆盖不同报告。在用户允许的测试仓库修改源码再运行，应得到新报告。旧报告结构仍可检查，但旧报告的确认核对应失败。
6. **检查失败呈现。** 在测试配置中使用不存在的项目路径或不可用工具，调度器应记录非零结果与诊断，不能将失败标为扫描成功。任务重叠时应幂等完成或明确报锁竞争，不覆盖任务预检、继续包和收据。
7. **检查确认边界。** 定时配置不能包含自动 `--confirm-report`、自动批准候选或基线更新。实际用户确认后，才核对当前快照并通过预检维护正式语义，执行完整语义和工程验证。
8. **暂停与恢复。** 用户停用外部任务后，验证不会继续产生触发记录；重新启用后验证实际触发。保留已有报告，不用删除项目材料模拟停用。

报告结构核对命令沿用当前 shell 已设置的插件路径、项目路径和 uv 输入变量：

```sh
: "${ECHO_SCAN_REPORT:?请设置已保存报告的绝对路径}"
"$ECHO_SCAN_UV" run \
  "$ECHO_SCAN_PLUGIN_ROOT/skills/semantic-discover/scripts/inventory.py" \
  --root "$ECHO_SCAN_PROJECT_ROOT" --check-report "$ECHO_SCAN_REPORT"
```

## Codex 安装与加载验收

在插件源码根更新本地 Codex 分发：

```sh
node bin/install.mjs install codex
codex plugin list --json
```

核对 `echo-semantic@echo-semantic` 的安装版本和 `enabled` 状态。用户启用插件后，新开一个项目会话，用小任务核对复用记录、允许路径和完成检查；单独记录宿主版本、实际事件和结果。当前 CLI 的安装、列表命令已核对，不把未核对的 GUI 菜单或定时界面作为接入前提。

插件安装、扫描脚本验收、真实宿主会话验收、外部定时触发验收分别给出结论。用户没有启用外部定时任务时，手动扫描和日常开发仍可使用。
