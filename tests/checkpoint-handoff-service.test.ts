import {it,expect,vi} from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import {checkpointServiceFixture,gate} from './member-checkpoint-service-fixture';
import {request} from './data/knowledge';
import {commitWorkspaceMember} from './workspace-member-fixture';
import {DispatchTools} from '../src/logic/tools/runtime/dispatch-tools';
import {mainToolCommandId} from '../src/logic/tools/runtime/main-tool-contracts';
import type {AbandonCheckpointInput} from '../src/logic/tasks/rules/checkpoint-handoff';

type Fixture=Awaited<ReturnType<typeof checkpointServiceFixture>>;
async function input(f:Fixture):Promise<AbandonCheckpointInput>{
  const graph=await f.service.snapshot(f.identity),task=graph.tasks.find(value=>value.taskId===f.taskId)!;
  return {expectedGraphCursor:{streamId:graph.cursor.streamId,seq:graph.cursor.seq},expectedGoalRevision:2,taskId:task.taskId,expectedRevision:task.revision,expectedPlanRevision:task.planRevision,checkpointId:task.checkpoints![0].checkpointId,expectedResumeRequestId:task.resumeRequest?.requestId??null,reason:'保留原执行事实，改由当前岗位新建任务接手'};
}
const stop=()=>{throw Object.assign(Error('本主轮停止'),{code:'COLLABORATION_STOPPED'})};
const abandon=(f:Fixture,raw:AbandonCheckpointInput,commandId='abandon-one',alive=()=>{})=>f.service.abandonCheckpoint(f.identity,f.scopeId,f.mainRunId,commandId,raw,alive);

it.each([false,true])('真实检查点放弃，原恢复预约=%s；原回执、迟到ACK、证明与租约严格保留',async reserved=>{
  const f=await checkpointServiceFixture();try{
    if(reserved)await f.reserve();
    const raw=await input(f),before=await f.store.read(),run=before.runs![0],events=(await f.read(run)).events;
    const commandId='_abandon-one',result=await abandon(f,raw,commandId),after=await f.store.read(),task=after.graphs[0].tasks[0];
    expect(result.status).toBe('cancelled');expect(task.checkpointAbandonment).toEqual(result.abandonment);
    expect(task.checkpoints).toEqual(before.graphs[0].tasks[0].checkpoints);expect(task.resumeRequest).toEqual(before.graphs[0].tasks[0].resumeRequest);
    expect(after.runs).toEqual(before.runs);expect(after.sessions).toEqual(before.sessions);expect(after.graphs[0].edges).toEqual(before.graphs[0].edges);
    expect(after.members.find(value=>value.agentInstanceId===run.binding.agentInstanceId)!.leaseEpoch).toBe(run.binding.leaseEpoch+1);
    expect(after.outbox.filter(value=>value.kind==='assignment').every(value=>value.delivery==='processed')).toBe(true);
    const message=after.outbox.find(value=>value.kind==='checkpoint')!;expect(message.delivery).toBe('pending');
    await f.members.acknowledge({...f.identity,agentSessionId:message.to.agentSessionId,messageId:message.messageId,commandId:'late-ack'});
    expect((await f.store.read()).outbox.find(value=>value.messageId===message.messageId)!.delivery).toBe('processed');
    f.inspect.mockRejectedValue(Error('不应重新取证'));expect(await abandon(f,raw,commandId,stop)).toEqual(result);
    await expect(abandon(f,{...raw,reason:'变参'},commandId)).rejects.toMatchObject({code:'COMMAND_ID_CONFLICT'});
    expect((await f.read(run)).events).toEqual(events);expect(f.starts).toBe(1);
    await expect(f.members.resume({...f.identity,taskId:f.taskId,commandId:'forged-resume',expectedRevision:task.revision,options:{permission:'read'}},f.wait)).rejects.toThrow();expect(f.starts).toBe(1);
  }finally{await f.cleanup()}
});

it('原命令只读查询保留图逻辑身份域，非法空白/控制字符仍拒绝，不构造历史运行许可',async()=>{
  const f=await checkpointServiceFixture();try{
    const raw=await input(f),before=await f.store.read();
    expect(await f.service.checkpointAbandonmentReceipt({...f.identity,rootSessionId:'_root'},'-scope','_main','-command',raw)).toBeUndefined();
    for(const rootSessionId of [' leading','line\nbreak','x'.repeat(513)])expect(()=>f.service.checkpointAbandonmentReceipt({...f.identity,rootSessionId},f.scopeId,f.mainRunId,'invalid',raw)).toThrow(expect.objectContaining({code:'CHECKPOINT_HANDOFF_INPUT'}));
    expect(await f.store.read()).toEqual(before);expect(f.starts).toBe(1);
  }finally{await f.cleanup()}
});

