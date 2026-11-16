# src/logic/execution/engines/memory 架构

本目录只维护这一份说明。设计与契约直接编辑本文；文件清单、类图和导航由 [架构脚本](../../../../../scripts/source-architecture.mjs) 更新，生成区域之外的人工说明会保留。

## 封装意图

官方自定义记忆 Loop：生成/向量双模型、受控知识工具、八回合限额与无进展中断；私有会话先同步，未知历史拒绝重放，派生向量缓存按完整代际隔离。

## 类与模块的设计意图

下表依据源码声明及文件头说明定位封装。字段表示该实例持有的状态或协作引用，不表示它拥有被引用服务的生命周期；实际资源责任和调用限制见下文契约及源码注释。

| 类／模块 | 实现形式与实例字段 | 封装依据 |
| --- | --- | --- |
| [MemoryEngine](engine.ts) | 实例类；持有 `kind`、`context`、`session`、`tools`、`catalog`、`controller`、`work`、`timer`、`fatal`、`requests`、`cache`、`options` | 模型决定、权限审批、工具回执、索引更新顺序执行；失败和重复动作立即收口，限制八次决定及总执行时间。 |
| [package.ts](package.ts) | 函数／契约模块 | 验证开发者定义的领域 Loop 也可经统一协议独立构建、安装与调度，冷壳无需认识本实现。 |
| [protocol.ts](protocol.ts) | 函数／契约模块 | 只接纳完整单结果、单工具调用，截断、额外调用和未知工具不能变成可执行动作；私有推理不持久化。 |
| [MemorySession](storage.ts) | 实例类；持有 `bytes`、`messages`、`id`、`file`、`root` | 每轮独占现有宿主租约保护的会话；不修复尾行、不截断旧历史，也不重放其中的调用。 |
| [MemoryIndexCache](storage.ts) | 实例类；持有 `home` | 完整缓存以不可变 key 单独存储；缺失才生成，损坏直接报告，不自行删除或循环下载/重建。 |

## 接口设计契约

<a id="contract"></a>

<a id="contract-记忆领域-loop"></a>

### 记忆领域 Loop

本包导出协议 1、版本 1.1.0 的 memory 工厂，无第三方 Agent SDK。primary 必须是 OpenAI Chat 兼容的生成模型；embedding 为必填向量角色，使用独立连接、维度、输入容量与价格。编译时声明随包保存，加载先核对主协议与必填角色，不将新声明应用到不同旧包。兼容表示允许选型，实际模型的工具调用和向量质量必须另行验证。当前只接受文本，不提供原生文件/命令、图片或用户插入。

`start` 捕获可信工具目录、准备私有会话并持久化 session.bound，不发送模型请求。`run` 每实例仅一次：经 beforeTool 读取完整知识 → 按来源和向量模型形成索引 → 查询向量/带出处检索 → 至多八次生成决定。每次最多一个工具，所有工具先持久化授权后调用，再持久化回执；重复相同模型工具请求、任何失败或未知结果立即停止，不重试也不重启任务。系统转交反馈不当成新增用户授权。模型正文在可靠用量结算后才进入消息或工具决定。

真实生成完成与工具事件续期无进展计时器，此外本轮有 30 分钟总上限；JSON 响应中尚未解析的网络字节不被当作已完成的模型工作。停止中止实际模型请求和工具端口，关闭等待请求及事件收口。上限不是运行器的自动重启信号。

正式知识只经 CBIM 原有工具修改，保留权限、revision、预览/提交与幂等回执。摘要要求引用来源并默认保留原文；删除/覆盖依用户明确目标及原授权，不新增隐含授权。知识写入已返回后，重新读取并生成新代向量索引；失败报告“知识写入工具已返回，向量索引尚未同步”，保留原工具 ID、知识事实及预算未知状态，不再执行原提交。

`agentHome/sessions/<nativeId>.jsonl` 保存 CBIM 版本 1 会话头和追加消息，头绑定 engine/id/工作区/任务/根目录；每条 fsync 后才继续。1 MiB 上限、完整尾行、原生路径与消息/工具/回合顺序逐项核实。只有完整结束的历史可恢复；未完成或损坏的历史明确拒绝，需要核实后开启新上下文，不修复后自动续跑。成员恢复还调用原冻结证明复核；统一原生指纹读取器按静态目录的 nativeHistoryFormat 核验。

