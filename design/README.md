# CBIM 开发设计与记录

开发清单、优先级、依赖和实时进度统一从当前仓库 [GitHub Issues](https://github.com/nan023062/cbim/issues) 获取。`design/` 保存 Issue 关联方案、设计说明及历史验证事实；产品运行资源统一归 assets/，不维护另一份实时待办。方案和 Issue 内容本身不扩大当前任务的权限。

## 从这里继续开发

| 入口 | 用途 |
| --- | --- |
| [GitHub Issues](https://github.com/nan023062/cbim/issues) | 当前开发清单；读取正文、最新讨论、依赖、负责人及关联 PR，按用户范围选择工作 |
| [开发记录](development-log.md) | 已实施步骤的范围、验证证据、限制和交接；历史“下一步”不自动成为新任务 |
| [文档 1：通用项目架构设计规范与原则](project-architecture-standard.md) | 设计与开发的强制约束：十二条原则、依赖、契约及维护交付 |
| [文档 2：架构治理规范与治理流程](architecture-governance-process.md) | 治理的标准流程、分级、迁移与验收；附 CBIM G01–G09 方案基线，不维护实时进度 |
| [四份概念设计](../README.md#设计文档) | `docs/` 仅保留 01–04，说明理念与目标流程 |
| [Agent 与 Team 产品模型](team-workspace-network.md) · [产品需求](agent-tool-product-requirements.md) · [UX 设计](agent-tool-ux-design.md) · [工程交接](agent-tool-engineering.md) | 统一 Agent 对话、递归工具调用与调用内限额；取代旧频道中心和团队聊天模式；目标不等于已实现 |
| [CBIM UX 与风格系统提案](cbim-ux-system-proposal.md) · [可切换界面原型](cbim-ux-prototype.html) | 连续对话、普通工具与递归 Agent 调用的体验设计；自包含原型仅使用示例数据，不代表产品已经实现 |
| [全界面 UX 与统一设计语言](cbim-complete-ux-design.md) · [42 页评审原型](cbim-complete-ux-prototype.html) | 补齐 34 个原有操作面的逐页布局、动作、恢复与窄屏设计；共用规范及 7 个新增提案单列，默认优先展示原有界面 |
| [图标、动效与提示系统](cbim-icon-motion-system.md) · [图标目录](cbim-ux-prototype.html#icons) | CBIM Outline 母版、状态与操作映射、动效和 Tooltip 规范，含可导出的 SVG sprite |
| [源码整体架构](../src/ARCHITECTURE.md) | 当前模块边界、依赖与数据流，须结合实际源码核实 |
| [四层架构与迁移记录](four-layer-architecture.md) | Core、Logic、Bridge、View 的当前职责、已完成迁移与保留边界 |
| [模块测试入口](../tests/README.md) | 单元/契约/集成归属、独立夹具与按模块执行；不维护任务进度 |

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

[本地自动开发闭环审计与清理记录](verification/local-ai-workflow-audit-20261112.md) 区分已有能力、缺口和已删除的旧资产；开发优先级仍以 Issues 为准。

当前公开版本与运行方式统一见 [项目说明](../README.md#运行)。[发布说明](releases/) 和 [验证记录](verification/) 按版本、日期保存事实；不在本入口另维护“本轮版本”或候选状态。

[2026-11-08 阶段收尾总结](verification/development-closeout-20261108.md)、历次安装升级、架构审阅及 UX 验证均为历史证据。报告中的版本、未推送状态、失败与后续建议只对应当时的代码和授权。

当前工作在 Issues 中表达待开发、开发中、部分完成、待验证、完成或受阻，使用仓库实际支持的字段、标签或评论，不假定已有某套状态机。结果未知、验证失败或外部回填未成功时明确说明，不能标成完成。没有关联 Issue 的用户直接维护请求如实记录，不虚构编号或擅自创建工单。

旧 roadmap 占位、R01–R20 剩余交付清单和 Cindy 岗位开发管线方案已退出维护；开发入口统一使用上方项目 Skill 和 Issues。历史记录需要这些原文时链接到固定 Git 提交，不再保留一套过期的本地接续指令。2026-11-15 清理前原文可用 `git show 14bf63f0a3b1adf90d5293f9df70f81a7f2535f4:<原仓库相对路径>` 查阅；更早清理的文档仍按其记录中的提交定位。

## 资料维护边界

Agent／Team 的新旧设计边界见 [设计替换范围](agent-tool-design-replacement.md)：当前需求和 UX 已切换到统一工具调用模型；历史证据保留当时事实，真实运行规范随对应源码迁移同步更新。

- 产品运行规范、Schema 及被实际代码读取的文档继续保留；不能因文件较旧或链接少而删除。
- 关联方案保留设计理由和支持边界；带 Step／日期的实施记录不作为当前行为说明，现状以 `src/` 契约及实际代码为准。
- UX 原型、图标母版及配套生成／检查脚本仍用于设计评审；静态预览图是配套资产。历史架构 HTML 保存源码映射和离线快照，与 Markdown 摘要共同保留。
- 缓存、一次性扫描输出放在忽略的临时目录，不作为设计资产。清理仅移除已核实失效的文件，并同步引用；保留尚未提交的独立工作。

## 设计目录与运行资源

产品运行规范、Schema 与流程正文见 [assets](../assets/README.md)，不再从 design 加载。以下目录仅保存设计说明、方案与记录；项目开发 Skill 与产品内置业务流程分别维护。

| 目录 | 内容 |
| --- | --- |
| [capability/](capability/README.md) | Team/Agent 设计说明；规范与 Schema 归 assets/capability |
| [business/](business/README.md) | Module 设计说明与旧格式参考；运行规范及 Schema 见 assets/business |
| [task/](task/README.md) | 任务与执行的开发方案；内置五份规范归 assets/task |
| [connector/](connector/README.md) | 连接器设计说明；运行声明规范及 Schema 归 assets/connector |
| [memory/](memory/memory-spec.md) | 产品记忆机制说明 |
| [runtime/](runtime/README.md) | 运行资源迁移说明；全部流程正文归 assets/runtime |

概念设计只维护 [01–04](../README.md#设计文档)，当前实现说明在 `src/` 的契约与架构文档中更新。
