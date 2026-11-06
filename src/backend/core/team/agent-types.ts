/**
 * 作用定位：虚拟成员的角色配置、持久化实例及独立会话身份，供调度和存储共同使用。
 * 设计原因：主调度实例随主会话保留，执行实例按调度周期中的单个任务创建并在周期结束释放；历史身份与原生记录保留用于审计。
 */
/** 角色属于工作区 Team；内置主角色与自定义角色使用相同身份模型。 */
export interface AgentIdentity {workspaceId:string;teamId:string;agentId:string}
/** 固定知识版本的配置，不包含凭据、会话正文或运行期授权。 */
export interface AgentConfigurationSnapshot extends AgentIdentity {
  knowledgeRevision:string;
  name:string;
  source:'builtin'|'workspace';
  principles:string;
  effectiveSkills:Array<{skillId:string;ownerId:string;inherited:boolean;content:string}>;
}
/** 成员活动摘要；排队任务尚未执行，不能因此宣称 working。 */
export type AgentActivity='idle'|'working'|'waiting'|'communicating';
/** 历史身份不可改写；主实例跨周期保留，执行实例随周期释放，新任务创建新实例，接管另增租约代际。 */
export interface AgentInstance extends AgentIdentity {
  agentInstanceId:string;
  /** cbim:main 新实例固定所属主会话；旧记录缺省表示历史共享实例，不据此迁移旧图。自定义角色不使用此字段。 */
  mainRootSessionId?:string;
  /** 新执行实例固定所属调度周期和任务；旧无周期成员保留历史兼容，不能据此复用到新周期。 */
  executionScopeId?:string;
  executionTaskId?:string;
  /** released 表示运行对象已释放，历史记录仍在；缺省为旧登记实例。 */
  lifecycle?:'active'|'released';
  releasedAt?:string;
  /** 非负安全整数，由实例管理器维护，不能由模型签发。 */
  leaseEpoch:number;
  configurationRevision:string;
  agentSessionIds:string[];
  activity:AgentActivity;
  activeTaskId?:string;
  activeRunId?:string;
  waitingTaskIds:string[];
  communicatingMessageIds:string[];
}
/** 原生会话属于明确的成员及主会话；不使用最近一次会话猜测归属。 */
export interface AgentSessionBinding extends AgentIdentity {
  agentInstanceId:string;
  agentSessionId:string;
  rootSessionId:string;
  /** 缺省为历史 task 通道；conversation 只承载主对话，不能与正式任务共享原生会话。用途创建后不可改绑。 */
  purpose?:'task'|'conversation';
  nativeSessionId?:string;
  lastTaskId?:string;
  lastRunId?:string;
}
