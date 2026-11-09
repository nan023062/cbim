/**
 * 作用定位：定义应用级人员、任务与运行消耗的只读监管契约，供调度索引和桌面桥接共同使用。
 * 设计原因：全局观察不能混淆静态角色、持久化成员、派发任务、目标周期与旧对话轮次；只公开身份、状态和有界原因，不传播完整正文或凭据。
 * 职责边界：监管快照不签发任务、租约、权限或验收；未知用量和工作区不可用必须明确呈现。
 */
import type {RunStatus} from '../brain/types';
import type {RunUsage} from '../brain/usage';
import type {TaskStatus} from '../tasks/graph-types';
import type {AgentActivity} from '../team/agent-types';
import type {MemberRunBinding} from '../brain/member-run';
import type {ConversationAgentBinding} from '../brain/conversation-binding';

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
  /** 新主实例归属的主会话；普通成员及未迁移历史实例缺省，不用角色名补造。 */
  mainRootSessionId?:string;
  /** 执行实例的任务/调度周期归属；主调度实例不带执行周期。 */
  executionScopeId?:string;executionTaskId?:string;
  /** released 只保留历史，不再占当前实例与活跃压力；主实例随会话保留。 */
  lifecycle?:'active'|'released';releasedAt?:string;
  activity:AgentActivity;activityCurrent:boolean;availability:RuntimeAvailability;
  sessionCount:number;activeTaskId?:string;activeRunId?:string;
  /** 真实运行中的主会话通道；不是派发 TaskNode，不占用 activeTaskId 或重复计任务。 */
  activeConversation?:{rootSessionId:string;agentSessionId:string;runId:string};
  waitingTaskIds:string[];communicatingMessageIds:string[];
}
/** 已派发业务任务；runIds 为空表示尚未创建执行轮次。 */
export interface RuntimeDispatchTask {
  source:'dispatch';binding:'instance';workspaceId:string;rootSessionId:string;taskId:string;
  /** 只复制派发节点的真实周期归属；旧节点缺省，不能按最近对话或时间补造。 */
  scopeId?:string;
  agentId:string;agentInstanceId:string;moduleIds:string[];status:TaskStatus;
  revision:number;planRevision:number;runIds:string[];updatedAt:string;
}
/** 对话按真实绑定归属实例；旧记录仍只有角色，禁止按角色名称猜测实例。 */
export type RuntimeLoopTask={
  source:'loop';workspaceId:string;taskId:string;agentId?:string;
  moduleIds:string[];status:RunStatus;runIds:string[];activeRunIds:string[];lastRunId:string;updatedAt:string;
}&({binding:'role-only'}|{binding:'instance';agentInstanceId:string;agentSessionId:string;rootSessionId:string});
export type RuntimeTask=RuntimeDispatchTask|RuntimeLoopTask;
/** 目标周期与模型轮次分开展示；审阅 complete 是申请，只有 closed/outcome 才是已提交的周期结算。 */
export interface RuntimeScope {
  workspaceId:string;rootSessionId:string;scopeId:string;
  status:'active'|'waiting'|'closed';createdAt:string;closedAt?:string;
  outcome?:'completed'|'failed'|'cancelled'|'interrupted';
  /** false 仅表示旧周期没有结构化目标，不能从日志内容补造。 */
  hasGoal:boolean;goalRevision?:number;
  reviewDecision?:'complete'|'replan'|'blocked'|'awaiting_user';
  /** 原因最多 240 个字符；不传播目标正文、验收证据或私有等待检查点。 */
  goalBlocked?:{reason:string};
  wait?:{createdAt:string;reason:string};
  /** 只说明此前真实预算拒绝，不是额度配置、用量证明或新的准入许可。 */
  budgetBlocked?:{reason:'token_limit'|'cost_limit'|'usage_unverifiable'};
}
export interface RuntimeRun {
  workspaceId:string;taskId:string;runId:string;agentId?:string;status:RunStatus;
  /** 来自 run.started 的已核验成员身份；存在时归属派发任务，不再生成重复的 role-only 任务。 */
  memberBinding?:MemberRunBinding;
  /** 主会话自身的实例身份；与 memberBinding 互斥，不代表已派发业务任务。 */
  conversationBinding?:ConversationAgentBinding;
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
  /** taskInstances 保留可观察历史任务数；memberInstances 仅计未释放实例。 */
  taskInstances:number;memberInstances:number;openWorkspaces:number;unavailableWorkspaces:number;
  activeMembers:number;workingMembers:number;waitingMembers:number;communicatingMembers:number;
  activeRuns:number;queuedDispatchTasks:number;waitingDispatchTasks:number;blockedDispatchTasks:number;
  pendingOutbox:number;queuedConversationMessages:number;pausedConversationMessages:number;insertingConversationMessages:number;
}
export interface RuntimeSnapshot {
  cursor:RuntimeCursor;workspaces:RuntimeWorkspace[];members:RuntimeMember[];
  tasks:RuntimeTask[];runs:RuntimeRun[];scopes:RuntimeScope[];pressure:RuntimePressure;usage:RuntimeUsage;
  /** 任一工作区尚未载入、不可用或有诊断时为 false；缺失数据不能当作零负载。 */
  complete:boolean;
}
/** 版本未变化时不复制全局状态；streamId 区分应用重启，不复用旧进程游标。 */
export type RuntimeRead={mode:'noop';cursor:RuntimeCursor}|{mode:'snapshot';cursor:RuntimeCursor;snapshot:RuntimeSnapshot};
