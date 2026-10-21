---
schema_version: 1
id: evidence.task-scoped-reuse
kind: evidence
observed_at: source:e2f030c43982a0e5bdc363e45ef67e8cc189d9cdd59552c89dd647c8cc5fb97e
source_refs:
  - scripts/preflight_contract.py#reuse_check_contents
  - runtime/preflight-contract.mjs#checkPreflightRecord
  - skills/semantic-contract/scripts/verify_semantic.py#validate_task
  - skills/semantic-discover/scripts/inventory.py#def scan
  - tests/test_preflight_contract.py#test_candidates_bind_current_content_and_checked_symbol
  - tests/test_task_validation.py#test_no_baseline_local_validation_and_out_of_scope_detection
  - tests/hooks.test.mjs#无基线任务也要求预检
  - scripts/benchmark-preflight.mjs#taskStages
  - skills/semantic-status/SKILL.md#路由
  - skills/semantic-status/scripts/status.py#next_actions
  - tests/status.test.mjs#状态建议区分无任务等待
supports:
  - behavior.preflight-before-write
  - behavior.post-change-verification
limitations:
  - 候选路径和符号存在不证明语义等价或检索完整
  - 读取量是临时夹具的源码与 Path 读取统计，不含所有运行态描述符读取
  - 本轮没有安装插件或完成真实宿主新会话与 GUI 重载验收
---

# 日常复用与局部验证证据

## 支持的结论

schemaVersion: 2 任务记录保存搜索范围、候选与理由，绑定相关文件内容。旧字符串记录拒绝沿用；不同消费者共用 Python 完整合同。无基线任务也检查准入，Stop 输出只证明当前任务的收据。全项目严格校验保持显式入口。

状态查询只展示全局缺口，不因缺少基线、库存开放或无关 Finding/Audit 自动推荐全项目治理；有任务时保留任务入口，可信且显式的 repository maintenance 才推荐全项目流程。状态投影不授予写入或建库权限。

空闲或缺失路由不吞掉待结算输入：失效或无法解析的预检、缺少同任务有效预检的继续包，先回到局部预检；Stop 阻断结合预检有效性给出局部恢复入口。继续包只恢复同任务的局部步骤，不能继承全仓范围；查询保留原记录和错误。

## 来源与范围

回归覆盖候选符号、固定依据变更、越界变化、无基线准入和完成收据。性能夹具覆盖局部完成与 --path 盘点，在无关文件增长前后观察读取范围，不将阶段耗时转述为线上体验。

状态回归包含纯查询、无基线任务、无关库存与审查缺口、不可信路由及显式全项目范围，并通过 CLI 核对只读查询不创建基线或路由。源码场景不替代实际命令退出结果；联合候选的完整执行结果保存在本地产物目录。

## 已知缺口

真实宿主会话与更新后的插件加载未验收；全项目安全候选报告和外部定时触发仍属于后续 Delivery Map。
