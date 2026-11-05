# Capability：能力侧

本说明面向人。能力侧描述专业角色能做什么、工作原则与可用方法；具体目标和工作范围由任务提供。

- [Agent 定义与维护规范](agent-spec.md)：字段、专业方法、组织路径、索引与维护约束。
- [Agent Schema](agent.schema.json)：结构化字段校验。
- [BaseAgent 类图](base-agent.md)：面向人的概念展示。

## 当前组织方式

成员由 CBIM 本地定义维护，注册表按 `groups → agents` 组织检索。分组提供候选范围，不产生额外调度层；CBIM AI 助理负责整体协调，AI 成员完成任务。

当前不要求为分组配置 Leader，也没有嵌套 Team 的运行模型。成员身份、分组和索引规则以 [Agent 定义与维护规范](agent-spec.md) 为准，本文不新增执行约束。
