---
schema_version: 4
slug: session-aware-stop-gate/multi-repository-workspace
design_ref: docs/supreme/specs/2026-09-17-session-aware-stop-gate/design.md
design_sections:
  - ref: design.md § 系统边界
    digest: sha256:80e09e7fc2e146c74f772d6d3ab11cec76bbbf832c2e70a51370ff0ce063402b
  - ref: design.md § 复用与实现约束
    digest: sha256:7b0f6438d4abd4ff4858339751f8796920ee848316b19cc0b167912856a4bacd
delivery_ref: null
outcome:
  summary: 在共同父目录打开一个会话即可统一处理多个独立 Git 子项目，父目录无需属于 Git，修改授权与完成验证仍按实际仓库归属
  acceptance:
    - 只在非 Git 父目录执行一次真实格式的 SessionStart，无需对子仓库逐个打开会话或伪造
      SessionStart，即可通过正常首次接入、逐仓预检与写入流程处理三个独立 Git 子项目；不要求创建父 Git 仓库或全项目语义基线。
    - 同一会话的 Stop 与 PreCompact
      能找回本轮涉及的仓库；各仓库保留独立的观察、用户差异裁决、任务预检、继续包和验证收据，任一未通过仓库不能被其它仓库的通过结果掩盖。
    - npm test 与 npm run verify 通过；完成 semantic-diff
      影响分析及任务范围语义验证。既有严格快照门禁要求的源码身份元数据同步是维护例外，不扩大治理范围、不改变 Baseline 覆盖和闭合结论。
    - 源码及进程夹具结果与 Codex、Cursor、Claude Code 的真实宿主验收分开报告；未进行对应新会话或 GUI
      重载验收时，明确标记未验证，不声称安装版 Hook 已运行。
out_of_scope:
  - 不把前端、后端等项目角色、固定子目录名或固定两仓结构写入协议。
  - 不增加父 Git 仓库，不合并子仓库历史，不引入全局注册服务、数据库、常驻扫描或自动全项目建库。
  - 不提供跨仓原子提交、跨 Git 移动或单次补丁跨多个 Git 根的事务能力；同一任务可连续向不同仓库分别写入。
  - 不扩展到普通非 Git 文件的受控写入，不自动接入父目录之外的仓库或沿符号链接扩大工作区范围。
  - 不将仓库级 preflight、route 或 continuation 全面改为多任务调度系统，不接管其它会话和任务的待结算状态。
  - 本计划与后续源码实现不自动授权 stage、commit、push、安装缓存改写、发布或其它会话消息发送。
