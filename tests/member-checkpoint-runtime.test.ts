import {runtimeToolGroup} from './runtime-tool-group';
import {expect,it,vi} from 'vitest';
import path from 'node:path';
import type {EngineContext,RunSummary} from '../src/backend/core/brain';
import {verifyMemberCheckpoint} from '../src/backend/core/tasks/member-checkpoint-evidence';
import {artifactRuntimeFixture,artifactBinding,seedProgress,invoke,captureInput,deferred} from './artifact-runtime-fixture';

async function input(c:EngineContext){await seedProgress(c);const captured=await invoke(c,'cbim_task_artifact_capture','capture',captureInput);return {expectedTaskProgressVersion:1,baselineId:captured.baseline.baselineId,reason:'保存单文件工作位置，交由主调度决定是否继续'}}
async function stage(c:EngineContext,value:Awaited<ReturnType<typeof input>>){
  expect((await c.beforeTool({name:'cbim_task_checkpoint',id:'checkpoint',input:value})).allow).toBe(true);
  const result=await runtimeToolGroup(c,'member-checkpoint')!.call('cbim_task_checkpoint',value,'checkpoint');
  await c.emit({type:'tool.finished',data:{name:'cbim_task_checkpoint',id:'checkpoint',result,isError:false}});return JSON.parse(result.content[0].text);
}

it('真实授权后暂存一次检查点并封住所有后续工具；正常终态才获得可核实记录',async()=>{
  const f=await artifactRuntimeFixture(async c=>{
    const value=await input(c),body=await stage(c,value);expect(body.state).toBe('staged');
    for(const name of ['read','write','cbim_task_inspect','cbim_task_help','cbim_task_checkpoint'])expect((await c.beforeTool({name,id:'after-'+name,input:{path:'File.txt'}})).allow).toBe(false);
  });try{
    const summary=await (await f.start()).done,record=verifyMemberCheckpoint(summary.events,artifactBinding,'knowledge-one',f.port.normalizePath);
    expect(summary.status).toBe('completed');expect(record?.checkpoint.binding).toEqual(artifactBinding);expect(record?.checkpoint.finishedSeq).toBeGreaterThan(record!.checkpoint.requestedSeq);expect(record?.checkpoint.terminalSeq).toBe(summary.events.at(-1)?.seq);expect(summary.taskProgress?.delivery).toBeUndefined();
  }finally{await f.cleanup()}
});

it('检查点在策略等待前占门闩，审批未结束时拒绝停泊且不放行并发工具',async()=>{
  const entered=deferred(),release=deferred();const f=await artifactRuntimeFixture(async c=>{
    const value=await input(c),pending=c.beforeTool({name:'write',id:'approval',input:{path:'File.txt',content:'never'}});await entered.promise;
    expect((await c.beforeTool({name:'cbim_task_checkpoint',id:'early',input:value})).allow).toBe(false);release.resolve();expect((await pending).allow).toBe(false);
    await stage(c,value);
  },{policy:async name=>{if(name==='write'){entered.resolve();await release.promise;return {allow:false,reason:'拒绝',effects:['business-write'],scope:{kind:'workspace',workspaceId:artifactBinding.workspaceId}}}return {allow:true,effects:name==='read'?['read']:['maintenance'],scope:{kind:'workspace',workspaceId:artifactBinding.workspaceId}}}});
  try{const summary=await (await f.start()).done;expect(summary.status).toBe('completed');expect(summary.events.filter(e=>e.type==='task.checkpoint_requested')).toHaveLength(1)}finally{release.resolve();await f.cleanup()}
});

it('文件复核期间停止会中止停泊，不产生检查点请求',async()=>{
  const entered=deferred(),release=deferred();let aborted=false;const f=await artifactRuntimeFixture(async c=>{
    const value=await input(c);expect((await c.beforeTool({name:'cbim_task_checkpoint',id:'checkpoint',input:value})).allow).toBe(true);
    await expect(runtimeToolGroup(c,'member-checkpoint')!.call('cbim_task_checkpoint',value,'checkpoint')).rejects.toThrow('停止');
    await c.emit({type:'tool.finished',data:{name:'cbim_task_checkpoint',id:'checkpoint',isError:true,result:{content:[{type:'text',text:'stopped'}]}}});
  });let calls=0;f.captureFiles.mockImplementation(async(paths,signal)=>{if(++calls===1)return f.filePort.captureFiles(paths,signal);entered.resolve();await release.promise;aborted=signal.aborted;signal.throwIfAborted();return []});
  try{const running=await f.start();await entered.promise;await f.runtime.stop(f.task.taskId);release.resolve();const summary=await running.done;expect(aborted).toBe(true);expect(summary.status).toBe('cancelled');expect(summary.events.some(e=>e.type==='task.checkpoint_requested')).toBe(false)}finally{release.resolve();await f.cleanup()}
});

