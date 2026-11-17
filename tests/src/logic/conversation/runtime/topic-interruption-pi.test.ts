import {expect,it,vi} from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fixture} from '../../application/support/helpers';
import {activeInputProvider,activeInputData as data} from './support/active-goal-input-provider';
import {seedActiveInput} from './support/active-goal-input-fixture';
import {FileRunStorage} from '../../../../../src/logic/execution/storage/run-storage';

it('stops the actual root then continues its conversation without replaying completed child calls',async()=>{
 const f=await fixture(),provider=await activeInputProvider('interrupt',true);
 try{
  const seed=await seedActiveInput(f.app,f.a,f.user,provider),started=await f.app.Dispatch('loop.chat',{id:seed.entry.id,message:data.goal,options:seed.options});
  const until=(check:()=>void|Promise<void>)=>vi.waitFor(async()=>{expect(provider.errors).toEqual([]);await check()},{timeout:45000,interval:30});
  await until(()=>expect(provider.main).toHaveLength(2));expect(provider.member).toHaveLength(5);
  const before=await f.app.Workspace(seed.entry.id).dispatchStore.Read(),original=before.agentBusinessRuns![0];
  expect(original.status).toBe('closed');
  const directory=path.join(f.user,seed.entry.id,'loop-engine/tasks',original.binding.taskId,original.binding.runId);
  const child=await new FileRunStorage().Read(directory),canonical=await fs.readFile(path.join(directory,'events.jsonl')),native=await fs.readFile(child.sessionFile!);
  await f.app.Dispatch('loop.stop',{id:seed.entry.id,taskId:started.taskId});provider.release();
  await until(async()=>{expect((await seed.scopes())[0].status).toBe('closed');expect(f.app.runtime.Snapshot().pressure.activeRuns).toBe(0)});
  expect((await seed.scopes())[0].outcome).toBe('cancelled');
  const resumed=await f.app.Dispatch('loop.resume',{id:seed.entry.id,taskId:started.taskId,runId:started.runId,message:data.insert,options:seed.options});
  expect(resumed.runId).not.toBe(started.runId);
  await until(async()=>{const scopes=await seed.scopes();expect(scopes).toHaveLength(2);expect(scopes[1]).toMatchObject({status:'closed',outcome:'completed'});expect(f.app.runtime.Snapshot().pressure.activeRuns).toBe(0)});
  const state=await f.app.Workspace(seed.entry.id).dispatchStore.Read(),thread=await f.app.Execution(seed.entry.id).Thread(started.taskId);
  expect(state.agentBusinessRuns).toEqual([original]);expect(state.graphs[0].tasks).toEqual([]);
  expect(thread.map(r=>r.status)).toEqual(['cancelled','completed']);expect(thread[1].runId).toBe(resumed.runId);
  expect(thread[1].toolReceipts?.find(r=>r.toolCallId==='active-current-read')?.outcome).toBe('succeeded');
  expect(provider.main).toHaveLength(4);expect(provider.member).toHaveLength(5);
  expect(await fs.readFile(path.join(directory,'events.jsonl'))).toEqual(canonical);expect(await fs.readFile(child.sessionFile!)).toEqual(native);
  await f.app.Open(seed.entry.id,true);
  expect(await f.app.Workspace(seed.entry.id).dispatchStore.Read()).toEqual(state);expect(await f.app.Execution(seed.entry.id).Thread(started.taskId)).toEqual(thread);
  expect(provider.main).toHaveLength(4);expect(provider.member).toHaveLength(5);
 }finally{provider.release();await f.cleanup();await provider.close()}
},90000);
