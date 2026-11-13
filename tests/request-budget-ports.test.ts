import {expect,it,vi} from 'vitest';
import {requestBudgetStore} from '../src/backend/main/dispatch-storage/request-budget-store';
import type {DispatchStore,DispatchState} from '../src/logic/dispatch/rules/dispatch-storage';
import type {RequestBudgetState,RequestBudgetStore} from '../src/logic/budget/rules/model-request-budget-storage';
import {ModelRequestBudgetService} from '../src/backend/scheduler-engine/budget/model-request-budget-service';
import type {ResolvedLlm} from '../src/logic/models';

it('预算投影只在原事务中读取，隔离其它领域及嵌套状态，不能夹带跨域提交',async()=>{
  const state:DispatchState={workspaceId:'w',members:[],sessions:[],graphs:[],outbox:[],scopes:[{workspaceId:'w',rootSessionId:'root',scopeId:'scope',status:'active',createdAt:'2026-11-11T00:00:00Z',runTracking:{version:1,mainRunIds:['run']},budget:{version:1,policy:{revision:1,enabled:true,enforcement:'request',limits:{tokens:200}}}}]};
  const read=vi.fn(async()=>state),commands:unknown[]=[],writes:unknown[]=[],store:Pick<DispatchStore,'read'|'transact'>={read,transact:async(command,prepare)=>{commands.push(command);const result=await prepare(state);writes.push(result);return result.receipt}};
  const port=requestBudgetStore(store),view=await port.readBudget();expect(Object.keys(view)).toEqual(['scopes']);expect(Object.keys(view.scopes![0])).toEqual(['workspaceId','rootSessionId','scopeId','budget','runTracking']);
  expect(view.scopes![0].budget).toEqual({policy:state.scopes![0].budget!.policy});
  view.scopes![0].runTracking!.mainRunIds.push('forged');expect(state.scopes![0].runTracking!.mainRunIds).toEqual(['run']);
  const command={commandId:'original',fingerprint:'original-hash'},receipt={accepted:true};
  state.scopes![0].budget!.policy.limits.tokens=300;
  expect(await port.transactBudget(command,async current=>{expect(current.scopes![0].budget!.policy.limits.tokens).toBe(300);return {modelRequestBudgetChanges:[],receipt}})).toBe(receipt);
  expect(read).toHaveBeenCalledTimes(1);expect(commands).toEqual([command]);expect(writes).toEqual([{modelRequestBudgetChanges:[],receipt}]);
  await expect(port.transactBudget(command,async()=>({modelRequestBudgetChanges:[],receipt,scopes:[]}))).rejects.toThrow('不能提交其它领域');expect(writes).toHaveLength(1);
});

it('预算服务只需领域状态替身即可预留和结算，不声明工作区任务图、成员或邮箱',async()=>{
  const state:RequestBudgetState={scopes:[{workspaceId:'w',rootSessionId:'root',scopeId:'scope',budget:{policy:{revision:1,enabled:true,enforcement:'request',limits:{tokens:10000}}},runTracking:{mainRunIds:['run']}}],modelRequestBudgetChanges:[]};
  const store:RequestBudgetStore={readBudget:async()=>structuredClone(state),transactBudget:async(_command,prepare)=>{const result=await prepare(structuredClone(state));state.modelRequestBudgetChanges!.push(...result.modelRequestBudgetChanges);return result.receipt}};
  const admission={isMainLive:vi.fn(()=>true),preflightRequest:vi.fn()},service=new ModelRequestBudgetService({entry:{id:'w'},instanceId:'instance',assert:()=>{}},store,admission);
  const llm:ResolvedLlm={profile:{id:'model',name:'Model',model:'model',api:'openai-completions',baseUrl:'http://127.0.0.1:1/v1',auth:'none',contextWindow:4096,maxTokens:100,reasoning:false},apiKey:''};
  await service.preflight('root','scope',llm);expect(admission.preflightRequest).toHaveBeenCalledTimes(1);
  const port=(await service.forRun({rootSessionId:'root',taskId:'root',runId:'run',kind:'main'},llm))!;
  const ticket=await port.reserve({requestHash:'a'.repeat(64),maxOutputTokens:100});await ticket.issue();await ticket.report({input:10,output:5,cacheRead:0,cacheWrite:0,totalTokens:15});
  expect(await service.report({workspaceId:'w',rootSessionId:'root',scopeId:'scope'})).toMatchObject({reported:1,tokens:15,reservedTokens:0});
  expect(state.modelRequestBudgetChanges!.map(change=>change.phase)).toEqual(['reserved','issuing','reported']);
});
