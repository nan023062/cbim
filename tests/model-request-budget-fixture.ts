import path from 'node:path';
import {fixture} from './helpers';
import {FileDispatchStore} from '../src/backend/main/dispatch-storage/dispatch-store';
import {WorkspaceDispatchService} from '../src/backend/scheduler-engine/dispatch/dispatch-service';
import {ModelRequestBudgetService} from '../src/backend/scheduler-engine/budget/model-request-budget-service';
import {requestBudgetStore} from '../src/backend/main/dispatch-storage/request-budget-store';
import type {ResolvedLlm} from '../src/backend/core/models/ports';
import type {ScopeBudgetPolicy} from '../src/backend/core/budget/scope-budget';

export const budgetTestModel:ResolvedLlm={profile:{id:'budget-model',name:'Budget model',model:'budget-model',api:'openai-completions',baseUrl:'http://127.0.0.1:1/v1',auth:'none',contextWindow:65536,maxTokens:4096,reasoning:false,pricing:{input:1,output:2,cacheRead:0.5,cacheWrite:1.5}},apiKey:''};
export async function requestBudgetFixture(limits:ScopeBudgetPolicy['limits']={tokens:100000},llm:ResolvedLlm=structuredClone(budgetTestModel)){
  const f=await fixture(),entry=await f.app.dispatch('add',{path:f.a}),owner=f.app.workspace(entry.id),directory=path.join(f.user,'request-budget-test'),store=new FileDispatchStore(directory,entry.id);
  const policy:ScopeBudgetPolicy={revision:1,enabled:true,enforcement:'request',limits},dispatch=new WorkspaceDispatchService(owner,store,undefined,()=>policy),identity={workspaceId:entry.id,rootSessionId:'budget-root'},scopeId='budget-scope',runId='budget-run';
  await dispatch.openScope(identity,scopeId,{message:'Request budget fixture'},runId);const release=dispatch.budgets.holdMain(runId),service=new ModelRequestBudgetService(owner,requestBudgetStore(store),dispatch.budgets),binding={rootSessionId:identity.rootSessionId,taskId:identity.rootSessionId,runId,kind:'main' as const};
  const port=(await service.forRun(binding,llm))!;
  return {...f,entry,owner,directory,store,dispatch,policy,service,port,llm,binding,identity,query:{...identity,scopeId},release,cleanup:async()=>{release();await store.close();await f.cleanup()}};
}
export const budgetAttempt={requestHash:'a'.repeat(64),maxOutputTokens:4096};
export const budgetUsage={input:100,output:20,cacheRead:0,cacheWrite:0,totalTokens:120};
