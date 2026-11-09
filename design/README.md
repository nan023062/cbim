# CBIM 开发计划模块

`design/` 组织 CBIM 工程的开发路线、实施步骤与完成记录；`docs/` 保存概念、产品和架构说明，解释为什么这样设计。开发计划不是产品运行时提示词，也不扩大当前任务的权限。

## 从这里继续开发

| 入口 | 用途 |
| --- | --- |
| [开发路线图](tool-architecture-roadmap.md) | 全局目标、五阶段状态、上一步成果、当前步骤、下一步与剩余项；当前进度的唯一维护位置 |
| [开发记录](development-log.md) | 每个已实施步骤的完成事实、验证证据、限制和后续交接；不另建一份实时待办表 |
| [开发者可持续维护 Skill](../docs/developer-skills.md) | 四项项目级能力：架构演进、源码与认知维护、开发推进、桌面发布；每项在三个开发入口同步 |
| [本轮开发收尾总结（2026-11-08）](development-closeout-20261108.md) | 截至 Step55 的已交付能力、交付包缺口、验证边界与最终成品；收尾快照，不代替路线图 |
| [Cindy + Git 岗位开发管线](cindy-development-pipeline.md) | 产品反馈 Skill、GitHub Issue、开发岗位与工单交接、CI、人工合并及软件更新日志；反馈／正式发布／手动升级已验收，内部开发管线待实施 |
| [GitHub OAuth 配置与线上验收](task/github-feedback-setup.md) | OAuth App 注册字段、Device Flow 登录、固定仓库及一条真实 Issue 验收步骤；实际结果另记验证报告 |
| [正式桌面发布与手动更新](task/desktop-release.md) | 独立 updater 子系统、Windows 安装包、桌面 Release 通道与真实升级验收 |
| [桌面发布 Skill](../.agents/skills/cbim-release/SKILL.md) | 冻结候选、签名模式、CI、草稿恢复、隔离安装、公开升级、官网及双分支收尾 |
| `verification/` | 随实施步骤保存的验证报告；由开发记录链接，不代替 roadmap 的实时状态 |
| [概念设计](../docs/README.md) | 产品定位、核心理论、设计取舍与相关说明，按本步需要阅读 |
| [源码整体架构](../src/ARCHITECTURE.md) | 当前真实模块边界、依赖和数据流；实施前结合源码核实 |

开发 Skill 的入口：

- [通用项目入口：cbim-development](../.agents/skills/cbim-development/SKILL.md)
- [Claude Code：cbim-development](../.claude/skills/cbim-development/SKILL.md)
- [Codex：cbim-development](../.codex/skills/cbim-development/SKILL.md)

三个入口内容保持一致。“继续开发”“按计划推进”时，先回顾全局路线图、上一步记录和当前代码，再确定一个可验证的下一步；每完成一步立即更新 roadmap，而不是等整个阶段结束再补进度。源码改动同时遵循 `architecture-maintenance`，不以进度记录替代注释、类图或行为验证。

日常按 [受影响单元验证规则](../AGENTS.md#日常验证范围) 选择本步测试，通过后收尾；全量回归交给后续 PR 自动化，完整桌面与制品验收留给集成／发布阶段。每步记录受影响单元、选择依据、实际命令及结果，明确后续自动化尚需验证的范围；历史全量和桌面报告不构成下一步的必跑清单。

## 状态与证据

- 待开发：目标已记录，尚未实施；开发中：正在处理明确的步骤。
- 部分完成：写出已经接通的部分及具体剩余项；待验证：实现存在，但必要验证尚未完成。
- 已完成：本步约定范围及验证已完成，并有可定位的记录；不自动意味着所属阶段全部完成。
- 受阻：记录原因、已有产物及恢复条件，不能把失败或中断改成完成。

开始开发时更新路线图的“开发接续”；完成、暂停或中断时同步阶段状态和剩余项，并在开发记录中留下结果。已有测试报告可引用，但不能写成刚刚重新测试通过；确定性模型、本地仓库和跨机器真实业务验证分别记录。

## 现有规范与运行资产

以下资产仍位于原路径，供现有程序按明确清单加载。开发计划与概念资料不会因进入本目录而自动成为运行规则；项目开发 Skill 也不是产品内置业务 Skill。

| 目录 | 内容 |
| --- | --- |
| [capability/](capability/README.md) | Team/Agent 的领域定义及 Schema |
| [business/](business/README.md) | Workspace/Module 的领域定义及 Schema |
| [task/](task/README.md) | 任务、执行与架构评估规范 |
| [connector/](connector/README.md) | 链接器定义与引用边界 |
| [memory/](memory/memory-spec.md) | 产品记忆机制说明 |
| [skills/](skills/business-execution/SKILL.md) | 产品内置方法的源文件，不是本仓库开发 Skill 的入口 |
| [runtime/](runtime/common-rules.md) | 内部 Loop 使用的运行规则正文 |
| [scripts/](scripts/README.md) | 历史规则与迁移对照工具；当前开发验证按 package.json 和架构维护 Skill 选择 |

核心领域的总体组合关系已归入 [docs/core-design.md](../docs/core-design.md)，实现状态统一回到路线图核对。
