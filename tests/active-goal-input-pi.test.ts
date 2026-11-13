import {expect,it,vi} from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {fixture} from './helpers';
import {Application} from '../src/backend/main/assembly/application';
import {Paths} from '../src/backend/main/platform/paths';
import {PiRpc} from '../src/backend/engines/pi/rpc';
import type {QueuedMessage} from '../src/logic/tasks/rules/queue';
import {activeInputProvider,activeInputData as data,type ActiveInputMode} from './active-goal-input-provider';
import {activeInputWait,seedActiveInput} from './active-goal-input-fixture';

const modes=['stale-complete','stale-waiting','replan','twice','waiting','twice-waiting','ack-unknown','ack-save-failure','before-send-stop','ack-stop'] as const;
it.each(modes)('binds actual active input to goal versions and final review (%s)',async mode=>{
  const providerMode:ActiveInputMode=['ack-unknown','ack-save-failure','before-send-stop','ack-stop'].includes(mode)?'stale-complete':mode as ActiveInputMode;
  const f=await fixture(),provider=await activeInputProvider(providerMode);let app=f.app,restore=()=>{},release!:()=>void,entered!:()=>void;
  const gate=new Promise<void>(resolve=>release=resolve),arrived=new Promise<void>(resolve=>entered=resolve);let steerCalls=0,held=false;
  try{
    const seed=await seedActiveInput(app,f.a,f.user,provider),start=await app.dispatch('loop.chat',{id:seed.entry.id,message:data.goal,options:seed.options}),identity={workspaceId:seed.entry.id,rootSessionId:start.taskId};
    await activeInputWait(async()=>provider.main.length===6,'真实旧审阅已保存并保持主运行');
    const old=(await seed.scopes())[0],thread=await app.execution(seed.entry.id).thread(start.taskId),active=thread.at(-1)!;
    expect(old.goal?.review?.decision).toBe(mode==='stale-waiting'?'awaiting_user':'complete');expect(old.goal?.revision).toBe(3);expect(old.goal?.inputRevision??1).toBe(1);
    const q=await app.dispatch('loop.enqueue',{id:seed.entry.id,taskId:start.taskId,message:data.insert,options:{...seed.options,permission:'execute'}}),insertRequest={id:seed.entry.id,taskId:start.taskId,queueId:q.id,expectedRunId:active.runId};
    const original=PiRpc.prototype.request,spy=vi.spyOn(PiRpc.prototype,'request').mockImplementation(async function(this:PiRpc,type,payload,timeout){
      const result=await original.call(this,type,payload,timeout);
      if(type==='steer'){steerCalls++;if(mode==='ack-unknown')throw Error('TEST_NATIVE_ACK_LOST_AFTER_REAL_QUEUED');if(mode==='ack-stop'){held=true;entered();await gate}}
      if(type==='get_state'&&mode==='before-send-stop'&&!held){held=true;entered();await gate}return result;
    });restore=()=>spy.mockRestore();
    if(mode==='ack-save-failure'){
      const service=app.memberDispatch(seed.entry.id).activeInputs,resolve=service.resolve.bind(service);
      const saveSpy=vi.spyOn(service,'resolve').mockImplementation(async(...args)=>{if(args[2].status==='accepted')throw Error('TEST_GOAL_ACK_SAVE_FAILED_BEFORE_TRANSACTION');return resolve(...args)});
      restore=()=>{saveSpy.mockRestore();spy.mockRestore()};
    }
    const insertion=app.dispatch('loop.queueInsert',insertRequest).then(value=>({ok:true as const,value}),error=>({ok:false as const,error}));
    if(mode==='before-send-stop'||mode==='ack-stop'){await arrived;const pending=(await seed.scopes())[0];expect(pending.activeInputs?.[0].status).toBe('pending');const stopping=app.dispatch('loop.stop',{id:seed.entry.id,taskId:start.taskId});await new Promise(resolve=>setTimeout(resolve,30));release();await stopping}
    const receipt=await insertion,afterAccepted=(await seed.scopes())[0];
    if(mode==='before-send-stop'){
      expect(receipt).toMatchObject({ok:false,error:{code:'QUEUE_INSERT_STOPPED'}});expect(steerCalls).toBe(0);expect(afterAccepted.activeInputs?.[0].status).toBe('rejected');expect(afterAccepted.goal).toEqual(old.goal);
    }else if(mode==='ack-unknown'||mode==='ack-save-failure'){
      expect(receipt).toMatchObject({ok:false,error:{code:'QUEUE_INSERT_UNKNOWN'}});expect(afterAccepted.activeInputs?.[0].status).toBe(mode==='ack-unknown'?'unknown':'pending');expect(afterAccepted.goal).toEqual(old.goal);
      await expect(app.dispatch('loop.queueInsert',insertRequest)).rejects.toMatchObject({code:'QUEUE_INSERT_UNKNOWN'});expect(steerCalls).toBe(1);
    }else{
      expect(receipt.ok).toBe(true);expect(afterAccepted.goal?.input).toEqual(old.goal?.input);expect(afterAccepted.goal?.revision).toBe(4);expect(afterAccepted.goal?.inputRevision).toBe(2);expect(afterAccepted.goal?.review).toBeUndefined();expect(afterAccepted.goal?.plan).toEqual(old.goal?.plan);
      expect(afterAccepted.activeInputs).toHaveLength(1);expect(afterAccepted.activeInputs?.[0]).toMatchObject({status:'accepted',runId:active.runId,queueId:q.id,baseInputRevision:1,inputRevision:2,input:{message:data.insert}});
      await app.dispatch('loop.queueInsert',insertRequest);expect(steerCalls).toBe(1);expect(await seed.scopes()).toEqual([afterAccepted]);
    }
    restore();restore=()=>{};provider.release();
    if(mode==='twice'||mode==='twice-waiting'){
      await activeInputWait(async()=>provider.main.length===12,'同一原主轮第二次审阅已保存');
      const before=(await seed.scopes())[0];expect(before.goal?.review?.inputRevision).toBe(2);
      const second=await app.dispatch('loop.enqueue',{id:seed.entry.id,taskId:start.taskId,message:data.second,options:seed.options});await app.dispatch('loop.queueInsert',{...insertRequest,queueId:second.id});
      const next=(await seed.scopes())[0];expect(next.activeInputs?.map(item=>item.runId)).toEqual([active.runId,active.runId]);expect(next.goal?.inputRevision).toBe(3);expect(next.goal?.review).toBeUndefined();provider.release(11);
    }
    await activeInputWait(async()=>{const scope=(await seed.scopes())[0];return scope.status!=='active'&&app.runtime.snapshot().pressure.activeRuns===0},'插入后的真实周期终态或安全等待');
    let final=(await seed.scopes())[0];
    if(mode==='waiting'||mode==='twice-waiting'){
      expect(final.status).toBe('waiting');expect(final.wait).toBeDefined();expect(final.goal?.review?.inputRevision).toBe(final.goal?.inputRevision);expect(final.runTracking?.mainRunIds).toHaveLength(2);
      const before=structuredClone(final),commandId=randomUUID(),request={...identity,scopeId:final.scopeId,waitId:final.wait!.waitId,expectedGoalRevision:final.goal!.revision,expectedInputRevision:final.goal!.inputRevision!,commandId,input:{message:data.continuation},options:seed.options};
      const accepted=await app.dispatch('loop.goalContinue',request);expect(accepted.continuation.runId).not.toBe(active.runId);expect(accepted.continuation.inputRevision).toBe(before.goal!.inputRevision!+1);
      await activeInputWait(async()=>{const s=(await seed.scopes())[0];return s.status==='closed'&&app.runtime.snapshot().pressure.activeRuns===0},'安全等待显式补充按连续输入版完成');final=(await seed.scopes())[0];
      expect(final.activeInputs).toEqual(before.activeInputs);expect(final.continuations).toHaveLength(1);expect(final.goal?.input).toEqual(old.goal?.input);expect(final.goal?.inputRevision).toBe(mode==='waiting'?3:4);
    }
    if(['stale-complete','stale-waiting','ack-unknown','ack-save-failure'].includes(mode)){expect(final).toMatchObject({status:'closed',outcome:'failed'});expect(final.wait).toBeUndefined();expect(final.goal?.blocked).toBeDefined()}
    else if(mode==='before-send-stop'||mode==='ack-stop')expect(final).toMatchObject({status:'closed',outcome:'cancelled'});
    else{expect(final).toMatchObject({status:'closed',outcome:'completed'});expect(final.goal?.review?.inputRevision).toBe(final.goal?.inputRevision);expect(final.goal?.plan?.inputRevision).toBe(final.goal?.inputRevision)}
    const stale=mode==='stale-complete'||mode==='stale-waiting';
    const summaries=await app.execution(seed.entry.id).thread(start.taskId),mainNative=new Set(summaries.map(run=>run.events.find(event=>event.type==='session.bound')?.data.sessionId));expect(mainNative.size).toBe(1);expect([...mainNative][0]).toEqual(expect.any(String));expect(summaries).toHaveLength(mode==='waiting'||mode==='twice-waiting'?3:stale?4:2);
    if(stale){
      expect(provider.main).toHaveLength(9);expect(final.goal?.inputRevision).toBe(2);expect(final.goal?.review).toBeUndefined();expect(final.activeInputs).toEqual(afterAccepted.activeInputs);
      expect(summaries.slice(2).map(run=>run.source)).toEqual([1,2].map(attempt=>expect.objectContaining({kind:'goal-repair',scopeId:final.scopeId,attempt,failureCode:'GOAL_REVIEW_REQUIRED'})));
    }
    expect(provider.member).toHaveLength(5);expect(provider.errors).toEqual([]);expect(provider.main.every(body=>!body.tools?.some(tool=>['write','edit','bash'].includes(tool.function.name)))).toBe(true);
    const graph=await app.dispatch('dispatch.graphSnapshot',{identity}),queue=await app.dispatch('loop.queue',{id:seed.entry.id,taskId:start.taskId}),nativeFile=summaries.at(-1)?.sessionFile,native=nativeFile?await fs.readFile(nativeFile,'utf8'):'';
    const requests={main:provider.main.length,member:provider.member.length};await app.shutdown();app=new Application(new Paths(f.user,path.resolve('.')),path.resolve('design'));await app.init();
    expect(await seed.scopes()).toEqual([final]);expect(await app.execution(seed.entry.id).thread(start.taskId)).toEqual(summaries);expect(await app.dispatch('dispatch.graphSnapshot',{identity})).toEqual(graph);expect(await app.dispatch('loop.queue',{id:seed.entry.id,taskId:start.taskId})).toEqual(queue.map((item:QueuedMessage)=>({...item,status:'paused',reason:'应用已重启，请确认后继续队列'})));if(nativeFile)expect(await fs.readFile(nativeFile,'utf8')).toBe(native);expect({main:provider.main.length,member:provider.member.length}).toEqual(requests);
    await fs.mkdir('test-results',{recursive:true});await fs.writeFile(`test-results/active-goal-input-${mode}-pi-evidence.json`,JSON.stringify({mode,requests,steerCalls,old,afterAccepted,final,root:graph.root,mainRuns:summaries.map(run=>({runId:run.runId,nativeSessionId:run.events.find(event=>event.type==='session.bound')?.data.sessionId,status:run.status})),errors:provider.errors},null,2));
  }catch(error){await fs.mkdir('test-results',{recursive:true});await fs.writeFile(`test-results/active-goal-input-${mode}-pi-failure.json`,JSON.stringify({error:String(error),main:provider.main,member:provider.member,errors:provider.errors,steerCalls,held},null,2));throw error}
  finally{release();restore();provider.release();provider.release(11);await app.shutdown();await provider.close();await f.cleanup()}
},120000);
