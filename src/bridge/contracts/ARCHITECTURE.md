# src/bridge/contracts 架构

## 目录定位

可序列化的 IPC 数据与公开展示契约。可以重导出 Core 类型及纯格式化函数，不暴露密钥或平台存储实现。

本文描述当前实现。通过分析目录边界后维护的 [源码架构脚本](../../../scripts/source-architecture.mjs) 同步清单和声明；代码变更时仍须核对职责、关键成员与关系。

## 代码清单

| 文件 | 当前职责 |
| --- | --- |
| [chat.ts](chat.ts) | 对话附件、执行权限和待审批请求的跨进程契约。 |
| [execution.ts](execution.ts) | 对话、运行和排队在 IPC 中传递的可序列化类型。 |
| [models.ts](models.ts) | 模型配置界面消费的公开模型信息与停止原因格式化。 |
| [resources.ts](resources.ts) | 资源种类、仓库快照、登录占位及仓库状态的共享类型。 |
| [workspace.ts](workspace.ts) | 跨进程工作区、知识事务、MCP 与 IPC 数据契约。 |

## 架构类图

### chat.ts

```mermaid
classDiagram
class N_src_bridge_contracts_chat_ts["chat.ts"] {
  <<module>>
}
class N_src_bridge_contracts_chat_ts_ChatAttachment["ChatAttachment"] {
  <<interface>>
  +id
  +kind
  +name
  +source
  +note
}
N_src_bridge_contracts_chat_ts ..> N_src_bridge_contracts_chat_ts_ChatAttachment : 声明
```

直接依赖：[../../backend/core/brain/types.ts](../../backend/core/brain/types.ts)。

### execution.ts

```mermaid
classDiagram
class N_src_bridge_contracts_execution_ts["execution.ts"] {
  <<module>>
}
```
直接依赖：[../../backend/core/brain/types.ts](../../backend/core/brain/types.ts)、[../../backend/core/tasks/types.ts](../../backend/core/tasks/types.ts)、[../../backend/core/tasks/queue.ts](../../backend/core/tasks/queue.ts)、[../../backend/core/tools/questions.ts](../../backend/core/tools/questions.ts)。

### models.ts

```mermaid
classDiagram
class N_src_bridge_contracts_models_ts["models.ts"] {
  <<module>>
}
```
直接依赖：[../../backend/core/brain/llm/config.ts](../../backend/core/brain/llm/config.ts)、[../../backend/core/brain/llm/catalog.ts](../../backend/core/brain/llm/catalog.ts)、[../../backend/core/brain/model-errors.ts](../../backend/core/brain/model-errors.ts)。

### resources.ts

```mermaid
classDiagram
class N_src_bridge_contracts_resources_ts["resources.ts"] {
  <<module>>
}
class N_src_bridge_contracts_resources_ts_ResourceKind["ResourceKind"] {
  <<type>>

}
N_src_bridge_contracts_resources_ts ..> N_src_bridge_contracts_resources_ts_ResourceKind : 声明
class N_src_bridge_contracts_resources_ts_ResourceCategory["ResourceCategory"] {
  <<type>>

}
N_src_bridge_contracts_resources_ts ..> N_src_bridge_contracts_resources_ts_ResourceCategory : 声明
class N_src_bridge_contracts_resources_ts_ResourceDefinition["ResourceDefinition"] {
  <<interface>>
  +id
  +kind
  +name
  +summary
  +content
  +updatedAt
}
N_src_bridge_contracts_resources_ts ..> N_src_bridge_contracts_resources_ts_ResourceDefinition : 声明
class N_src_bridge_contracts_resources_ts_ResourceLibrarySnapshot["ResourceLibrarySnapshot"] {
  <<interface>>
  +repositoryId
  +revision
  +items
}
N_src_bridge_contracts_resources_ts ..> N_src_bridge_contracts_resources_ts_ResourceLibrarySnapshot : 声明
```

