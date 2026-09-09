---
name: semantic-preflight
description: >-
  在 Coding Agent 开始缺陷修复、功能开发、重构、契约或样式改动前，完成已有能力复用、语义边界、状态权威、
  允许修改路径和验证矩阵预检；当需求可能新增公共接口、协议、状态或重复实现时使用，不负责首次全量语义建库。
---

# 生成前语义预检

在写代码前证明为什么改、复用什么、由谁继续拥有语义，以及怎样验证。预检是任务内工作合同，不是长期架构库。

## 输入

- 目标仓库根目录和生效的项目指令；
- 用户目标、授权范围和现有设计或计划；
- 当前分支、提交标识、未提交状态；
- 可选的现有 `semantic/` 基线。

## 预检

1. 将变更归为 `bugfix`、`feature`、`refactor`、`contract` 或 `style`。
2. 标记公共 API、状态权威、协议、跨服务迁移、持久化、并发/恢复、外部副作用和未知证据风险。
3. 按名称、概念、相邻类型和真实调用路径搜索完整仓库；区分定义、注册、生产可达和已验证。
4. 列出应复用的 Capability、Rule、公共接口、实现、测试和文档。
5. 判断通用机制、产品策略和适配边界，确认唯一状态权威；能扩展时禁止平行存储、状态机、协议或近义术语。
6. 给出允许修改路径、明确不触碰路径、旧路径退出目标和最小充分验证矩阵。

## 架构门禁

新的公共 API、状态权威、协议、跨服务迁移或关键架构变化必须先读取
[架构收敛工作流](workflows/architecture-convergence.md)。先发现并绑定已有 design/ADR；只有没有现有权威时才创建新的
正式设计。`semantic-decide` 只用于证据无法确定的产品选择和风险接受。

## 机器记录

分析完成后，在本 Skill 根目录运行：

```bash
python3 scripts/preflight.py record --root <仓库绝对路径> --kind <分类> --risk <风险> \
  --allow <允许路径> --reuse <复用依据> --verify <验证命令> \
  --reuse-existing-boundary <边界复用理由>
```

Windows 使用 `py -3 scripts/preflight.py ...`，参数合同不变。

高风险参数按实际情况增加：

- `--public-api`、`--new-state-authority`、`--new-protocol`、`--cross-service-migration`；
- `--architecture-change`、`--unknown-production-code`；
- `--basis <依据>` 和 `--semantic-ref <语义对象>`；
- `--design-authority <现有或新设计路径>`、`--adr <ADR 路径>`。
- 新增边界时用 `--new-boundary-reason <理由>` 替换 `--reuse-existing-boundary`。

记录写入目标仓库 Git 私有目录，不进入版本控制。脚本自动生成任务标识；SessionStart、无变化 Stop 或成功 Stop 会消费
该记录，失败 Stop 保留以便修复后重试。记录只供当前任务的 Hook 和校验器检查允许路径、新鲜度与高风险依据。

## 衔接

1. 普通局部改动通过预检后直接编码。
2. 首个代码差异形成后调用 `semantic-diff`，风险深度只能升级。
3. 高风险失效、残余风险或事故关联进入 `semantic-audit`。
4. 完成工程工具验证后调用 `semantic-verify`。
