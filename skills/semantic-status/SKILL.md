---
name: semantic-status
description: >-
  汇总当前项目的语义基线闭合状态、路由、生成前预检、开放 Finding、失效 Audit 和下一步 Frontier；当用户询问语义治理
  进度、当前状态、还缺什么或应执行哪个语义 Skill 时使用，不修改代码或长期语义材料。
---

# 语义治理状态

读取项目当前事实，生成一次性状态视图。该视图不是新的语义权威，也不替代 `semantic-verify`。

## 工作流

1. 读取项目 Git 状态和 `.echo-semantic/` 是否存在。
2. 在本 Skill 根目录运行：

```bash
uv run scripts/status.py --root <项目绝对路径>
```

3. 核对基线闭合、当前路由、任务范围、预检新鲜度、继续包可信度、资产与候选数量、开放 Finding、失效 Audit 和未决对象。
4. 返回当前状态、阻断原因和唯一下一入口。

## 路由

- 没有基线：进入 `semantic-discover`；
- 库存未闭合：继续 `semantic-discover`；
- 只有文档、配置或测试变化：采用 `fast` 路由，执行预检和工程验证；
- 有代码差异但无预检：进入 `semantic-preflight`；
- 没有明确任务且没有工作树变化：进入 `maintenance`，执行全仓 `semantic-discover`、`semantic-status`、`semantic-audit` 和 `semantic-verify`；
- 严格路由：依次进入 `semantic-diff`、必要的 `semantic-audit` 和 `semantic-verify`；
- 开放 Finding 或 stale Audit：进入定向 `semantic-audit`；
- 只缺确定性证据：进入 `semantic-verify`。

继续包只用于短期恢复。仓库、分支、有效期或证据摘要不匹配时显示失效原因，并回到当前路由重新判断，不沿用旧 Frontier。

输出不得使用“安全”“没有缺陷”或其它绝对结论。
