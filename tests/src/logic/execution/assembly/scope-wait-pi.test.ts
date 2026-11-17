import {expect,it,vi} from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fixture} from '../../application/support/helpers';
import {prepareRecursivePause} from './support/recursive-pause-fixture';
import {recursivePauseProvider} from './support/recursive-pause-provider';
import {seedMemberCheckpoint} from '../../team/runtime/support/member-checkpoint-fixture';
import {memberCheckpointFixture as data} from '../../team/runtime/support/member-checkpoint-provider';
import {Application} from '../../../../../src/bridge/server/application';
import {Paths} from '../../../../../src/logic/workspace/service/paths';
import {WorkspaceExecutionLease} from '../../../../../src/logic/execution/admission/workspace-lease';
import {FileRunStorage} from '../../../../../src/logic/execution/storage/run-storage';

it.each(['waiting-shutdown','answered-shutdown'] as const)('recursive waiting retains its real lease until drained and never resumes itself after restart (%s)',async mode=>{
 const leases=new Set<string>(),original=WorkspaceExecutionLease.prototype.Acquire;
 const spy=vi.spyOn(WorkspaceExecutionLease.prototype,'Acquire').mockImplementation(function(this:WorkspaceExecutionLease,...args:Parameters<typeof original>){const release=original.apply(this,args);leases.add(args[0]);return()=>{release();leases.delete(args[0])}});
 let c:Awaited<ReturnType<typeof prepareRecursivePause>>|undefined;
 try{
  c=await prepareRecursivePause(false,mode==='answered-shutdown');const current=c;
  expect(leases.size).toBe(1);expect(c.app.runtime.Snapshot().pressure.activeRuns).toBeGreaterThan(0);
  const first=await c.child();
  if(mode==='waiting-shutdown'){
   const before=await c.state(),requests=[...c.provider.sequence];
   await c.app.Dispatch('loop.enqueue',{id:c.entry.id,taskId:c.start.taskId,message:'同意',options:{permission:'read'}});
   expect(await c.questions()).toEqual([c.first]);expect(c.provider.sequence).toEqual(requests);
   expect((await c.state()).agentBusinessRuns).toEqual(before.agentBusinessRuns);
   expect((await c.app.Dispatch('loop.queue',{id:c.entry.id,taskId:c.start.taskId})).map((item:{message:string})=>item.message)).toEqual(['同意']);
  }else{await c.answer(c.first);await c.until(()=>expect(current.provider.state.continued).toBe(true))}
  await c.app.Shutdown();c.provider.releaseContinuation();
  expect(leases.size).toBe(0);
  const state=await c.persistedState(),child=await c.child();
  expect(state.scopes![0],JSON.stringify(state.scopes![0])).toMatchObject({status:'closed',outcome:'cancelled'});
  expect(child.status).toBe('cancelled');expect(child.runId).toBe(first.runId);expect(child.taskProgress?.delivery).toBeUndefined();
  expect(c.provider.byChild.slice(1)).toEqual([[],[]]);
  const bytes=await fs.readFile(path.join(c.directory,'events.jsonl'),'utf8'),requests=[...c.provider.sequence];
  await c.reopen();expect(leases.size).toBe(0);expect(await c.state()).toEqual(state);expect(await c.questions()).toEqual([]);
  expect(c.provider.sequence).toEqual(requests);expect(await fs.readFile(path.join(c.directory,'events.jsonl'),'utf8')).toBe(bytes);
  await expect(c.answer(c.first)).rejects.toThrow();
  expect(await fs.readFile(path.join(c.f.a,data.files[0]),'utf8')).toBe(data.facts[0]);
 }finally{await c?.cleanup();spy.mockRestore()}
},90000);

it('a parent ending with an unanswered recursive call fails and drains the original child without repair runs',async()=>{
 const f=await fixture(),provider=await recursivePauseProvider(false,false,true);let app=f.app;
 try{
  const {entry}=await seedMemberCheckpoint(app,f.a,provider);
  const start=await app.Dispatch('loop.chat',{id:entry.id,message:'核实未答复子调用的结束边界',options:{permission:'execute',turnTimeoutMs:60000}});
  await vi.waitFor(async()=>{expect(provider.errors).toEqual([]);expect((await app.Workspace(entry.id).dispatchStore.Read()).scopes![0].status).toBe('closed');expect(app.runtime.Snapshot().pressure.activeRuns).toBe(0)},{timeout:30000});
  const state=await app.Workspace(entry.id).dispatchStore.Read(),thread=await app.Execution(entry.id).Thread(start.taskId);
  expect(state.scopes![0].outcome).toBe('interrupted');expect(thread).toHaveLength(1);
  expect(thread[0].events.find(e=>e.type==='run.interrupted')?.data.error).toBe('仍有未答复的子调用，已停止原子树；不能报告本轮完成');
  const runs=state.agentBusinessRuns!;expect(runs).toHaveLength(1);expect(runs[0].status).toBe('closed');
  const directory=path.join(f.user,entry.id,'loop-engine/tasks',runs[0].binding.taskId,runs[0].binding.runId);
  const child=await new FileRunStorage().Read(directory);expect(child.status).toBe('cancelled');expect(child.taskProgress?.delivery).toBeUndefined();
  expect(provider.byChild.map(c=>c.length)).toEqual([5,0,0]);expect(provider.main).toHaveLength(2);
  const requests=[...provider.sequence],bytes=await fs.readFile(path.join(directory,'events.jsonl'),'utf8');
  await app.Shutdown();app=new Application(new Paths(f.user,path.resolve('.')));await app.Init();
  expect(await app.Workspace(entry.id).dispatchStore.Read()).toEqual(state);expect(provider.sequence).toEqual(requests);
  expect(await fs.readFile(path.join(directory,'events.jsonl'),'utf8')).toBe(bytes);expect(await app.Execution(entry.id).Thread(start.taskId)).toEqual(thread);
 }finally{await app.Shutdown();await provider.close();await f.cleanup()}
},90000);
