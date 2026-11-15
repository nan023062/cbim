# Capability：能力侧

本说明面向人。能力侧描述专业角色能做什么、工作原则与可用方法；具体目标和工作范围由任务提供。

- [Agent 定义与维护规范](../../assets/capability/agent-spec.md)：字段、专业方法、组织路径、索引与维护约束。
- [Agent Schema](../../assets/capability/agent.schema.json)：结构化字段校验。
- [BaseAgent 类图](base-agent.md)：面向人的概念展示。

## 产品目标与运行格式

产品采用 [统一 Agent 工具模型](../agent-tool-product-requirements.md)：Team 配置可调用 Agent、职责与权限；主 Agent 与用户交互，执行 Agent 与直接调用方交互，任意已授权 Agent 可递归调用工具和 Agent。界面使用同一种对话流与工具展开，不使用独立团队聊天模式。

现有注册表、能力目录分组和 Skill 继承是存储与检索约定，不是调用层级。产品加载的 [Agent 定义规范](agent-spec.md) 和 Schema 仍描述实际支持的格式；递归执行接通前不通过修改提示词开放原本不存在的权限。实现与目标的差异见 [工程交接](../agent-tool-engineering.md)。
