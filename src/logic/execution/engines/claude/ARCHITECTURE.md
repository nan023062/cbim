# src/logic/execution/engines/claude 架构

<a id="contract"></a>

## 设计意图

把 Claude Agent SDK 的会话、事件与工具调用转换为宿主统一执行协议。

`ClaudeCodeEngine` 持有本次 SDK 会话，`sdk` 隔离加载，`tools` 连接可信工具，`package` 暴露工厂。运行环境和能力由宿主注入，历史反馈不扩大授权；这里不开放对外通用 MCP 服务。

## 主要组成

| 组成 | 定位 |
| --- | --- |
| [ClaudeCodeEngine](engine.ts) | Claude Code 的 AgentEngine 适配器，管理 SDK 与原生会话；目标返工沿合成系统资料输入，不带入新授权。 |
| [tools](tools.ts) | 将宿主已授权能力适配成 SDK 工具，保持真实调用身份。 |

<!-- architecture:generated:start -->

## 架构关系

```mermaid
classDiagram
class N_f68f9fd17f74["ClaudeCodeEngine"]
click N_f68f9fd17f74 href "engine.ts"
class N_995f04f45e9f["tools"] {
  <<module>>
}
click N_995f04f45e9f href "tools.ts"
class N_649b8a6ac172["AgentEngine"] {
  <<boundary>>
}
click N_649b8a6ac172 href "../../rules/types.ts"
N_f68f9fd17f74 ..> N_995f04f45e9f : 依赖
N_649b8a6ac172 <|.. N_f68f9fd17f74
```

外部继承／实现边界：[AgentEngine](../../rules/types.ts)。

[上层设计](../ARCHITECTURE.md)

<!-- architecture:generated:end -->
