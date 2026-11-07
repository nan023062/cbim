# src/backend/core/tools 架构

## 目录定位

工具 Schema、版本、副作用、调用决策、结构化提问及回执；统一校验结果的 JSON 传输快照，拒绝缺失文本等无效内容。回执绑定运行身份与输入结果哈希；注册和发现不授予执行权限。

本文描述当前实现。通过分析目录边界后维护的 [源码架构脚本](../../../../scripts/source-architecture.mjs) 同步清单和声明；代码变更时仍须核对职责、关键成员与关系。

## 代码清单

| 文件 | 当前职责 |
| --- | --- |
| [contracts.ts](contracts.ts) | 工具取消、恢复说明及按需契约发现的纯协议，不导入具体领域或执行服务。 |
| [native-tools.ts](native-tools.ts) | 定义当前引擎真实装配的原生工具及可信副作用分类。 |
| [questions.ts](questions.ts) | 结构化用户问题的 Schema 和待答快照。 |
| [receipts.ts](receipts.ts) | 把已核实的工具调用、授权和终态整理为可追溯回执。 |
| [registry.ts](registry.ts) | 实际内部工具的输入/业务输出协议、版本、副作用及取消/恢复说明，支持摘要与按需完整描述。 |
| [results.ts](results.ts) | 校验内部工具传给大脑的结果，并将领域返回值封装为合法文本块。 |
| [scope-schema.ts](scope-schema.ts) | 工具回执与可信授权描述共用的纯范围协议，区分项目文件、知识、未知影响和外部仓库读取。 |
| [types.ts](types.ts) | 引擎无关的工具调用、副作用、策略决策及运行回执契约。 |

## 架构类图

### contracts.ts

```mermaid
classDiagram
class N_src_backend_core_tools_contracts_ts["contracts.ts"] {
  <<module>>
}
class N_src_backend_core_tools_contracts_ts_ToolCancellation["ToolCancellation"] {
  <<type>>

}
N_src_backend_core_tools_contracts_ts ..> N_src_backend_core_tools_contracts_ts_ToolCancellation : 声明
class N_src_backend_core_tools_contracts_ts_ToolRecovery["ToolRecovery"] {
  <<type>>

}
N_src_backend_core_tools_contracts_ts ..> N_src_backend_core_tools_contracts_ts_ToolRecovery : 声明
class N_src_backend_core_tools_contracts_ts_KnowledgeToolCatalog["KnowledgeToolCatalog"] {
  <<type>>

}
N_src_backend_core_tools_contracts_ts ..> N_src_backend_core_tools_contracts_ts_KnowledgeToolCatalog : 声明
class N_src_backend_core_tools_contracts_ts_KnowledgeToolDescription["KnowledgeToolDescription"] {
  <<type>>

}
N_src_backend_core_tools_contracts_ts ..> N_src_backend_core_tools_contracts_ts_KnowledgeToolDescription : 声明
```


### native-tools.ts

```mermaid
classDiagram
class N_src_backend_core_tools_native_tools_ts["native-tools.ts"] {
  <<module>>
  +nativeToolDescriptor()
  +nativeToolNames()
}
```

