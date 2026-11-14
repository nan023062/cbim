import {expect,it,vi} from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {hash} from '../src/core/platform/node/serialization';
import type {DispatchStore,DispatchCommand,DispatchMutation} from '../src/logic/dispatch/rules/dispatch-storage';
import type {EffectDispositionInput} from '../src/logic/tasks/rules/effect-observation';
import {projectEffectDispositionMutation} from '../src/logic/tasks/rules/effect-observation-invariants';
import {EffectObservationService} from '../src/logic/evidence/runtime/effect-observation-service';
import {ArtifactFiles,normalizeArtifactPath} from '../src/logic/file-operations/platform/files/artifact-files';
import {reportFixture,reportIdentity,reportInputs,evidenceFor,reportBinding} from './command-verification-fixture';
import {restoreMainCommand} from '../src/logic/tasks/runtime/main-command-request';
import {artifactRuntimeFixture,artifactBinding,invoke,seedProgress} from './artifact-runtime-fixture';
import type {EffectSourceRead} from '../src/logic/evidence/runtime/effect-source';
import type {EffectObservationReport} from '../src/logic/tasks/rules/effect-observation';

const actor={kind:'local_desktop' as const,interaction:'explicit_submit' as const};

it.each([
  ['旧单对',{path:'current.txt',oldText:'private before',newText:'private after'}],
  ['当前单项数组',{path:'current.txt',edits:[{oldText:'private before',newText:'private after'}]}],
  ['当前多项数组',{path:'current.txt',edits:[{oldText:'private first',newText:'private replacement'},{oldText:'private second',newText:''}]}],
] as const)('edit %s 从原授权参数观察当前文件，不把替换正文变成成功证明',async(_label,input)=>{
  const f=await fixture('edit',input);try{
    const before=structuredClone(f.summary),report=await f.service.observe(f.selection);
    expect(report.calls[0]).toMatchObject({toolName:'edit',outcome:'unknown',inputHash:hash(JSON.stringify(input)),coverage:'selected_files_now',file:{relativePath:'current.txt',state:'present',byteLength:13,sha256:hash('current bytes')}});
    expect(report.calls[0]).not.toHaveProperty('baselineChecks');expect(f.observeFiles).toHaveBeenCalledTimes(1);expect(f.observeFiles.mock.calls[0][0]).toEqual(['current.txt']);expect(f.release).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(report)).not.toContain('private');expect(f.summary).toEqual(before);expect(await fs.readFile(path.join(f.directory,'current.txt'),'utf8')).toBe('current bytes');expect(f.transact).not.toHaveBeenCalled();
  }finally{await f.cleanup()}
});

