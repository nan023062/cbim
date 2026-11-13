/**
 * 目录归属：logic/budget/rules/budget；请求与周期预算规则。
 * 作用定位：模型请求账本独有的读视图、提交单元与准入端口。
 * 设计原因：请求预留只需要冻结周期预算和原请求记录，不应获得岗位、任务图、邮箱或其它领域的写权限；实现仍在原串行事务内投影视图和提交。
 */
import type {ScopeBudgetPolicy} from './scope-budget';
import type {ModelRequestBudgetChange,RequestBudgetModel} from './model-request-budget';

/** 只观察周期身份、预算和真实主运行绑定，不暴露目标、等待、成员或交付状态。 */
export interface RequestBudgetScope {workspaceId:string;rootSessionId:string;scopeId:string;budget?:{policy:ScopeBudgetPolicy};runTracking?:{mainRunIds:string[]}}
export interface RequestBudgetState {scopes?:RequestBudgetScope[];modelRequestBudgetChanges?:ModelRequestBudgetChange[]}
export interface RequestBudgetMutation<T> {modelRequestBudgetChanges:ModelRequestBudgetChange[];receipt:T}
/** 命令身份与幂等摘要由调用方按原请求产生；同一键重放须返回原回执而不再次执行 prepare。 */
export interface RequestBudgetStore {
  readBudget():Promise<RequestBudgetState>;
  transactBudget<T>(command:{commandId:string;fingerprint:string},prepare:(state:RequestBudgetState)=>Promise<RequestBudgetMutation<T>>):Promise<T>;
}
/** 只核实可信主运行占位与请求额度，不授予启动、改写周期或补造历史的能力。 */
export interface RequestBudgetAdmission {
  isMainLive(runId:string):boolean;
  preflightRequest(state:RequestBudgetState,scope:RequestBudgetScope,model:Pick<RequestBudgetModel,'contextWindow'|'maxTokens'|'pricing'>):void;
}
