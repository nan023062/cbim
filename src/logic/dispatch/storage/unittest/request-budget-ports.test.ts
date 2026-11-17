// logic/dispatch/storage: module-owned contract coverage; keep the original scenario and cleanup semantics.
import {expect,it,vi} from 'vitest';
import {requestBudgetStore} from '../request-budget-store';
import type {DispatchStore,DispatchState} from '../../rules/dispatch-storage';
import type {RequestBudgetState,RequestBudgetStore} from '../../../budget/rules/model-request-budget-storage';
import {ModelRequestBudgetService} from '../../../budget/runtime/model-request-budget-service';
import type {ResolvedLlm} from '../../../models/index';

it('预算投影只在原事务中读取，隔离其它领域及嵌套状态，不能夹带跨域提交',async()=>{
  const state:DispatchState={workspaceId:'w',members:[],sessions:[],graphs:[],outbox:[],scopes:[{workspaceId:'w',rootSessionId:'root',scopeId:'scope',status:'active',createdAt:'2026-11-11T00:00:00Z',runTracking:{version:1,mainRunIds:['run']},budget:{version:1,policy:{revision:1,enabled:true,enforcement:'request',limits:{tokens:200}}}}]};
  const read=vi.fn(async()=>state),commands:unknown[]=[],writes:unknown[]=[],store:Pick<DispatchStore,'Read'|'Transact'>={Read: read,Transact:async(command,prepare)=>{commands.push(command);const result=await prepare(state);writes.push(result);return result.receipt}};
  const port=requestBudgetStore(store),view=await port.ReadBudget();expect(Object.keys(view)).toEqual(['scopes']);expect(Object.keys(view.scopes![0])).toEqual(['workspaceId','rootSessionId','scopeId','budget','runTracking']);
  expect(view.scopes![0].budget).toEqual({policy:state.scopes![0].budget!.policy});
  view.scopes![0].runTracking!.mainRunIds.push('forged');expect(state.scopes![0].runTracking!.mainRunIds).toEqual(['run']);
  const command={commandId:'original',fingerprint:'original-hash'},receipt={accepted:true};
  state.scopes![0].budget!.policy.limits.tokens=300;
  expect(await port.TransactBudget(command,async current=>{expect(current.scopes![0].budget!.policy.limits.tokens).toBe(300);return {modelRequestBudgetChanges:[],receipt}})).toBe(receipt);
  expect(read).toHaveBeenCalledTimes(1);expect(commands).toEqual([command]);expect(writes).toEqual([{modelRequestBudgetChanges:[],receipt}]);
  await expect(port.TransactBudget(command,async()=>({modelRequestBudgetChanges:[],receipt,scopes:[]}))).rejects.toThrow('不能提交其它领域');expect(writes).toHaveLength(1);
});