it('检查点事件落盘后、成功回执前停止，保留暂存事实但不能认作可恢复记录',async()=>{
  const saved=deferred(),release=deferred();const f=await artifactRuntimeFixture(async c=>{
    const value=await input(c);expect((await c.beforeTool({name:'cbim_task_checkpoint',id:'checkpoint',input:value})).allow).toBe(true);
    await expect(runtimeToolGroup(c,'member-checkpoint')!.call('cbim_task_checkpoint',value,'checkpoint')).rejects.toThrow('停止');
    await c.emit({type:'tool.finished',data:{name:'cbim_task_checkpoint',id:'checkpoint',isError:true,result:{content:[{type:'text',text:'stopped'}]}}});
  },{afterAppend:async event=>{if(event.type==='task.checkpoint_requested'){saved.resolve();await release.promise}}});
  try{const running=await f.start();await saved.promise;await f.runtime.stop(f.task.taskId);release.resolve();const summary=await running.done;expect(summary.status).toBe('cancelled');expect(summary.events.some(e=>e.type==='task.checkpoint_requested')).toBe(true);expect(()=>verifyMemberCheckpoint(summary.events,artifactBinding,'knowledge-one',f.port.normalizePath)).toThrow()}finally{release.resolve();await f.cleanup()}
});

it('专用续执行保留任务和通道、要求下一代租约，清空旧证据且不再提供检查点工具',async()=>{
  let iterations=0;const native=vi.fn(async()=>{});const f=await artifactRuntimeFixture(async c=>{
    if(++iterations===1){await stage(c,await input(c));return}
    expect(runtimeToolGroup(c,'member-checkpoint')).toBeUndefined();const progress=await invoke(c,'cbim_task_inspect','new-inspect',{});expect(progress.plan.version).toBeGreaterThan(1);expect(progress.evidence).toEqual([]);expect(progress.plan.delivery).toBeUndefined();expect(c.nativeSessionId).toBe('native-one');expect(c.sessionFile).toBe(path.join(f.directory,'native.jsonl'));
    expect((await c.beforeTool({name:'cbim_task_checkpoint',id:'again',input:{}})).allow).toBe(false);
  },{nativeCheck:native});
  try{
    const original=await (await f.start()).done,proof=verifyMemberCheckpoint(original.events,artifactBinding,'knowledge-one',f.port.normalizePath)!;
    const launch=(epoch:number)=>({binding:{...artifactBinding,runId:'run-two',leaseEpoch:epoch},session:{nativeSessionId:'native-one',sessionFile:original.sessionFile}}),checkpoint={checkpointId:proof.checkpoint.checkpointId,runId:original.runId,logHash:proof.logHash};
    await expect(f.runtime.resumeMember(f.task,'继续',launch(1),checkpoint)).rejects.toThrow('下一代');await expect(f.runtime.resumeMember(f.task,'继续',launch(3),checkpoint)).rejects.toThrow('下一代');expect(iterations).toBe(1);
    const resumed=await (await f.runtime.resumeMember(f.task,'继续',launch(2),checkpoint)).done;expect(resumed.status).toBe('completed');expect(resumed.runId).toBe('run-two');expect(native).toHaveBeenCalledTimes(1);expect(resumed.events[0].data.memberResume).toEqual({runId:original.runId,checkpointId:proof.checkpoint.checkpointId});
  }finally{await f.cleanup()}
});

it('原生指纹或原知识已变化时，续执行在引擎开始前拒绝且不建立新日志',async()=>{
  let iterations=0;const native=vi.fn(async()=>{});const f=await artifactRuntimeFixture(async c=>{iterations++;await stage(c,await input(c))},{nativeCheck:native});
  try{
    const original:RunSummary=await (await f.start()).done,proof=verifyMemberCheckpoint(original.events,artifactBinding,'knowledge-one',f.port.normalizePath)!;
    native.mockRejectedValueOnce(Error('原生指纹变化'));const launch={binding:{...artifactBinding,runId:'run-two',leaseEpoch:2},session:{nativeSessionId:'native-one',sessionFile:original.sessionFile}},checkpoint={checkpointId:proof.checkpoint.checkpointId,runId:original.runId,logHash:proof.logHash};
    await expect(f.runtime.resumeMember(f.task,'继续',launch,checkpoint)).rejects.toThrow('原生指纹变化');expect(iterations).toBe(1);await expect(f.runtime.inspect(f.task.taskId,'run-two')).rejects.toThrow();
    f.knowledge.mockRejectedValueOnce(Error('知识变化'));await expect(f.runtime.resumeMember(f.task,'继续',launch,checkpoint)).rejects.toThrow('知识变化');expect(iterations).toBe(1);
  }finally{await f.cleanup()}
});

it('原生已经载入但发送前最终输入核实失败，不请求模型且保留本次中断记录',async()=>{
  let iterations=0;const ready=vi.fn(async()=>{throw Error('文件在原生准备时变化')});const f=await artifactRuntimeFixture(async c=>{iterations++;await stage(c,await input(c))},{nativeCheck:async()=>{},resumeInputs:ready});
  try{
    const original=await (await f.start()).done,proof=verifyMemberCheckpoint(original.events,artifactBinding,'knowledge-one',f.port.normalizePath)!;
    const run=await f.runtime.resumeMember(f.task,'继续',{binding:{...artifactBinding,runId:'run-two',leaseEpoch:2},session:{nativeSessionId:'native-one',sessionFile:original.sessionFile}},{checkpointId:proof.checkpoint.checkpointId,runId:original.runId,logHash:proof.logHash});
    const summary=await run.done;expect(summary.status).toBe('interrupted');expect(summary.events.some(event=>event.type==='session.bound')).toBe(true);expect(summary.events.at(-1)?.data.error).toContain('文件在原生准备时变化');expect(iterations).toBe(1);expect(ready).toHaveBeenCalledTimes(1);
  }finally{await f.cleanup()}
});
