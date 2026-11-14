/**
 * 目录归属：logic/dispatch/storage；唯一调度日志及预算适配。
 * 作用定位：将工作区唯一 DispatchStore 适配为请求预算专用的两项读写能力。
 * 设计原因：投影和预留都发生在原串行事务内部，不先读余额再独立扣减；明确投影字段与提交字段，避免结构类型或额外属性把其他领域状态传给预算服务。
 */
import type {DispatchStore,DispatchState} from '../rules/dispatch-storage';
import type {RequestBudgetStore,RequestBudgetState} from '../../budget/rules/model-request-budget-storage';

function budgetState(state:DispatchState):RequestBudgetState {
  return structuredClone({
    ...(state.scopes?{scopes:state.scopes.map(({workspaceId,rootSessionId,scopeId,budget,runTracking})=>({workspaceId,rootSessionId,scopeId,...(budget?{budget:{policy:budget.policy}}:{}),...(runTracking?{runTracking:{mainRunIds:runTracking.mainRunIds}}:{})}))}:{}),
    ...(state.modelRequestBudgetChanges?{modelRequestBudgetChanges:state.modelRequestBudgetChanges}:{}),
  });
}

/** 不获取新锁或另建日志；原 Store 负责幂等、预算不变量、可靠落盘和恢复。 */
export function requestBudgetStore(store:Pick<DispatchStore,'read'|'transact'>):RequestBudgetStore {
  return {
    readBudget:async()=>budgetState(await store.read()),
    transactBudget:(command,prepare)=>store.transact(command,async state=>{
      const proposed=await prepare(budgetState(state));
      if(Reflect.ownKeys(proposed).some(key=>key!=='modelRequestBudgetChanges'&&key!=='receipt'))throw Error('请求预算端口不能提交其它领域变更');
      return {modelRequestBudgetChanges:proposed.modelRequestBudgetChanges,receipt:proposed.receipt};
    }),
  };
}
