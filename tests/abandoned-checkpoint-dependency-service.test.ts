import {expect,it} from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import {checkpointServiceFixture,gate} from './member-checkpoint-service-fixture';
import {FileDispatchStore} from '../src/backend/main/dispatch-storage/dispatch-store';
import {queuedDependencyReplacementSelection} from '../src/backend/core/tasks/queued-dependency-replacement-rules';
import type {DispatchState} from '../src/backend/core/dispatch/dispatch-storage';
import type {RunSummary} from '../src/backend/core/execution/types';
import type {ReplaceQueuedDependencyInput} from '../src/backend/core/tasks/queued-dependency-replacement';
import {currentMemberResumeRequest} from '../src/backend/core/tasks/member-checkpoint-chain';

async function setup(reserved=false,chain=false){
  const f=await checkpointServiceFixture({checkpointCount:chain?2:1});
  if(reserved)await f.reserve();
  if(chain){if(!reserved)await f.reserve();await f.resume();await f.members.waitForSettlement({...f.identity,taskId:f.taskId})}
  const state=await f.store.read(),t=state.graphs[0].tasks[0],moduleId=t.modules[0].moduleId;
  const ownerSelection=(await f.service.owners.discover([moduleId])).groups[0].selection!;
  const assign=(id:string,prior?:string)=>f.service.dispatchTask({...f.identity,commandId:id,expectedParentRevision:1,task:{assigneeAgentId:t.assignee.agentId,moduleIds:[moduleId],ownerSelection,goal:id,acceptance:t.acceptance,prerequisites:prior?[{taskId:prior,expectedPlanRevision:1}]:[]}},f.scopeId);
  const b=await assign('B',t.taskId),c=await assign('C',b.taskId);
  const graph=await f.service.snapshot(f.identity),source=graph.tasks[0];
  await f.service.abandonCheckpoint(f.identity,f.scopeId,f.mainRunId,'abandon-source',{expectedGraphCursor:{streamId:graph.cursor.streamId,seq:graph.cursor.seq},expectedGoalRevision:2,taskId:source.taskId,expectedRevision:source.revision,expectedPlanRevision:source.planRevision,checkpointId:source.checkpoints!.at(-1)!.checkpointId,expectedResumeRequestId:currentMemberResumeRequest(source)?.requestId??null,reason:'原检查点明确放弃，保留后继由新候选接替'},()=>{});
  // Old captured bytes may legitimately change; only the new candidate is current execution evidence.
  await fs.writeFile(path.join(f.a,'checkpoint.txt'),'new candidate bytes');
  f.finishNewTasks();const a2=await assign('A2');
  await f.members.start({...f.identity,taskId:a2.taskId,commandId:'start-A2',expectedRevision:1,options:{permission:'read'}});await f.members.waitForSettlement({...f.identity,taskId:a2.taskId});
  const before=await f.store.read(),g=before.graphs[0],target=g.tasks.find(t=>t.taskId===b.taskId)!,replacement=g.tasks.find(t=>t.taskId===a2.taskId)!,edge=g.edges.find(e=>e.kind==='dependency'&&e.fromNodeId===source.nodeId&&e.toNodeId===target.nodeId)!;
  const input:ReplaceQueuedDependencyInput={expectedGraphCursor:{streamId:g.cursor.streamId,seq:g.cursor.seq},expectedGoalRevision:2,target:{taskId:b.taskId,expectedRevision:target.revision,expectedPlanRevision:target.planRevision},replace:{edgeId:edge.edgeId,expectedRevision:edge.revision},with:{taskId:a2.taskId,expectedRevision:replacement.revision,expectedPlanRevision:replacement.planRevision,runId:replacement.result!.runId,resultId:replacement.result!.resultId},reason:'新候选接替已放弃检查点来源'};
  return {...f,b,c,a2,before,input,get starts(){return f.starts},replace:(id='replace-abandoned',alive?:()=>void)=>f.service.replaceQueuedDependency(f.identity,f.scopeId,f.mainRunId,id,input,alive)};
}

it.each([false,true])('明确放弃%s预约后换边，原证明/完成段/信封保留且新候选使用当前文件',async reserved=>{
  const f=await setup(reserved);try{
    const receipt=await f.replace(),after=await f.store.read();
    expect(receipt.trackedTaskIds).toEqual([f.b.taskId,f.c.taskId]);expect(receipt.status).toBe('queued');
    for(const field of ['runs','outbox','sessions','scopes'] as const)expect(after[field]).toEqual(f.before[field]);
    expect(after.graphs[0].tasks[0]).toEqual(f.before.graphs[0].tasks[0]);expect(after.graphs[0].tasks[0].status).toBe('cancelled');expect(f.starts).toBe(2);
    f.inspect.mockClear();expect(await f.replace()).toEqual(receipt);expect(f.inspect).not.toHaveBeenCalled();
    const reopened=new FileDispatchStore(f.directory,f.entry.id);try{expect(await reopened.read()).toEqual(after)}finally{await reopened.close()}
    const b=after.graphs[0].tasks.find(t=>t.taskId===f.b.taskId)!;
    await f.members.start({...f.identity,taskId:b.taskId,commandId:'start-original-B',expectedRevision:b.revision,options:{permission:'read'}});await f.members.waitForSettlement({...f.identity,taskId:b.taskId});
    const final=await f.store.read(),run=final.runs!.find(r=>r.binding.taskId===b.taskId)!;
    expect(run.prerequisites?.map(p=>p.taskId)).toEqual([f.a2.taskId]);expect(run.binding.agentInstanceId).toBe(b.assignee.agentInstanceId);expect(final.graphs[0].tasks[0]).toEqual(f.before.graphs[0].tasks[0]);
  }finally{await f.cleanup()}
});

