import {expect,it} from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import type {RunSummary} from '../src/backend/core/brain/types';
import {FileDispatchStore} from '../src/backend/main/persistence/tasks/dispatch-store';
import {GlobalRuntimeManager} from '../src/backend/scheduler-engine/runtime/global-runtime';
import {checkpointServiceFixture,gate} from './member-checkpoint-service-fixture';

it('预约独立信封并幂等，实际领取才新增run；同实例原模型权限保留，历史检查点不改写',async()=>{
  const f=await checkpointServiceFixture();try{
    const before=await f.store.read(),monitor=new GlobalRuntimeManager(),epoch=monitor.begin(f.entry.id,'检查点');monitor.restoreDispatch(f.entry.id,epoch,before);monitor.ready(f.entry.id,epoch);expect(monitor.snapshot().pressure).toMatchObject({waitingDispatchTasks:1,activeRuns:0,workingMembers:0});
    const receipt=await f.reserve();expect(f.starts).toBe(1);expect((await f.store.read()).runs).toEqual(before.runs);expect((await f.store.read()).outbox.find(m=>m.messageId===receipt.requestId)).toMatchObject({kind:'assignment',delivery:'pending',resumeFrom:{checkpointId:f.input.checkpointId,runId:before.runs![0].binding.runId}});
    f.inspect.mockClear();expect(await f.reserve()).toEqual(receipt);expect(f.inspect).not.toHaveBeenCalled();
    await f.resume();await f.members.waitForSettlement({...f.identity,taskId:f.taskId});const after=await f.store.read(),[old,current]=after.runs!,task=after.graphs[0].tasks.find(t=>t.taskId===f.taskId)!;
    expect(f.starts).toBe(2);expect(old).toEqual(before.runs![0]);expect(current.permission).toBe('read');expect(current.binding.leaseEpoch).toBe(old.binding.leaseEpoch+1);expect(current.session).toEqual(old.session);expect(current.binding.agentInstanceId).toBe(old.binding.agentInstanceId);expect(task.checkpoints).toEqual(f.task.checkpoints);expect(task.result?.runId).toBe(current.binding.runId);
    const reader=new FileDispatchStore(f.directory,f.entry.id);try{expect(await reader.read()).toEqual(after)}finally{await reader.close()}
  }finally{await f.cleanup()}
});

it('来源日志身份、进度目标、原生绑定或完整性不可信时不写预约',async()=>{
  const f=await checkpointServiceFixture();try{
    const before=await f.store.read();
    for(const mutate of [(s:RunSummary)=>{s.logIntegrity=undefined},(s:RunSummary)=>{s.logIntegrity={partialTail:true}},(s:RunSummary)=>{s.taskProgress!.goal='改写目标'},(s:RunSummary)=>{s.taskProgress!.acceptance=['别的验收']},(s:RunSummary)=>{s.events.find(e=>e.type==='session.bound')!.data.sessionId='foreign'},(s:RunSummary)=>{s.unresolvedTools=['unknown-write']}]){
      f.inspect.mockImplementation(async run=>{const summary=await f.read(run);mutate(summary);return summary});await expect(f.reserve()).rejects.toThrow();expect(await f.store.read()).toEqual(before);
    }expect(f.starts).toBe(1);
  }finally{await f.cleanup()}
});

it('文件与原生历史变化不能被重新采集洗白；完整预约失败不消耗检查点',async()=>{
  const f=await checkpointServiceFixture();try{
    const before=await f.store.read();await fs.writeFile(path.join(f.a,'checkpoint.txt'),'changed');await expect(f.reserve()).rejects.toMatchObject({code:'MEMBER_CHECKPOINT_ARTIFACT_CHANGED'});expect(await f.store.read()).toEqual(before);
    await fs.writeFile(path.join(f.a,'checkpoint.txt'),'captured bytes');f.native.mockResolvedValueOnce({byteLength:128,sha256:'b'.repeat(64)});await expect(f.reserve()).rejects.toMatchObject({code:'MEMBER_CHECKPOINT_NATIVE_CHANGED'});expect(await f.store.read()).toEqual(before);
    expect((await f.reserve()).taskId).toBe(f.taskId);
  }finally{await f.cleanup()}
});