todos:
  - id: workspace-routing-state
    summary: 区分工作区身份与仓库身份，扩展既有会话运行态在非 Git 父目录保存路由，并修订设计中的旧限制
    files:
      - docs/supreme/specs/2026-09-17-session-aware-stop-gate/design.md
      - runtime/project-state.mjs
      - runtime/session-state.mjs
      - tests/project-state.test.mjs
      - tests/session-changes.test.mjs
    acceptance:
      - 工作区路由以规范父目录、宿主及原生会话身份隔离，仓库记录以实际 Git 根和 worktree
        身份隔离；相同会话字符串在不同宿主或工作区不可串用。
      - 复用既有 session-snapshot.json、串行更新、原子替换和有界安全读取；非 Git
        工作区只保存路由及必要生命周期元数据，不生成仓库快照、预检授权或完成收据。
      - 显式区分非 Git 工作区运行态与 Git 仓库运行态的写入条件，解决现有写入强依赖 .git/info/exclude
        的问题，同时保留仓库内运行态禁止被 Git 跟踪的检查；不全局跳过跟踪与忽略检查。
      - 新路由记录不能被 loadSessionSnapshot 当作仓库起始观察；旧单仓和父 Git 加独立子 Git
        的记录可识别复用，不迁移或覆盖其它会话的裁决。
      - 移除以八个仓库为业务上限的限制，在既有安全字节与执行预算内允许九个以上仓库；资源超限明确失败，不能静默截断仓库集合、丢失待结算绑定或生成整体通过。
      - 设计同步说明非 Git 父工作区、首次接入观察和路由运行态边界；若改动本 Plan 引用章节，刷新同一 Plan 的章节摘要后再继续实现。
  - id: repository-first-contact
    summary: 让父目录会话通过真实 Hook 首次接入目标子仓库，在写入前建立本仓观察和差异处置依据
    files:
      - hooks/entry.mjs
      - runtime/route.mjs
      - runtime/session-state.mjs
      - scripts/session-changes.mjs
      - skills/semantic-preflight/SKILL.md
      - tests/native-hook-binding.test.mjs
      - tests/session-changes.test.mjs
    acceptance:
      - SessionStart 先建立工作区会话身份；按实际访问的目标子仓库惰性接入，不递归扫描全部项目、依赖目录或无关文件。
      - 目标仓库没有本会话观察时，由写入前的真实 Hook 建立首次接入观察，明确记录其实际时刻和事件来源，不能冒充 SessionStart
        时的历史快照；本次观察不自动授权写入。
      - 首次接入后通过正常反馈让助手完成本仓预检和必要的差异处置，再重试准入；干净仓库不新增用户确认，已有差异沿用
        inspect、用户明确答复、decide 及受保护路径检查。
      - 已有本会话观察、未结算绑定、预检或继续包存在时优先核对和恢复，不以首次接入重录为由把待结算修改改称初始差异；损坏或缺失依据须明确恢复，不从预检、目标路径或其它会话补造。
      - 仅父目录一次启动即可完成子仓接入；缺失或冲突会话、错误任务、失效观察和其它会话裁决仍不能获准写入。
  - id: repository-scoped-admission
    summary: 按实际编辑仓库逐次准入，使同一任务可在多个 Git 子项目之间连续推进
    files:
      - hooks/entry.mjs
      - runtime/session-state.mjs
      - tests/native-hook-binding.test.mjs
      - tests/hooks.test.mjs
    acceptance:
      - 移除非 Git 父目录一律拒写的分支，所有新增、更新、删除及 Move 两端仍先由 actualEditTargets 确认实际 Git
        归属，再执行本仓授权检查。
      - 父工作区路由、仓库 A 的预检或用户差异裁决不能授权仓库 B；分别编辑多个仓库时，各次写入只登记实际获准的
        repositoryRoot、HEAD 与 taskId。
      - 覆盖同级仓库、不同目录深度、目录带空格及中文、独立克隆和 linked worktree；真实 Git 根与 worktree 不能因共享
        common Git 目录而混淆。
      - 范围外路径、符号链接歧义、越界路径、未知写入目标、未经授权删除及同一次补丁跨仓仍有明确拒绝结果；普通单仓兼容行为保留。
  - id: workspace-lifecycle-settlement
    summary: 从非 Git 工作区恢复本会话仓库集合，逐仓保存继续包并结算 Stop，支持部分失败后的正确重试
    files:
      - hooks/entry.mjs
      - runtime/session-state.mjs
      - runtime/continuation.mjs
      - tests/native-hook-binding.test.mjs
      - tests/hooks.test.mjs
    acceptance:
      - Stop 与 PreCompact 不再因父目录无 Git 提前返回；只处理本会话实际接入且有可核对归属的仓库，不扫描并消费未参与任务的子仓状态。
      - resume、compact 和 fork 按既有宿主语义核对身份；事件 cwd
        变化不能静默切换到其它工作区或丢弃原绑定，无法可靠定位原工作区时明确返回未验证与恢复信息。
      - 逐仓验证真实 Git 根、worktree、HEAD、原生会话和 taskId，沿用 checkpointBinding
        及现有同会话授权续接；合法 commit、squash 后续接与错误 HEAD、任务替换等拒绝场景继续成立。
      - 任一仓库验证失败，聚合宿主输出明确失败仓库和原因；已真实通过仓库的独立收据可以保留，失败仓库及未归属任务的预检和继续包不得被清除。修复重试能重验或复用有效收据，避免已通过仓库因正常清态而无法结束。
      - 只读、无修改、没有参与仓库及重复 Stop 均不伪造整体通过；待裁决和失败去重维持原语义，不能出现自动重入循环。
      - 绑定损坏、路由过期、仓库移走、并发更新及总执行预算耗尽时不得遗漏仓库后宣称成功；保留必要待结算状态，反馈可恢复原因。
  - id: workspace-contract-and-evidence
    summary: 同步多仓库工作区的使用契约与语义闭包，以真实 Git 生命周期回归验证并区分源码与宿主证据
    files:
      - README.md
      - docs/concepts.md
      - docs/command-reference.md
      - docs/host-support.md
      - skills/semantic-preflight/SKILL.md
      - .echo-semantic/maps/map.lifecycle-enforcement.md
      - .echo-semantic/behaviors/behavior.preflight-before-write.md
      - .echo-semantic/behaviors/behavior.post-change-verification.md
      - .echo-semantic/evidence/evidence.lifecycle-hooks.md
      - scripts/validate-package.mjs
      - tests/native-hook-binding.test.mjs
      - tests/project-state.test.mjs
      - tests/hooks.test.mjs
      - .echo-semantic/baseline.md
      - tests/installer.test.mjs
    acceptance:
      - 在现有测试文件中加入非 Git 父目录加至少三个独立 Git 子项目的真实 Git
        夹具，完整覆盖仅父目录启动、首次接入、逐仓预检、真实文件修改、PreCompact 和 Stop；不以 f.start(child)
        代替新能力。
      - 补充无基线与有基线、部分已有差异、并发会话、超过八仓、部分失败重试和旧单仓兼容的反例，断言实际收据、失败原因以及必须保留的状态，不能仅断言退出码。
      - 文档说明共同父目录可无 Git、首次接入时刻与仓库起始观察的区别、逐仓授权和汇总结算；不承诺未被真实 Hook 覆盖的任意写入工具均受阻断。
      - 只使用当前已确认的宿主事件和字段；确需扩展宿主协议时先取得官方文档、当前 CLI 或真实加载证据并回到方案对齐，不在实现中虚构字段。
      - 仅更新本次影响闭包内的长期结论和引用；运行态、原始日志与中间产物留在忽略的 .echo-semantic/local/<task-id>/ 或
        CI Artifact，分发校验确保不携带采用方运行态。
      - 真实宿主验收单独列明各宿主的版本、加载身份和已观察事件，未获安装授权时保留源码结果与未验收清单，不为取得现场证据直接覆盖缓存。
      - 旧 source 摘要已证明等于 main@7536db0 的 Git tree 时，未变对象仅将旧观察固定到该可恢复 Git
        revision；本轮受影响对象绑定最终源码身份，现有 Baseline 仅更新 content_digest，不改
        base_revision、覆盖、闭合字段或无关正文。
      - 分发入口冒烟使用既有宿主合同的 cwd、session_id 与 source，并验证无 Git 文件写入被拒绝，不以空 JSON
        的全事件放行代替入口可用性。