`agentHome/memory-index/<key>.json` 仅存派生向量；来源原文始终来自本轮授权快照。key 绑定完整来源版本、模型公开配置、维度和分块策略。完整新代通过维度/数量/数值校验、同步临时文件后原子切换；旧代保留，缺失才生成，损坏不静默删除重建。每代最多 128 个 768 字符片段，缓存 16 MiB；输入还按 UTF-8 字节做保守容量保护，真实 token 用量仍以供应商报告为准。大规模分块、缓存清理、历史压缩迁移和跨包自动恢复不在首版实现中。

本地完整应用测试使用真实知识事务、实际 HTTP 与预算账本，但供应商返回由隔离测试服务生成；它证明契约及失败行为，不证明某个外部模型的质量或认证可用。包构建和冷壳字节隔离已有回归；尚未公开发布或安装到用户生产数据。

适配包版本为 1.1.1；本次递归预算契约改变了包内代码，必须使用新版本身份。固定依赖、旧包缓存和原生会话身份核验继续生效，不覆盖公开 1.1.0 制品。


<a id="contract-共享算法调用边界"></a>

#### 共享算法调用边界

本目录通过 Core 公开入口调用 `JsonUtils.OrderJsonValue`、`JsonUtils.ParseStrictJson`。静态类只承载原算法；本目录继续决定字段、比较器、错误映射及资源生命周期。函数改为静态方法不改变原持久化字节或失败语义。

## 开闭边界

