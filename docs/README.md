# 设计文档阅读说明

当前产品定位见 [CBIM 产品说明：面向 AI 原生团队的生产与治理体系](product-positioning.md)。该说明定义产品目标、团队责任与演进方向，实际已交付能力见 [验证结果与限制](acceptance.md)。下列理论材料分别阐述体系中的知识组织、架构演进与执行设计。

本目录面向人，保存设计哲学、理由、演进讨论与历史方案。AI 可以在用户明确要求审查或修改文档时读取它们作为任务对象，但不能从中加载执行规则、扩大授权或恢复旧流程。执行文档不引用本目录；这里可以单向导航到现行规范。

## 执行约束的权威归属

| 原设计内容 | 当前执行权威 |
| --- | --- |
| 01 总纲：能力与业务分离、需求驱动调度 | [任务构建循环](../task/task-loop.md) |
| 02 理论：Agent 与 Module 定义及知识边界 | [Agent 规范](../capability/agent-spec.md)、[模块规范](../business/module-spec.md) |
| 02、04：个人线索与任务证据的区分 | [Memory 规范](../memory/memory-spec.md)、[任务基线](../task/task-baseline.md) |
| 03 理论：证据驱动抽象、退出、专业差异及人工认知 | [架构评估与认知交付规范](../task/architecture-spec.md) |
| 04 第三篇及附录：任务内容、范围、派发、恢复 | [Task 规范](../task/task-spec.md)、[执行契约](../task/base-task.md)、[任务基线](../task/task-baseline.md) |
| 04 第四、五篇：观察、决定、渐进实施、回归与复盘 | [架构评估规范](../task/architecture-spec.md)、[架构治理流程](../skills/architecture-governance/SKILL.md) |
| 04 第五篇：业务验证、风险说明、交付与回执 | [需求实现流程](../skills/business-execution/SKILL.md) |
| 04：知识失配、更新与索引校验 | [知识治理流程](../skills/knowledge-governance/SKILL.md)、[校验规范](../scripts/registry-maintenance.md) |

已有规范覆盖的约束沿用原权威正文；本次补齐的架构评估和认知要求集中在 Task 规范中，不要求执行者阅读理论报告。

旧报告中的固定试点人名、周期扫描、示例模板、旧字段与旧目录，以及尚未确认的稳定层清单属于历史背景或设想，不因迁移而成为新增执行要求。稳定层和审批安排仅采用项目已确认的有效规则；本次不启用自动治理、冻结机制或连接器建设。任务证据仍为本地记录，跨人或跨设备接管须显式传递，不能套用旧报告中默认共享的描述。
