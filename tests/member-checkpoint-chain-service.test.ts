import {expect,it} from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import {checkpointServiceFixture} from './member-checkpoint-service-fixture';
import {FileDispatchStore} from '../src/backend/main/persistence/tasks/dispatch-store';
import {memberResumeRequests,currentMemberResumeRequest} from '../src/backend/core/tasks/member-checkpoint-chain';
import {memberCheckpointView} from '../src/frontend/tasks/member-checkpoint-state';
import {validateDispatchExecution} from '../src/backend/core/tasks/dispatch-invariants';

type Fixture=Awaited<ReturnType<typeof checkpointServiceFixture>>;
async function latest(f:Fixture){const state=await f.store.read(),graph=state.graphs.find(g=>g.identity.rootSessionId===f.identity.rootSessionId)!;return {state,graph,task:graph.tasks.find(t=>t.taskId===f.taskId)!}}
async function reserve(f:Fixture,commandId:string){const {state,graph,task}=await latest(f);return f.members.requestResume(f.identity,f.scopeId,f.mainRunId,commandId,{expectedGraphCursor:{streamId:graph.cursor.streamId,seq:graph.cursor.seq},expectedGoalRevision:state.scopes![0].goal!.revision,taskId:f.taskId,expectedRevision:task.revision,checkpointId:task.checkpoints!.at(-1)!.checkpointId,reason:commandId},()=>{})}
async function run(f:Fixture,commandId:string){const {task}=await latest(f),receipt=await f.members.resume({...f.identity,taskId:f.taskId,commandId,expectedRevision:task.revision,options:{permission:'execute'}},f.wait);await f.members.waitForSettlement({...f.identity,taskId:f.taskId});return receipt}
async function second(f:Fixture){await f.reserve();await f.resume();await f.members.waitForSettlement({...f.identity,taskId:f.taskId});const result=await latest(f);expect(result.task.status,JSON.stringify({reason:result.task.waitReason,log:(await f.read(result.state.runs!.at(-1)!)).events.slice(-4)})).toBe('checkpointed');expect(result.task.checkpoints).toHaveLength(2);return result}

it('两次检查点三段原任务，预约只消费一次且原历史重放完整；界面按段选择本段预约',async()=>{
  const f=await checkpointServiceFixture({checkpointCount:2,paths:['checkpoint.txt','second.txt']});try{
    const first=await f.store.read(),parked=await second(f);expect(parked.task.resumeHistory).toBeUndefined();expect(currentMemberResumeRequest(parked.task)).toBeUndefined();expect(parked.state.runs![0]).toEqual(first.runs![0]);
    expect(memberCheckpointView(parked.task).phase).toBe('parked');expect(memberCheckpointView(parked.task,parked.task.runIds[0])).toMatchObject({phase:'resumed',segment:1,total:2,request:parked.task.resumeRequest});
    const reservations=await Promise.allSettled([reserve(f,'second-reservation'),reserve(f,'competing-reservation')]);expect(reservations.filter(r=>r.status==='fulfilled')).toHaveLength(1);
    const queued=await latest(f),requests=memberResumeRequests(queued.task);expect(requests).toHaveLength(2);expect(queued.task.resumeHistory).toEqual([parked.task.resumeRequest]);expect(queued.task.resumeRequest!.checkpointId).toBe(parked.task.checkpoints![1].checkpointId);
    const started=await run(f,'second-claim'),done=await latest(f);expect(f.starts).toBe(3);expect(done.task.status).toBe('result_ready');expect(done.task.result!.runId).toBe(started.runId);expect(done.task.runIds).toHaveLength(3);expect(done.task.checkpoints).toEqual(parked.task.checkpoints);expect(done.task.resumeHistory).toEqual(queued.task.resumeHistory);
    expect(done.state.runs!.slice(0,2)).toEqual(parked.state.runs);for(const item of done.state.runs!){expect(item.session).toEqual(done.state.runs![0].session);expect(item.permission).toBe('read');expect(item.binding.agentInstanceId).toBe(f.task.assignee.agentInstanceId)}
    expect(done.state.runs!.map(r=>r.binding.leaseEpoch)).toEqual([1,2,3].map(n=>done.state.runs![0].binding.leaseEpoch+n-1));
    const stored=done.state;await expect(run(f,'third-claim')).rejects.toThrow();expect(await f.store.read()).toEqual(stored);expect(f.starts).toBe(3);
    const reader=new FileDispatchStore(f.directory,f.entry.id);try{expect(await reader.read()).toEqual(stored)}finally{await reader.close()}
  }finally{await f.cleanup()}
});

it('只读取另一文件的后段仍保护早期文件；原任一 canonical 被改写拒绝第三段预约且不刷新证明',async()=>{
  const f=await checkpointServiceFixture({checkpointCount:2,paths:['checkpoint.txt','second.txt']});try{
    const parked=await second(f),before=parked.state;
    await fs.writeFile(path.join(f.a,'checkpoint.txt'),'external old file change');await expect(reserve(f,'reject-old-file')).rejects.toMatchObject({code:'MEMBER_CHECKPOINT_ARTIFACT_CHANGED'});expect(await f.store.read()).toEqual(before);
    await fs.writeFile(path.join(f.a,'checkpoint.txt'),'captured bytes');
    f.inspect.mockImplementation(async r=>{const summary=await f.read(r);if(r.binding.runId===parked.task.runIds[0])summary.events[0].data.altered=true;return summary});
    await expect(reserve(f,'reject-old-log')).rejects.toMatchObject({code:'MEMBER_CHECKPOINT_CHANGED'});expect(await f.store.read()).toEqual(before);expect(f.starts).toBe(2);
    f.inspect.mockImplementation(f.read);await reserve(f,'accept-full-chain');expect(f.starts).toBe(2);
  }finally{await f.cleanup()}
});

