import {expect,it,vi} from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import {revisionFixture} from './queued-dependency-revision-fixture';
import type {DispatchMutation,DispatchCommand} from '../src/logic/dispatch/rules/dispatch-storage';
import type {ReviseQueuedDependenciesInput} from '../src/logic/tasks/rules/queued-dependency-revision';
import {FileDispatchStore} from '../src/logic/dispatch/storage/dispatch-store';
import {DispatchTools} from '../src/logic/tools/runtime/dispatch-tools';
import {mainToolCommandId} from '../src/logic/tools/runtime/main-tool-contracts';
import {restoreMainCommand} from '../src/logic/tasks/runtime/main-command-request';
import {projectCommandReceipt} from '../src/logic/tasks/rules/command-verification-output';
import {memberDependencyRevisionHistory} from '../src/view/tasks/member-dependency-state';
import {MemberExecutionManager,type PreparedEngine} from '../src/logic/team/runtime/member-execution';
import {LoopRuntime} from '../src/logic/execution/rules/runtime/runtime';
import {FileRunStorage} from '../src/logic/execution/storage/run-storage';
import type {AgentEngine,EngineContext} from '../src/logic/execution/rules/types';

function deferred(){let resolve!:()=>void;const promise=new Promise<void>(r=>{resolve=r});return {promise,resolve}}
const taskChange=(m:DispatchMutation)=>{const c=m.batch!.changes.find(c=>c.type==='task.upserted');if(c?.type!=='task.upserted')throw Error('missing task');return c.task};

it('真实Store原子退役一条/新增两条，保留身份信封；同命令、重开和只读摘要不重做',async()=>{
 const f=await revisionFixture();try{
  const before=await f.store.read(),receipt=await f.revise(),after=await f.store.read(),target=after.graphs[0].tasks.find(t=>t.taskId===f.target.taskId)!;
  expect(receipt.status).toBe('waiting');expect(receipt.trackedTaskIds).toEqual(f.graph.tasks.map(t=>t.taskId));expect(receipt.revision.removed).toHaveLength(1);expect(receipt.revision.added).toHaveLength(2);
  expect(target).toEqual({...f.target,revision:2,status:'waiting',waitReason:'等待修订后的前置任务有效结果',updatedAt:receipt.revision.revisedAt,dependencyRevisions:[receipt.revision]});
  expect(after.graphs[0].edges.find(e=>e.edgeId===f.edge.edgeId)).toEqual({...f.edge,revision:2,enabled:false});
  for(const edge of receipt.revision.added)expect(after.graphs[0].edges.find(e=>e.edgeId===edge.edgeId)).toMatchObject({revision:1,enabled:true,fromNodeId:'task:'+edge.sourceTaskId,toNodeId:f.target.nodeId,condition:{kind:'result_ready',planRevision:1}});
  for(const key of ['outbox','runs','scopes','sessions']as const)expect(after[key]).toEqual(before[key]);expect(after.graphs[0].tasks.filter(t=>t.taskId!==f.target.taskId)).toEqual(before.graphs[0].tasks.filter(t=>t.taskId!==f.target.taskId));
  const spy=vi.spyOn(f.workspace,'snapshot');expect(await f.revise()).toEqual(receipt);expect(spy).not.toHaveBeenCalled();spy.mockRestore();
  await expect(f.revise('revise-one',{...f.input,reason:'different'})).rejects.toMatchObject({code:'COMMAND_ID_CONFLICT'});
  const reader=new FileDispatchStore(f.directory,f.entry.id);try{expect(await reader.read()).toEqual(after)}finally{await reader.close()}
  expect(memberDependencyRevisionHistory(target)).toEqual({records:[receipt.revision],invalid:false});expect(memberDependencyRevisionHistory({...target,dependencyRevisions:[{...receipt.revision,scopeId:'other'}]}).invalid).toBe(true);
 }finally{await f.cleanup()}
});

it('后续删除新增边保留全部历史，最后一条删除才排队，退役边不能复活',async()=>{
 const f=await revisionFixture();try{
  const first=await f.revise();let last=first;
  for(const [i,edge]of first.revision.added.entries()){
   const graph=await f.service.snapshot(f.identity),target=graph.tasks.find(t=>t.taskId===f.target.taskId)!;
   last=await f.revise('delete-'+i,{...f.input,expectedGraphCursor:{streamId:graph.cursor.streamId,seq:graph.cursor.seq},target:{taskId:target.taskId,expectedRevision:target.revision,expectedPlanRevision:target.planRevision},remove:[{edgeId:edge.edgeId,expectedRevision:1}],add:[]});
   expect(last.status).toBe(i===0?'waiting':'queued');
  }
  const graph=await f.service.snapshot(f.identity),target=graph.tasks.find(t=>t.taskId===f.target.taskId)!;expect(target.dependencyRevisions).toHaveLength(3);expect(memberDependencyRevisionHistory(target).invalid).toBe(false);
  const old=graph.edges.find(e=>e.edgeId===f.edge.edgeId)!;await expect(f.store.transact({commandId:'resurrect',fingerprint:'resurrect'},async()=>({batch:{version:1,identity:f.identity,streamId:graph.cursor.streamId,seq:graph.cursor.seq+1,eventId:'resurrect',commandId:'resurrect',cause:'dependency.changed',committedAt:new Date().toISOString(),changes:[{type:'edge.upserted',edge:{...old,revision:old.revision+1,enabled:true}}]},receipt:true}))).rejects.toMatchObject({code:'GRAPH_INPUT_INVALID'});
  const reader=new FileDispatchStore(f.directory,f.entry.id);try{expect((await reader.read()).graphs[0]).toEqual(graph)}finally{await reader.close()}
 }finally{await f.cleanup()}
});

