import {RunArtifactCapture} from '../src/backend/core/execution/capabilities/artifact-capture';
import {runtimeToolGroup} from './runtime-tool-group';
import {afterEach,it,expect,vi} from 'vitest';
import type {ArtifactBaselineStaged,ArtifactCaptureInput} from '../src/backend/core/evidence/artifact-baseline';
import {artifactRuntimeFixture,seedProgress,invoke,captureInput,deferred} from './artifact-runtime-fixture';
import {verifyArtifactBaselines} from '../src/backend/core/evidence/artifact-evidence';
import {artifactBinding} from './artifact-runtime-fixture';

it('records real sources before receipt, exposes only confirmed refs and never uses a capture as delivery evidence',async()=>{
  const f=await artifactRuntimeFixture(async c=>{
    await seedProgress(c);const captured=await invoke(c,'cbim_task_artifact_capture','capture',captureInput);expect(captured.baseline.sourceCalls[0].toolCallId).toBe('source-read');
    const inspected=await invoke(c,'cbim_task_inspect','inspect',{});expect(inspected.artifacts).toHaveLength(1);expect(inspected.evidence.map((r:any)=>r.toolCallId)).not.toContain('capture');
  });try{
    const summary=await (await f.start()).done;expect(summary.status).toBe('completed');expect(f.knowledge).toHaveBeenCalledTimes(2);expect(f.captureFiles).toHaveBeenCalledTimes(1);
    const verified=verifyArtifactBaselines(summary.events,artifactBinding,'knowledge-one',f.port.normalizePath);expect(verified.refs).toHaveLength(1);expect(verified.records[0].capturedSeq).toBeLessThan(verified.records[0].finishedSeq);
  }finally{await f.cleanup()}
});

it('reserve precedes asynchronous policy; neither writing nor help slips into an active capture',async()=>{
  const entered=deferred(),release=deferred();const f=await artifactRuntimeFixture(async c=>{
    await seedProgress(c);const gate=c.beforeTool({name:'cbim_task_artifact_capture',id:'capture',input:captureInput});await entered.promise;
    expect((await c.beforeTool({name:'write',id:'write-race',input:{path:'File.txt',content:'changed'}})).allow).toBe(false);
    expect((await c.beforeTool({name:'cbim_task_help',id:'help-race',input:{kind:'missing_input',reason:'缺失',question:'请补充',attemptedToolCallIds:[]}})).allow).toBe(false);
    release.resolve();expect((await gate).allow).toBe(true);const result=await runtimeToolGroup(c,'artifacts')!.call('cbim_task_artifact_capture',captureInput,'capture');await c.emit({type:'tool.finished',data:{name:'cbim_task_artifact_capture',id:'capture',result}});
    expect((await c.beforeTool({name:'read',id:'after',input:{path:'File.txt'}})).allow).toBe(true);await c.emit({type:'tool.finished',data:{name:'read',id:'after',result:{content:[{type:'text',text:'done'}]}}});
  },{policy:async name=>{if(name==='cbim_task_artifact_capture'){entered.resolve();await release.promise}return {allow:true,effects:name==='read'?['read']:['maintenance'],scope:{kind:'workspace',workspaceId:artifactBinding.workspaceId}}}});
  try{expect((await (await f.start()).done).status).toBe('completed')}finally{release.resolve();await f.cleanup()}
});

it('capture rejects pending approval and only a new authorized call after settlement may proceed',async()=>{
  const entered=deferred(),release=deferred();const f=await artifactRuntimeFixture(async c=>{
    await seedProgress(c);const pending=c.beforeTool({name:'write',id:'pending',input:{path:'File.txt',content:'value'}});await entered.promise;
    expect((await c.beforeTool({name:'cbim_task_artifact_capture',id:'early',input:captureInput})).allow).toBe(false);release.resolve();expect((await pending).allow).toBe(false);
    await invoke(c,'cbim_task_artifact_capture','capture',captureInput);
  },{policy:async name=>{if(name==='write'){entered.resolve();await release.promise;return {allow:false,reason:'用户拒绝',effects:['business-write'],scope:{kind:'workspace',workspaceId:artifactBinding.workspaceId}}}return {allow:true,effects:name==='read'?['read']:['maintenance'],scope:{kind:'workspace',workspaceId:artifactBinding.workspaceId}}}});
  try{expect((await (await f.start()).done).status).toBe('completed')}finally{release.resolve();await f.cleanup()}
});