it('后段真实写入同一路径后使用最新已核实字节，不误要求恢复到第一段旧字节',async()=>{
  const f=await checkpointServiceFixture({checkpointCount:2,writeOnRun:1});try{
    await second(f);expect(await fs.readFile(path.join(f.a,'checkpoint.txt'),'utf8')).toBe('legitimate new bytes');await reserve(f,'latest-file-fact');await run(f,'latest-file-claim');expect((await latest(f)).task.status).toBe('result_ready');
  }finally{await f.cleanup()}
});

it('多段重放拒绝删改早期检查点、预约、权限和信封，停止封存最新段且不产生第三次运行',async()=>{
  const f=await checkpointServiceFixture({checkpointCount:2});try{
    const parked=await second(f);await reserve(f,'reserved-before-stop');const {state}=await latest(f);
    for(const mutate of [
      (s:typeof state)=>{s.graphs[0].tasks[0].checkpoints!.shift()},
      (s:typeof state)=>{s.graphs[0].tasks[0].resumeHistory![0].reason='changed'},
      (s:typeof state)=>{s.runs![0].permission='execute'},
      (s:typeof state)=>{s.outbox=s.outbox.filter(m=>m.messageId!==s.runs![0].assignmentMessageId)},
    ]){const damaged=structuredClone(state);mutate(damaged);expect(()=>validateDispatchExecution(state,damaged,{receipt:true},{commandId:'forged',fingerprint:'forged'})).toThrow()}
    await f.service.closeScope(f.identity,f.scopeId,'cancelled');const closed=await latest(f);expect(closed.task.status).toBe('cancelled');expect(closed.task.runIds).toEqual(parked.task.runIds);expect(closed.task.checkpoints).toEqual(parked.task.checkpoints);expect(memberCheckpointView(closed.task).phase).toBe('sealed');expect(memberCheckpointView(closed.task,closed.task.runIds[0]).phase).toBe('resumed');expect(f.starts).toBe(2);
  }finally{await f.cleanup()}
});

it('累计超过单批16文件仍全部核实，早期批次文件变化拒绝预约',async()=>{
  const first=Array.from({length:16},(_,i)=>'part-'+i+'.txt'),f=await checkpointServiceFixture({checkpointCount:2,paths:[first,'last.txt']});try{
    const parked=await second(f);f.checkFiles.mockClear();await reserve(f,'multiple-file-batches');expect(f.checkFiles.mock.calls.map(([files])=>files.length)).toEqual([16,1]);
    await fs.writeFile(path.join(f.a,first[0]),'old batch changed');await expect(run(f,'reject-old-batch')).rejects.toMatchObject({code:'MEMBER_CHECKPOINT_ARTIFACT_CHANGED'});expect((await latest(f)).task.runIds).toEqual(parked.task.runIds);expect(f.starts).toBe(2);
  }finally{await f.cleanup()}
});

it.each([false,true])('多段明确放弃只处置最新预约=%s，已消费历史和原运行均保留',async pending=>{
  const f=await checkpointServiceFixture({checkpointCount:2});try{
    await second(f);if(pending)await reserve(f,'last-pending');const {state,graph,task}=await latest(f),request=currentMemberResumeRequest(task);
    const input={expectedGraphCursor:{streamId:graph.cursor.streamId,seq:graph.cursor.seq},expectedGoalRevision:2,taskId:task.taskId,expectedRevision:task.revision,expectedPlanRevision:task.planRevision,checkpointId:task.checkpoints!.at(-1)!.checkpointId,expectedResumeRequestId:request?.requestId??null,reason:'只放弃最新未消费段'};
    const receipt=await f.service.abandonCheckpoint(f.identity,f.scopeId,f.mainRunId,'abandon-chain',input,()=>{}),after=await latest(f);
    expect(receipt.abandonment.resumeRequestId).toBe(request?.requestId??null);expect(after.state.runs).toEqual(state.runs);expect(after.task.checkpoints).toEqual(task.checkpoints);expect(memberResumeRequests(after.task)).toEqual(memberResumeRequests(task));expect(after.state.outbox.filter(m=>m.kind==='assignment').every(m=>m.delivery==='processed')).toBe(true);expect(f.starts).toBe(2);
    expect(memberCheckpointView(after.task)).toMatchObject({phase:'abandoned',segment:2});expect(memberCheckpointView(after.task,task.runIds[0])).toMatchObject({phase:'resumed',abandonment:undefined,request:memberResumeRequests(task)[0]});
    const reader=new FileDispatchStore(f.directory,f.entry.id);try{expect(await reader.read()).toEqual(after.state)}finally{await reader.close()}
  }finally{await f.cleanup()}
});

it('16个检查点后第17段不再注册检查点工具，仍可用本轮新证据交付',async()=>{
  const f=await checkpointServiceFixture({checkpointCount:16});try{
    for(let index=1;index<=16;index++){const {task}=await latest(f);expect(task.checkpoints).toHaveLength(index);await reserve(f,'limit-reserve-'+index);await run(f,'limit-run-'+index)}
    const {task,state}=await latest(f);expect(task.runIds).toHaveLength(17);expect(task.checkpoints).toHaveLength(16);expect(task.resumeHistory).toHaveLength(15);expect(task.status).toBe('result_ready');expect(f.starts).toBe(17);
    const reader=new FileDispatchStore(f.directory,f.entry.id);try{expect(await reader.read()).toEqual(state)}finally{await reader.close()}
  }finally{await f.cleanup()}
},180000);
