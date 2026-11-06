/**
 * 作用定位：任务派发图的可序列化领域契约，供调度、持久化和 Bridge 共同引用。
 * 设计原因：把会话、成员、任务与执行轮次分开，避免现有聊天 taskId 被误当成业务派工身份。
 * 职责边界：这里只声明事实形状；权限、知识核实、磁盘提交和模型执行由各自服务负责。
 */
export type GraphIdentity = {workspaceId:string;rootSessionId:string};
export type AgentRef = {
  agentId:string;agentInstanceId:string;agentSessionId:string;
  /** 名称是显示快照，不可代替成员身份。 */
  name:string;
};
export type ModuleBinding = {
  moduleId:string;name:string;knowledgeRevision:string;
  /** 指向显式维护关系；不能从作者列表推断。 */
  maintenanceBindingId:string;maintainerPersonIds:string[];
  workflow:{kind:'module';id:string;version:string}
    |{kind:'general';id:string;version:string;reason:string};
};
export type SessionRootNode = {
  kind:'session-root';nodeId:string;identity:GraphIdentity;
  agent:AgentRef;revision:number;createdAt:string;
};
export type TaskStatus = 'planned'|'queued'|'running'|'waiting'|'result_ready'
  |'blocked'|'failed'|'cancelled'|'interrupted';
export type TaskNode = {
  kind:'task';nodeId:string;taskId:string;identity:GraphIdentity;
  /** 可信主调度周期；旧显式派发可缺省，创建后不可更换。 */
  scopeId?:string;
  /** 缺省表示主会话根派发；创建后不能迁移父节点。 */
  parentTaskId?:string;
  requester:AgentRef;assignee:AgentRef;modules:ModuleBinding[];
  goal:string;acceptance:{id:string;text:string}[];
  /** revision 跟踪所有节点变化，planRevision 仅跟踪目标、范围、责任和验收变化。 */
  revision:number;planRevision:number;status:TaskStatus;
  awaitedChildren:{taskId:string;planRevision:number}[];
  waitReason?:string;runIds:string[];activeRunId?:string;
  result?:{
    resultId:string;runId:string;planRevision:number;summary:string;
    evidenceRefs:string[];limitations:string[];acceptance:'not_evaluated';
  };
  /** 时间均为可信后端生成的 UTC ISO 8601 字符串。 */
  createdAt:string;updatedAt:string;
};
export type GraphEdge = {
  edgeId:string;identity:GraphIdentity;fromNodeId:string;toNodeId:string;
  revision:number;enabled:boolean;
} & ({kind:'dispatch'}|{kind:'dependency';condition:{
  kind:'result_ready';planRevision:number;
  /** 依赖放行时固定实际消费结果；尚未满足时可缺省。 */
  resultId?:string;
}});
export type GraphCursor = GraphIdentity & {streamId:string;seq:number};
/** 当前图内的成员活动投影，不代表该成员在所有会话中的全局状态。 */
export type AgentGraphView = {
  agentInstanceId:string;agentId:string;name:string;revision:number;
  state:'idle'|'working'|'waiting'|'communicating';
  runningTaskId?:string;waitingTaskIds:string[];
};
export type GraphChange =
  |{type:'root.upserted';root:SessionRootNode}
  |{type:'task.upserted';task:TaskNode}
  |{type:'edge.upserted';edge:GraphEdge}
  |{type:'agent.upserted';agent:AgentGraphView};
export type GraphCause = 'graph.created'|'task.created'|'task.dispatched'
  |'task.started'|'task.waiting'|'task.result_ready'|'task.blocked'|'task.failed'
  |'task.cancelled'|'task.interrupted'|'task.revised'|'task.reconciled'
  |'dependency.changed'|'message.accepted'|'message.processed'|'agent.state_changed';
/** 一次可靠提交的原子批次；changes 只包含变化对象的完整新快照。 */
export type GraphEventBatch = {
  version:1;identity:GraphIdentity;streamId:string;seq:number;
  eventId:string;commandId:string;cause:GraphCause;committedAt:string;
  changes:GraphChange[];
};
export type GraphSnapshot = {
  version:1;identity:GraphIdentity;cursor:GraphCursor;
  root:SessionRootNode;tasks:TaskNode[];edges:GraphEdge[];agents:AgentGraphView[];
};
/** cursor 指向已经完整返回的位置；delta 不拆批，reset 不改变图身份。 */
export type GraphDelta =
  |{mode:'noop';cursor:GraphCursor}
  |{mode:'delta';from:GraphCursor;cursor:GraphCursor;batches:GraphEventBatch[];hasMore:boolean}
  |{mode:'reset';reason:'initial'|'stream_changed'|'cursor_ahead'|'history_compacted';snapshot:GraphSnapshot;cursor:GraphCursor};