it.each([
  ['双形态同时存在',{path:'current.txt',oldText:'a',newText:'b',edits:[{oldText:'a',newText:'b'}]}],
  ['旧对加空数组',{path:'current.txt',oldText:'a',newText:'b',edits:[]}],
  ['数组夹旧字段',{path:'current.txt',oldText:'a',edits:[{oldText:'a',newText:'b'}]}],
  ['空数组',{path:'current.txt',edits:[]}],
  ['字符串数组',{path:'current.txt',edits:'[{"oldText":"a","newText":"b"}]'}],
  ['单对象',{path:'current.txt',edits:{oldText:'a',newText:'b'}}],
  ['嵌套数组',{path:'current.txt',edits:[[{oldText:'a',newText:'b'}]]}],
  ['缺少原文字段',{path:'current.txt',edits:[{newText:'b'}]}],
  ['缺少替换字段',{path:'current.txt',oldText:'a'}],
  ['条目夹额外路径',{path:'current.txt',edits:[{oldText:'a',newText:'b',path:'other.txt'}]}],
  ['顶层夹额外字段',{path:'current.txt',edits:[{oldText:'a',newText:'b'}],all:true}],
  ['第二项字段非法',{path:'current.txt',edits:[{oldText:'a',newText:'b'},{oldText:'c',newText:null}]}],
] as const)('edit %s 不猜测或正规化原输入，不取得文件读取占用',async(_label,input)=>{
  const f=await fixture('edit',input);try{
    const report=await f.service.observe(f.selection);
    expect(report.source.state).toBe('verified');expect(report.calls[0]).toMatchObject({toolName:'edit',outcome:'unknown',coverage:'unsupported',inputHash:hash(JSON.stringify(input))});expect(report.calls[0]).not.toHaveProperty('file');expect(report.calls[0]).not.toHaveProperty('baselineChecks');
    expect(f.observeFiles).not.toHaveBeenCalled();expect(f.acquireRead).not.toHaveBeenCalled();expect(f.transact).not.toHaveBeenCalled();
  }finally{await f.cleanup()}
});
/** 只测服务端口和真实 Core 附录投影；完整唯一 FileStore/实际 Pi 链另由集成测试覆盖。 */
async function fixture(name='write',input:unknown={path:'current.txt',content:'private original content'},control=false){
  const directory=await fs.mkdtemp(path.join(os.tmpdir(),'cbim-effect-service-'));
  const restored=control?restoreMainCommand('cbim_goal_plan',reportBinding,reportIdentity.toolCallId,input):undefined;
  const f=reportFixture(name,input,restored?evidenceFor('cbim_goal_plan',restored.input,restored.commandId,restored.fingerprint!):undefined);
  f.owner.entry.path=directory;f.summary.task.root=directory;
  const scope=f.state.scopes![0];scope.status='closed';scope.outcome='failed';scope.closedAt=scope.createdAt;
  if(!control){f.summary.events=f.summary.events.slice(0,3);f.summary.events[2].data.effects=[name==='read'?'read':name==='write'||name==='edit'?'business-write':'command'];f.summary.toolReceipts=[];f.summary.unresolvedTools=[reportIdentity.toolCallId]}
  f.summary.status='interrupted';f.summary.events.push({...f.summary.events[0],seq:f.summary.events.length+1,type:'run.interrupted',data:{reason:'actual unresolved call'}});
  await fs.writeFile(path.join(directory,'current.txt'),'current bytes');
  const receipts=new Map<string,{fingerprint:string;receipt:unknown}>();
  const transact=vi.fn(async(command:DispatchCommand,prepare:(state:typeof f.state)=>Promise<DispatchMutation>)=>{const old=receipts.get(command.commandId);if(old){if(old.fingerprint!==command.fingerprint)throw Error('command conflict');return structuredClone(old.receipt)}const mutation=await prepare(structuredClone(f.state));Object.assign(f.state,projectEffectDispositionMutation(f.state,mutation,command));receipts.set(command.commandId,{fingerprint:command.fingerprint,receipt:structuredClone(mutation.receipt)});return structuredClone(mutation.receipt)});
  const store={read:f.read,commandReceipt:vi.fn(async(id:string)=>structuredClone(receipts.get(id))),commandEvidence:f.commandEvidence,transact} as unknown as DispatchStore;
  const files=new ArtifactFiles(directory,()=>{}),observeFiles=vi.fn((paths:readonly string[],signal:AbortSignal)=>files.observeFiles(paths,signal)),release=vi.fn(),acquireRead=vi.fn(()=>release),acquireMainRead=vi.fn((_rootSessionId:string)=>release);
  const service=new EffectObservationService(f.owner,store,f.service,{inspectMember:async()=>{throw Error('not a member fixture')},normalizePath:raw=>normalizeArtifactPath(directory,raw),observeFiles,acquireRead,acquireMainRead});
  const selection={workspaceId:reportIdentity.workspaceId,rootSessionId:reportIdentity.rootSessionId,subject:{kind:'main_run' as const,runId:reportIdentity.runId,toolCallIds:[reportIdentity.toolCallId]}};
  const request=async(decision:EffectDispositionInput['decision']='inspect_more'):Promise<EffectDispositionInput>=>{const report=await service.observe(selection);return {...selection,commandId:randomUUID(),expectedBasis:report.basis,expectedRevision:report.dispositionRevision,decision,reason:'明确检查原影响'}};
  return {...f,directory,files,observeFiles,release,acquireRead,acquireMainRead,service,selection,request,store,transact,cleanup:async()=>{await fs.rm(directory,{recursive:true,force:true})}};
}

it('公开影响观察不能借用主占用，可信主内部核证保持同一文件依据且独立释放',async()=>{
  const f=await fixture();try{
    const before=await f.service.observe(f.selection);expect(f.acquireMainRead).not.toHaveBeenCalled();
    f.acquireRead.mockImplementation(()=>{throw Error('workspace writer active')});
    const blocked=await f.service.observe(f.selection);expect(blocked.calls[0].coverage).toBe('unsupported');expect(f.acquireMainRead).not.toHaveBeenCalled();
    const internal=await f.service.observeFromMain(f.selection);
    expect(internal.basis).toBe(before.basis);expect(internal.calls[0].coverage).toBe('selected_files_now');
    expect(f.acquireMainRead).toHaveBeenCalledWith(f.selection.rootSessionId);expect(f.release).toHaveBeenCalledTimes(2);expect(f.transact).not.toHaveBeenCalled();
  }finally{await f.cleanup()}
});

