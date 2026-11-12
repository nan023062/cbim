import {expect,it,vi} from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {fixture} from './helpers';
import {Application} from '../src/backend/main/assembly/application';
import {Paths} from '../src/backend/main/platform/paths';
import {humanContinuationReceiptSchema} from '../src/backend/core/tasks/human-continue';
import type {TaskNode} from '../src/backend/core/tasks/graph-types';
import {humanContinuationProvider,humanContinuationFixture as data,type HumanContinuationMode} from './human-continuation-provider';
import {seedHumanContinuation,humanContinuationRecords,decideHumanContinuation,humanContinuationRequest,humanContinuationSourceBytes} from './human-continuation-fixture';

async function ready(mode:HumanContinuationMode,budget=false){
  const f=await fixture(),provider=await humanContinuationProvider(mode);
  try{
    if(budget){const policy=await f.app.dispatch('budget.settings');await f.app.dispatch('budget.configure',{revision:policy.revision,enabled:true,limits:{tokens:130}})}
    const {entry}=await seedHumanContinuation(f.app,f.a,provider);await f.app.dispatch('loop.chat',{id:entry.id,message:data.goal,options:{permission:'execute',turnTimeoutMs:60000}});const records=()=>humanContinuationRecords(f.user,entry.id);
    await vi.waitFor(async()=>{expect(provider.errors).toEqual([]);expect((await records()).scopes[0]?.status).toBe('waiting')},{timeout:45000,interval:30});
    const decision=await decideHumanContinuation(f.app,f.user,entry.id,mode==='reject'?'reject':mode==='request_evidence'?'request_evidence':'accept'),request=await humanContinuationRequest(f.app,f.user,entry.id),saved=await records(),graph=await f.app.dispatch('dispatch.graphSnapshot',{identity:{workspaceId:entry.id,rootSessionId:request.rootSessionId}}),bytes=await humanContinuationSourceBytes(f.user,entry.id);
    expect(provider.main).toHaveLength(6);expect(provider.member).toHaveLength(7);expect(saved.scopes[0].goal?.review?.checks.find(value=>value.criterionId===data.humanId)?.outcome).toBe('needs_human');
    return {f,provider,entry,records,decision,request,saved,graph,bytes,cleanup:async()=>{provider.releaseAll();await f.cleanup();await provider.close()}};
  }catch(error){provider.releaseAll();await f.cleanup();await provider.close();throw error}
}