直接依赖：[../policy/tool-policy.ts](../policy/tool-policy.ts)。

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
  +outputSchema
  +version
  +effects
  +cancellation
  +recovery
  +execute
}
N_src_backend_core_tools_registry_ts ..> N_src_backend_core_tools_registry_ts_ToolDefinition : 声明
class N_src_backend_core_tools_registry_ts_ToolRegistry["ToolRegistry"] {
  +tools
  +register()
  +list()
  +catalog()
  +describe()
  +resolve()
  +invokeResolved()
  -entries
  -summary()
  -entry()
}
N_src_backend_core_tools_registry_ts ..> N_src_backend_core_tools_registry_ts_ToolRegistry : 声明
```

直接依赖：[../foundation/errors.ts](../foundation/errors.ts)、[types.ts](types.ts)、[results.ts](results.ts)、[contracts.ts](contracts.ts)。

### results.ts

```mermaid
classDiagram
class N_src_backend_core_tools_results_ts["results.ts"] {
  <<module>>
  +jsonToolResult()
  +checkedJsonToolResult()
  +validateToolResult()
}
```

```mermaid
classDiagram
class N_src_backend_core_tools_results_ts["results.ts"] {
  <<module>>
}
class N_src_backend_core_tools_results_ts_ToolResultContent["ToolResultContent"] {
  <<type>>

}
N_src_backend_core_tools_results_ts ..> N_src_backend_core_tools_results_ts_ToolResultContent : 声明
class N_src_backend_core_tools_results_ts_ToolResult["ToolResult"] {
  <<interface>>
  +content
  +isError
  +details
}
N_src_backend_core_tools_results_ts ..> N_src_backend_core_tools_results_ts_ToolResult : 声明
```

直接依赖：[../foundation/errors.ts](../foundation/errors.ts)。

### scope-schema.ts

```mermaid
classDiagram
class N_src_backend_core_tools_scope_schema_ts["scope-schema.ts"] {
  <<module>>
}
class N_src_backend_core_tools_scope_schema_ts_RepositoryToolScope["RepositoryToolScope"] {
  <<type>>

}
N_src_backend_core_tools_scope_schema_ts ..> N_src_backend_core_tools_scope_schema_ts_RepositoryToolScope : 声明
class N_src_backend_core_tools_scope_schema_ts_ToolScope["ToolScope"] {
  <<type>>

}
N_src_backend_core_tools_scope_schema_ts ..> N_src_backend_core_tools_scope_schema_ts_ToolScope : 声明
```

直接依赖：[../connectors/definition.ts](../connectors/definition.ts)。

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
class N_src_backend_core_tools_types_ts_ToolDecision["ToolDecision"] {
  <<interface>>
  +allow
  +reason
  +effects
  +scope
}
N_src_backend_core_tools_types_ts ..> N_src_backend_core_tools_types_ts_ToolDecision : 声明
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

直接依赖：[scope-schema.ts](scope-schema.ts)。

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
class N_src_backend_core_tools_results_ts["results.ts"] {
  <<module>>
}
class N_src_backend_core_tools_contracts_ts["contracts.ts"] {
  <<module>>
}
N_src_backend_core_tools_receipts_ts ..> N_src_backend_core_tools_types_ts : 导入依赖
N_src_backend_core_tools_registry_ts ..> N_src_backend_core_tools_types_ts : 导入依赖
N_src_backend_core_tools_registry_ts ..> N_src_backend_core_tools_results_ts : 导入依赖
N_src_backend_core_tools_registry_ts ..> N_src_backend_core_tools_contracts_ts : 导入依赖
```

```mermaid
classDiagram
class N_src_backend_core_tools_types_ts["types.ts"] {
  <<module>>
}
class N_src_backend_core_tools_scope_schema_ts["scope-schema.ts"] {
  <<module>>
}
N_src_backend_core_tools_types_ts ..> N_src_backend_core_tools_scope_schema_ts : 导入依赖
```


## 子目录导航

无子目录。

[返回上层](../ARCHITECTURE.md)。

每次修改本目录代码，同步维护文件头、关键契约说明及本图。未实现的治理、证据验收和自动编排能力不列入当前类图。

## 设计契约 v1 与落地范围

以下内容区分已接通能力与后续设计；以各节的实现状态为准，不将目标图当作现状图。维护源：[CONTRACT.md](CONTRACT.md)；生成类图时同步附加，勿直接修改本附录。

### 当前工具结果边界

`results.ts` 是内部工具结果的共同协议边界。`jsonToolResult` 将明确的领域值编码为文本块，拒绝 `undefined`、循环对象和不可序列化值；显式 `null` 可以正常返回。

知识注册工具通过 `checkedJsonToolResult` 验证业务输出：领域 `execute` 只调用一次，原值只进行一次 JSON 序列化；用该编码的独立解析副本执行输出 Schema 校验，并与未交给校验器的原快照作结构比较。Zod 裁剪、默认值、类型转换、原地修改或增加 `undefined` 字段都不能补成成功；对象键顺序不改变 JSON 事实。通过后直接发送原编码文本，不重新编码领域值或 Schema 结果，因此 `toJSON` 不能在验证后偷偷改变发送内容。