it.each(['stop','knowledge']as const)('准备期间%s先发生，原子修订整体拒绝且日志字节不变',async mode=>{
 const f=await revisionFixture(),entered=deferred(),release=deferred(),original=f.workspace.withSourceSnapshot.bind(f.workspace);let stopped=false;
 try{
  const before=await f.store.read(),file=path.join(f.directory,'dispatch.jsonl'),bytes=await fs.readFile(file);
  const spy=vi.spyOn(f.workspace,'withSourceSnapshot').mockImplementationOnce(use=>original(async value=>{entered.resolve();await release.promise;return use(value)}));
  const pending=f.revise('held',f.input,()=>{if(stopped)throw Object.assign(Error('主轮停止'),{code:'COLLABORATION_STOPPED'})});await entered.promise;
  if(mode==='stop')stopped=true;else await fs.writeFile(path.join(f.workspace.entry.path,'.cbim/README.md'),'# concurrent external knowledge change');release.resolve();
  await expect(pending).rejects.toMatchObject({code:mode==='stop'?'COLLABORATION_STOPPED':'DEPENDENCY_KNOWLEDGE_STALE'});expect(await f.store.read()).toEqual(before);expect(await fs.readFile(file)).toEqual(bytes);spy.mockRestore();
 }finally{release.resolve();await f.cleanup()}
});

it('通用Store拒绝绕过审计、漏闭包、伪结果、改计划和夹带成员变化；合法原事务仍可保存',async()=>{
 const f=await revisionFixture();try{
  const original=f.store.transact.bind(f.store);let command!:DispatchCommand,mutation!:DispatchMutation;
  const spy=vi.spyOn(f.store,'transact').mockImplementation(async(cmd,prepare)=>{command=cmd;mutation=await prepare(await f.store.read());throw Error('capture')});
  await expect(f.revise()).rejects.toThrow('capture');spy.mockRestore();const before=await f.store.read(),bytes=await fs.readFile(path.join(f.directory,'dispatch.jsonl'));
  const edits:Array<(m:DispatchMutation)=>void>=[m=>{delete taskChange(m).dependencyRevisions},m=>{taskChange(m).dependencyRevisions![0].trackedTaskIds.pop()},m=>{taskChange(m).dependencyRevisions![0].knowledgeRevision='old'},m=>{taskChange(m).dependencyRevisions![0].mainRunId='fake'},m=>{taskChange(m).goal='changed';taskChange(m).planRevision++},m=>{m.members![0].leaseEpoch++},m=>{m.messages=[before.outbox[0]]},m=>{m.batch!.cause='task.created'},m=>{m.receipt={}},m=>{const e=m.batch!.changes.find(c=>c.type==='edge.upserted'&&c.edge.enabled);if(e?.type==='edge.upserted'&&e.edge.kind==='dependency')e.edge.condition.resultId='fake'},m=>{taskChange(m).dependencyRevisions![0].removed[0].sourceTaskRevision++}];
  for(const edit of edits){const bad=structuredClone(mutation);edit(bad);await expect(original(command,async()=>bad)).rejects.toThrow();expect(await f.store.read()).toEqual(before);expect(await fs.readFile(path.join(f.directory,'dispatch.jsonl'))).toEqual(bytes)}
  expect(await original(command,async()=>mutation)).toMatchObject({taskId:f.target.taskId,status:'waiting'});
 }finally{await f.cleanup()}
});

it('旧图CAS竞争整体拒绝，首次合法修订结果不受第二条迟到命令影响',async()=>{
 const f=await revisionFixture();try{
  await f.revise('winner');const before=await f.store.read();await expect(f.revise('late')).rejects.toMatchObject({code:'DEPENDENCY_GRAPH_STALE'});expect(await f.store.read()).toEqual(before);
 }finally{await f.cleanup()}
});

