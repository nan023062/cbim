# src/backend/core/tasks 架构

## 目录定位

任务计划、成员派发图类型及原子存储端口。图校验派发/依赖/等待关系，按游标增量读取；执行计划只产生交付候选，不自动验收。

本文描述当前实现。通过分析目录边界后维护的 [源码架构脚本](../../../../scripts/source-architecture.mjs) 同步清单和声明；代码变更时仍须核对职责、关键成员与关系。

## 代码清单

| 文件 | 当前职责 |
| --- | --- |
| [dispatch-commands.ts](dispatch-commands.ts) | 第一阶段成员注册与主会话派发的命令及回执契约。 |
| [dispatch-storage.ts](dispatch-storage.ts) | 定义工作区成员注册、会话绑定及任务派发的原子持久化端口。 |
| [graph-reducer.ts](graph-reducer.ts) | 把已提交的图事件原子转换为内存投影，并按游标输出增量读取结果。 |
| [graph-rules.ts](graph-rules.ts) | 任务图的纯领域校验，检查序列化形状、身份、派发父关系及依赖/等待无环。 |
| [graph-types.ts](graph-types.ts) | 任务派发图的可序列化领域契约，供调度、持久化和 Bridge 共同引用。 |
| [progress-tools.ts](progress-tools.ts) | 内部 Loop 的任务计划、步骤证据和交付工具，状态通过注入的持久化回调保存。 |
| [progress.ts](progress.ts) | 单 Agent 执行计划及交付候选的领域状态，独立于 Pi、磁盘和界面。 |
| [queue.ts](queue.ts) | 待执行用户消息的校验结构与增量同步契约。 |
| [types.ts](types.ts) | 业务目标和冻结上下文的任务定义。 |

## 架构类图

### dispatch-commands.ts

```mermaid
classDiagram
class N_src_backend_core_tasks_dispatch_commands_ts["dispatch-commands.ts"] {
  <<module>>
}
class N_src_backend_core_tasks_dispatch_commands_ts_OpenGraphInput["OpenGraphInput"] {
  <<type>>

}
N_src_backend_core_tasks_dispatch_commands_ts ..> N_src_backend_core_tasks_dispatch_commands_ts_OpenGraphInput : 声明
class N_src_backend_core_tasks_dispatch_commands_ts_CreateMemberInput["CreateMemberInput"] {
  <<type>>

}
N_src_backend_core_tasks_dispatch_commands_ts ..> N_src_backend_core_tasks_dispatch_commands_ts_CreateMemberInput : 声明
class N_src_backend_core_tasks_dispatch_commands_ts_DispatchTaskInput["DispatchTaskInput"] {
  <<type>>

}
N_src_backend_core_tasks_dispatch_commands_ts ..> N_src_backend_core_tasks_dispatch_commands_ts_DispatchTaskInput : 声明
class N_src_backend_core_tasks_dispatch_commands_ts_OpenGraphReceipt["OpenGraphReceipt"] {
  <<interface>>
  +agent
  +cursor
}
N_src_backend_core_tasks_dispatch_commands_ts ..> N_src_backend_core_tasks_dispatch_commands_ts_OpenGraphReceipt : 声明
```

```mermaid
classDiagram
class N_src_backend_core_tasks_dispatch_commands_ts["dispatch-commands.ts"] {
  <<module>>
}
class N_src_backend_core_tasks_dispatch_commands_ts_CreateMemberReceipt["CreateMemberReceipt"] {
  <<interface>>
  +member
  +session
}
N_src_backend_core_tasks_dispatch_commands_ts ..> N_src_backend_core_tasks_dispatch_commands_ts_CreateMemberReceipt : 声明
class N_src_backend_core_tasks_dispatch_commands_ts_external_OpenGraphReceipt["OpenGraphReceipt (外部契约)"] {
  <<external>>
}
N_src_backend_core_tasks_dispatch_commands_ts_external_OpenGraphReceipt <|-- N_src_backend_core_tasks_dispatch_commands_ts_CreateMemberReceipt
class N_src_backend_core_tasks_dispatch_commands_ts_DispatchReceipt["DispatchReceipt"] {
  <<interface>>
  +commandId
  +taskId
  +messageId
  +cursor
  +disposition
}
N_src_backend_core_tasks_dispatch_commands_ts ..> N_src_backend_core_tasks_dispatch_commands_ts_DispatchReceipt : 声明
```