业务输出失败为 `TOOL_OUTPUT_INVALID`，错误仅提供掩去动态键的结构位置和校验类别，不包含输出正文、凭据或原始异常。它明确表示操作可能已发生，要求核实既有记录、不自动重试；不会撤销事务、返还单次批准或再调用领域操作。合法的 `invalid`、`not_found`、校验问题和已提交清理警告由各领域 Schema 保留，不被转换为执行成功或回滚。

`validateToolResult` 校验实际 JSON 传输快照：`content` 必须为数组；文本块必须有字符串 `text`；图片块必须有非空 `data` 和图片 `mimeType`；可选 `isError` 必须为布尔值。校验失败抛出 `TOOL_RESULT_INVALID`，错误不携带原始返回内容。

知识适配器在返回时校验，Pi 执行桥在结果进入原生会话前再次校验。桥将失败转为带错误码的合法工具错误，已消费的单次授权不因结果错误而恢复，也不重放可能已发生副作用的操作。有效的结果结构不代表业务成功，业务状态和验收仍由对应领域负责。

```mermaid
classDiagram
class ResultsModule["results.ts"] {
  <<module>>
  +jsonToolResult(name, value)
  +checkedJsonToolResult(name, value, schema)
  +validateToolResult(name, value)
}
class KnowledgeTools {
  <<scheduler boundary>>
}
class PiBridge {
  <<brain boundary>>
}
KnowledgeTools ..> ResultsModule : 封装与返回校验
PiBridge ..> ResultsModule : 进入会话前校验
```

历史会话修复属于显式维护，不在模型调用或结果校验中静默修改旧记录。

### 实际注册表与按需发现

`ToolRegistry` 只登记合法 `cbim_` 名称，并强制声明正整数版本、副作用、输出 Schema、取消语义和恢复说明。解析输入与执行分离；只有本注册表实际解析出的定义可以调用 `invokeResolved`，不能借同名外来对象执行。`list` 保持引擎需要的紧凑输入清单；`catalog/describe` 仅查询该知识注册表，不能执行工具或凭元数据授权。

`contracts.ts` 保存取消/恢复和发现输出的纯协议。知识目录返回 `family:knowledge` 与实际名称、可选描述、版本、副作用；详情按名称返回有限输入/输出 JSON Schema 和取消/恢复说明。自描述通过有限 Schema 引用表达，不递归嵌套整个注册表，不公开 `execute`、凭据、原生工具或派发工具。原始定义/人员诊断允许保留任意 JSON 事实（包括自有 `__proto__` 键），不裁剪成看似合格的业务对象。
### 原生工具的单一可信分类

`native-tools.ts` 保存当前引擎实际支持的原生工具描述，供 Pi 注册、正式成员能力预检、授权分类和 Workflow canonical 评价共用。`nativeToolDescriptor` 返回独立描述，未知名称及对象继承属性不属于注册工具；`nativeToolNames(false)` 只包含只读工具。

表中 read/grep/find/ls 属于 read，write/edit 属于 business-write，bash 属于 command。该清单不发放权限、不执行工具、不决定路径是否可访问；路径守卫、ask 审批与工作区身份仍由策略执行。任务评价只能核对实际成功调用，不能凭名称声明业务验证或完整文件覆盖。

### 工具范围与外部资料身份

`scope-schema.ts` 是授权策略、工具回执和证据解析共用的纯范围协议。原 workspace/knowledge/unknown 分支保留 `{kind,workspaceId}` 形状；repository 分支严格保存 workspaceId、connectorId、repositoryId、connectionId 与 list/get 操作，不接受 URL、凭据或调用方声明的授权。仓库身份来自本轮可信捕获描述，不从模型输入直接创建能力。

成功的 repository read 表示所绑定仓库操作收到真实回执，不能降格为 workspace read，也不能冒充本地文件、任务交付或成员检查点的证据。共享解析保留这种身份供主运行历史与 canonical 核实；下游业务证据仍分别检查来源边界。