artifact_id: plan:27b95514-a195-40a4-b54e-5adb9d1c1394
lifecycle: completed
---
## Notes

本计划依据当前对话确认的通用多仓库工作区目标制定。调查快照为 `main@7536db0b896eef31873d0e4c998961db03516df3`，初始工作树干净，宿主工作根与 Git 根均为当前仓库。执行前须重新核对实际快照与已有差异，不继承本次干净状态。

本计划编制时 Design 的“原生事件与实际编辑仓库绑定（本地修复）”章节描述了待替换的旧限制，包括非 Git 父目录拒绝、仅依赖子仓 SessionStart 观察及八仓上限。本 Plan 仅绑定继续复用的系统边界和实现约束；首项工作须将目标行为同步到同一 Design，避免把旧限制当作新能力的验收。

复用决定为扩展现有实现：`hooks/entry.mjs` 的 `actualEditTargets`、`checkEditScope`、`runBoundRepositories`、`checkpointBinding`；`runtime/session-state.mjs` 的会话记录与 `repositoryBindings`；`runtime/project-state.mjs` 的锁、原子更新及安全读取；`scripts/session-changes.mjs` 的 inspect/decide；已有逐仓 Stop 的真实 Git 回归。非 Git 父目录的路由只指向仓库，不拥有仓库授权、裁决或通过结论，避免引入平行状态权威。

先闭合工作区身份、运行态存放与首次接入语义，再接入编辑和结束路径，最后完成相关语义引用与工程验证。进入代码实现前执行 semantic-preflight；首个实现差异后执行 semantic-diff；完成前执行 semantic-verify。Plan 校验只证明计划合同与引用有效，不证明上述功能已经实现或真实宿主已经加载。

既有 npm run verify 强制 --strict-snapshot。源码修改后，原 source:323d9d10e27ceb3a901d3b923bb58982aa6efcc4cbf919bfab17ad0abbd0ec18 已核实等于 main@7536db0b896eef31873d0e4c998961db03516df3 的完整源码身份；将未变观察固定到该 Git revision 可以保留历史事实。仅同步现有 Baseline content_digest 与受影响对象最终身份，不运行新的全项目发现，不把旧对象误报为已在新源码重新审查。