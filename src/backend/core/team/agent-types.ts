/**
 * 作用定位：虚拟成员的角色配置、持久化实例及独立会话身份，供调度和存储共同使用。
 * 设计原因：角色知识与运行实例分开；类型不引用调度或平台实现，避免共享身份造成反向依赖。
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
/** 持久化成员身份；正常重启不更换 agentInstanceId，运行接管另增租约代际。 */
export interface AgentInstance extends AgentIdentity {
  agentInstanceId:string;
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
  nativeSessionId?:string;
  lastTaskId?:string;
  lastRunId?:string;
}
