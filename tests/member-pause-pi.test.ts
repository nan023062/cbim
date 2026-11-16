import {expect,it,vi} from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fixture} from './helpers';
import {recursivePauseProvider,pauseQuestion} from './recursive-pause-provider';
import {memberCheckpointFixture as data} from './member-checkpoint-provider';
import {seedMemberCheckpoint} from './member-checkpoint-fixture';
import {Application} from '../src/bridge/server/application';
import {Paths} from '../src/logic/workspace/service/paths';
import {FileRunStorage} from '../src/logic/execution/storage/run-storage';
import type {PendingQuestion} from '../src/logic/tools/rules/questions';

// 新协议在同一个调用内暂停；关闭应用不将未知等待伪装成可重放检查点。
it.each(['complete-restart','stop-wait','changed-files','submitted-stop'] as const)('recursive pause keeps the original run and gates dependent work (%s)',async mode=>{
 const f=await fixture(),provider=await recursivePauseProvider(mode==='submitted-stop');let app=f.app;
 try{
  const {entry}=await seedMemberCheckpoint(app,f.a,provider);
  const start=await app.Dispatch('loop.chat',{id:entry.id,message:'依次完成 A、B、C，在 A 原调用内暂停求助',options:{permission:'execute',turnTimeoutMs:60000}});
  const until=async(check:()=>Promise<void>|void)=>{await vi.waitFor(async()=>{if(provider.errors.length)return;await check()},{timeout:30000,interval:30});expect(provider.errors).toEqual([])};
  const questions=()=>app.Dispatch('loop.questions',{id:entry.id,taskId:start.taskId}) as Promise<PendingQuestion[]>;
  await until(async()=>expect(await questions()).toHaveLength(1));
  const question=(await questions())[0];expect(question.questions).toEqual(pauseQuestion.questions);
  const first=(await app.Workspace(entry.id).dispatchStore.Read()).agentBusinessRuns![0];
  const childDir=path.join(f.user,entry.id,'loop-engine/tasks',first.binding.taskId,first.binding.runId),storage=new FileRunStorage();
  const before=await storage.Read(childDir);
  expect(provider.byChild.map(c=>c.length)).toEqual([5,0,0]);
  expect(await fs.readFile(path.join(f.a,data.files[0]),'utf8')).toBe(data.facts[0]);
  expect((await app.Workspace(entry.id).dispatchStore.Read()).graphs[0].tasks).toEqual([]);
  if(mode==='stop-wait')await app.Dispatch('loop.stop',{id:entry.id,taskId:start.taskId});
  else{
   if(mode==='changed-files')await fs.writeFile(path.join(f.a,data.files[0]),'external change during original pause');
   await app.Dispatch('loop.answerQuestion',{id:entry.id,taskId:start.taskId,questionId:question.id,answers:[{option:0,other:'继续同一次调用，不重放写入'}]});
   if(mode==='submitted-stop'){await until(()=>expect(provider.state.continued).toBe(true));await app.Dispatch('loop.stop',{id:entry.id,taskId:start.taskId});provider.releaseContinuation()}
  }
  await until(async()=>{expect(app.runtime.Snapshot().pressure.activeRuns).toBe(0);expect((await app.Workspace(entry.id).dispatchStore.Read()).scopes![0].status).toBe('closed')});
  const state=await app.Workspace(entry.id).dispatchStore.Read(),child=await storage.Read(childDir),runs=state.agentBusinessRuns!;
  expect(child.runId).toBe(before.runId);expect(child.sessionFile).toBe(before.sessionFile);
  expect(child.events.filter(e=>e.type==='tool.proposed'&&e.data.id==='pause-write')).toHaveLength(1);
  expect(child.events.filter(e=>e.type==='tool.proposed'&&e.data.id==='pause-ask')).toHaveLength(1);
  expect(runs.every(r=>r.status==='closed')).toBe(true);
  if(mode==='complete-restart'){
   expect(runs).toHaveLength(3);expect(provider.byChild.map(c=>c.length)).toEqual([9,6,6]);
   expect(provider.state.results.map(r=>r.status)).toEqual(['completed','completed','completed']);
   expect(provider.state.result.agentCall).toEqual(provider.state.waiting.agentCall);
   const aEnd=provider.sequence.indexOf('child0:8'),bStart=provider.sequence.indexOf('child1:0'),bEnd=provider.sequence.indexOf('child1:5'),cStart=provider.sequence.indexOf('child2:0');
   expect(bStart).toBeGreaterThan(aEnd);expect(cStart).toBeGreaterThan(bEnd);
  }else{
   expect(runs).toHaveLength(1);expect(provider.byChild.slice(1)).toEqual([[],[]]);
   if(mode==='changed-files')expect(provider.state.result.error.code).toBe('ARTIFACT_BASELINE_STALE');
   else expect(child.status).toBe('cancelled');
  }
  const expected=mode==='changed-files'?'external change during original pause':data.facts[0];
  expect(await fs.readFile(path.join(f.a,data.files[0]),'utf8')).toBe(expected);
  const sequence=[...provider.sequence],logs=await Promise.all(runs.map(r=>fs.readFile(path.join(f.user,entry.id,'loop-engine/tasks',r.binding.taskId,r.binding.runId,'events.jsonl'),'utf8')));
  await app.Shutdown();app=new Application(new Paths(f.user,path.resolve('.')),path.resolve('assets'));await app.Init();
  expect(await app.Workspace(entry.id).dispatchStore.Read()).toEqual(state);expect(await questions()).toEqual([]);expect(provider.sequence).toEqual(sequence);
  await expect(app.Dispatch('loop.answerQuestion',{id:entry.id,taskId:start.taskId,questionId:question.id,answers:[{option:0,other:''}]})).rejects.toThrow();
  expect(await Promise.all(runs.map(r=>fs.readFile(path.join(f.user,entry.id,'loop-engine/tasks',r.binding.taskId,r.binding.runId,'events.jsonl'),'utf8')))).toEqual(logs);
  expect(provider.sequence).toEqual(sequence);expect(await fs.readFile(path.join(f.a,data.files[0]),'utf8')).toBe(expected);
 }finally{provider.releaseContinuation();await app.Shutdown();await provider.close();await f.cleanup()}
},90000);
