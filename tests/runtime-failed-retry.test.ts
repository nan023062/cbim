import {afterEach,expect,it} from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {LoopRuntime} from '../src/logic/execution/rules/runtime/runtime';
import {FileRunStorage} from '../src/backend/main/run-storage/run-storage';
import type {AgentEngine,EngineContext,TaskSpec} from '../src/logic/execution/rules/types';

const cleanups:(()=>Promise<void>)[]=[];
afterEach(async()=>{for(const cleanup of cleanups.splice(0))await cleanup()});
async function fixture(attempts:{kind:string;fail?:boolean;tool?:boolean}[]){
  const directory=await fs.mkdtemp(path.join(os.tmpdir(),'cbim-failed-retry-')),contexts:EngineContext[]=[];
  const task:TaskSpec={taskId:'main',workspaceId:'workspace',root:directory,mode:'chat',agentId:'cbim:main',goal:'User request',moduleIds:[],acceptance:[]};
  let leases=0,index=0,modelCalls=0;
  const runtime=new LoopRuntime({directory,storage:new FileRunStorage(),acquireLease:async()=>{leases++;return()=>{leases--}},toolPolicy:async()=>({allow:true,effects:['read']}),createEngine:()=>{
    const attempt=attempts[index++];let current:EngineContext;
    const engine:AgentEngine={kind:attempt.kind,start:async context=>{
      current=context;contexts.push(context);
      await context.emit({type:'session.bound',data:{sessionId:context.nativeSessionId??context.runId,...(!attempt.fail?{sessionFile:context.sessionFile??path.join(context.directory,'native.jsonl')}: {})}});
    },run:async()=>{
      modelCalls++;
      if(attempt.tool){await current.beforeTool({id:'read',name:'read',input:{path:'sample.txt'}});await current.emit({type:'tool.finished',data:{id:'read',name:'read',result:{content:[{type:'text',text:'read result'}]}}})}
      if(attempt.fail)throw Error('Provider HTTP 400 before reliable response');
      return {status:'completed'};
    },stop:async()=>{},close:async()=>{}};
    return engine;
  }});
  cleanups.push(async()=>{await runtime.close();expect(leases).toBe(0);const target=path.resolve(directory);if(path.dirname(target)!==path.resolve(os.tmpdir())||!path.basename(target).startsWith('cbim-failed-retry-'))throw Error('Unexpected cleanup path');await fs.rm(target,{recursive:true,force:true})});
  return {task,runtime,contexts,modelCalls:()=>modelCalls};
}

it.each(['codex','pi'])('首轮未绑定原生文件且未执行工具，显式重发到 %s 可继续同一逻辑对话',async kind=>{
  const f=await fixture([{kind:'codex',fail:true},{kind}]);
  const first=await f.runtime.start(f.task),failed=await first.done;
  expect(failed.status).toBe('interrupted');expect(failed.sessionFile).toBeUndefined();
  const before=JSON.stringify(failed.events);
  const retry=await f.runtime.start(f.task,'Explicit retry',{runId:first.runId});
  expect((await retry.done).status).toBe('completed');expect(f.modelCalls()).toBe(2);
  expect(f.contexts[1].sessionFile).toBeUndefined();expect(f.contexts[1].nativeSessionId).toBeUndefined();
  expect(JSON.parse(f.contexts[1].engineHandoff!)).toMatchObject([{runId:first.runId,input:f.task.goal,status:'interrupted'}]);
  expect(JSON.stringify((await f.runtime.inspect(f.task.taskId,first.runId)).events)).toBe(before);
});

it('切回原引擎跨过未绑定文件的失败轮次，只恢复原文件并转交失败输入',async()=>{
  const f=await fixture([{kind:'pi'},{kind:'codex',fail:true},{kind:'pi'}]);
  const first=await f.runtime.start(f.task),original=await first.done;
  const second=await f.runtime.start(f.task,'Try Codex',{runId:first.runId});await second.done;
  const retry=await f.runtime.start(f.task,'Back to Pi',{runId:second.runId});expect((await retry.done).status).toBe('completed');
  expect(f.contexts[2].sessionFile).toBe(original.sessionFile);
  expect(f.contexts[2].nativeSessionId).toBe(first.runId);
  expect(JSON.parse(f.contexts[2].engineHandoff!).map((entry:{runId:string})=>entry.runId)).toEqual([second.runId]);
});

it('缺少原生文件但已经执行工具的失败不能被当作未执行启动来重试',async()=>{
  const f=await fixture([{kind:'codex',fail:true,tool:true},{kind:'pi'}]);
  const first=await f.runtime.start(f.task),failed=await first.done;expect(failed.unresolvedTools).toEqual([]);
  await expect(f.runtime.start(f.task,'Retry',{runId:first.runId})).rejects.toThrow('缺少原生会话');
  expect(f.modelCalls()).toBe(1);expect(f.contexts).toHaveLength(1);
});