直接依赖：[../team/agent-types.ts](../team/agent-types.ts)、[graph-types.ts](graph-types.ts)。

### dispatch-storage.ts

```mermaid
classDiagram
class N_src_backend_core_tasks_dispatch_storage_ts["dispatch-storage.ts"] {
  <<module>>
}
class N_src_backend_core_tasks_dispatch_storage_ts_AssignmentMessage["AssignmentMessage"] {
  <<interface>>
  +kind
  +messageId
  +commandId
  +identity
  +from
  +to
  +taskId
  +planRevision
  +createdAt
  +delivery
}
N_src_backend_core_tasks_dispatch_storage_ts ..> N_src_backend_core_tasks_dispatch_storage_ts_AssignmentMessage : 声明
class N_src_backend_core_tasks_dispatch_storage_ts_DispatchState["DispatchState"] {
  <<interface>>
  +workspaceId
  +members
  +sessions
  +graphs
  +outbox
}
N_src_backend_core_tasks_dispatch_storage_ts ..> N_src_backend_core_tasks_dispatch_storage_ts_DispatchState : 声明
class N_src_backend_core_tasks_dispatch_storage_ts_DispatchCommand["DispatchCommand"] {
  <<interface>>
  +commandId
  +fingerprint
}
N_src_backend_core_tasks_dispatch_storage_ts ..> N_src_backend_core_tasks_dispatch_storage_ts_DispatchCommand : 声明
class N_src_backend_core_tasks_dispatch_storage_ts_DispatchMutation["DispatchMutation"] {
  <<interface>>
  +members
  +sessions
  +batch
  +messages
  +receipt
}
N_src_backend_core_tasks_dispatch_storage_ts ..> N_src_backend_core_tasks_dispatch_storage_ts_DispatchMutation : 声明
```

```mermaid
classDiagram
class N_src_backend_core_tasks_dispatch_storage_ts["dispatch-storage.ts"] {
  <<module>>
}
class N_src_backend_core_tasks_dispatch_storage_ts_DispatchObserver["DispatchObserver"] {
  <<interface>>
  +loaded()
  +committed()
  +failed()
}
N_src_backend_core_tasks_dispatch_storage_ts ..> N_src_backend_core_tasks_dispatch_storage_ts_DispatchObserver : 声明
class N_src_backend_core_tasks_dispatch_storage_ts_DispatchStore["DispatchStore"] {
  <<interface>>
  +read()
  +transact()
  +snapshot()
  +delta()
  +close()
}
N_src_backend_core_tasks_dispatch_storage_ts ..> N_src_backend_core_tasks_dispatch_storage_ts_DispatchStore : 声明
```

直接依赖：[../team/agent-types.ts](../team/agent-types.ts)、[graph-types.ts](graph-types.ts)。

### graph-reducer.ts

```mermaid
classDiagram
class N_src_backend_core_tasks_graph_reducer_ts["graph-reducer.ts"] {
  <<module>>
}
class N_src_backend_core_tasks_graph_reducer_ts_SeenBatch["SeenBatch"] {
  <<type>>

}
N_src_backend_core_tasks_graph_reducer_ts ..> N_src_backend_core_tasks_graph_reducer_ts_SeenBatch : 声明
```

直接依赖：[../foundation/errors.ts](../foundation/errors.ts)、[graph-rules.ts](graph-rules.ts)、[graph-types.ts](graph-types.ts)。

### graph-rules.ts

```mermaid
classDiagram
class N_src_backend_core_tasks_graph_rules_ts["graph-rules.ts"] {
  <<module>>
  +shape()
  +validateGraphIdentity()
  +validateGraphBatch()
  +assertGraphIdentity()
  +validateGraphCursor()
  +unique()
  +sameMember()
  +acyclic()
  +usableResult()
  +validateGraph()
}
```
直接依赖：[../foundation/errors.ts](../foundation/errors.ts)、[graph-types.ts](graph-types.ts)。

