/**
 * fallbackBinding 与 ownerBinding 表达不同执行来源；前者不产生长期岗位、模块责任或维护人。
 * 任务检查点按段只追加，旧预约进入独立历史，当前预约仍保留原字段以兼容单段记录。
 * 作用定位：任务派发图的可序列化领域契约，供调度、持久化和 Bridge 共同引用。
 * 设计原因：把登记岗位、执行实例、任务与轮次分开；前置增删永久保留原请求和审计，不改变原计划、负责人或执行事实。
 * 职责边界：这里只声明事实形状；权限、知识核实、磁盘提交和模型执行由各自服务负责。
 */
import {type AutomaticExecutionBinding} from '../team/automatic-execution';
import type {MemberHelpRecord} from './member-help';
import type {QueuedTaskCancellation} from './queued-task-cancel';
import type {DependencyReplacement} from './queued-dependency-replacement';
import type {DependencyAddition} from './queued-dependency-addition';
import type {DependencyRevision} from './queued-dependency-revision';
import type {MemberCheckpointRecord} from './member-checkpoint';
import type {MemberResumeRequest} from './queued-member-resume';
import type {CheckpointAbandonment} from './checkpoint-handoff';
import type {WorkflowSelection} from './workflow-selection';
import type {OwnerExecutionBinding} from '../team/member-execution-binding';
export type GraphIdentity = {workspaceId:string;rootSessionId:string};
export type AgentRef = {
  agentId:string;agentInstanceId:string;agentSessionId:string;
  /** 名称是显示快照，不可代替成员身份。 */
  name:string;
};
export type ModuleBinding = {
  moduleId:string;name:string;knowledgeRevision:string;
  /** 真实模块指向显式维护关系；仅自动隐式模块使用 cbim:implicit-project 和空清单，不表示人工确认。 */
  maintenanceBindingId:string;maintainerPersonIds:string[];
  workflow:{kind:'module';id:string;version:string}
    |{kind:'general';id:string;version:string;reason:string};
};
export type SessionRootNode = {
  kind:'session-root';nodeId:string;identity:GraphIdentity;
  agent:AgentRef;revision:number;createdAt:string;
};
export type TaskStatus = 'planned'|'queued'|'running'|'waiting'|'result_ready'
  |'blocked'|'failed'|'cancelled'|'interrupted'|'checkpointed';
export type TaskNode = {
  kind:'task';nodeId:string;taskId:string;identity:GraphIdentity;
  /** 可信主调度周期；旧显式派发可缺省，创建后不可更换。 */
  scopeId?:string;
  /** 缺省表示主会话根派发；创建后不能迁移父节点。 */
  parentTaskId?:string;
  requester:AgentRef;assignee:AgentRef;modules:ModuleBinding[];
  /** 创建时的显式流程选择；缺省沿旧默认模式，不代表可任意换选，已有任务不可改写。 */
  workflowSelections?:WorkflowSelection[];
  /** 真实派发时冻结的岗位与责任；旧记录缺省不补造，创建后不得换人或更新配置。 */
  ownerBinding?:OwnerExecutionBinding;
  /** 自动模式独立兜底身份，不是登记岗位或人工确认。 */
  fallbackBinding?:AutomaticExecutionBinding;
  goal:string;acceptance:{id:string;text:string}[];
  /** revision 跟踪所有节点变化，planRevision 仅跟踪目标、范围、责任和验收变化。 */
  revision:number;planRevision:number;status:TaskStatus;
  awaitedChildren:{taskId:string;planRevision:number}[];
  waitReason?:string;runIds:string[];activeRunId?:string;
  result?:{
    resultId:string;runId:string;planRevision:number;summary:string;
    evidenceRefs:string[];limitations:string[];acceptance:'not_evaluated';
  };
  /** 正常结束后可靠交接的求助；任务保持 blocked，主调度须创建新任务，不可恢复此运行。 */
  help?:MemberHelpRecord;
  /** 按同任务运行顺序只追加的可靠检查点；每段保持原事实，关闭不改写为成功或求助。 */
  checkpoints?:MemberCheckpointRecord[];
  /** 最新显式预约的不可变值；再次预约时原值移入 resumeHistory，存在不表示已经领取。 */
  resumeRequest?:MemberResumeRequest;
  /** 最新预约之前的不可变顺序历史；只在第二次预约起存在，不替换或重复最新 resumeRequest。 */
  resumeHistory?:MemberResumeRequest[];
  /** 主调度明确终止未消费检查点的历史；只撤销原待办，不改变岗位或产生新结果。 */
  checkpointAbandonment?:CheckpointAbandonment;
  /** 仅主调度明确撤销且从未领取的任务存在；普通运行停止或周期关闭不补造此记录。 */
  cancelledBeforeStart?:QueuedTaskCancellation;
  /** 主调度显式换入真实前置候选的历史；只追加，不改变本任务计划或把旧来源标为成功。 */
  dependencyReplacements?:DependencyReplacement[];
  /** 未领取时明确追加的前置；不预填来源结果，后续领取与替换保留此不可变历史。 */
  dependencyAdditions?:DependencyAddition[];
  /** 未领取时的多边原子增删；原计划与信封保留，审计不得改删或跨目标使用。 */
  dependencyRevisions?:DependencyRevision[];
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
  |'task.checkpointed'|'task.resume_requested'
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
