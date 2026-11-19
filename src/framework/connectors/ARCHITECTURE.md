# 外部服务连接器

## 设计意图

描述可连接的外部服务及其身份，供宿主发现、核实和连接。现有协议覆盖插件与资源仓库。

Skill 和 Workflow 承载操作手册及经验流程；ConnectorServer 表达外部办公工具的运行端口。宿主管理进程、账号、连接和适用范围，Agent 调度使用本轮捕获的服务。

## 主要组成

| 组成 | 定位 |
| --- | --- |
| [ConnectorRuntime](runtime.ts) | 按 ID 加载宿主登记的产品工厂，共用实例，按任务获取会话并在结束或部分失败时释放。 |
| [ExclusiveConnector](connector.ts) | 按任务获取和释放同一资源的独占使用权。 |
| [ConcurrentConnector](connector.ts) | 为每个任务打开独立会话，允许同时使用同一资源。 |
| [ConnectorRegistry](registry.ts) | 登记静态服务身份、查询与重复校验。 |
| [ConnectorService](service.ts) | 为 Agent 固定已连接服务器的工具目录，按工具名路由调用。 |
| [ConnectorDefinition](definition.ts) | 描述可连接的外部服务及其身份，供宿主发现、核实和连接。现有协议覆盖插件与资源仓库。 |

<!-- architecture:generated:start -->

## 架构关系

```mermaid
classDiagram
class N_60f0ed0c4416["ConnectorDefinition"] {
  <<type>>
}
click N_60f0ed0c4416 href "definition.ts"
class N_5cfcf07d551b["ConnectorRegistry"]
click N_5cfcf07d551b href "registry.ts"
class N_cafd6f96c05c["ConnectorRuntime"]
click N_cafd6f96c05c href "runtime.ts"
class N_228eec79ddf7["ExclusiveConnector"]
click N_228eec79ddf7 href "connector.ts"
class N_89453caaa7dd["ConcurrentConnector"]
click N_89453caaa7dd href "connector.ts"
class N_b6ec811fb68c["ConnectorService"]
click N_b6ec811fb68c href "service.ts"
N_5cfcf07d551b ..> N_60f0ed0c4416 : 依赖
```

[上层设计](../ARCHITECTURE.md)

<!-- architecture:generated:end -->