### graph-types.ts

```mermaid
classDiagram
class N_src_backend_core_tasks_graph_types_ts["graph-types.ts"] {
  <<module>>
}
class N_src_backend_core_tasks_graph_types_ts_GraphIdentity["GraphIdentity"] {
  <<type>>

}
N_src_backend_core_tasks_graph_types_ts ..> N_src_backend_core_tasks_graph_types_ts_GraphIdentity : 声明
class N_src_backend_core_tasks_graph_types_ts_AgentRef["AgentRef"] {
  <<type>>

}
N_src_backend_core_tasks_graph_types_ts ..> N_src_backend_core_tasks_graph_types_ts_AgentRef : 声明
class N_src_backend_core_tasks_graph_types_ts_ModuleBinding["ModuleBinding"] {
  <<type>>

}
N_src_backend_core_tasks_graph_types_ts ..> N_src_backend_core_tasks_graph_types_ts_ModuleBinding : 声明
class N_src_backend_core_tasks_graph_types_ts_SessionRootNode["SessionRootNode"] {
  <<type>>

}
N_src_backend_core_tasks_graph_types_ts ..> N_src_backend_core_tasks_graph_types_ts_SessionRootNode : 声明
```

```mermaid
classDiagram
class N_src_backend_core_tasks_graph_types_ts["graph-types.ts"] {
  <<module>>
}
class N_src_backend_core_tasks_graph_types_ts_TaskStatus["TaskStatus"] {
  <<type>>

}
N_src_backend_core_tasks_graph_types_ts ..> N_src_backend_core_tasks_graph_types_ts_TaskStatus : 声明
class N_src_backend_core_tasks_graph_types_ts_TaskNode["TaskNode"] {
  <<type>>

}
N_src_backend_core_tasks_graph_types_ts ..> N_src_backend_core_tasks_graph_types_ts_TaskNode : 声明
class N_src_backend_core_tasks_graph_types_ts_GraphEdge["GraphEdge"] {
  <<type>>

}
N_src_backend_core_tasks_graph_types_ts ..> N_src_backend_core_tasks_graph_types_ts_GraphEdge : 声明
class N_src_backend_core_tasks_graph_types_ts_GraphCursor["GraphCursor"] {
  <<type>>

}
N_src_backend_core_tasks_graph_types_ts ..> N_src_backend_core_tasks_graph_types_ts_GraphCursor : 声明
```

```mermaid
classDiagram
class N_src_backend_core_tasks_graph_types_ts["graph-types.ts"] {
  <<module>>
}
class N_src_backend_core_tasks_graph_types_ts_AgentGraphView["AgentGraphView"] {
  <<type>>

}
N_src_backend_core_tasks_graph_types_ts ..> N_src_backend_core_tasks_graph_types_ts_AgentGraphView : 声明
class N_src_backend_core_tasks_graph_types_ts_GraphChange["GraphChange"] {
  <<type>>

}
N_src_backend_core_tasks_graph_types_ts ..> N_src_backend_core_tasks_graph_types_ts_GraphChange : 声明
class N_src_backend_core_tasks_graph_types_ts_GraphCause["GraphCause"] {
  <<type>>

}
N_src_backend_core_tasks_graph_types_ts ..> N_src_backend_core_tasks_graph_types_ts_GraphCause : 声明
class N_src_backend_core_tasks_graph_types_ts_GraphEventBatch["GraphEventBatch"] {
  <<type>>

}
N_src_backend_core_tasks_graph_types_ts ..> N_src_backend_core_tasks_graph_types_ts_GraphEventBatch : 声明
```