it.each(['accept','reject','request_evidence','subject-changed','review-file-changed','stop'] as HumanContinuationMode[])('continues only an explicit saved human decision with real Pi (%s)',async mode=>{
  const c=await ready(mode);let app=c.f.app;
  try{
    const identity={workspaceId:c.entry.id,rootSessionId:c.request.rootSessionId},lookup={...identity,scopeId:c.request.scopeId,commandId:c.request.commandId};
    await app.dispatch('loop.enqueue',{id:c.entry.id,taskId:c.request.rootSessionId,message:data.queued,options:{permission:'execute'}});const queued=await app.dispatch('loop.queue',{id:c.entry.id,taskId:c.request.rootSessionId});expect(queued).toHaveLength(1);expect(queued[0].status).toBe('paused');
    await app.shutdown();app=new Application(new Paths(c.f.user,path.resolve('.')),path.resolve('design'));await app.init();expect(await c.records()).toEqual(c.saved);expect(c.provider.main).toHaveLength(6);
    await expect(app.dispatch('loop.humanContinue',{...c.request,input:{message:'普通文字不能构造人工接续'}})).rejects.toThrow();expect(await app.dispatch('loop.humanContinuation',lookup)).toBeUndefined();
    const receipts=await Promise.all([app.dispatch('loop.humanContinue',c.request),app.dispatch('loop.humanContinue',c.request)]),receipt=humanContinuationReceiptSchema.parse(receipts[0]);expect(humanContinuationReceiptSchema.parse(receipts[1]).continuation).toEqual(receipt.continuation);
    await vi.waitFor(()=>expect(c.provider.main).toHaveLength(7),{timeout:20000,interval:30});const active=(await c.records()).scopes[0];expect(active.status).toBe('active');expect(active.goal?.input).toEqual(c.saved.scopes[0].goal?.input);expect(active.goal?.inputRevision).toBe(2);expect(active.goal?.review).toBeUndefined();expect(active.humanDecisions).toEqual(c.saved.scopes[0].humanDecisions);expect(receipt.continuation).toMatchObject({kind:'human_decisions',continuationId:c.request.commandId,wait:c.saved.scopes[0].wait,decisionIds:[c.decision.record.decisionId],inputRevision:2});expect(receipt.continuation).not.toHaveProperty('input');expect(active.continuations).toEqual([receipt.continuation]);
    expect(humanContinuationReceiptSchema.parse(await app.dispatch('loop.humanContinuation',lookup)).continuation).toEqual(receipt.continuation);await expect(app.dispatch('loop.humanContinue',{...c.request,options:{...c.request.options,permission:'read'}})).rejects.toThrow();expect(c.provider.main).toHaveLength(7);
    if(mode==='stop')await app.dispatch('loop.stop',{id:c.entry.id,taskId:c.request.rootSessionId});c.provider.releaseContinuation();
    if(mode==='review-file-changed'){await vi.waitFor(()=>{expect(c.provider.errors).toEqual([]);expect(c.provider.state.finalReview?.goal?.review?.decision).toBe('complete')},{timeout:20000,interval:30});await fs.writeFile(path.join(c.f.a,data.file),data.changed);c.provider.releaseFinal()}
    const rework=mode==='reject'||mode==='request_evidence';await vi.waitFor(async()=>{expect(c.provider.errors).toEqual([]);expect((await c.records()).scopes[0].status).toBe(rework?'waiting':'closed');expect(app.runtime.snapshot().pressure.activeRuns).toBe(0)},{timeout:45000,interval:30});
    const saved=await c.records(),scope=saved.scopes[0],graph=await app.dispatch('dispatch.graphSnapshot',{identity}),old=graph.tasks.find((task:TaskNode)=>task.taskId===c.graph.tasks[0].taskId);expect(old).toEqual(c.graph.tasks[0]);expect(scope.goal?.input).toEqual(c.saved.scopes[0].goal?.input);expect(scope.humanDecisions).toEqual(c.saved.scopes[0].humanDecisions);expect(scope.continuations).toEqual([receipt.continuation]);expect(graph.root.agent).toEqual(c.graph.root.agent);
    for(const [file,bytes] of Object.entries(c.bytes))expect((await humanContinuationSourceBytes(c.f.user,c.entry.id))[file]).toBe(bytes);
    if(rework){expect(graph.tasks).toHaveLength(2);const next=graph.tasks.find((task:TaskNode)=>task.goal===data.reworkGoal);expect(next?.result).toBeTruthy();expect(next?.assignee.agentInstanceId).not.toBe(old?.assignee.agentInstanceId);expect(scope.wait?.waitId).not.toBe(c.saved.scopes[0].wait?.waitId);expect(scope.goal?.review?.checks.find(value=>value.criterionId===data.humanId)?.outcome).toBe('needs_human');expect(await fs.readFile(path.join(c.f.a,data.file),'utf8')).toBe(data.reworked)}
    else{expect(graph.tasks).toEqual(c.graph.tasks);expect(scope.outcome).toBe(mode==='accept'?'completed':mode==='stop'?'cancelled':'failed');if(mode==='accept'){const check=scope.goal?.review?.checks.find(value=>value.criterionId===data.humanId);expect(check?.outcome).toBe('satisfied');expect(check?.evidence).toContainEqual({kind:'human-decision',decisionId:c.decision.record.decisionId,continuationId:c.request.commandId})}}
    if(mode==='subject-changed'){
      expect(c.provider.state.finalReview.error).toBeTruthy();expect(scope.goal?.review).toBeUndefined();
      const thread=await app.execution(c.entry.id).thread(c.request.rootSessionId);
      expect(thread).toHaveLength(5);expect(thread.slice(3).map(run=>run.source)).toEqual([1,2].map(attempt=>expect.objectContaining({kind:'goal-repair',scopeId:scope.scopeId,attempt,failureCode:'GOAL_REVIEW_REQUIRED'})));
    }
    expect(c.provider.main).toHaveLength(rework||mode==='subject-changed'?13:mode==='stop'?7:11);expect(c.provider.member).toHaveLength(rework?14:7);expect((await app.dispatch('loop.queue',{id:c.entry.id,taskId:c.request.rootSessionId}))[0].status).toBe('paused');
    const sequence=[...c.provider.sequence],bytes=await humanContinuationSourceBytes(c.f.user,c.entry.id);await app.shutdown();app=new Application(new Paths(c.f.user,path.resolve('.')),path.resolve('design'));await app.init();expect(await c.records()).toEqual(saved);expect(await humanContinuationSourceBytes(c.f.user,c.entry.id)).toEqual(bytes);expect(humanContinuationReceiptSchema.parse(await app.dispatch('loop.humanContinue',c.request)).continuation).toEqual(receipt.continuation);expect(c.provider.sequence).toEqual(sequence);
  }finally{await app.shutdown();await c.cleanup()}
},150000);

it('a newer rejection invalidates the frozen older acceptance request before a model can start',async()=>{
  const c=await ready('accept');try{await decideHumanContinuation(c.f.app,c.f.user,c.entry.id,'reject');const saved=await c.records();await expect(c.f.app.dispatch('loop.humanContinue',c.request)).rejects.toThrow();expect(await c.records()).toEqual(saved);expect(await c.f.app.dispatch('loop.humanContinuation',{workspaceId:c.entry.id,rootSessionId:c.request.rootSessionId,scopeId:c.request.scopeId,commandId:c.request.commandId})).toBeUndefined();expect(c.provider.main).toHaveLength(6);expect(c.provider.member).toHaveLength(7);expect(saved.scopes[0].status).toBe('waiting')}finally{await c.cleanup()}
},90000);

it('run-boundary budget denial preserves the original wait, decisions and unconsumed continuation',async()=>{
  const c=await ready('accept',true);try{await expect(c.f.app.dispatch('loop.humanContinue',c.request)).rejects.toMatchObject({code:'SCOPE_BUDGET_EXCEEDED'});const scope=(await c.records()).scopes[0];expect(scope.status).toBe('waiting');expect(scope.wait).toEqual(c.saved.scopes[0].wait);expect(scope.goal).toEqual(c.saved.scopes[0].goal);expect(scope.humanDecisions).toEqual(c.saved.scopes[0].humanDecisions);expect(scope.continuations).toBeUndefined();expect(c.provider.main).toHaveLength(6);expect(c.provider.member).toHaveLength(7);expect(await c.f.app.dispatch('loop.humanContinuation',{workspaceId:c.entry.id,rootSessionId:c.request.rootSessionId,scopeId:c.request.scopeId,commandId:c.request.commandId})).toBeUndefined()}finally{await c.cleanup()}
},90000);