it('未知原文件调用可观察当前字节但无成功基线，保存/原命令重复不清原 unknown',async()=>{
  const f=await fixture();try{
    const before=structuredClone(f.summary),report=await f.service.observe(f.selection);
    expect(report).toMatchObject({source:{state:'verified',execution:'settled',unknownToolCount:1},calls:[{outcome:'unknown',coverage:'selected_files_now',file:{state:'present',byteLength:13,sha256:hash('current bytes')}}]});expect(report.calls[0]).not.toHaveProperty('baselineChecks');expect(JSON.stringify(report)).not.toContain('private original content');
    const input=await f.request(),receipt=await f.service.record(input,actor),calls=f.observeFiles.mock.calls.length;
    await fs.unlink(path.join(f.directory,'current.txt'));expect(await f.service.record(input,actor)).toEqual(receipt);expect(f.observeFiles).toHaveBeenCalledTimes(calls);expect(f.transact).toHaveBeenCalledTimes(1);await expect(f.service.receipt({...f.selection,commandId:input.commandId} as never)).rejects.toMatchObject({code:'EFFECT_INPUT_INVALID'});
    expect(await f.service.receipt({workspaceId:f.selection.workspaceId,rootSessionId:f.selection.rootSessionId,commandId:input.commandId})).toEqual(receipt);
    expect((await f.service.list(f.selection)).records).toMatchObject([{dispositionId:input.commandId,reasonTruncated:false}]);expect((await f.service.relations({workspaceId:f.selection.workspaceId,rootSessionId:f.selection.rootSessionId,dispositionId:input.commandId})).links).toEqual([]);expect(f.summary).toEqual(before);
  }finally{await f.cleanup()}
});

it('当前文件改变使保存明确预拒；head 独立于观察 basis，改变参数不能重用旧命令',async()=>{
  const f=await fixture();try{
    const input=await f.request();await fs.writeFile(path.join(f.directory,'current.txt'),'changed later');await expect(f.service.record(input,actor)).rejects.toMatchObject({code:'EFFECT_PREACCEPT_BASIS_STALE'});expect(f.transact).not.toHaveBeenCalled();
    const next=await f.request();await f.service.record(next,actor);const report=await f.service.observe(f.selection);expect(report.basis).toBe(next.expectedBasis);expect(report.dispositionRevision).toBe(1);
    await expect(f.service.record({...next,decision:'leave_unresolved'},actor)).rejects.toMatchObject({code:'EFFECT_COMMAND_CONFLICT'});expect(f.transact).toHaveBeenCalledTimes(1);
  }finally{await f.cleanup()}
});

it('日志坏尾、重复调用、二次 started、错误 root/主实例均不探测文件或泄露路径',async()=>{
  const mutations=[(f:Awaited<ReturnType<typeof fixture>>)=>{f.summary.logIntegrity={partialTail:true}},(f:Awaited<ReturnType<typeof fixture>>)=>{f.summary.events.splice(3,0,structuredClone(f.summary.events[1]));f.summary.events.forEach((e,i)=>{e.seq=i+1})},(f:Awaited<ReturnType<typeof fixture>>)=>{f.summary.events.splice(1,0,structuredClone(f.summary.events[0]));f.summary.events.forEach((e,i)=>{e.seq=i+1})},(f:Awaited<ReturnType<typeof fixture>>)=>{f.summary.conversationBinding!.rootSessionId='foreign'},(f:Awaited<ReturnType<typeof fixture>>)=>{f.state.sessions.find(s=>s.purpose==='conversation')!.agentInstanceId='foreign-main'}];
  for(const change of mutations){const f=await fixture();try{change(f);const report=await f.service.observe(f.selection);expect(report.source.state).toBe('unverifiable');expect(report.calls[0].coverage).toBe('unsupported');expect(f.observeFiles).not.toHaveBeenCalled();expect(JSON.stringify(report)).not.toContain('current.txt')}finally{await f.cleanup()}}
});

it('unsupported 和越界原参数不扩展观察，控制面失败回包可关联 committed 而不当文件成功',async()=>{
  for(const [name,input] of [['bash',{command:'read private'}],['write',{path:'../outside',content:'private'}],['read',{path:'current.txt',glob:'*'}]] as const){const f=await fixture(name,input);try{expect((await f.service.observe(f.selection)).calls[0].coverage).toBe('unsupported');expect(f.observeFiles).not.toHaveBeenCalled()}finally{await f.cleanup()}}
  const input=reportInputs()[0].input,f=await fixture('cbim_goal_plan',input,true);try{const report=await f.service.observe(f.selection);expect(report.calls[0]).toMatchObject({outcome:'failed',coverage:'control_commit_only',command:{state:'committed'}});expect(f.observeFiles).not.toHaveBeenCalled()}finally{await f.cleanup()}
});

