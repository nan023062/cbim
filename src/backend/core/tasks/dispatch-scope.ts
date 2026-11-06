/**
 * 作用定位：定义一次用户任务的调度周期，与长期主会话和单次模型运行区分。
 * 设计原因：一次目标可以经历多轮调度、执行和结果回注；周期结束释放执行实例，但保留图和证据，不在每次 LLM 回合结束时销毁成员。
 */
export type DispatchScopeOutcome='completed'|'failed'|'cancelled'|'interrupted';
/** scopeId 由可信主调度入口创建，不从模型参数读取；closed 是生命周期结束，不代表业务已验收。 */
export interface DispatchScope {
  scopeId:string;
  workspaceId:string;
  rootSessionId:string;
  status:'active'|'closed';
  createdAt:string;
  closedAt?:string;
  outcome?:DispatchScopeOutcome;
}