it('两段历史完成后放弃最新检查点，原未领取后继可接替到真实新候选且不重放原链',async()=>{
  const f=await setup(false,true);try{
    const original=f.before.graphs[0].tasks[0];expect(original.checkpoints).toHaveLength(2);expect(original.runIds).toHaveLength(2);expect(original.checkpointAbandonment!.resumeRequestId).toBeNull();
    await f.replace();const state=await f.store.read(),target=state.graphs[0].tasks.find(t=>t.taskId===f.b.taskId)!;expect(state.graphs[0].tasks[0]).toEqual(original);expect(state.runs).toEqual(f.before.runs);
    await f.members.start({...f.identity,taskId:target.taskId,commandId:'chain-start-B',expectedRevision:target.revision,options:{permission:'read'}});await f.members.waitForSettlement({...f.identity,taskId:target.taskId});
    const final=await f.store.read();expect(final.runs!.find(r=>r.binding.taskId===target.taskId)!.prerequisites!.map(p=>p.taskId)).toEqual([f.a2.taskId]);expect(final.graphs[0].tasks[0]).toEqual(original);expect(f.starts).toBe(4);
  }finally{await f.cleanup()}
});

it('取消标签或放弃字段不足以绕过原证明、预约、身份和租约的纯门禁',async()=>{
  const f=await setup(true);try{
    expect(()=>queuedDependencyReplacementSelection(f.before,f.identity,f.scopeId,f.input)).not.toThrow();
    const mutations:Array<(s:DispatchState)=>void>=[s=>{delete s.graphs[0].tasks[0].checkpointAbandonment},s=>{s.graphs[0].tasks[0].status='checkpointed'},s=>{s.graphs[0].tasks[0].checkpointAbandonment!.checkpointId='forged'},s=>{s.runs![0].status='interrupted'},s=>{s.runs![0].checkpointProof!.logHash='bad'},s=>{s.runs![0].resumeFrom={runId:'earlier',checkpointId:'other'}},s=>{s.members.find(m=>m.executionTaskId===f.taskId)!.leaseEpoch++},s=>{s.outbox.find(m=>m.kind==='assignment'&&m.resumeFrom)!.delivery='pending'},s=>{s.outbox.find(m=>m.kind==='assignment'&&m.resumeFrom)!.claim={runId:'resumed',leaseEpoch:3}},s=>{s.outbox=s.outbox.filter(m=>m.kind!=='checkpoint')},s=>{s.graphs[0].tasks.find(t=>t.taskId===f.b.taskId)!.runIds=['claimed']}];
    for(const mutate of mutations){const changed=structuredClone(f.before);mutate(changed);expect(()=>queuedDependencyReplacementSelection(changed,f.identity,f.scopeId,f.input)).toThrow()}
    expect(await f.store.read()).toEqual(f.before);
  }finally{await f.cleanup()}
});

it('原canonical缺失、截断、错配、未知或检查点证明变化均不保存半条边',async()=>{
  const f=await setup();try{
    const journal=path.join(f.directory,'dispatch.jsonl'),bytes=await fs.readFile(journal);
    const changes:Array<(s:RunSummary)=>void>=[s=>{s.logIntegrity={partialTail:true}},s=>{s.unresolvedTools=['unknown-write']},s=>{s.memberBinding!.taskId='foreign'},s=>{s.events[1].data.extra='changed log'},s=>{s.sessionFile='foreign-native'},s=>{s.events.at(-1)!.data.status='interrupted'}];
    for(const change of changes){f.inspect.mockImplementation(async run=>{const summary=await f.read(run);if(run.binding.taskId===f.taskId)change(summary);return summary});await expect(f.replace()).rejects.toThrow();expect(await fs.readFile(journal)).toEqual(bytes)}
    f.inspect.mockImplementation(async run=>{if(run.binding.taskId===f.taskId)throw Error('missing canonical');return f.read(run)});await expect(f.replace()).rejects.toThrow('missing canonical');expect(await f.store.read()).toEqual(f.before);
  }finally{await f.cleanup()}
});

it('读取原检查点期间停止拒绝整体提交，同一键可在未保存后显式重新请求',async()=>{
  const f=await setup(),entered=gate(),release=gate();let stopped=false;
  try{
    f.inspect.mockImplementation(async run=>{const s=await f.read(run);if(run.binding.taskId===f.taskId){entered.resolve();await release.promise}return s});
    const pending=f.replace('stop-replacement',()=>{if(stopped)throw Error('stopped')});await entered.promise;stopped=true;release.resolve();await expect(pending).rejects.toThrow('stopped');expect(await f.store.read()).toEqual(f.before);
    stopped=false;f.inspect.mockImplementation(f.read);expect((await f.replace('stop-replacement')).taskId).toBe(f.b.taskId);
  }finally{release.resolve();await f.cleanup()}
});
