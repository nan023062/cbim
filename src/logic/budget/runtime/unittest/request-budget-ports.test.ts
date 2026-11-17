// logic/budget/runtime: module-owned contract coverage; keep the original scenario and cleanup semantics.
import {expect,it,vi} from 'vitest';
import {requestBudgetStore} from '../../../dispatch/storage/request-budget-store';
import type {DispatchStore,DispatchState} from '../../../dispatch/rules/dispatch-storage';
import type {RequestBudgetState,RequestBudgetStore} from '../../rules/model-request-budget-storage';
import {ModelRequestBudgetService} from '../model-request-budget-service';
import type {ResolvedLlm} from '../../../models/index';

it('预算服务只需领域状态替身即可预留和结算，不声明工作区任务图、成员或邮箱',async()=>{
  const state:RequestBudgetState={scopes:[{workspaceId:'w',rootSessionId:'root',scopeId:'scope',budget:{policy:{revision:1,enabled:true,enforcement:'request',limits:{tokens:10000}}},runTracking:{mainRunIds:['run']}}],modelRequestBudgetChanges:[]};
  const store:RequestBudgetStore={ReadBudget:async()=>structuredClone(state),TransactBudget:async(_command,prepare)=>{const result=await prepare(structuredClone(state));state.modelRequestBudgetChanges!.push(...result.modelRequestBudgetChanges);return result.receipt}};
  const admission={IsMainLive:vi.fn(()=>true),PreflightRequest:vi.fn()},service=new ModelRequestBudgetService({entry:{id:'w'},instanceId:'instance',Assert:()=>{}},store,admission);
  const llm:ResolvedLlm={profile:{id:'model',name:'Model',model:'model',api:'openai-completions',baseUrl:'http://127.0.0.1:1/v1',auth:'none',contextWindow:4096,maxTokens:100,reasoning:false},apiKey:''};
  await service.Preflight('root','scope',llm);expect(admission.PreflightRequest).toHaveBeenCalledTimes(1);
  const port=(await service.ForRun({rootSessionId:'root',taskId:'root',runId:'run',kind:'main'},llm))!;
  const ticket=await port.reserve({requestHash:'a'.repeat(64),maxOutputTokens:100});await ticket.issue();await ticket.report({input:10,output:5,cacheRead:0,cacheWrite:0,totalTokens:15});
  expect(await service.Report({workspaceId:'w',rootSessionId:'root',scopeId:'scope'})).toMatchObject({reported:1,tokens:15,reservedTokens:0});
  expect(state.modelRequestBudgetChanges!.map(change=>change.phase)).toEqual(['reserved','issuing','reported']);
});
