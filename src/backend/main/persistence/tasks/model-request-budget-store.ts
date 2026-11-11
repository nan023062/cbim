/**
 * 作用定位：将预算专用端口适配到工作区唯一 DispatchStore，供 Main 装配请求预算服务。
 * 设计原因：在稳定事务机制外收窄业务能力；预算服务不能读取邮箱或提交任务、成员、周期变更。
 * 职责边界：预留决定仍在原串行事务内执行；命令重放、落盘、跨领域不变量和关闭权保留在原 Store。
 */
import type {DispatchState,DispatchStore} from '../../../core/tasks/dispatch-storage';
import type {ModelRequestBudgetStore,ModelRequestBudgetView} from '../../../core/tasks/model-request-budget-storage';
import {requestBudgetCommand,requestBudgetReceipt} from '../../../core/tasks/model-request-budget-rules';

/** 复制显式白名单字段，既不把全状态交给消费者，也不让消费者修改事务前态。 */
function budgetView(state:DispatchState):ModelRequestBudgetView {
  return structuredClone({scopes:state.scopes??[],modelRequestBudgetChanges:state.modelRequestBudgetChanges??[]});
}

/** 借用已打开的 Store；返回端口没有关闭、任意 mutation 或原始事务查询能力。 */
export function modelRequestBudgetStore(store:DispatchStore):ModelRequestBudgetStore {
  return {
    read:async()=>budgetView(await store.read()),
    transact:(initial,prepare)=>store.transact(requestBudgetCommand(initial),async state=>{
      const change=await prepare(budgetView(state));
      return {modelRequestBudgetChanges:[change],receipt:requestBudgetReceipt(change)};
    }),
  };
}