it('观察中 canonical 或文件身份变化标不稳定，停止释放短占用且不保存',async()=>{
  for(const mode of ['log','file','stop'] as const){const f=await fixture();try{
    const actual=f.observeFiles.getMockImplementation()!,controller=new AbortController();f.observeFiles.mockImplementationOnce(async(...args)=>{const files=await actual(...args);if(mode==='log')f.summary.events.push({...f.summary.events[0],seq:f.summary.events.length+1,type:'run.stop_requested',data:{}});if(mode==='file')return [{relativePath:'current.txt',state:'unverifiable',reason:'读取期间文件发生变化'}];if(mode==='stop')controller.abort(Error('stop evidence'));return files});
    if(mode==='stop')await expect(f.service.observe(f.selection,controller.signal)).rejects.toThrow('stop evidence');else expect((await f.service.observe(f.selection)).consistency).toBe('changed_during_read');expect(f.release).toHaveBeenCalledTimes(1);expect(f.transact).not.toHaveBeenCalled();
  }finally{await f.cleanup()}}
});

it('最后 CAS 变化及真实保存后回包丢失不误称 PREACCEPT，查询不重写',async()=>{
  for(const mode of ['race','reply'] as const){const f=await fixture();try{
    const input=await f.request(),original=f.transact.getMockImplementation()!;f.transact.mockImplementationOnce(async(command,prepare)=>{if(mode==='race')f.state.scopes![0].goal!.revision++;const receipt=await original(command,prepare);throw Error('saved response lost')});
    if(mode==='race')await expect(f.service.record(input,actor)).rejects.toMatchObject({code:'EFFECT_BASIS_STALE'});else{await expect(f.service.record(input,actor)).rejects.toThrow('saved response lost');const receipt=await f.service.receipt({workspaceId:f.selection.workspaceId,rootSessionId:f.selection.rootSessionId,commandId:input.commandId});expect(receipt?.record.dispositionId).toBe(input.commandId);expect(await f.service.record(input,actor)).toEqual(receipt)}expect(f.transact).toHaveBeenCalledTimes(1);
  }finally{await f.cleanup()}}
});

it('活动来源、输入和伪 actor 的事务前拒绝有专用码，未知 IO 没有未受理承诺',async()=>{
  const f=await fixture();try{
    const input=await f.request();await expect(f.service.record({...input,subject:{...input.subject,toolCallIds:[]}},actor)).rejects.toMatchObject({code:'EFFECT_PREACCEPT_INPUT_INVALID'});
    await expect(f.service.record(input,{...actor,kind:'model'} as never)).rejects.toMatchObject({code:'EFFECT_PREACCEPT_ACTOR'});
    f.state.scopes![0].status='active';delete f.state.scopes![0].closedAt;delete f.state.scopes![0].outcome;const active=await f.request();await expect(f.service.record(active,actor)).rejects.toMatchObject({code:'EFFECT_PREACCEPT_SOURCE_NOT_CLOSED'});expect(f.transact).not.toHaveBeenCalled();
    f.read.mockRejectedValueOnce(Error('storage unavailable'));await expect(f.service.record(active,actor)).rejects.toThrow('storage unavailable');
  }finally{await f.cleanup()}
});

it('真实采集上限保留八份成功基线，第九次未知不能伪造新基线或丢掉当前观察',async()=>{
  const runtime=await artifactRuntimeFixture(async context=>{await seedProgress(context);for(let i=1;i<=9;i++)await invoke(context,'cbim_task_artifact_capture','capture-'+i,{expectedTaskProgressVersion:1,sourceToolCallIds:['source-read']})}),f=await fixture();
  try{
    const active=await runtime.start(),summary=await active.done,report=await f.service.observe(f.selection),captured=summary.events.filter(event=>event.type==='artifact.baseline_captured').map(event=>(event.data.baseline as {baselineId:string}).baselineId);
    expect(captured).toHaveLength(8);expect(summary.unresolvedTools).toContain('capture-9');report.calls[0].file={relativePath:'File.txt',state:'present',byteLength:12,sha256:hash('actual bytes')};
    // 此处仅测报告的有界比较投影；来源是实际 Runtime canonical，不建立任务或授予新运行资格。
    const source={source:report.source,summary,stamp:'projection-only',run:{binding:artifactBinding,prepared:{knowledgeRevision:'knowledge-one'}}} as EffectSourceRead;
    (f.service as unknown as {baselines(source:EffectSourceRead,report:EffectObservationReport):void}).baselines(source,report);
    expect(report.calls[0].baselineChecks?.map(item=>item.baselineId)).toEqual(captured);expect(report.calls[0].baselineChecks?.every(item=>item.file.state==='matches')).toBe(true);expect(report.calls[0].file.state).toBe('present');
  }finally{await runtime.cleanup();await f.cleanup()}
});
