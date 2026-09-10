# 路由走查

| 用户意图                   | 应触发                        | 不应触发                              |
| -------------------------- | ----------------------------- | ------------------------------------- |
| 新增功能，先检查已有实现   | `semantic-preflight`          | `semantic-discover`、`semantic-audit` |
| 修复已有明确复现的局部缺陷 | `semantic-preflight`          | `semantic-decide`                     |
| 建立整个仓库语义地图       | `semantic-discover`           | `semantic-preflight`                  |
| 分析已经形成的代码差异     | `semantic-diff`               | `semantic-discover`                   |
| 审查指定高风险边界         | `semantic-audit`              | 普通代码审查                          |
| 真实行为应该报错还是降级   | `semantic-decide`             | `semantic-audit`                      |
| 校验材料与问题关闭证据     | `semantic-verify`             | 普通测试执行                          |
| 只调整排版或注释           | `semantic-preflight` 快速路径 | `semantic-audit`                      |