it('预约核实await期间停止不留下信封或回执；待领预约关闭封存且不续跑',async()=>{
  const f=await checkpointServiceFixture(),entered=gate(),release=gate();let stopped=false;try{
    const before=await f.store.read();f.native.mockImplementationOnce(async()=>{entered.resolve();await release.promise;return {byteLength:128,sha256:'a'.repeat(64)}});
    const reserving=f.reserve('resume-stopped',()=>{if(stopped)throw Error('stopped')});await entered.promise;stopped=true;release.resolve();await expect(reserving).rejects.toThrow('stopped');expect(await f.store.read()).toEqual(before);
    stopped=false;await f.reserve('resume-stopped');await f.service.closeScope(f.identity,f.scopeId,'cancelled');const after=await f.store.read(),task=after.graphs[0].tasks.find(t=>t.taskId===f.taskId)!;
    expect(task.status).toBe('cancelled');expect(task.checkpoints).toEqual(f.task.checkpoints);expect(task.runIds).toHaveLength(1);expect(after.outbox.filter(m=>m.kind==='assignment'&&m.resumeFrom).every(m=>m.delivery==='processed')).toBe(true);await expect(f.resume()).rejects.toMatchObject({code:'MEMBER_RELEASED'});expect(f.starts).toBe(1);
  }finally{release.resolve();await f.cleanup()}
});

it('等待本地名额不消费预约；已获名额的文件复核期间停止不落第二run且释放占用',async()=>{
  const f=await checkpointServiceFixture(),entered=gate(),release=gate();try{
    await f.reserve();const before=await f.store.read(),releaseLease=f.lease.acquire('other-writer','execute');
    await expect(f.resume()).rejects.toMatchObject({code:'WORKSPACE_EXECUTION_BUSY'});expect(await f.store.read()).toEqual(before);releaseLease();
    f.checkFiles.mockImplementationOnce(async(files,signal)=>{entered.resolve();await release.promise;return f.files.checkFiles(files,signal)});
    const pending=f.resume();await entered.promise;await f.members.stop({...f.identity,taskId:f.taskId});release.resolve();await expect(pending).rejects.toMatchObject({code:'COLLABORATION_STOPPED'});
    expect(await f.store.read()).toEqual(before);expect(f.starts).toBe(1);expect(f.lease.canAcquire('next','execute')).toBeUndefined();
  }finally{release.resolve();await f.cleanup()}
});

it('已领取后引擎准备窗口中文件变化，在新模型开始前拒绝并保留未知轮次事实',async()=>{
  const f=await checkpointServiceFixture(),entered=gate(),release=gate();try{
    await f.reserve();f.setCreateGate(async()=>{entered.resolve();await release.promise});const receipt=await f.resume();await entered.promise;
    await fs.writeFile(path.join(f.a,'checkpoint.txt'),'external change after claim');release.resolve();await f.members.waitForSettlement({...f.identity,taskId:f.taskId});
    const after=await f.store.read(),run=after.runs!.find(run=>run.binding.runId===receipt.runId)!;
    expect(run.status).toBe('interrupted');expect(run.resumeFrom?.checkpointId).toBe(f.input.checkpointId);expect(f.starts).toBe(1);expect(after.graphs[0].tasks[0].result).toBeUndefined();expect(after.graphs[0].tasks[0].checkpoints).toEqual(f.task.checkpoints);expect(f.lease.canAcquire('next','execute')).toBeUndefined();
  }finally{release.resolve();await f.cleanup()}
});

it('预约后主调度修订目标，即使模块相同也不能消费原计划下的续执行信封',async()=>{
  const f=await checkpointServiceFixture();try{
    await f.reserve();const state=await f.store.read(),plan=state.scopes![0].goal!.plan!;
    await f.service.goals.plan(f.identity,f.scopeId,f.mainRunId,'replan-after-reservation',{expectedRevision:2,objective:plan.objective,constraints:plan.constraints,criteria:plan.criteria,assignments:plan.assignments.map(({agentId,moduleIds,ownerSelection,criterionIds,reason})=>({agentId,moduleIds,ownerSelection,criterionIds,reason})),reason:'主调度明确修订计划'});
    const before=await f.store.read();await expect(f.resume()).rejects.toMatchObject({code:'MEMBER_RESUME_STALE'});expect(await f.store.read()).toEqual(before);expect(f.starts).toBe(1);
  }finally{await f.cleanup()}
});