```mermaid
classDiagram
class N_src_backend_core_tasks_graph_types_ts["graph-types.ts"] {
  <<module>>
}
class N_src_backend_core_tasks_graph_types_ts_GraphSnapshot["GraphSnapshot"] {
  <<type>>

}
N_src_backend_core_tasks_graph_types_ts ..> N_src_backend_core_tasks_graph_types_ts_GraphSnapshot : 声明
class N_src_backend_core_tasks_graph_types_ts_GraphDelta["GraphDelta"] {
  <<type>>

}
N_src_backend_core_tasks_graph_types_ts ..> N_src_backend_core_tasks_graph_types_ts_GraphDelta : 声明
```


### progress-tools.ts

```mermaid
classDiagram
class N_src_backend_core_tasks_progress_tools_ts["progress-tools.ts"] {
  <<module>>
}
class N_src_backend_core_tasks_progress_tools_ts_TaskProgressTools["TaskProgressTools"] {
  -save
  +list()
  -state
  -evidence
  +generation
  -tail
  -serial()
  -persist()
  +invalidate()
  +record()
  +call()
}
N_src_backend_core_tasks_progress_tools_ts ..> N_src_backend_core_tasks_progress_tools_ts_TaskProgressTools : 声明
```

直接依赖：[progress.ts](progress.ts)、[../tools/types.ts](../tools/types.ts)、[../tools/results.ts](../tools/results.ts)。

### progress.ts

```mermaid
classDiagram
class N_src_backend_core_tasks_progress_ts["progress.ts"] {
  <<module>>
}
class N_src_backend_core_tasks_progress_ts_TaskStep["TaskStep"] {
  <<interface>>
  +id
  +title
  +owner
  +state
  +evidence
}
N_src_backend_core_tasks_progress_ts ..> N_src_backend_core_tasks_progress_ts_TaskStep : 声明
class N_src_backend_core_tasks_progress_ts_TaskProgress["TaskProgress"] {
  <<interface>>
  +version
  +goal
  +acceptance
  +steps
  +state
  +reason
  +delivery
}
N_src_backend_core_tasks_progress_ts ..> N_src_backend_core_tasks_progress_ts_TaskProgress : 声明
```


### queue.ts

```mermaid
classDiagram
class N_src_backend_core_tasks_queue_ts["queue.ts"] {
  <<module>>
}
class N_src_backend_core_tasks_queue_ts_QueuedMessage["QueuedMessage"] {
  <<type>>

}
N_src_backend_core_tasks_queue_ts ..> N_src_backend_core_tasks_queue_ts_QueuedMessage : 声明
class N_src_backend_core_tasks_queue_ts_QueueCursor["QueueCursor"] {
  <<interface>>
  +epoch
  +revision
  +items
}
N_src_backend_core_tasks_queue_ts ..> N_src_backend_core_tasks_queue_ts_QueueCursor : 声明
class N_src_backend_core_tasks_queue_ts_QueueDelta["QueueDelta"] {
  <<interface>>
  +epoch
  +revision
  +reset
  +order
  +upserts
}
N_src_backend_core_tasks_queue_ts ..> N_src_backend_core_tasks_queue_ts_QueueDelta : 声明
```


### types.ts

```mermaid
classDiagram
class N_src_backend_core_tasks_types_ts["types.ts"] {
  <<module>>
}
class N_src_backend_core_tasks_types_ts_TaskSpec["TaskSpec"] {
  <<interface>>
  +mode
  +taskId
  +workspaceId
  +root
  +goal
  +moduleIds
  +agentId
  +responsiblePerson
  +acceptance
  +workflowContext
}
N_src_backend_core_tasks_types_ts ..> N_src_backend_core_tasks_types_ts_TaskSpec : 声明
```


### 本目录调用边界

```mermaid
classDiagram
class N_src_backend_core_tasks_dispatch_commands_ts["dispatch-commands.ts"] {
  <<module>>
}
class N_src_backend_core_tasks_graph_types_ts["graph-types.ts"] {
  <<module>>
}
class N_src_backend_core_tasks_dispatch_storage_ts["dispatch-storage.ts"] {
  <<module>>
}
class N_src_backend_core_tasks_graph_reducer_ts["graph-reducer.ts"] {
  <<module>>
}
class N_src_backend_core_tasks_graph_rules_ts["graph-rules.ts"] {
  <<module>>
}
N_src_backend_core_tasks_dispatch_commands_ts ..> N_src_backend_core_tasks_graph_types_ts : 导入依赖
N_src_backend_core_tasks_dispatch_storage_ts ..> N_src_backend_core_tasks_graph_types_ts : 导入依赖
N_src_backend_core_tasks_graph_reducer_ts ..> N_src_backend_core_tasks_graph_rules_ts : 导入依赖
N_src_backend_core_tasks_graph_reducer_ts ..> N_src_backend_core_tasks_graph_types_ts : 导入依赖
```

