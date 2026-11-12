import {expect,it,vi} from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {LoopRuntime} from '../src/backend/core/execution/runtime/runtime';
import type {AgentEngine,EngineContext,EngineEvent} from '../src/backend/core/execution/types';
import {FileRunStorage} from '../src/backend/main/run-storage/run-storage';
import {hash,json} from '../src/backend/core/foundation/serialization';
import {scopedActiveInputHash} from '../src/backend/core/tasks/scope-active-input-rules';

async function fixture(afterSave?:(event:EngineEvent)=>void){
  const directory=await fs.mkdtemp(path.join(os.tmpdir(),'cbim-active-input-runtime-')),storage=new FileRunStorage(),create=storage.createJournal.bind(storage);
  storage.createJournal=(...args)=>{const journal=create(...args),append=journal.append.bind(journal);journal.append=async event=>{const saved=await append(event);afterSave?.(event);return saved};return journal};
  let context!:EngineContext,finish!:(value:{status:'cancelled'})=>void;const done=new Promise<{status:'cancelled'}>(resolve=>{finish=resolve}),steer=vi.fn(async()=>{});
  const engine:AgentEngine={kind:'controlled',start:async value=>{context=value},run:()=>done,steer,stop:async()=>{finish({status:'cancelled'})},close:async()=>{}};
  const runtime=new LoopRuntime({directory,storage,createEngine:()=>engine,acquireLease:async()=>()=>{},toolPolicy:async()=>({allow:false})}),run=await runtime.start({taskId:'main',workspaceId:'workspace',root:directory,mode:'chat',agentId:'cbim:main',moduleIds:[],goal:'原输入',acceptance:[]});
  await vi.waitFor(()=>expect(context).toBeDefined());const input={message:'新增输入'},token={scopeId:'scope',insertionId:hash(json({scopeId:'scope',runId:run.runId,queueId:'queue'})),queueId:'queue',runId:run.runId,inputHash:scopedActiveInputHash(input)};
  return {runtime,run,context,token,input,steer,insert:()=>runtime.steer('main',input.message,[],{expectedRunId:run.runId,signal:new AbortController().signal,activeInput:{token}}),cleanup:async()=>{finish({status:'cancelled'});await runtime.close();const target=path.resolve(directory);if(path.dirname(target)!==path.resolve(os.tmpdir())||!path.basename(target).startsWith('cbim-active-input-runtime-'))throw Error('Unexpected cleanup');await fs.rm(target,{recursive:true,force:true})}};
}

it('引擎事件不能伪造activeInput，真实插入只返回本轮持久日志序号',async()=>{
  const f=await fixture();try{
    await expect(f.context.emit({type:'engine.status',data:{metric:'insertion',state:'accepted',activeInput:f.token,message:f.input.message}})).rejects.toThrow('可信插入');
    const receipt=await f.insert(),summary=await f.runtime.inspect('main',f.run.runId),events=summary.events.filter(event=>event.data.activeInput!==undefined);
    expect(f.steer).toHaveBeenCalledTimes(1);expect(events.map(event=>event.data.state)).toEqual(['requested','accepted']);expect(receipt).toEqual({...f.token,requestedSeq:events[0].seq,acceptedSeq:events[1].seq});
  }finally{await f.cleanup()}
});

it('queued之后日志保存错误即便携带STOPPED码也只能unknown，不能记录未发送',async()=>{
  const f=await fixture(event=>{if(event.data.metric==='insertion'&&event.data.state==='accepted')throw Object.assign(Error('save failure'),{code:'QUEUE_INSERT_STOPPED'})});try{
    await expect(f.insert()).rejects.toMatchObject({code:'QUEUE_INSERT_UNKNOWN'});expect(f.steer).toHaveBeenCalledTimes(1);
    const summary=await f.runtime.inspect('main',f.run.runId),failure=summary.events.find(event=>event.data.metric==='insertion'&&event.data.state==='failed');expect(failure?.data.label).toBe('插入未确认，请核实后继续');
  }finally{await f.cleanup()}
});
