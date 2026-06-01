---
name: cbim-unity-agentos
owner: architect
description: CBIM 在 v2 项目内的定位与一级子模块边界。
keywords: []
dependencies: []
status: spec
---

## 定位

CBIM 是 v2 项目里的 Agent OS：把"会话入口、Agent 装配、业务工作区、共享基建"组织成一个可被宿主装配根调用的整体。对 v2 项目而言，它是承载所有 Agent 能力与业务模块的运行时底盘。

## 边界约束

- 依赖单向向下：`AgenticOS → {Channel, Agent, Workspace} → 基建子模块 → Storage`，禁止反向依赖。
- `Agent` 与 `Workspace` 不直接耦合，二者通过共享基建（`Mcp / Skills / Tools`）与组合根协作。
- 每个一级子模块的内部组织由其自身的 `.dna/module.md` 负责，本文件不下钻。

## Class Diagram

```mermaid
classDiagram
    class Channel { <<module>> }
    class Agent { <<module>> }
    class Workspace { <<module>> }
    class Memory { <<module>> }
    class Mcp { <<module>> }
    class Skills { <<module>> }
    class Tools { <<module>> }
    class Storage { <<module>> }

    Channel ..> Agent : entry layer drives agent
    Agent ..> Memory : per-agent memory
    Agent ..> Mcp : agent-side mcp list
    Agent ..> Skills : agent skill set
    Agent ..> Tools : agent system tools
    Workspace ..> Mcp : module-side mcp list
    Workspace ..> Skills : module workflows
    Workspace ..> Tools : module tools
    Memory ..> Storage : file-backed memory
    Mcp ..> Storage : descriptor store
    Skills ..> Storage : descriptor store
    Tools ..> Storage : Files family
```

| 子模块 | 角色 |
|--------|------|
| `Channel` | 对外会话入口，把外部调用翻译成 Agent 可处理的会话事件。 |
| `Agent` | Agent 的装配与运行门面，对外提供“一个可被驱动的 Agent”这一抽象。 |
| `Workspace` | 业务侧工作区，把项目自身的 Skill / MCP / Tool 组装成可被 Agent 使用的模块。 |
| `Memory` | Agent 的记忆服务，承担长期/短期记忆的读写契约。 |
| `Mcp` | MCP 描述符与实例的统一管理面。 |
| `Skills` | Skill 描述符的存储与检索面。 |
| `Tools` | Tool 描述符的基建面，定义工具能力的统一形态。 |
| `Storage` | 全栈最底层的存储原语，被所有需要落盘的基建依赖。 |