```mermaid
classDiagram
class N_src_backend_core_tasks_graph_rules_ts["graph-rules.ts"] {
  <<module>>
}
class N_src_backend_core_tasks_graph_types_ts["graph-types.ts"] {
  <<module>>
}
class N_src_backend_core_tasks_progress_tools_ts["progress-tools.ts"] {
  <<module>>
}
class N_src_backend_core_tasks_progress_ts["progress.ts"] {
  <<module>>
}
N_src_backend_core_tasks_graph_rules_ts ..> N_src_backend_core_tasks_graph_types_ts : 导入依赖
N_src_backend_core_tasks_progress_tools_ts ..> N_src_backend_core_tasks_progress_ts : 导入依赖
```


## 子目录导航

无子目录。

[返回上层](../ARCHITECTURE.md)。

每次修改本目录代码，同步维护文件头、关键契约说明及本图。未实现的治理、证据验收和自动编排能力不列入当前类图。

## 设计契约 v1 与落地范围

以下内容区分已接通能力与后续设计；以各节的实现状态为准，不将目标图当作现状图。维护源：[CONTRACT.md](CONTRACT.md)；生成类图时同步附加，勿直接修改本附录。

### 任务图节点与事件 v1

状态：已实现图类型、纯结构校验、原子批次投影与游标增量读取；执行状态机、结果交付及运行调度仍按下文契约逐步实现。总说明见 [虚拟成员与任务派发图契约](../../../../docs/agent-dispatch-contract.md)。本模块不拥有进程、磁盘、在线模型或 UI。

### 节点结构

以下 TypeScript 对应 `graph-types.ts` 的公开协议；字段均为可序列化数据，不能直接复用当前兼任会话 ID 的 `TaskSpec.taskId`。

```ts
type GraphIdentity = { workspaceId: string; rootSessionId: string };
type AgentRef = {
  agentId: string; agentInstanceId: string; agentSessionId: string;
  name: string; // 展示快照；身份仍以 ID 为准
};
type ModuleBinding = {
  moduleId: string; name: string;
  knowledgeRevision: string;
  maintenanceBindingId: string; // 已核实维护关系；不能从作者字段自动推断
  maintainerPersonIds: string[]; // 非空，来自真人花名册；不等于已认证登录人
  workflow: { kind: 'module'; id: string; version: string }
          | { kind: 'general'; id: string; version: string; reason: string };
};
type SessionRootNode = {
  kind: 'session-root'; nodeId: string; identity: GraphIdentity;
  agent: AgentRef; revision: number; createdAt: string;
};
type TaskStatus = 'planned' | 'queued' | 'running' | 'waiting'
  | 'result_ready' | 'blocked' | 'failed' | 'cancelled' | 'interrupted';
type TaskNode = {
  kind: 'task'; nodeId: string; taskId: string; identity: GraphIdentity;
  parentTaskId?: string; // 缺省表示从主会话根派发
  requester: AgentRef;
  assignee: AgentRef; // 每个任务恰好一个责任成员
  modules: ModuleBinding[]; // 至少一个；多成员工作拆成多个 Task
  goal: string; acceptance: { id: string; text: string }[];
  revision: number; // 每次节点事实变化递增，用于条件更新
  planRevision: number; // 目标/范围/责任/验收变化才递增
  status: TaskStatus;
  awaitedChildren: { taskId: string; planRevision: number }[];
  // 持久化等待的子任务及计划版本，不产生反向边
  waitReason?: string; // 等待、阻塞或中断的可展示原因
  runIds: string[]; activeRunId?: string;
  result?: {
    resultId: string; runId: string; planRevision: number;
    summary: string; evidenceRefs: string[]; limitations: string[];
    acceptance: 'not_evaluated';
  };
  createdAt: string; updatedAt: string; // UTC ISO 8601，由调度器生成
};
type GraphEdge = {
  edgeId: string; identity: GraphIdentity;
  fromNodeId: string; toNodeId: string;
  revision: number; enabled: boolean;
} & (
  | { kind: 'dispatch' }
  | { kind: 'dependency'; condition: {
      kind: 'result_ready'; planRevision: number;
      resultId?: string; // 放行时固定实际消费的结果，未满足前可缺省
    } }
);
```

