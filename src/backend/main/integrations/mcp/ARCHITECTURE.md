# src/backend/main/integrations/mcp 架构

## 目录定位

可选 MCP 发布、发现、鉴权、调用日志及心跳。复用调度知识工具适配，不维护领域规则副本。

本文描述当前实现。通过分析目录边界后维护的 [源码架构脚本](../../../../../scripts/source-architecture.mjs) 同步清单和声明；代码变更时仍须核对职责、关键成员与关系。

## 代码清单

| 文件 | 当前职责 |
| --- | --- |
| [discovery.ts](discovery.ts) | 校验发现文件、凭据与实际 MCP 实例，建立绑定指定工作区的连接。 |
| [mcp-log.ts](mcp-log.ts) | McpCallLogs：每工作区独立的有界调用日志与落盘队列。 |
| [mcp-status.ts](mcp-status.ts) | McpMonitor：维护健康、请求、错误、耗时及上下行统计快照。 |
| [mcp-trace.ts](mcp-trace.ts) | 将 HTTP/MCP 请求与响应接入调用日志和流量统计。 |
| [mcp.ts](mcp.ts) | 将内部知识服务发布为 MCP，处理传输鉴权、调用日志与心跳。 |

## 架构类图

### discovery.ts

```mermaid
classDiagram
class N_src_backend_main_integrations_mcp_discovery_ts["discovery.ts"] {
  <<module>>
  +connectWorkspace()
}
```
直接依赖：[../../platform/paths.ts](../../platform/paths.ts)、[../../../core/foundation/files.ts](../../../core/foundation/files.ts)、[../../../core/foundation/errors.ts](../../../core/foundation/errors.ts)。

### mcp-log.ts

```mermaid
classDiagram
class N_src_backend_main_integrations_mcp_mcp_log_ts["mcp-log.ts"] {
  <<module>>
}
class N_src_backend_main_integrations_mcp_mcp_log_ts_McpCallLogs["McpCallLogs"] {
  +file
  +workspaceId
  -maxBytes
  -entries
  -queue
  -pending
  +error
  +init()
  +add()
  +view()
  +flush()
}
N_src_backend_main_integrations_mcp_mcp_log_ts ..> N_src_backend_main_integrations_mcp_mcp_log_ts_McpCallLogs : 声明
```

直接依赖：[../../../../bridge/contracts/workspace.ts](../../../../bridge/contracts/workspace.ts)。

### mcp-status.ts

```mermaid
classDiagram
class N_src_backend_main_integrations_mcp_mcp_status_ts["mcp-status.ts"] {
  <<module>>
}
class N_src_backend_main_integrations_mcp_mcp_status_ts_McpMonitor["McpMonitor"] {
  -now
  -samples
  -value
  +start()
  +finish()
  +bytes()
  -activity()
  -prune()
  +checked()
  +stopped()
  +view()
}
N_src_backend_main_integrations_mcp_mcp_status_ts ..> N_src_backend_main_integrations_mcp_mcp_status_ts_McpMonitor : 声明
```

直接依赖：[../../../../bridge/contracts/workspace.ts](../../../../bridge/contracts/workspace.ts)。

### mcp-trace.ts

```mermaid
classDiagram
class N_src_backend_main_integrations_mcp_mcp_trace_ts["mcp-trace.ts"] {
  <<module>>
  +traceMcp()
}
```
直接依赖：[../../workspace/workspace.ts](../../workspace/workspace.ts)。

### mcp.ts

```mermaid
classDiagram
class N_src_backend_main_integrations_mcp_mcp_ts["mcp.ts"] {
  <<module>>
  +serve()
}
```
直接依赖：[../../workspace/workspace.ts](../../workspace/workspace.ts)、[../../../core/foundation/errors.ts](../../../core/foundation/errors.ts)、[mcp-trace.ts](mcp-trace.ts)、[../../../scheduler-engine/tools/knowledge-tools.ts](../../../scheduler-engine/tools/knowledge-tools.ts)。

### 本目录调用边界

```mermaid
classDiagram
class N_src_backend_main_integrations_mcp_mcp_ts["mcp.ts"] {
  <<module>>
}
class N_src_backend_main_integrations_mcp_mcp_trace_ts["mcp-trace.ts"] {
  <<module>>
}
N_src_backend_main_integrations_mcp_mcp_ts ..> N_src_backend_main_integrations_mcp_mcp_trace_ts : 导入依赖
```


## 子目录导航

无子目录。

[返回上层](../ARCHITECTURE.md)。

每次修改本目录代码，同步维护文件头、关键契约说明及本图。未实现的治理、证据验收和自动编排能力不列入当前类图。
