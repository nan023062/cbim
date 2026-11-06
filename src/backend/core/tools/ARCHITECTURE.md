# src/backend/core/tools 架构

## 目录定位

工具 Schema、版本、副作用、调用决策、结构化提问及回执。回执绑定运行身份与输入结果哈希；注册和发现不授予执行权限。

本文描述当前实现。通过分析目录边界后维护的 [源码架构脚本](../../../../scripts/source-architecture.mjs) 同步清单和声明；代码变更时仍须核对职责、关键成员与关系。

## 代码清单

| 文件 | 当前职责 |
| --- | --- |
| [questions.ts](questions.ts) | 结构化用户问题的 Schema 和待答快照。 |
| [receipts.ts](receipts.ts) | 把已核实的工具调用、授权和终态整理为可追溯回执。 |
| [registry.ts](registry.ts) | 内部工具定义、版本和副作用声明、名称查找及参数 Schema 转换。 |
| [types.ts](types.ts) | 引擎无关的工具调用、副作用、策略决策及运行回执契约。 |

## 架构类图

### questions.ts

```mermaid
classDiagram
class N_src_backend_core_tools_questions_ts["questions.ts"] {
  <<module>>
}
class N_src_backend_core_tools_questions_ts_QuestionInput["QuestionInput"] {
  <<type>>

}
N_src_backend_core_tools_questions_ts ..> N_src_backend_core_tools_questions_ts_QuestionInput : 声明
class N_src_backend_core_tools_questions_ts_PendingQuestion["PendingQuestion"] {
  <<interface>>
  +id
  +taskId
}
N_src_backend_core_tools_questions_ts ..> N_src_backend_core_tools_questions_ts_PendingQuestion : 声明
N_src_backend_core_tools_questions_ts_QuestionInput <|-- N_src_backend_core_tools_questions_ts_PendingQuestion
```


### receipts.ts

```mermaid
classDiagram
class N_src_backend_core_tools_receipts_ts["receipts.ts"] {
  <<module>>
  +toolReceipt()
}
```
直接依赖：[../foundation/serialization.ts](../foundation/serialization.ts)、[types.ts](types.ts)。

### registry.ts

```mermaid
classDiagram
class N_src_backend_core_tools_registry_ts["registry.ts"] {
  <<module>>
}
class N_src_backend_core_tools_registry_ts_ToolDefinition["ToolDefinition"] {
  <<interface>>
  +name
  +description
  +inputSchema
  +version
  +effects
  +execute
}
N_src_backend_core_tools_registry_ts ..> N_src_backend_core_tools_registry_ts_ToolDefinition : 声明
class N_src_backend_core_tools_registry_ts_ToolRegistry["ToolRegistry"] {
  -entries
  +tools
  +register()
  +list()
  +resolve()
}
N_src_backend_core_tools_registry_ts ..> N_src_backend_core_tools_registry_ts_ToolRegistry : 声明
```

直接依赖：[../foundation/errors.ts](../foundation/errors.ts)、[types.ts](types.ts)。

### types.ts

```mermaid
classDiagram
class N_src_backend_core_tools_types_ts["types.ts"] {
  <<module>>
}
class N_src_backend_core_tools_types_ts_ToolCall["ToolCall"] {
  <<interface>>
  +id
  +name
  +input
}
N_src_backend_core_tools_types_ts ..> N_src_backend_core_tools_types_ts_ToolCall : 声明
class N_src_backend_core_tools_types_ts_ToolEffect["ToolEffect"] {
  <<type>>

}
N_src_backend_core_tools_types_ts ..> N_src_backend_core_tools_types_ts_ToolEffect : 声明
class N_src_backend_core_tools_types_ts_ToolScope["ToolScope"] {
  <<interface>>
  +kind
  +workspaceId
}
N_src_backend_core_tools_types_ts ..> N_src_backend_core_tools_types_ts_ToolScope : 声明
class N_src_backend_core_tools_types_ts_ToolDecision["ToolDecision"] {
  <<interface>>
  +allow
  +reason
  +effects
  +scope
}
N_src_backend_core_tools_types_ts ..> N_src_backend_core_tools_types_ts_ToolDecision : 声明
```

```mermaid
classDiagram
class N_src_backend_core_tools_types_ts["types.ts"] {
  <<module>>
}
class N_src_backend_core_tools_types_ts_ToolReceipt["ToolReceipt"] {
  <<interface>>
  +version
  +toolCallId
  +toolName
  +workspaceId
  +taskId
  +runId
  +outcome
  +inputHash
  +resultHash
  +effects
  +scope
  +recordedAt
}
N_src_backend_core_tools_types_ts ..> N_src_backend_core_tools_types_ts_ToolReceipt : 声明
```


### 本目录调用边界

```mermaid
classDiagram
class N_src_backend_core_tools_receipts_ts["receipts.ts"] {
  <<module>>
}
class N_src_backend_core_tools_types_ts["types.ts"] {
  <<module>>
}
class N_src_backend_core_tools_registry_ts["registry.ts"] {
  <<module>>
}
N_src_backend_core_tools_receipts_ts ..> N_src_backend_core_tools_types_ts : 导入依赖
N_src_backend_core_tools_registry_ts ..> N_src_backend_core_tools_types_ts : 导入依赖
```


## 子目录导航

无子目录。

[返回上层](../ARCHITECTURE.md)。

每次修改本目录代码，同步维护文件头、关键契约说明及本图。未实现的治理、证据验收和自动编排能力不列入当前类图。
