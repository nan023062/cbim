# CBIM 概念设计

`docs/` 保存产品定位、概念理论、架构取舍及配套说明。开发路线与逐步实施状态统一维护在 [design/ 开发计划模块](../design/README.md)，这里不再维护开发 roadmap。

## 概念与产品

- [产品定位：面向 AI 原生团队的生产与治理体系](product-positioning.md)
- [AI Native 设计思想总纲](01-AI-Native设计思想总纲.md)
- [CBIM 架构设计理论](02-CBIM架构设计理论.md)
- [渐进式架构演进与人工认知保障体系](03-渐进式架构演进与人工认知保障体系.md)
- [AI Native 开发全流程设计方案](04-AI-Native开发全流程设计方案.md)
- [核心概念与领域设计](core-design.md)：能力、业务与任务的组合关系，原 `design/README.md` 的概念说明。

## 架构与交互说明

- [架构、存储与生命周期](assistant-architecture.md) · [源码目录说明](source-layout.md) · [源码类图](../src/ARCHITECTURE.md)
- [Team 与 Workspace 树](shared-skills-workflows.md)：Skill 沿父链继承；Workflow 仅属于当前 Module。
- [工作区成员与模块负责人索引](module-owner-index.md)：能力加入项目后的岗位适配、按负责人派发及换人交接；设计方案，尚待实施。
- [大脑与 Loop Engine](loop-engine.md) · [任务派发契约](agent-dispatch-contract.md)
- [主 Agent 的目标调度循环](main-agent-orchestration-loop.md)：图谱驱动的外层循环、结果评估与目标完成条件；明确现有派工回注基础与待实现门禁。
- [成员执行与结果回传](member-execution.md) · [全局运行监管](global-runtime-management.md)
- [Agent 的 Session 执行历史](agent-session-history.md)：从团队节点只读查看主、默认和自定义角色的会话与轮次；删除定义后仍保留归档。
- [工作区界面](workspace-ui.md) · [Cindy 对话适配](cindy-chat-port.md)
- [资源仓库](resource-repositories.md) · [规则迁移](rule-migration.md) · [构建命名](build-naming.md)

这些材料用于解释设计或特定功能。当前已完成、部分完成与待开发范围统一以[开发路线图](../design/tool-architecture-roadmap.md)为入口，并核对实际源码和验证证据。

## 运行规范与验证参考

开发者可以按任务需要读取概念资料；产品运行仍按现有明确清单加载规范，不把整个目录或开发计划当作运行提示词或授权。

- 领域规范：[Agent](../design/capability/agent-spec.md)、[Module](../design/business/module-spec.md)、[Memory](../design/memory/memory-spec.md)。
- 任务规范：[任务构建循环](../design/task/task-loop.md)、[Task](../design/task/task-spec.md)、[执行契约](../design/task/base-task.md)、[任务基线](../design/task/task-baseline.md)、[架构评估](../design/task/architecture-spec.md)。
- 方法源文件：[需求实现](../design/skills/business-execution/SKILL.md)、[知识治理](../design/skills/knowledge-governance/SKILL.md)、[架构治理](../design/skills/architecture-governance/SKILL.md)。本仓库开发使用独立的 `cbim-development` Skill。
- 验证参考：[验收说明](acceptance.md)、[静态架构与资源复用构建报告](build-test-20261106-220344.md)、[历史构建报告](build-test-20261106-181923.md)、[任务实测记录](live-task-test-2026-11-06.md)。报告说明各自测试时的范围，不自动证明之后版本仍通过。

旧理论中的人名、周期、字段、路径和示例不自动成为当前规则。设计目标、已实现行为与验证结论分别表达；运行时目前使用的显式资料（包括 Team/Workspace 结构说明）保留原路径。