it('stopping during file read aborts the port and leaves no successful baseline',async()=>{
  const entered=deferred(),release=deferred();let aborted=false;const f=await artifactRuntimeFixture(async c=>{
    await seedProgress(c);expect((await c.beforeTool({name:'cbim_task_artifact_capture',id:'capture',input:captureInput})).allow).toBe(true);
    await expect(runtimeToolGroup(c,'artifacts')!.call('cbim_task_artifact_capture',captureInput,'capture')).rejects.toThrow('停止');await c.emit({type:'tool.finished',data:{name:'cbim_task_artifact_capture',id:'capture',isError:true,result:{content:[{type:'text',text:'已停止'}]}}});
  });f.captureFiles.mockImplementation(async(_paths,signal)=>{entered.resolve();await release.promise;aborted=signal.aborted;signal.throwIfAborted();return []});
  try{const run=await f.start();await entered.promise;await f.runtime.stop(f.task.taskId);release.resolve();const summary=await run.done;expect(aborted).toBe(true);expect(summary.status).toBe('cancelled');expect(summary.events.some(event=>event.type==='artifact.baseline_captured')).toBe(false)}finally{release.resolve();await f.cleanup()}
});

it('knowledge change after hashing refuses capture; missing ports and ordinary main never expose capture',async()=>{
  const f=await artifactRuntimeFixture(async c=>{await seedProgress(c);expect((await c.beforeTool({name:'cbim_task_artifact_capture',id:'capture',input:captureInput})).allow).toBe(true);await expect(runtimeToolGroup(c,'artifacts')!.call('cbim_task_artifact_capture',captureInput,'capture')).rejects.toThrow('知识变化');await c.emit({type:'tool.finished',data:{name:'cbim_task_artifact_capture',id:'capture',isError:true,result:{content:[{type:'text',text:'基线过期'}]}}})});
  f.knowledge.mockResolvedValueOnce(undefined).mockRejectedValueOnce(Error('知识变化'));
  try{const summary=await (await f.start()).done;expect(summary.events.some(event=>event.type==='artifact.baseline_captured')).toBe(false)}finally{await f.cleanup()}
  for(const main of [false,true]){
    const absent=await artifactRuntimeFixture(async c=>{expect(runtimeToolGroup(c,'artifacts')).toBeUndefined();expect((await c.beforeTool({name:'cbim_task_artifact_capture',id:'fake',input:captureInput})).allow).toBe(false)},{port:main?undefined:false});
    try{const run=main?await absent.runtime.start({...absent.task,mode:'chat',agentId:'cbim:main'}):await absent.start();await run.done;expect(absent.captureFiles).not.toHaveBeenCalled()}finally{await absent.cleanup()}
  }
});

it('真实采集已落盘后坏回包保留原事件，不能成为引用且仅在失败结束后释放短锁',async()=>{
  let captureCalls=0;const f=await artifactRuntimeFixture(async c=>{
    await seedProgress(c);
    const port=RunArtifactCapture.prototype as unknown as {capture(input:ArtifactCaptureInput,id:string):Promise<ArtifactBaselineStaged>},original=port.capture;
    vi.spyOn(port,'capture').mockImplementationOnce(async function(this:typeof port,input,id){captureCalls++;const saved=await original.call(this,input,id);return {...saved,binding:{...saved.binding,agentSessionId:'foreign'}}});
    expect((await c.beforeTool({name:'cbim_task_artifact_capture',id:'capture',input:captureInput})).allow).toBe(true);
    const error=await runtimeToolGroup(c,'artifacts')!.call('cbim_task_artifact_capture',captureInput,'capture').catch(value=>value);expect(error.code).toBe('TOOL_OUTPUT_INVALID');
    expect((await c.beforeTool({name:'read',id:'before-end',input:{path:'File.txt'}})).allow).toBe(false);
    await c.emit({type:'tool.finished',data:{name:'cbim_task_artifact_capture',id:'capture',isError:true,result:{content:[{type:'text',text:error.message}]}}});
    const inspected=await invoke(c,'cbim_task_inspect','inspect-after',{});expect(inspected.artifacts).toEqual([]);
    await invoke(c,'read','after-end',{path:'File.txt'});
  });try{
    const summary=await (await f.start()).done;expect(summary.status).toBe('completed');expect(captureCalls).toBe(1);expect(f.captureFiles).toHaveBeenCalledTimes(1);
    const staged=summary.events.filter(event=>event.type==='artifact.baseline_captured');expect(staged).toHaveLength(1);expect((staged[0].data.baseline as ArtifactBaselineStaged).binding).toEqual(artifactBinding);
    expect(summary.events.find(event=>event.type==='tool.finished'&&event.data.id==='capture')?.data.receipt).toMatchObject({outcome:'failed'});expect(verifyArtifactBaselines(summary.events,artifactBinding,'knowledge-one',f.port.normalizePath).refs).toEqual([]);
  }finally{await f.cleanup()}
});

afterEach(()=>vi.restoreAllMocks());