it.each(['changed','missing'] as const)('知识/文件/岗位/模型已变且当前native=%s仍可放弃；原证明不刷新',async nativeState=>{
  const f=await checkpointServiceFixture();try{
    const before=await f.store.read(),run=before.runs![0],member=before.workspaceMembers![0],snapshot=await f.workspace.snapshot();
    const overview=snapshot.files.find(value=>value.path===f.task.modules[0].moduleId+'/module.md')!;
    await f.workspace.commit(request(snapshot,[{path:overview.path,text:overview.text+'\n补充当前知识。\n'}]));
    await fs.unlink(path.join(f.a,'checkpoint.txt'));
    await commitWorkspaceMember(f.app,f.entry.id,{kind:'state',memberId:member.memberId,expectedRevision:member.revision,nextState:'suspended',reason:'旧岗位暂停，新任务另行规划'});
    await f.app.models.remove(run.model.id!);
    // 夹具已通过平台端口冻结原证明；此后只改当前测试文件，不补写 canonical/proof 为它背书。
    const nativePath=run.session.sessionFile!;await fs.mkdir(path.dirname(nativePath),{recursive:true});await fs.writeFile(nativePath,'current native no longer matches the frozen proof');
    if(nativeState==='missing')await fs.unlink(nativePath);
    f.native.mockRejectedValue(Error('原native已缺失，不能用于恢复'));f.checkFiles.mockRejectedValue(Error('今日业务文件不可用'));f.native.mockClear();f.checkFiles.mockClear();
    const result=await abandon(f,await input(f));expect(result.status).toBe('cancelled');
    expect(f.native).not.toHaveBeenCalled();expect(f.checkFiles).not.toHaveBeenCalled();expect((await f.store.read()).runs).toEqual(before.runs);expect(f.starts).toBe(1);
    if(nativeState==='changed')expect(await fs.readFile(nativePath,'utf8')).toBe('current native no longer matches the frozen proof');
    else await expect(fs.stat(nativePath)).rejects.toMatchObject({code:'ENOENT'});
  }finally{await f.cleanup()}
});

it('取证中停止不提交，取证IO在Store外不会阻塞原信封ACK',async()=>{
  const f=await checkpointServiceFixture();try{
    const entered=gate(),release=gate(),before=await f.store.read(),raw=await input(f);let stopped=false;
    f.inspect.mockImplementationOnce(async run=>{const summary=await f.read(run);entered.resolve();await release.promise;return summary});
    const pending=abandon(f,raw,'abandon-stop',()=>{if(stopped)stop()});await entered.promise;
    const checkpoint=before.outbox.find(value=>value.kind==='checkpoint')!;
    await f.members.acknowledge({...f.identity,agentSessionId:checkpoint.to.agentSessionId,messageId:checkpoint.messageId,commandId:'during-io-ack'});
    stopped=true;release.resolve();await expect(pending).rejects.toMatchObject({code:'COLLABORATION_STOPPED'});
    const after=await f.store.read();expect(after.graphs).toEqual(before.graphs);expect(after.runs).toEqual(before.runs);expect(await f.store.commandReceipt('abandon-stop')).toBeUndefined();
  }finally{await f.cleanup()}
});

it('历史核实后的目标变化使原请求失效；原检查点ACK本身不使处置失效',async()=>{
  const f=await checkpointServiceFixture();try{
    const raw=await input(f);f.inspect.mockImplementationOnce(async run=>{const summary=await f.read(run);await f.service.goals.block(f.identity,f.scopeId,'先核实缺口');return summary});
    await expect(abandon(f,raw)).rejects.toMatchObject({code:'CHECKPOINT_HANDOFF_STALE'});
    const graph=await f.service.snapshot(f.identity),scope=(await f.store.read()).scopes![0],fresh={...raw,expectedGoalRevision:scope.goal!.revision,expectedGraphCursor:{streamId:graph.cursor.streamId,seq:graph.cursor.seq}};
    f.inspect.mockImplementationOnce(async run=>{const summary=await f.read(run),message=(await f.store.read()).outbox.find(value=>value.kind==='checkpoint')!;await f.members.acknowledge({...f.identity,agentSessionId:message.to.agentSessionId,messageId:message.messageId,commandId:'ack-during-verify'});return summary});
    expect((await abandon(f,fresh,'after-block')).status).toBe('cancelled');
  }finally{await f.cleanup()}
});

it('缺失或变造canonical拒绝，已经领取的恢复不能被放弃',async()=>{
  const f=await checkpointServiceFixture();try{
    const raw=await input(f),before=await f.store.read();
    f.inspect.mockRejectedValueOnce(Error('canonical missing'));await expect(abandon(f,raw,'missing')).rejects.toThrow('canonical missing');
    f.inspect.mockImplementationOnce(async run=>{const summary=await f.read(run);return {...summary,events:summary.events.slice(0,-1)}});
    await expect(abandon(f,raw,'corrupt')).rejects.toThrow();expect((await f.store.read()).graphs).toEqual(before.graphs);
    await f.reserve();const reserved=await input(f);await f.resume();await f.members.waitForSettlement({...f.identity,taskId:f.taskId});
    await expect(abandon(f,reserved,'already-claimed')).rejects.toThrow();expect(f.starts).toBe(2);expect((await f.store.read()).graphs[0].tasks[0].checkpointAbandonment).toBeUndefined();
  }finally{await f.cleanup()}
});

it('真实保存后坏wire只失败一次，不回滚重做；停止后仍可只查原回执',async()=>{
  const f=await checkpointServiceFixture();try{
    const raw=await input(f),binding={...f.identity,scopeId:f.scopeId,runId:f.mainRunId},callId='abandon-tool';
    const commandId=mainToolCommandId('cbim_dispatch_abandon_checkpoint',binding,callId)!;
    const submit=vi.fn(async()=>{const receipt=await abandon(f,raw,commandId);return {...receipt,rootSessionId:'wrong-root'}});
    const tools=new DispatchTools({binding,dispatch:async()=>{throw Error('unused')},inspect:async()=>f.service.snapshot(f.identity),abandonCheckpoint:submit});
    await expect(tools.call('cbim_dispatch_abandon_checkpoint',raw,new AbortController().signal,callId)).rejects.toMatchObject({code:'TOOL_OUTPUT_INVALID'});
    expect(submit).toHaveBeenCalledTimes(1);const saved=(await f.store.commandReceipt(commandId))!.receipt;
    expect(await abandon(f,raw,commandId,stop)).toEqual(saved);expect((await f.store.read()).graphs[0].tasks[0].status).toBe('cancelled');expect(f.starts).toBe(1);
  }finally{await f.cleanup()}
});
