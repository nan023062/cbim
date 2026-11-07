import {expect,it,vi} from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fixture} from './helpers';
import {Application} from '../src/backend/main/application';
import {Paths} from '../src/backend/main/platform/paths';
import {PiRpc} from '../src/backend/core/brain/pi/rpc';
import type {InputImage} from '../src/backend/core/brain/types';
import type {QueuedMessage} from '../src/backend/core/tasks/queue';
import {insertionData as data,insertionProvider} from './queue-insertion-provider';
import {insertionWait,seedInsertion} from './queue-insertion-fixture';

it.each(['complete','images-stop','state-stop','ack-unknown','ack-stop'] as const)('binds actual Pi queue insertion to the original run and stop barrier (%s)',async mode=>{
  const f=await fixture(),provider=await insertionProvider();let app=f.app,restore:()=>void=()=>{},release!:()=>void,entered!:()=>void;
  const gate=new Promise<void>(resolve=>release=resolve),arrived=new Promise<void>(resolve=>entered=resolve);let steerCalls=0,held=false;
  try{
    const seed=await seedInsertion(app,f.a,provider),started=await app.dispatch('loop.chat',{id:seed.entry.id,message:data.goal,options:seed.options}),identity={workspaceId:seed.entry.id,rootSessionId:started.taskId};
    await insertionWait(async()=>provider.requests.length===1,'真实首主请求保持进行');
    const queued=await app.dispatch('loop.enqueue',{id:seed.entry.id,taskId:started.taskId,message:data.insert,attachments:[seed.image.id],options:seed.queuedOptions}),queue=()=>app.dispatch('loop.queue',{id:seed.entry.id,taskId:started.taskId});
    expect((await queue())[0].options).toMatchObject({model:data.otherModel,permission:'execute',attachmentIds:[seed.image.id]});
    if(mode==='images-stop'){
      const manager=app.execution(seed.entry.id) as unknown as {inputImages:(ids?:string[])=>Promise<InputImage[]>},original=manager.inputImages;
      manager.inputImages=async ids=>{const result=await original(ids);expect(result[0].data).toBe(seed.png.toString('base64'));held=true;entered();await gate;return result};restore=()=>{manager.inputImages=original};
    }else{
      const original=PiRpc.prototype.request,spy=vi.spyOn(PiRpc.prototype,'request').mockImplementation(async function(this:PiRpc,type,payload,timeout){
        const result=await original.call(this,type,payload,timeout);
        if(type==='steer'){steerCalls++;if(mode==='ack-unknown')throw Error('TEST_NATIVE_ACK_LOST: 真实 queued 回执已收到后仅测试层丢失');if(mode==='ack-stop'){held=true;entered();await gate}}
        if(type==='get_state'&&mode==='state-stop'&&!held){held=true;entered();await gate}return result;
      });restore=()=>spy.mockRestore();
    }
    const insertion=app.dispatch('loop.queueInsert',{id:seed.entry.id,taskId:started.taskId,queueId:queued.id,expectedRunId:started.runId}).then(value=>({ok:true as const,value}),error=>({ok:false as const,error}));
    if(['images-stop','state-stop','ack-stop'].includes(mode)){await arrived;const stopping=app.dispatch('loop.stop',{id:seed.entry.id,taskId:started.taskId});await new Promise(resolve=>setTimeout(resolve,30));release();await stopping}
    const result=await insertion;
    if(mode==='complete'||mode==='ack-stop'){expect(result).toMatchObject({ok:true});expect(await queue()).toEqual([])}
    else{expect(result.ok).toBe(false);if(!result.ok)expect(result.error).toMatchObject({code:mode==='ack-unknown'?'QUEUE_INSERT_UNKNOWN':'QUEUE_INSERT_STOPPED'});const saved=await queue();expect(saved).toHaveLength(1);expect(saved[0]).toMatchObject({id:queued.id,status:'paused'});expect(saved[0].message).toContain(data.insert)}
    restore();restore=()=>{};provider.release();await insertionWait(async()=>app.runtime.snapshot().pressure.activeRuns===0,'原主运行退出');
    const first=await app.execution(seed.entry.id).inspect(started.taskId,started.runId),accepted=first.events.filter(event=>event.type==='engine.status'&&event.data.metric==='insertion'&&event.data.state==='accepted');
    if(mode==='complete'||mode==='ack-unknown'){
      expect(first.status).toBe('completed');expect(first.toolReceipts?.find(receipt=>receipt.toolCallId==='queue-original-read')?.outcome).toBe('succeeded');expect(provider.requests).toHaveLength(2);expect(steerCalls).toBe(1);expect(provider.earlyClosed).toBe(0);
      expect(JSON.stringify(provider.requests[1].messages)).toContain(data.insert);expect(provider.requests.every(body=>body.model===data.model)).toBe(true);expect(provider.requests.every(body=>!body.tools?.some(tool=>['write','edit','bash'].includes(tool.function.name)))).toBe(true);expect(accepted).toHaveLength(mode==='complete'?1:0);
    }else{
      expect(first.status).toBe('cancelled');expect(provider.requests).toHaveLength(1);expect(accepted).toHaveLength(mode==='ack-stop'?1:0);if(mode==='state-stop')expect(steerCalls).toBe(0);
      if(mode!=='ack-stop'){
        const fresh=await app.dispatch('loop.resume',{id:seed.entry.id,taskId:started.taskId,runId:started.runId,message:data.fresh,options:seed.options});await insertionWait(async()=>provider.requests.length===2,'显式新主轮请求');expect(fresh.runId).not.toBe(started.runId);
        const beforeRepeat=await seed.scopes(),prior=beforeRepeat.flatMap(scope=>scope.activeInputs??[]).find(item=>item.queueId===queued.id),savedQueue=await queue(),savedNative=first.sessionFile?await fs.readFile(first.sessionFile,'utf8'):'';
        // get_state 前已登记的 rejected 是持久事实；附件准备前停止尚无该记录，仍按旧运行失效拒绝。
        if(mode==='state-stop')expect(prior).toMatchObject({status:'rejected',runId:started.runId,queueId:queued.id});else expect(prior).toBeUndefined();
        const retryRpc=vi.spyOn(PiRpc.prototype,'request');
        try{await expect(app.dispatch('loop.queueInsert',{id:seed.entry.id,taskId:started.taskId,queueId:queued.id,expectedRunId:started.runId})).rejects.toMatchObject({code:mode==='state-stop'?'QUEUE_INSERT_STOPPED':'QUEUE_INSERT_STALE'});expect(retryRpc.mock.calls.filter(call=>call[0]==='steer')).toHaveLength(0)}finally{retryRpc.mockRestore()}
        expect(await seed.scopes()).toEqual(beforeRepeat);expect(await queue()).toEqual(savedQueue);expect(await app.execution(seed.entry.id).inspect(started.taskId,started.runId)).toEqual(first);if(first.sessionFile)expect(await fs.readFile(first.sessionFile,'utf8')).toBe(savedNative);expect(provider.requests).toHaveLength(2);expect((await queue())[0].id).toBe(queued.id);expect(JSON.stringify(provider.requests[1].messages)).not.toContain(data.insert);provider.releaseFresh();await insertionWait(async()=>app.runtime.snapshot().pressure.activeRuns===0,'新主轮完成');
      }
    }
    const thread=await app.execution(seed.entry.id).thread(started.taskId),savedQueue=await queue(),scopes=await seed.scopes(),graph=await app.dispatch('dispatch.graphSnapshot',{identity}),native=first.sessionFile?await fs.readFile(first.sessionFile,'utf8'):'';expect(provider.errors).toEqual([]);const count=provider.requests.length;
    await app.shutdown();app=new Application(new Paths(f.user,path.resolve('.')),path.resolve('design'));await app.init();
    expect(await app.execution(seed.entry.id).thread(started.taskId)).toEqual(thread);expect(await queue()).toEqual(savedQueue.map((item:QueuedMessage)=>({...item,status:'paused',reason:'应用已重启，请确认后继续队列'})));expect(await seed.scopes()).toEqual(scopes);expect(await app.dispatch('dispatch.graphSnapshot',{identity})).toEqual(graph);if(first.sessionFile)expect(await fs.readFile(first.sessionFile,'utf8')).toBe(native);expect(provider.requests).toHaveLength(count);expect(app.runtime.snapshot().pressure.activeRuns).toBe(0);
  }catch(error){await fs.mkdir('test-results',{recursive:true});await fs.writeFile(`test-results/queue-insertion-${mode}-pi-failure.json`,JSON.stringify({error:String(error),requests:provider.requests,providerErrors:provider.errors,steerCalls,held},null,2));throw error}
  finally{release();restore();provider.release();provider.releaseFresh();await app.shutdown();await provider.close();await f.cleanup()}
},120000);
