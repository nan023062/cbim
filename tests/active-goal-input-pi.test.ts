import {expect,it,vi} from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fixture} from './helpers';
import {Application} from '../src/bridge/server/application';
import {Paths} from '../src/logic/workspace/service/paths';
import {PiRpc} from '../src/logic/execution/engines/pi/rpc';
import type {PendingQuestion} from '../src/logic/tools/rules/questions';
import type {QueuedMessage} from '../src/logic/tasks/rules/queue';
import {activeInputProvider,activeInputData as data,type ActiveInputMode} from './active-goal-input-provider';
import {seedActiveInput} from './active-goal-input-fixture';

const modes=['stale-complete','stale-waiting','replan','twice','waiting','twice-waiting','ack-unknown','ack-save-failure','before-send-stop','ack-stop'] as const;
// 插入保留原 run/native 与可靠 ACK；旧目标审阅退出，不能为通过测试补造 plan/review。
it.each(modes)('recursive active input retains identity, receipt and stop boundaries (%s)',async mode=>{
 const providerMode:ActiveInputMode=['ack-unknown','ack-save-failure','before-send-stop','ack-stop'].includes(mode)?'replan':mode as ActiveInputMode;
 const f=await fixture(),provider=await activeInputProvider(providerMode,true);let app=f.app,restore=()=>{},release!:()=>void,entered!:()=>void;
 const gate=new Promise<void>(resolve=>release=resolve),arrived=new Promise<void>(resolve=>entered=resolve);let steerCalls=0,held=false;
 try{
  const seed=await seedActiveInput(app,f.a,f.user,provider),start=await app.Dispatch('loop.chat',{id:seed.entry.id,message:data.goal,options:seed.options});
  const until=async(check:()=>Promise<void>|void)=>{await vi.waitFor(async()=>{if(provider.errors.length)return;await check()},{timeout:30000,interval:30});expect(provider.errors).toEqual([])};
  await until(()=>expect(provider.main).toHaveLength(2));
  const old=(await seed.scopes())[0],thread=await app.Execution(seed.entry.id).Thread(start.taskId),active=thread[0];
  expect(thread).toHaveLength(1);expect(old.goal).toMatchObject({revision:1,input:{message:data.goal,attachmentIds:[]}});
  expect(old.goal?.plan).toBeUndefined();expect(old.goal?.review).toBeUndefined();expect(provider.member).toHaveLength(5);
  const q=await app.Dispatch('loop.enqueue',{id:seed.entry.id,taskId:start.taskId,message:data.insert,options:{...seed.options,permission:'execute'}});
  const insertRequest={id:seed.entry.id,taskId:start.taskId,queueId:q.id,expectedRunId:active.runId};
  const original=PiRpc.prototype.Request,spy=vi.spyOn(PiRpc.prototype,'Request').mockImplementation(async function(this:PiRpc,type,payload,timeout){
   const result=await original.call(this,type,payload,timeout);
   if(type==='steer'){steerCalls++;if(mode==='ack-unknown')throw Error('TEST_NATIVE_ACK_LOST_AFTER_REAL_QUEUED');if(mode==='ack-stop'){held=true;entered();await gate}}
   if(type==='get_state'&&mode==='before-send-stop'&&!held){held=true;entered();await gate}return result;
  });restore=()=>spy.mockRestore();
  if(mode==='ack-save-failure'){
   const service=app.MemberDispatch(seed.entry.id).activeInputs,resolve=service.Resolve.bind(service);
   const saveSpy=vi.spyOn(service,'Resolve').mockImplementation(async(...args)=>{if(args[2].status==='accepted')throw Error('TEST_GOAL_ACK_SAVE_FAILED_BEFORE_TRANSACTION');return resolve(...args)});
   restore=()=>{saveSpy.mockRestore();spy.mockRestore()};
  }
  const insertion=app.Dispatch('loop.queueInsert',insertRequest).then(value=>({ok:true as const,value}),error=>({ok:false as const,error}));
  if(mode==='before-send-stop'||mode==='ack-stop'){
   await arrived;expect((await seed.scopes())[0].activeInputs?.[0].status).toBe('pending');
   const stopping=app.Dispatch('loop.stop',{id:seed.entry.id,taskId:start.taskId});await new Promise(resolve=>setTimeout(resolve,30));release();await stopping;
  }
  const receipt=await insertion;
  if(mode==='ack-stop'||mode==='before-send-stop')await until(async()=>expect((await seed.scopes())[0].status).toBe('closed'));
  const afterAccepted=(await seed.scopes())[0];
  if(mode==='before-send-stop'){
   expect(receipt).toMatchObject({ok:false,error:{code:'QUEUE_INSERT_STOPPED'}});expect(steerCalls).toBe(0);
   expect(afterAccepted.activeInputs?.[0].status).toBe('rejected');expect(afterAccepted.goal).toEqual(old.goal);
  }else if(mode==='ack-unknown'||mode==='ack-save-failure'){
   expect(receipt).toMatchObject({ok:false,error:{code:'QUEUE_INSERT_UNKNOWN'}});
   expect(afterAccepted.activeInputs?.[0].status).toBe(mode==='ack-unknown'?'unknown':'pending');expect(afterAccepted.goal).toEqual(old.goal);
   await expect(app.Dispatch('loop.queueInsert',insertRequest)).rejects.toMatchObject({code:'QUEUE_INSERT_UNKNOWN'});expect(steerCalls).toBe(1);
  }else{
   expect(receipt.ok).toBe(true);expect(afterAccepted.goal?.input).toEqual(old.goal?.input);
   expect(afterAccepted.goal).toMatchObject({revision:2,inputRevision:2});expect(afterAccepted.goal?.review).toBeUndefined();expect(afterAccepted.goal?.plan).toBeUndefined();
   expect(afterAccepted.activeInputs).toHaveLength(1);
   expect(afterAccepted.activeInputs?.[0]).toMatchObject({status:'accepted',runId:active.runId,queueId:q.id,baseInputRevision:1,inputRevision:2,input:{message:data.insert}});
   await app.Dispatch('loop.queueInsert',insertRequest);expect(steerCalls).toBe(1);expect(await seed.scopes()).toEqual([afterAccepted]);
  }
  restore();restore=()=>{};provider.release();
  if(mode==='twice'||mode==='twice-waiting'){
   await until(()=>expect(provider.main).toHaveLength(3));
   const second=await app.Dispatch('loop.enqueue',{id:seed.entry.id,taskId:start.taskId,message:data.second,options:seed.options});
   await app.Dispatch('loop.queueInsert',{...insertRequest,queueId:second.id});
   const next=(await seed.scopes())[0];expect(next.activeInputs?.map(i=>i.runId)).toEqual([active.runId,active.runId]);expect(next.goal?.inputRevision).toBe(3);provider.release(11);
  }
  if(mode==='waiting'||mode==='twice-waiting'){
   const questions=()=>app.Dispatch('loop.questions',{id:seed.entry.id,taskId:start.taskId}) as Promise<PendingQuestion[]>;
   await until(async()=>expect(await questions()).toHaveLength(1));const question=(await questions())[0];
   const before=(await seed.scopes())[0];expect(before.status).toBe('active');expect(before.wait).toBeUndefined();expect(before.runTracking?.mainRunIds).toEqual([active.runId]);
   await app.Dispatch('loop.answerQuestion',{id:seed.entry.id,taskId:start.taskId,questionId:question.id,answers:[{option:0,other:data.continuation}]});
  }
  await until(async()=>{expect((await seed.scopes())[0].status).toBe('closed');expect(app.runtime.Snapshot().pressure.activeRuns).toBe(0)});
  const final=(await seed.scopes())[0];
  if(mode==='ack-unknown'||mode==='ack-save-failure'){expect(final.outcome).toBe('failed');expect(final.goal?.blocked).toBeDefined()}
  else if(mode==='before-send-stop'||mode==='ack-stop')expect(final.outcome).toBe('cancelled');
  else expect(final.outcome).toBe('completed');
  expect(final.goal?.input).toEqual(old.goal?.input);expect(final.goal?.plan).toBeUndefined();expect(final.goal?.review).toBeUndefined();expect(final.wait).toBeUndefined();
  const summaries=await app.Execution(seed.entry.id).Thread(start.taskId);expect(summaries).toHaveLength(1);expect(summaries[0].runId).toBe(active.runId);
  expect(summaries[0].sessionFile).toBe(active.sessionFile);expect(summaries[0].events[0].data.executionModel).toBe('agent-tools-v1');
  const state=await app.Workspace(seed.entry.id).dispatchStore.Read();expect(state.graphs[0].tasks).toEqual([]);expect(state.agentBusinessRuns).toHaveLength(1);
  expect(provider.member).toHaveLength(5);expect(provider.errors).toEqual([]);
  const queue=await app.Dispatch('loop.queue',{id:seed.entry.id,taskId:start.taskId}),nativeFile=summaries[0].sessionFile!,native=await fs.readFile(nativeFile),counts=[provider.main.length,provider.member.length];
  await app.Shutdown();app=new Application(new Paths(f.user,path.resolve('.')),path.resolve('assets'));await app.Init();
  expect(await seed.scopes()).toEqual([final]);expect(await app.Execution(seed.entry.id).Thread(start.taskId)).toEqual(summaries);
  expect(await app.Workspace(seed.entry.id).dispatchStore.Read()).toEqual(state);
  expect(await app.Dispatch('loop.queue',{id:seed.entry.id,taskId:start.taskId})).toEqual(queue.map((item:QueuedMessage)=>({...item,status:'paused',reason:'应用已重启，请确认后继续队列'})));
  expect(await fs.readFile(nativeFile)).toEqual(native);expect([provider.main.length,provider.member.length]).toEqual(counts);
 }catch(error){await fs.mkdir('test-results',{recursive:true});await fs.writeFile('test-results/recursive-active-input-'+mode+'.json',JSON.stringify({error:String(error),main:provider.main,errors:provider.errors,steerCalls,held},null,2));throw error}
 finally{release();restore();provider.release();provider.release(11);await app.Shutdown();await provider.close();await f.cleanup()}
},90000);