本目录的职责及允许协作由[封装意图](#封装意图)限定，输入输出、状态与失败语义以[接口设计契约](#接口设计契约)为准。扩展从已有公开入口及实际装配位置进入；没有明确可替换契约的部分按真实影响修改和验证，不预建未使用的基类或插件入口。

<!-- architecture:generated:start -->

## 文件清单

| 文件 | 形式 | 当前职责 |
| --- | --- | --- |
| [ARCHITECTURE.md](ARCHITECTURE.md) | 说明文档 | 本目录的文件清单、真实声明、依赖与子封装导航。 |
| [engine.ts](engine.ts) | 源码模块 | 官方记忆领域 Agent Loop，使用生成和 embedding 双模型管理受控知识，不依赖厂商 Agent SDK。 |
| [package.ts](package.ts) | 源码模块 | CBIM 自定义记忆引擎的独立官方包入口，运行库与适配器同版，无外部 Agent SDK。 |
| [protocol.ts](protocol.ts) | 源码模块 | 记忆 Loop 的模型结果与私有对话消息协议，隔离供应商 JSON 与可执行工具决定。 |
| [storage.ts](storage.ts) | 源码模块 | 记忆包的私有会话及派生向量缓存；正式知识只能经注入工具访问。 |

## 架构类图

成员标记：`+` 公开、`-` 私有、`#` 受保护、`$` 静态；构造函数单独列出。文档和资源仅在文件清单中导航，不作为代码节点。

### engine.ts

成员 1/2（同名节点为同一声明，跨图合并阅读）。

```mermaid
classDiagram
class N_src_logic_execution_engines_memory_engine_ts["engine.ts"] {
  <<module>>
}
class N_src_logic_execution_engines_memory_engine_ts_MemoryEngine["MemoryEngine"] {
  +kind
  +constructor()
  +start()
  +run()
  +stop()
  +close()
  -options
  -context
  -session
  -tools
  -catalog
  -controller
  -work
  -timer
  -fatal
  -requests
}
N_src_logic_execution_engines_memory_engine_ts ..> N_src_logic_execution_engines_memory_engine_ts_MemoryEngine : 声明
class N_src_logic_execution_engines_memory_engine_ts_external_AgentEngine["AgentEngine (../../rules/types)"] {
  <<boundary>>
}
N_src_logic_execution_engines_memory_engine_ts_external_AgentEngine <|.. N_src_logic_execution_engines_memory_engine_ts_MemoryEngine
```

成员 2/2（同名节点为同一声明，跨图合并阅读）。

```mermaid
classDiagram
class N_src_logic_execution_engines_memory_engine_ts["engine.ts"] {
  <<module>>
}
class N_src_logic_execution_engines_memory_engine_ts_MemoryEngine["MemoryEngine"] {
  -cache
  -Execute()
  -Invoke()
  -RefreshIndex()
  -Emit()
}
N_src_logic_execution_engines_memory_engine_ts ..> N_src_logic_execution_engines_memory_engine_ts_MemoryEngine : 声明
class N_src_logic_execution_engines_memory_engine_ts_external_AgentEngine["AgentEngine (../../rules/types)"] {
  <<boundary>>
}
N_src_logic_execution_engines_memory_engine_ts_external_AgentEngine <|.. N_src_logic_execution_engines_memory_engine_ts_MemoryEngine
```

继承／实现来源：`AgentEngine` → [../../rules/types.ts](../../rules/types.ts)。
直接依赖：[../../../../core/utility/index.ts](../../../../core/utility/index.ts)、[../../../budget/rules/model-request-configuration.ts](../../../budget/rules/model-request-configuration.ts)、[protocol.ts](protocol.ts)、[storage.ts](storage.ts)、[../run-inactivity.ts](../run-inactivity.ts)、[../transport/model-json-requests.ts](../transport/model-json-requests.ts)、[../../rules/engine-adapter.ts](../../rules/engine-adapter.ts)、[../../rules/engine-instructions.ts](../../rules/engine-instructions.ts)、[../../rules/engine-tools.ts](../../rules/engine-tools.ts)、[../../rules/types.ts](../../rules/types.ts)、[../../../knowledge/rules/memory-index.ts](../../../knowledge/rules/memory-index.ts)、[../../../tools/rules/outcome.ts](../../../tools/rules/outcome.ts)、[../../../tools/rules/results.ts](../../../tools/rules/results.ts)。

### package.ts

```mermaid
classDiagram
class N_src_logic_execution_engines_memory_package_ts["package.ts"] {
  <<module>>
}
```
直接依赖：[../../../engines/index.ts](../../../engines/index.ts)、[engine.ts](engine.ts)、[../../rules/engine-adapter.ts](../../rules/engine-adapter.ts)。

### protocol.ts

```mermaid
classDiagram
class N_src_logic_execution_engines_memory_protocol_ts["protocol.ts"] {
  <<module>>
  +memoryDecision()
  +memoryVectors()
}
```

```mermaid
classDiagram
class N_src_logic_execution_engines_memory_protocol_ts["protocol.ts"] {
  <<module>>
}
class N_src_logic_execution_engines_memory_protocol_ts_MemoryMessage["MemoryMessage"] {
  <<type>>

}
N_src_logic_execution_engines_memory_protocol_ts ..> N_src_logic_execution_engines_memory_protocol_ts_MemoryMessage : 声明
```

直接依赖：[../../../../core/utility/index.ts](../../../../core/utility/index.ts)。

### storage.ts

```mermaid
classDiagram
class N_src_logic_execution_engines_memory_storage_ts["storage.ts"] {
  <<module>>
}
class N_src_logic_execution_engines_memory_storage_ts_MemorySession["MemorySession"] {
  +id
  +file
  +messages
  +Open()$
  +Append()
  -root
  -bytes
  -constructor()
}
N_src_logic_execution_engines_memory_storage_ts ..> N_src_logic_execution_engines_memory_storage_ts_MemorySession : 声明
class N_src_logic_execution_engines_memory_storage_ts_MemoryIndexCache["MemoryIndexCache"] {
  +constructor()
  +Load()
  +Save()
  -home
}
N_src_logic_execution_engines_memory_storage_ts ..> N_src_logic_execution_engines_memory_storage_ts_MemoryIndexCache : 声明
```

直接依赖：[../../../../core/platform/node/files/index.ts](../../../../core/platform/node/files/index.ts)、[protocol.ts](protocol.ts)、[../../ports/identity.ts](../../ports/identity.ts)、[../../rules/types.ts](../../rules/types.ts)、[../../../knowledge/rules/memory-index.ts](../../../knowledge/rules/memory-index.ts)。

### 本目录调用边界

```mermaid
classDiagram
class N_src_logic_execution_engines_memory_engine_ts["engine.ts"] {
  <<module>>
}
class N_src_logic_execution_engines_memory_protocol_ts["protocol.ts"] {
  <<module>>
}
class N_src_logic_execution_engines_memory_storage_ts["storage.ts"] {
  <<module>>
}
class N_src_logic_execution_engines_memory_package_ts["package.ts"] {
  <<module>>
}
N_src_logic_execution_engines_memory_engine_ts ..> N_src_logic_execution_engines_memory_protocol_ts : 导入依赖
N_src_logic_execution_engines_memory_engine_ts ..> N_src_logic_execution_engines_memory_storage_ts : 导入依赖
N_src_logic_execution_engines_memory_package_ts ..> N_src_logic_execution_engines_memory_engine_ts : 导入依赖
N_src_logic_execution_engines_memory_storage_ts ..> N_src_logic_execution_engines_memory_protocol_ts : 导入依赖
```


## 子目录导航

无子目录。

[返回上层](../ARCHITECTURE.md)。

每次修改本目录代码，同步维护文件头、关键契约说明及本图。未实现的治理、证据验收和自动编排能力不列入当前类图。

<!-- architecture:generated:end -->