`nodeId` 区分根锚点与任务：根为 `session:<rootSessionId>`，任务为 `task:<taskId>`。同 Agent 的多个任务有不同 taskId，但共享该成员实例身份；重试只追加 runId。AgentRef 由调度器从真实成员绑定填入，不允许模型冒充 requester。模块无维护关系时拒绝正式派发，返回缺口；普通对话与定位过程仍可继续。

派发边创建后不移动父节点、不删除历史。依赖边可在任务未运行时用带版本的修订禁用；旧边保留 `enabled:false`。失效结果须清除为当前有效结果，旧结果仍在事件历史中，不可因存在旧 result 字段就满足依赖。

### 图不变量与任务状态

- 每图恰好一个 SessionRootNode，根必须绑定主 Agent；根不是业务任务，也不计入任务完成率。
- 建图以 seq=1 的 graph.created 批次原子提交根和主成员投影；seq=0 只是内部空前缀，公开 Snapshot 始终有根。读取未建图返回 GRAPH_NOT_FOUND。
- 每个任务恰好一条入向 dispatch 边，父节点必须已存在且在同图；边的 parentTaskId 必须与节点字段一致。
- 每个模块的维护关系、Agent 身份及版本在派发前核实；未定位到模块不能伪造节点。Workflow 属于模块，不继承其他模块的流程。
- 启用的 dispatch 与 dependency 边合并检查有向无环；拒绝自环、缺失端点、跨工作区/跨图依赖。dependency 的两端必须是任务，方向为前置 → 后续。
- dependency.condition 固定前置计划版本；允许放行前须固定实际 resultId。v1 只支持有效交付候选作为前置，不宣称该候选已通过业务验收；结果修订使引用失效时必须复核消费方基线。
- 子任务返回通过消息解除 `awaitedChildren`；结果必须匹配所等的 taskId 与 planRevision，修订后的同 ID 结果不能静默唤醒旧计划。父子等待不添加反向 dependency 边，消息也不自动让父任务完成。
- 显示图无环不等于没有等待死锁。另建仅供检查的等待关系：等待方 → 未满足前置，以及父任务 → 正在等待的子任务。派发、登记等待、依赖或计划修订均检查该关系无环；拒绝“A 派 B，B 等 A 的结果，A 又等 B”。该检查图不加入可视化派发边。
- `planned → queued → running`；运行可进入 waiting、result_ready、failed、interrupted，取消须经过实际停止确认后才记 cancelled。
- waiting 在依赖满足且收到恢复调度后回 queued；依赖失败进入 blocked，不能因为收到“回复”就运行。blocked / failed / interrupted 的继续或重试须显式命令及当前版本，未知副作用先核实。
- result_ready 只表示可交接候选，不表示验收通过；新计划修订撤销旧候选的有效性，并重新核验已绑定该结果的下游基线。不能自动重放已经执行过的下游任务。
- 终态节点保留。上游取消不默认回滚磁盘、不隐式取消全部子树；取消范围必须显式给定并逐项追踪。

### 增量协议