```mermaid
classDiagram
class N_src_bridge_contracts_resources_ts["resources.ts"] {
  <<module>>
}
class N_src_bridge_contracts_resources_ts_RepositoryConfig["RepositoryConfig"] {
  <<type>>

}
N_src_bridge_contracts_resources_ts ..> N_src_bridge_contracts_resources_ts_RepositoryConfig : 声明
class N_src_bridge_contracts_resources_ts_RepositorySession["RepositorySession"] {
  <<type>>

}
N_src_bridge_contracts_resources_ts ..> N_src_bridge_contracts_resources_ts_RepositorySession : 声明
class N_src_bridge_contracts_resources_ts_RepositoryStatus["RepositoryStatus"] {
  <<interface>>
  +session
  +source
  +config
  +error
  +sharing
}
N_src_bridge_contracts_resources_ts ..> N_src_bridge_contracts_resources_ts_RepositoryStatus : 声明
```


### workspace.ts

```mermaid
classDiagram
class N_src_bridge_contracts_workspace_ts["workspace.ts"] {
  <<module>>
}
class N_src_bridge_contracts_workspace_ts_WorkspaceEntry["WorkspaceEntry"] {
  <<interface>>
  +id
  +path
  +name
  +lastOpened
  +previousIds
}
N_src_bridge_contracts_workspace_ts ..> N_src_bridge_contracts_workspace_ts_WorkspaceEntry : 声明
class N_src_bridge_contracts_workspace_ts_McpCallLog["McpCallLog"] {
  <<interface>>
  +id
  +time
  +workspaceId
  +instanceId
  +httpMethod
  +method
  +tool
  +status
  +result
  +code
  +message
  +durationMs
  +receivedBytes
  +sentBytes
}
N_src_bridge_contracts_workspace_ts ..> N_src_bridge_contracts_workspace_ts_McpCallLog : 声明
class N_src_bridge_contracts_workspace_ts_Catalog["Catalog"] {
  <<interface>>
  +version
  +entries
  +recent
}
N_src_bridge_contracts_workspace_ts ..> N_src_bridge_contracts_workspace_ts_Catalog : 声明
class N_src_bridge_contracts_workspace_ts_McpStatus["McpStatus"] {
  <<interface>>
  +health
  +instanceId
  +startedAt
  +checkedAt
  +latencyMs
  +error
  +requests
  +errors
  +inFlight
  +receivedBytes
  +sentBytes
  +receiveRate
  +sendRate
  +lastActivityAt
}
N_src_bridge_contracts_workspace_ts ..> N_src_bridge_contracts_workspace_ts_McpStatus : 声明
```

```mermaid
classDiagram
class N_src_bridge_contracts_workspace_ts["workspace.ts"] {
  <<module>>
}
class N_src_bridge_contracts_workspace_ts_WorkspaceView["WorkspaceView"] {
  <<interface>>
  +state
  +error
  +hostConfigWarnings
  +writable
  +tasks
  +revision
  +changed
  +instanceId
  +mcp
  +knowledgeErrors
}
N_src_bridge_contracts_workspace_ts ..> N_src_bridge_contracts_workspace_ts_WorkspaceView : 声明
class N_src_bridge_contracts_workspace_ts_external_WorkspaceEntry["WorkspaceEntry (外部契约)"] {
  <<external>>
}
N_src_bridge_contracts_workspace_ts_external_WorkspaceEntry <|-- N_src_bridge_contracts_workspace_ts_WorkspaceView
class N_src_bridge_contracts_workspace_ts_Bridge["Bridge"] {
  <<interface>>
  +call()
  +importFiles()
}
N_src_bridge_contracts_workspace_ts ..> N_src_bridge_contracts_workspace_ts_Bridge : 声明
```

直接依赖：[../../backend/core/knowledge/types.ts](../../backend/core/knowledge/types.ts)、[chat.ts](chat.ts)。

### 本目录调用边界

```mermaid
classDiagram
class N_src_bridge_contracts_workspace_ts["workspace.ts"] {
  <<module>>
}
class N_src_bridge_contracts_chat_ts["chat.ts"] {
  <<module>>
}
N_src_bridge_contracts_workspace_ts ..> N_src_bridge_contracts_chat_ts : 导入依赖
```


## 子目录导航

无子目录。

[返回上层](../ARCHITECTURE.md)。

每次修改本目录代码，同步维护文件头、关键契约说明及本图。未实现的治理、证据验收和自动编排能力不列入当前类图。
