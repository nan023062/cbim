import {it,expect} from 'vitest';
import {ModelRequestBudgetService} from '../src/logic/budget/runtime/model-request-budget-service';
import {projectModelRequestBudgetMutation} from '../src/logic/budget/rules/model-request-budget-invariants';
import type {RequestBudgetStore} from '../src/logic/budget/rules/model-request-budget-storage';
import type {DispatchState} from '../src/logic/dispatch/rules/dispatch-storage';
import type {ResolvedLlm} from '../src/logic/models';

function fixture(limits:{tokens?:number;estimatedCostUsd?:number}={tokens:5000}){
 let live=true;
 let state={workspaceId:'workspace',graphs:[],scopes:[{workspaceId:'workspace',rootSessionId:'root',scopeId:'scope',status:'active',budget:{policy:{revision:1,enabled:true,enforcement:'request',limits}},runTracking:{mainRunIds:['root-run']}}]} as unknown as DispatchState;
 let tail=Promise.resolve();
 const store:RequestBudgetStore={readBudget:async()=>structuredClone(state),transactBudget:(command,prepare)=>{
   const job=tail.then(async()=>{const mutation=await prepare(structuredClone(state));state={...state,...projectModelRequestBudgetMutation(state,mutation,command)};return mutation.receipt});tail=job.then(()=>{},()=>{});return job;
 }};
 const service=new ModelRequestBudgetService({entry:{id:'workspace'},instanceId:'instance',assert:()=>{}},store,{isMainLive:()=>live,preflightRequest:()=>{}});
 const binding={rootSessionId:'root',taskId:'root',runId:'root-run',kind:'main' as const},query={workspaceId:'workspace',rootSessionId:'root',scopeId:'scope'};
 const model=(id:string,price:number):ResolvedLlm=>({apiKey:'private',profile:{id,name:id,model:id,api:'openai-completions',baseUrl:'https://example.invalid',auth:'none',contextWindow:1024,maxTokens:128,reasoning:false,pricing:{input:price,output:2*price,cacheRead:price,cacheWrite:price}}});
 return {service,binding,query,model,state:()=>state,close:()=>{live=false}};
}
const attempt={requestHash:'a'.repeat(64),maxOutputTokens:128},usage={input:100,output:20,cacheRead:0,cacheWrite:0,totalTokens:120};
it('rechecks the original child before issue and immediately before transport send',async()=>{
 for(const stage of ['issue','send']){
  const f=fixture();let live=true;
  const port=(await f.service.forRun({...f.binding,agentRun:{taskId:'child',runId:'child-run'}},f.model('child-model',10), 'primary',()=>{if(!live)throw Error('child closed')}))!;
  const ticket=await port.reserve(attempt);
  if(stage==='send')await ticket.issue();
  live=false;
  if(stage==='issue')await expect(ticket.issue()).rejects.toThrow('child closed');
  else expect(()=>ticket.assertSend()).toThrow('child closed');
  await ticket.notSent('cancelled_before_send');
  expect(await f.service.report(f.query)).toMatchObject({reservedTokens:0});
 }
});
it('different child prices share the root ledger while recording actual child run identities',async()=>{
 const f=fixture(),root=(await f.service.forRun(f.binding,f.model('root-model',1)))!,childModel=f.model('child-model',10);
 let childLive=true;const assertChild=()=>{if(!childLive)throw Error('child closed')};
 const child=(await f.service.forRun({...f.binding,agentRun:{taskId:'child',runId:'child-run'}},childModel, 'primary',assertChild))!;
 childModel.profile.pricing!.input=999;
 const tickets=await Promise.all([root.reserve(attempt),child.reserve(attempt)]);
 for(const ticket of tickets){await ticket.issue();await ticket.report(usage)}
 expect((await f.service.report(f.query)).estimatedCostUsd).toBeCloseTo(0.00154);
 const intents=f.state().modelRequestBudgetChanges!.filter(e=>e.phase==='reserved').map(e=>e.intent);
 expect(intents.map(i=>i.model.modelId)).toEqual(['root-model','child-model']);
 expect(intents[1].binding.agentRun).toEqual({taskId:'child',runId:'child-run'});
 childLive=false;await expect(child.reserve(attempt)).rejects.toThrow('child closed');
 const next=await root.reserve(attempt);await next.notSent('cancelled_before_send');f.close();
 await expect(root.reserve(attempt)).rejects.toMatchObject({code:'MODEL_REQUEST_RUN_STALE'});
});
it('child reservation cannot bypass shared token/dollar limits or missing pricing',async()=>{
 const f=fixture({tokens:1152}),root=(await f.service.forRun(f.binding,f.model('root-model',1)))!,child=(await f.service.forRun({...f.binding,agentRun:{taskId:'child',runId:'child-run'}},f.model('child-model',10)))!;
 const ticket=await root.reserve(attempt);await expect(child.reserve(attempt)).rejects.toMatchObject({code:'MODEL_REQUEST_BUDGET_DENIED'});await ticket.notSent('cancelled_before_send');
 const childTicket=await child.reserve(attempt);await childTicket.notSent('cancelled_before_send');
 const cost=fixture({estimatedCostUsd:0.01}),expensive=(await cost.service.forRun(cost.binding,cost.model('expensive',100)))!;
 await expect(expensive.reserve(attempt)).rejects.toMatchObject({code:'MODEL_REQUEST_BUDGET_DENIED'});
 const unknown=cost.model('unpriced',1);delete unknown.profile.pricing;
 await expect((await cost.service.forRun(cost.binding,unknown))!.reserve(attempt)).rejects.toMatchObject({code:'MODEL_REQUEST_BUDGET_DENIED'});
});
it('unknown child usage stops the whole root budget and late real usage remains auditable',async()=>{
 const f=fixture(),root=(await f.service.forRun(f.binding,f.model('root-model',1)))!;
 let live=true;const child=(await f.service.forRun({...f.binding,agentRun:{taskId:'child',runId:'child-run'}},f.model('child-model',10), 'primary',()=>{if(!live)throw Error('child closed')}))!;
 const ticket=await child.reserve(attempt);await ticket.issue();live=false;await ticket.report(usage);
 expect(await f.service.report(f.query)).toMatchObject({reported:1,tokens:120});
 live=true;const unknown=await child.reserve(attempt);await unknown.issue();await unknown.unknown('cancelled');
 await expect(root.reserve(attempt)).rejects.toMatchObject({code:'MODEL_REQUEST_UNVERIFIED'});
 expect(await f.service.report(f.query)).toMatchObject({unknown:1,reservedTokens:1152});
});
