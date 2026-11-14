import {expect,test} from 'vitest';
import {ModelRequestBudgetService} from '../../../../src/logic/budget/runtime/model-request-budget-service';
import type {RequestBudgetState,RequestBudgetStore} from '../../../../src/logic/budget/rules/model-request-budget-storage';
import type {ResolvedEngineModel} from '../../../../src/logic/engines';

test('同周期生成和向量角色共用准入与未知屏障，重开不释放未决消耗',async()=>{
  const state:RequestBudgetState={scopes:[{workspaceId:'w',rootSessionId:'root',scopeId:'scope',budget:{policy:{revision:1,enabled:true,enforcement:'request',limits:{tokens:10000}}},runTracking:{mainRunIds:['run']}}],modelRequestBudgetChanges:[]};
  const store:RequestBudgetStore={readBudget:async()=>structuredClone(state),transactBudget:async(_command,prepare)=>{const result=await prepare(structuredClone(state));state.modelRequestBudgetChanges!.push(...result.modelRequestBudgetChanges);return result.receipt}};
  const create=(instanceId:string)=>new ModelRequestBudgetService({entry:{id:'w'},instanceId,assert:()=>{}},store,{isMainLive:()=>true,preflightRequest:()=>{}});
  const service=create('instance'),binding={rootSessionId:'root',taskId:'root',runId:'run',kind:'main' as const};
  const llm:ResolvedEngineModel={apiKey:'',profile:{id:'provider',name:'Model',model:'chat',api:'openai-completions',baseUrl:'http://127.0.0.1:9',auth:'none',contextWindow:4096,maxTokens:100,reasoning:false,modelRoles:{version:2,roles:{memory:{kind:'embedding',profile:{kind:'embedding',id:'vectors',name:'Vectors',model:'vector',api:'openai-embeddings',baseUrl:'http://127.0.0.1:9',auth:'none',inputTokens:2048,dimensions:3,inputPrice:2}}}}}};
  const main=(await service.forRun(binding,llm))!,vector=(await service.forRun(binding,llm,'memory'))!;
  const v=await vector.reserve({requestHash:'a'.repeat(64),maxOutputTokens:0});await v.issue();await v.report({input:10,output:0,cacheRead:0,cacheWrite:0,totalTokens:10});
  const query={workspaceId:'w',rootSessionId:'root',scopeId:'scope'};
  expect(await service.report(query)).toMatchObject({tokens:10,reported:1,reservedTokens:0,estimatedCostUsd:0.00002});
  const a=await main.reserve({requestHash:'b'.repeat(64),maxOutputTokens:100});await a.issue();
  const b=await vector.reserve({requestHash:'c'.repeat(64),maxOutputTokens:0});await b.issue();await b.unknown('transport_failed');
  expect(()=>a.assertSend()).toThrow();await a.notSent('cancelled_before_send');
  await expect(main.reserve({requestHash:'d'.repeat(64),maxOutputTokens:100})).rejects.toMatchObject({code:'MODEL_REQUEST_UNVERIFIED'});
  const reopened=create('other-instance'),next=(await reopened.forRun(binding,llm,'memory'))!;
  await expect(next.reserve({requestHash:'e'.repeat(64),maxOutputTokens:0})).rejects.toMatchObject({code:'MODEL_REQUEST_BUDGET_DENIED'});
  expect(await reopened.report(query)).toMatchObject({unknown:1,reservedTokens:2048,tokens:10});
});
