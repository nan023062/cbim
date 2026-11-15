import {expect,it,vi} from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fixture} from './helpers';
import {memberHelpProvider,memberHelpFixture as data} from './member-help-provider';
import {seedMemberHelp,memberHelpRecords} from './member-help-fixture';
import {Application} from '../src/bridge/server/application';
import {Paths} from '../src/logic/workspace/service/paths';
import {WorkspaceExecutionLease} from '../src/logic/execution/admission/workspace-lease';
import {FileRunStorage} from '../src/logic/execution/storage/run-storage';
import {globalRuntimeLogBytes} from './global-runtime-fixture';
import type {PendingQuestion} from '../src/logic/tools/rules/questions';

it.each(['complete','waiting','stop','unknown-log'] as const)('hands help to the direct caller within the original Agent call (%s)',async mode=>{
 const f=await fixture(),provider=await memberHelpProvider(mode);let app=f.app;
 const leases=new Set<string>(),originalAcquire=WorkspaceExecutionLease.prototype.acquire;
 const spy=vi.spyOn(WorkspaceExecutionLease.prototype,'acquire').mockImplementation(function(this:WorkspaceExecutionLease,...args:Parameters<typeof originalAcquire>){
  const release=originalAcquire.apply(this,args);leases.add(args[0]);return ()=>{release();leases.delete(args[0])};
 });
 try{
  const {entry}=await seedMemberHelp(app,f.a,provider);
  const started=await app.dispatch('loop.chat',{id:entry.id,message:data.mainGoal,options:{permission:mode==='complete'?'execute':'read',turnTimeoutMs:30000}});
  const root=()=>app.execution(entry.id).inspect(started.taskId,started.runId),records=()=>memberHelpRecords(f.user,entry.id);
  const questions=()=>app.dispatch('loop.questions',{id:entry.id,taskId:started.taskId}) as Promise<PendingQuestion[]>;
  const until=async(check:()=>Promise<void>|void)=>vi.waitFor(async()=>{expect(provider.errors).toEqual([]);await check()},{timeout:30000,interval:40});
  await until(()=>expect(provider.mainRequests).toHaveLength(2));
  const waiting=await root(),ref=waiting.events.find(e=>e.type==='tool.updated'&&e.data.agentCallState==='waiting')!.data.agentCall as {taskId:string;runId:string};
  expect(leases.size).toBe(1);expect(await questions()).toEqual([]);
  const directory=path.join(f.user,entry.id,'loop-engine','tasks',ref.taskId,ref.runId),storage=new FileRunStorage(),log=path.join(directory,'events.jsonl');
  const before=await storage.read(directory);
  expect(before.events.filter(e=>e.type==='run.started')).toHaveLength(1);
  expect(before.events.some(e=>e.type==='run.settled')).toBe(false);
  expect(before.toolReceipts?.find(r=>r.toolCallId==='help-source')?.outcome).toBe('succeeded');
  const marker=path.join(f.a,data.marker),markerStat=mode==='complete'?await fs.stat(marker):undefined;
  if(mode==='unknown-log')await fs.appendFile(log,'{"isolated_test_incomplete_help_tail":');
  provider.releaseHelp();
  if(mode==='waiting'||mode==='stop'){
   await until(async()=>expect(await questions()).toHaveLength(1));
   expect(provider.memberRequests).toHaveLength(2);expect(leases.size).toBe(1);
   const question=(await questions())[0];expect(question.questions[0].question).toBe(data.question);
   if(mode==='stop')await app.dispatch('loop.stop',{id:entry.id,taskId:started.taskId});
   else await app.dispatch('loop.answerQuestion',{id:entry.id,taskId:started.taskId,questionId:question.id,answers:[{option:0,other:''}]});
  }
  await until(async()=>{expect(app.runtime.snapshot().pressure.activeRuns).toBe(0);expect(leases.size).toBe(0);expect((await records()).scopes[0]?.status).toBe('closed')});
  const finished=await root();
  if(mode==='unknown-log')await expect(storage.read(directory)).rejects.toMatchObject({code:'RUN_LOG_INVALID'});
  const child=mode==='unknown-log'?undefined:await storage.read(directory);
  expect(new Set(finished.events.filter(e=>e.data.agentCall).map(e=>(e.data.agentCall as {runId:string}).runId))).toEqual(new Set([ref.runId]));
  if(child)expect(child.events.filter(e=>e.type==='run.started')).toHaveLength(1);
  if(mode==='stop'){
   expect(finished.status).toBe('cancelled');expect(child!.status).toBe('cancelled');expect(provider.memberRequests).toHaveLength(2);
  }else if(mode==='unknown-log'){
   const receipt=finished.events.find(e=>e.type==='tool.finished'&&e.data.id==='reply-original');
   expect(receipt).toBeDefined();expect(JSON.stringify(receipt)).toContain('RUN_LOG_INVALID');
   expect((await fs.readFile(log,'utf8')).includes('isolated_test_incomplete_help_tail')).toBe(true);
  }else{
   expect(child!.status).toBe('completed');expect(finished.status).toBe('completed');
   expect(child!.toolReceipts?.find(r=>r.toolCallId==='help-supplement')?.outcome).toBe('succeeded');
   expect(child!.events.some(e=>e.type==='tool.finished'&&e.data.name==='cbim_ask_user_question')).toBe(true);
  }
  expect((await app.dispatch('dispatch.graphSnapshot',{identity:{workspaceId:entry.id,rootSessionId:started.taskId}})).tasks).toEqual([]);
  expect(await questions()).toEqual([]);
  const counts=[provider.mainRequests.length,provider.memberRequests.length],snapshot=await records(),bytes=await globalRuntimeLogBytes(f.user,entry.id);
  await app.shutdown();app=new Application(new Paths(f.user,path.resolve('.')),path.resolve('assets'));await app.init();
  expect(await records()).toEqual(snapshot);expect(await globalRuntimeLogBytes(f.user,entry.id)).toEqual(bytes);
  expect([provider.mainRequests.length,provider.memberRequests.length]).toEqual(counts);expect(app.runtime.snapshot().pressure.activeRuns).toBe(0);
  if(markerStat){expect(await fs.readFile(marker,'utf8')).toBe(data.markerText);expect((await fs.stat(marker)).mtimeMs).toBe(markerStat.mtimeMs)}
  expect(await fs.readFile(path.join(f.a,data.source),'utf8')).toBe(data.sourceText);
  expect(await fs.readFile(path.join(f.a,data.supplement),'utf8')).toBe(data.supplementText);
 }finally{provider.releaseHelp();await app.shutdown();spy.mockRestore();await provider.close();await f.cleanup()}
},120000);