it('真实领取先保存，旧游标及刷新后的增删均拒绝；不能删除正在执行的原来源',async()=>{
 const f=await revisionFixture(),entered=deferred(),release=deferred(),logs=path.join(f.user,'revision-claim-logs'),storage=new FileRunStorage();let members:MemberExecutionManager|undefined;
 try{
  const binding=f.oldSource.ownerBinding!,model=await f.app.engineModels.configuration(binding.model.profileId,binding.model.modelId);
  const prepare=():PreparedEngine=>({model,create:async(_run,_task,hooks)=>{
   let context:EngineContext;const engine:AgentEngine={kind:'held-claim-test',start:async c=>{context=c;await c.emit({type:'session.bound',data:{sessionId:c.nativeSessionId,sessionFile:path.join(logs,'native.jsonl')}})},run:async()=>{entered.resolve();await release.promise;return {status:'cancelled'}},stop:async()=>{release.resolve()},close:async()=>{release.resolve()}};
   return new LoopRuntime({storage,directory:logs,createEngine:()=>engine,acquireLease:async()=>()=>{},onEngineReady:hooks.onEngineReady,onEvent:hooks.onEvent,toolPolicy:async()=>({allow:true,effects:['read'],scope:{kind:'workspace',workspaceId:f.entry.id}})});
  }});
  members=new MemberExecutionManager(f.workspace,f.store,{acquire:()=>()=>{},inspect:r=>storage.read(path.join(logs,r.binding.taskId,r.binding.runId)),prepare:async()=>prepare(),owners:f.service.owners,withEngineConfiguration:(ref,_options,use)=>f.app.engineModels.withRuntimeConfiguration(ref,c=>use({model:c.profile,prepare}))});await members.initialize();
  await members.start({...f.identity,taskId:f.oldSource.taskId,commandId:'claim-first',expectedRevision:f.oldSource.revision,options:{permission:'read'}});await entered.promise;
  const before=await f.store.read(),graph=before.graphs[0];expect(before.runs).toHaveLength(1);expect(before.outbox.find(m=>m.taskId===f.oldSource.taskId)!.delivery).toBe('claimed');
  await expect(f.revise()).rejects.toMatchObject({code:'DEPENDENCY_GRAPH_STALE'});
  await expect(f.revise('fresh-after-claim',{...f.input,expectedGraphCursor:{streamId:graph.cursor.streamId,seq:graph.cursor.seq}})).rejects.toMatchObject({code:'DEPENDENCY_NOT_ALLOWED'});
  expect(await f.store.read()).toEqual(before);expect(graph.edges.find(e=>e.edgeId===f.edge.edgeId)?.enabled).toBe(true);expect(graph.tasks.find(t=>t.taskId===f.target.taskId)?.dependencyRevisions).toBeUndefined();
 }finally{release.resolve();await members?.close();await f.cleanup()}
});

it.each(['identity','alias']as const)('实际工具%s坏回包仍只提交一次，原命令投影核原输入且只读',async mode=>{
 const f=await revisionFixture();try{
  const binding={...f.identity,scopeId:f.scopeId,runId:f.mainRunId},name='cbim_dispatch_revise_dependencies',callId='revise-call';let saved:any;
  const revise=vi.fn(async(input:ReviseQueuedDependenciesInput,call:{toolCallId:string})=>{saved=await f.revise(mainToolCommandId(name,binding,call.toolCallId)!,input);if(mode==='identity')return {...saved,rootSessionId:'foreign'};input.reason='mutated';return {...saved,revision:{...saved.revision,request:input}}});
  const tools=new DispatchTools({binding,dispatch:vi.fn(),inspect:async()=>f.service.snapshot(f.identity),reviseDependencies:revise}),signal=new AbortController().signal;
  expect(tools.list().find(t=>t.name===name)).toMatchObject({version:1,effects:['maintenance'],recovery:{mode:'inspect_before_retry',queryTool:'cbim_dispatch_command_report'}});
  await expect(tools.call(name,{...f.input,scopeId:'forged'},signal,callId)).rejects.toMatchObject({code:'DISPATCH_TOOL_INPUT_INVALID'});expect(revise).not.toHaveBeenCalled();
  await expect(tools.call(name,f.input,signal,callId)).rejects.toMatchObject({code:'TOOL_OUTPUT_INVALID'});expect(revise).toHaveBeenCalledTimes(1);
  const before=await f.store.read(),restored=restoreMainCommand(name,binding,callId,f.input),evidence=await f.store.commandEvidence(restored.commandId);
  expect(evidence?.fingerprint).toBe(restored.fingerprint);expect(projectCommandReceipt(name,evidence!.receipt,{binding,input:f.input,expectedCommandId:restored.commandId})).toMatchObject({toolName:name,removedCount:1,addedCount:2,status:'waiting'});
  const read=JSON.parse((await tools.call('cbim_dispatch_inspect',{},signal,'read')).content[0].text);expect(read.tasks.find((t:any)=>t.taskId===f.target.taskId).dependencyRevisions).toHaveLength(1);expect(await f.store.read()).toEqual(before);
 }finally{await f.cleanup()}
});