```ts
type GraphCursor = GraphIdentity & { streamId: string; seq: number };
type AgentGraphView = {
  agentInstanceId: string; agentId: string; name: string; revision: number;
  state: 'idle' | 'working' | 'waiting' | 'communicating';
  // 状态与任务引用均是当前图局部投影；全局成员状态另走授权接口
  runningTaskId?: string; waitingTaskIds: string[];
};
type GraphChange =
  | { type: 'root.upserted'; root: SessionRootNode }
  | { type: 'task.upserted'; task: TaskNode }
  | { type: 'edge.upserted'; edge: GraphEdge }
  | { type: 'agent.upserted'; agent: AgentGraphView };
type GraphCause = 'graph.created' | 'task.created' | 'task.dispatched'
  | 'task.started' | 'task.waiting' | 'task.result_ready' | 'task.blocked'
  | 'task.failed' | 'task.cancelled' | 'task.interrupted' | 'task.revised'
  | 'task.reconciled' | 'dependency.changed' | 'message.accepted'
  | 'message.processed' | 'agent.state_changed';
type GraphEventBatch = {
  version: 1; identity: GraphIdentity; streamId: string; seq: number;
  eventId: string; commandId: string; cause: GraphCause;
  committedAt: string; changes: GraphChange[];
};
type GraphSnapshot = {
  version: 1; identity: GraphIdentity; cursor: GraphCursor;
  root: SessionRootNode; tasks: TaskNode[]; edges: GraphEdge[];
  agents: AgentGraphView[];
};
type GraphDelta =
  | { mode: 'noop'; cursor: GraphCursor }
  | { mode: 'delta'; from: GraphCursor; cursor: GraphCursor;
      batches: GraphEventBatch[]; hasMore: boolean }
  | { mode: 'reset'; reason: 'initial' | 'stream_changed' | 'cursor_ahead'
      | 'history_compacted'; snapshot: GraphSnapshot; cursor: GraphCursor };
```

seq 是**原子提交批次**的序号，从 1 开始连续；一次派发中的节点、边、成员状态在同一批次展示，不能拆开应用。changes 只包含变化对象，但 upsert 携带对象完整新快照，避免部分字段清空或乱序补丁产生歧义。同一批次同一对象最多一次 upsert；所有端点允许在本批次一起创建，按整个批次验证，不逐条暂时判缺失。

streamId 正常重启不变；只有明确重建或不兼容迁移才换流。重复 eventId / seq 不重复应用，断档先补读，不跳过；同 seq 不同内容是损坏或协议错误，不能当重复忽略。seq 和 revision 必须是非负安全整数；首节点 revision=1。

GraphDelta 不包含私有推理、模型凭据、完整工具正文、绝对文件路径或其他会话消息；evidenceRefs 指向需单独授权读取的记录。无变化只返回 noop，不重读全图或替换前端对象引用。成员状态按本图事实依 working > communicating > waiting > idle 投影，不能用本图 idle 声称成员在全工作区空闲。

### 目标结构类图（待实现，独立于上方当前代码图）

```mermaid
classDiagram
class SessionRootNode {
  identity
  agent
}
class TaskNode {
  taskId
  assignee
  modules
  goal
  status
  planRevision
}
class GraphEdge {
  kind
  fromNodeId
  toNodeId
  condition
}
class GraphEventBatch {
  seq
  commandId
  changes
}
class GraphSnapshot {
  cursor
  tasks
  edges
  agents
}
class GraphDelta {
  mode
  cursor
}
SessionRootNode --> TaskNode : 派发锚点
GraphEdge --> TaskNode : 连接任务
GraphEventBatch --> TaskNode : 更新快照
GraphSnapshot o-- TaskNode : 投影
GraphSnapshot o-- GraphEdge : 投影
GraphDelta --> GraphEventBatch : 连续批次
GraphDelta --> GraphSnapshot : reset
```

已新增 `graph-types.ts`（公开契约）、`graph-reducer.ts`（原子投影与增量读取）、`graph-rules.ts`（结构、DAG 与等待约束）。这些纯函数不签发权限、不运行 Agent、不自行把候选变成验收通过。内存投影保留已验证批次的重放证明，重复批次返回原对象；单独反序列化 Snapshot 后没有历史证明时拒绝旧批次，持久化从日志重放可重建证明。执行与恢复的行为测试仍需随对应服务接入。
