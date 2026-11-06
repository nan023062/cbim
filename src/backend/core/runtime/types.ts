/**
 * 作用定位：定义应用级人员、任务与运行消耗的只读监管契约，供调度索引和桌面桥接共同使用。
 * 设计原因：全局观察不能混淆静态角色、持久化成员、派发任务与旧对话轮次；契约只含身份、状态和计量，不传播知识正文或凭据。
 * 职责边界：监管快照不签发任务、租约、权限或验收；未知用量和工作区不可用必须明确呈现。
 */
import type {RunStatus} from '../brain/types';
import type {RunUsage} from '../brain/usage';
import type {TaskStatus} from '../tasks/graph-types';
import type {AgentActivity} from '../team/agent-types';

/** epoch 由应用级管理器生成；关闭并重新接入工作区后，旧回调不能写入新投影。 */
export type RuntimeAvailability='loading'|'ready'|'closed'|'unavailable';
export interface RuntimeCursor {streamId:string;revision:number}
/** 队列数量只统计待执行用户消息，不把它们冒充已经创建的任务或运行。 */
export interface RuntimeQueueCounts {
  pending:number;paused:number;
  /** 已 claim 的 starting 消息，包括启动新轮次和插入当前轮次；不能再次计算为待领取。 */
  inserting:number;
}
export interface RuntimeIssue {source:string;message:string}
export interface RuntimeWorkspace {
  workspaceId:string;name:string;epoch:number;availability:RuntimeAvailability;
  issues:RuntimeIssue[];queue:RuntimeQueueCounts;
}
/** 持久化实例加当前进程观察状态；恢复的历史 activity 不代表已经持有活动执行租约。 */
export interface RuntimeMember {
  workspaceId:string;teamId:string;agentId:string;agentInstanceId:string;leaseEpoch:number;
  activity:AgentActivity;activityCurrent:boolean;availability:RuntimeAvailability;
  sessionCount:number;activeTaskId?:string;activeRunId?:string;
  waitingTaskIds:string[];communicatingMessageIds:string[];
}
/** 已派发业务任务；runIds 为空表示尚未创建执行轮次。 */
export interface RuntimeDispatchTask {
  source:'dispatch';binding:'instance';workspaceId:string;rootSessionId:string;taskId:string;
  agentId:string;agentInstanceId:string;moduleIds:string[];status:TaskStatus;
  revision:number;planRevision:number;runIds:string[];updatedAt:string;
}
/** 既有 Loop 的任务没有成员实例绑定；禁止按角色名称猜测 agentInstanceId。 */
export interface RuntimeLoopTask {
  source:'loop';binding:'role-only';workspaceId:string;taskId:string;agentId?:string;
  moduleIds:string[];status:RunStatus;runIds:string[];activeRunIds:string[];lastRunId:string;updatedAt:string;
}
export type RuntimeTask=RuntimeDispatchTask|RuntimeLoopTask;
export interface RuntimeRun {
  workspaceId:string;taskId:string;runId:string;agentId?:string;status:RunStatus;
  phase:'working'|'tool'|'waiting'|'stopping'|'settled';
  /** 最近一次改变公开状态的事件序号；流式片段仅推进内部去重序号，不触发界面版本。 */
  lastSeq:number;
  startedAt?:string;updatedAt:string;usage:RunUsage;
}
/** 已报告消费的累计数，不是上下文占用；cost 可为已计价部分，不完整由 costPartial 指明。 */
export interface RuntimeUsage extends RunUsage {
  runCount:number;reportedRuns:number;unreportedRuns:number;unpricedRuns:number;
}
/** 当前活跃运行与各类排队分别计数，避免把任务、轮次、消息叠加成虚假的总负载。 */
export interface RuntimePressure {
  taskInstances:number;memberInstances:number;openWorkspaces:number;unavailableWorkspaces:number;
  activeMembers:number;workingMembers:number;waitingMembers:number;communicatingMembers:number;
  activeRuns:number;queuedDispatchTasks:number;waitingDispatchTasks:number;blockedDispatchTasks:number;
  pendingOutbox:number;queuedConversationMessages:number;pausedConversationMessages:number;insertingConversationMessages:number;
}
export interface RuntimeSnapshot {
  cursor:RuntimeCursor;workspaces:RuntimeWorkspace[];members:RuntimeMember[];
  tasks:RuntimeTask[];runs:RuntimeRun[];pressure:RuntimePressure;usage:RuntimeUsage;
  /** 任一工作区尚未载入、不可用或有诊断时为 false；缺失数据不能当作零负载。 */
  complete:boolean;
}
/** 版本未变化时不复制全局状态；streamId 区分应用重启，不复用旧进程游标。 */
export type RuntimeRead={mode:'noop';cursor:RuntimeCursor}|{mode:'snapshot';cursor:RuntimeCursor;snapshot:RuntimeSnapshot};
