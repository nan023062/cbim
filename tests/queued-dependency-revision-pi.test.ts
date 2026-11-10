import {expect,it,vi} from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fixture} from './helpers';
import {Application} from '../src/backend/main/application';
import {Paths} from '../src/backend/main/platform/paths';
import type {ReviseQueuedDependenciesReceipt} from '../src/backend/core/tasks/queued-dependency-revision';
import {dependencyRevisionProvider,dependencyRevisionData as data} from './queued-dependency-revision-provider';
import {seedDependencyRevision,assertDependencyRevision,revisionRecords,revisionWait,revisionRunBytes,revisionRunByteEvidence} from './queued-dependency-revision-pi-fixture';

it.each(['complete','bad-output','prepare-stop','submitted-stop']as const)('真实Pi多边增删保留原实例/信封，未知只查且重开不重放：%s',async mode=>{
 const f=await fixture(),provider=await dependencyRevisionProvider({lostReply:mode==='bad-output'});let app=f.app,receipt:ReviseQueuedDependenciesReceipt|undefined,restore=()=>{},inside=false,held=false,enter!:()=>void,release!:()=>void;
 const arrived=new Promise<void>(r=>enter=r),gate=new Promise<void>(r=>release=r);let invocations=0;
 try{
  const {entry,workspace}=await seedDependencyRevision(app,f.a,provider),service=app.memberDispatch(entry.id),original=service.reviseQueuedDependencies.bind(service);let originalArgs:Parameters<typeof original>|undefined,originalMessages:unknown;
  const spy=vi.spyOn(service,'reviseQueuedDependencies').mockImplementation(async(...args)=>{invocations++;originalArgs=args;originalMessages=(await revisionRecords(f.user,entry.id)).messages;inside=true;try{receipt=await original(...args);return mode==='bad-output'?{...receipt,rootSessionId:'wrong-root'}:receipt}finally{inside=false}});
  const read=workspace.read.bind(workspace),readSpy=vi.spyOn(workspace,'read').mockImplementation(async(...args)=>{const value=await read(...args);if(mode==='prepare-stop'&&inside&&!held){held=true;enter();await gate}return value});restore=()=>{spy.mockRestore();readSpy.mockRestore()};
  const start=await app.dispatch('loop.chat',{id:entry.id,message:data.goal,options:{permission:'read',turnTimeoutMs:60000}}),identity={workspaceId:entry.id,rootSessionId:start.taskId},graph=()=>app.memberDispatch(entry.id).snapshot(identity),records=()=>revisionRecords(f.user,entry.id);
  if(mode==='prepare-stop'){await arrived;expect(provider.member).toHaveLength(0);const stopping=app.dispatch('loop.stop',{id:entry.id,taskId:start.taskId});await new Promise(r=>setTimeout(r,30));release();await stopping;provider.releaseMain()}
  else{
   await revisionWait(async()=>provider.main.length===provider.heldTurn+1&&!!receipt,'修订已保存且主轮保持');expect(provider.errors).toEqual([]);expect(provider.member).toHaveLength(0);
   // HTTP 已收到下一请求不等于其 stdout 增量已落盘；等真实保持文本后再核原命令，避免读取横跨日志追加。
   await revisionWait(async()=>{const run=await app.execution(entry.id).inspect(start.taskId,start.runId);return run.events.filter(event=>event.type==='message.delta').map(event=>event.data.text??'').join('').includes(data.held)},'主轮保持文本已写入 canonical');
   const saved=await graph(),before=provider.state.before!,heldRecords=await records();assertDependencyRevision(saved,before,receipt!,false);expect(heldRecords.runs).toEqual([]);expect(heldRecords.messages).toEqual(originalMessages);
   restore();restore=()=>{};expect(await service.reviseQueuedDependencies(...originalArgs!)).toEqual(receipt);expect(await graph()).toEqual(saved);
   const originalReport=await service.commandReport({...identity,runId:start.runId,toolCallId:'revision-exact'});expect(originalReport.command,JSON.stringify(originalReport)).toMatchObject({state:'committed',result:{toolName:'cbim_dispatch_revise_dependencies',removedCount:1,addedCount:2}});expect(originalReport.source.outcome).toBe(mode==='bad-output'?'failed':'succeeded');expect(await records()).toEqual(heldRecords);
   if(mode==='submitted-stop')await app.dispatch('loop.stop',{id:entry.id,taskId:start.taskId});provider.releaseMain();
  }
  await revisionWait(async()=>(await records()).scopes[0].status==='closed'&&app.runtime.snapshot().pressure.activeRuns===0,'原周期已结算');restore();restore=()=>{};
  const state=await records(),finished=await graph(),complete=mode==='complete'||mode==='bad-output';expect(invocations).toBe(1);expect(provider.errors).toEqual([]);
  if(mode==='prepare-stop'){expect(receipt).toBeUndefined();expect(state.runs).toEqual([]);expect(finished.edges.filter(e=>e.kind==='dependency')).toEqual(provider.state.before!.edges.filter(e=>e.kind==='dependency'));expect(finished.tasks.every(t=>!t.dependencyRevisions)).toBe(true)}
  else{
   const nodes=assertDependencyRevision(finished,provider.state.before!,receipt!,complete);
   if(complete){
    expect(state.scopes[0].outcome).toBe('completed');expect(state.runs).toHaveLength(4);expect(provider.member).toHaveLength(20);expect(provider.main).toHaveLength(provider.heldTurn+4);
    const run=(id:string)=>state.runs.find(r=>r.binding.taskId===id)!;expect(run(nodes.b.taskId).prerequisites).toEqual([]);expect(run(nodes.a.taskId).prerequisites).toEqual([]);
    expect(run(nodes.d.taskId).prerequisites).toEqual([{taskId:nodes.a.taskId,planRevision:nodes.a.planRevision,result:nodes.a.result}]);expect(run(nodes.c.taskId).prerequisites).toEqual([nodes.a,nodes.d].map(t=>({taskId:t.taskId,planRevision:t.planRevision,result:t.result})));
    for(const r of state.runs){const old=provider.state.before!.tasks.find(t=>t.taskId===r.binding.taskId)!;expect(r.binding.agentInstanceId).toBe(old.assignee.agentInstanceId);expect(r.assignmentMessageId).toBe((originalMessages as any[]).find(m=>m.taskId===old.taskId).messageId)}
   }else{expect(state.scopes[0].outcome).toBe('cancelled');expect(state.runs).toEqual([]);expect(provider.member).toHaveLength(0)}
  }
  const thread=await app.execution(entry.id).thread(start.taskId),bytes=await revisionRunBytes(f.user,entry.id,start.taskId,thread,state.runs),sequence=[...provider.sequence];await app.shutdown();app=new Application(new Paths(f.user,path.resolve('.')),path.resolve('design'));await app.init();
  expect(await records()).toEqual(state);expect(await graph()).toEqual(finished);expect(await app.execution(entry.id).thread(start.taskId)).toEqual(thread);expect(await revisionRunBytes(f.user,entry.id,start.taskId,thread,state.runs)).toEqual(bytes);expect(provider.sequence).toEqual(sequence);expect(app.runtime.snapshot().pressure.activeRuns).toBe(0);
  for(let i=0;i<data.files.length;i++)expect(await fs.readFile(path.join(f.a,data.files[i]),'utf8')).toBe(data.facts[i]);
  await fs.writeFile(`test-results/dependency-revision-${mode}-pi-evidence.json`,JSON.stringify({mode,receipt,scope:state.scopes[0],graph:finished,runs:state.runs,requests:{main:provider.main.length,member:provider.member.length},sequence,runBytes:revisionRunByteEvidence(bytes),restartNoReplay:true,errors:provider.errors},null,2));
 }catch(error){await fs.writeFile(`test-results/dependency-revision-${mode}-pi-failure.json`,JSON.stringify({error:String(error),main:provider.main,member:provider.member,state:provider.state,errors:provider.errors,receipt},null,2));throw error}
 finally{release();restore();provider.releaseMain();await app.shutdown();await provider.close();await f.cleanup()}
},120000);
