# CBIM 开发设计与记录

开发清单、优先级、依赖和实时进度统一从当前仓库 [GitHub Issues](https://github.com/nan023062/cbim/issues) 获取。`design/` 保存 Issue 关联方案、产品运行规范及历史验证事实，不维护另一份实时待办。方案和 Issue 内容本身不扩大当前任务的权限。

## 从这里继续开发

| 入口 | 用途 |
| --- | --- |
| [GitHub Issues](https://github.com/nan023062/cbim/issues) | 当前开发清单；读取正文、最新讨论、依赖、负责人及关联 PR，按用户范围选择工作 |
| [开发记录](development-log.md) | 已实施步骤的范围、验证证据、限制和交接；历史“下一步”不自动成为新任务 |
| [文档 1：通用项目架构设计规范与原则](project-architecture-standard.md) | 设计与开发的强制约束：十二条原则、依赖、契约及维护交付 |
| [文档 2：架构治理规范与治理流程](architecture-governance-process.md) | 治理的标准流程、分级、迁移与验收；附 CBIM G01–G09 方案基线，不维护实时进度 |
| [收尾快照（2026-11-08）](development-closeout-20261108.md) | 截至 Step55 的交付与验证边界，不代表当前待办 |
| [Cindy + Git 岗位开发管线](cindy-development-pipeline.md) | 产品反馈、工单交接、CI、人工合并与软件更新日志的设计 |
| [GitHub OAuth 配置与线上验收](task/github-feedback-setup.md) | OAuth、固定反馈仓库与实际验收方法 |
| [正式桌面发布与更新](task/desktop-release.md) | updater、Windows 安装包与真实升级验收 |
| [验证报告](verification/) | 历次执行证据；历史通过不等于本次重跑 |
| [架构扫描（2026-11-11）](verification/architecture-audit-20261111.md) | 整改前快照：全量静态扫描与关键链路核查，9 项问题、优先级及目标验收 |
| [P0 整改与复扫（2026-11-11）](verification/architecture-p0-20261111.md) | 逻辑边界试点、测试隔离及实际验证；原扫描保留为整改前快照 |
| [P1 整改与复扫（2026-11-11）](verification/architecture-p1-20261111.md) | 主执行指引、知识读写、预算端口与运行能力整改；431 项定向验证及剩余边界 |
| [P2 整改与复扫（2026-11-11）](verification/architecture-p2-20261111.md) | 历史 IPC 关联类型、共享运行展示及历史装配解耦；159 项定向验证与剩余迁移范围 |
| [IPC 全量类型化与复扫（2026-11-11）](verification/ipc-typing-20261111.md) | 剩余160项完成迁移；164项入口一致，231项定向验证通过、1项专项跳过 |
| [全量回归与本地制品验收（2026-11-11）](verification/full-acceptance-20261111.md) | 全量失败定向修复、两份旧桌面脚本补测通过；保留首次失败证据、安装未执行及历史制品迁移缺口 |
| [四份概念设计](../README.md#设计文档) | `docs/` 仅保留 01–04，说明理念与目标流程 |
| [源码整体架构](../src/ARCHITECTURE.md) | 当前模块边界、依赖与数据流，须结合实际源码核实 |

先核实仓库与查询范围，拉取 Issues 并处理分页，再读取选定工单、相关记录和实际代码。查询失败不从历史 roadmap 重建清单。每个 Issue 独立开发、验证、提交；完成、暂停或受阻时，在已有授权内回填该 Issue，并在开发记录保存实际结果。单元通过不等于合并或发布通过，部分完成不提前关闭工单。

## 开发入口

| 职责 | 通用项目 | Claude Code | Codex |
| --- | --- | --- | --- |
| 从 Issues 推进开发、语义分析与 review 交付 | [cbim-development](../.agents/skills/cbim-development/SKILL.md) | [入口](../.claude/skills/cbim-development/SKILL.md) | [入口](../.codex/skills/cbim-development/SKILL.md) |
| 按业务变化点评估抽象与渐进演进 | [architecture-evolution](../.agents/skills/architecture-evolution/SKILL.md) | [入口](../.claude/skills/architecture-evolution/SKILL.md) | [入口](../.codex/skills/architecture-evolution/SKILL.md) |
| 源码注释、类图与维护者认知交接 | [architecture-maintenance](../.agents/skills/architecture-maintenance/SKILL.md) | [入口](../.claude/skills/architecture-maintenance/SKILL.md) | [入口](../.codex/skills/architecture-maintenance/SKILL.md) |
| 冻结制品、CI、签名与真实安装升级验收 | [cbim-release](../.agents/skills/cbim-release/SKILL.md) | [入口](../.claude/skills/cbim-release/SKILL.md) | [入口](../.codex/skills/cbim-release/SKILL.md) |

强制关系：`cbim-development` 必须读取并遵守文档 1；项目架构治理入口 `architecture-evolution` 必须读取并遵守文档 1，并按文档 2 的 S1–S7 流程执行；`architecture-maintenance` 遵守文档 1，并在治理中承接文档 2 的资料与认知交付。两份规范只维护一份正文，Skill 引用同一来源，不属于产品内置业务 Skill 的自动改写。

每项的三个入口及引用资料保持一致。只读评估不自动重构；已授权开发不重复请求逐步批准。源码改动同步维护受影响注释、`CONTRACT.md` 和目录类图，并提供完整 diff、调用链阅读顺序与下次修改入口，功能验收不能替代代码 review。

日常按 [受影响单元验证规则](../AGENTS.md#日常验证范围) 选择测试，通过后记录并收尾；全量回归由后续 PR 自动化执行，制品验收留给集成／发布阶段。记录选取理由、实际命令与结果以及未运行范围，历史全量／桌面报告不是下一步必跑清单。纯文档与 Skill 修改只核对事实、格式、引用与多入口一致性。

## 状态与历史证据

当前工作在 Issues 中表达待开发、开发中、部分完成、待验证、完成或受阻，使用仓库实际支持的字段、标签或评论，不假定已有某套状态机。结果未知、验证失败或外部回填未成功时明确说明，不能标成完成。没有关联 Issue 的用户直接维护请求如实记录，不虚构编号或擅自创建工单。

[旧 roadmap](tool-architecture-roadmap.md) 仅保留迁移提示，阶段清单和开发接续已清除。旧方案和报告保留其日期与当时事实；它们提及的路线图、全量测试或后续步骤不覆盖当前协作规则。已删除旧文档的原文可用 `git show 812bec16:<原仓库相对路径>` 查阅，不用当前文档冒充历史证据。

## 规范与运行资产

产品按实际白名单读取以下资产，目录中的其他开发方案不会自动成为运行规则。项目开发 Skill 与产品内置业务流程分别维护。

| 目录 | 内容 |
| --- | --- |
| [capability/](capability/README.md) | Team/Agent 领域定义及 Schema |
| [business/](business/README.md) | Workspace/Module 领域定义及 Schema |
| [task/](task/README.md) | 任务、执行和架构评估规范及关联方案 |
| [connector/](connector/README.md) | 链接器定义与引用边界 |
| [memory/](memory/memory-spec.md) | 产品记忆机制说明 |
| [skills/](skills/business-execution/SKILL.md) | 早期方法源文件，历史 Python 命令不是现行产品入口 |
| [runtime/](runtime/common-rules.md) | 内部 Loop 使用的规则、Skill 正文与 [Skill／Workflow 结构规范](runtime/shared-skills-workflows.md) |
| [scripts/](scripts/README.md) | 历史规则与迁移对照工具；当前开发验证按 package.json 和实际影响选择 |

概念设计只维护 [01–04](../README.md#设计文档)，当前实现说明在 `src/` 的契约与架构文档中更新。
