import {expect,it,vi} from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {LoopRuntime} from '../src/logic/execution/rules/runtime/runtime';
import type {AgentEngine,EngineContext,TaskSpec} from '../src/logic/execution/rules/types';
import type {UserContinuationSource} from '../src/logic/execution/rules/input-source';
import {FileRunStorage} from '../src/logic/execution/storage/run-storage';

const deferred=()=>{let resolve!:()=>void;const promise=new Promise<void>(done=>{resolve=done});return {promise,resolve}};
const source:UserContinuationSource={kind:'user-continuation',continuationId:'input-command',scopeId:'scope-one',waitId:'wait-one',inputRevision:2};

/** Stops use the real runtime and journal, with a deterministic engine only at the externally controlled preparation boundary. */
it.each(['before-intent','journal-init','engine-start','engine-ready','lease-failed','aborted-before-start'] as const)('does not launch a model or leak a lease when explicit continuation stops at %s',async(mode)=>{
  const directory=await fs.mkdtemp(path.join(os.tmpdir(),'cbim-runtime-continue-')),boundary=deferred(),entered=deferred(),engines:{ran:boolean;closed:boolean;stopped:boolean}[]=[];
  let leases=0,continuing=false;
  const task:TaskSpec={taskId:'main-session',workspaceId:'workspace',root:directory,goal:'Original goal',mode:'chat',moduleIds:[],acceptance:[]};
  const storage=new FileRunStorage(),createJournal=storage.CreateJournal.bind(storage);
  storage.CreateJournal=(directory,task,runId)=>{const journal=createJournal(directory,task,runId),initialize=journal.Init.bind(journal);journal.Init=async()=>{await initialize();if(continuing&&mode==='journal-init'){entered.resolve();await boundary.promise}};return journal};
  const runtime=new LoopRuntime({directory,storage,engineKind:'test',AcquireLease:async()=>{if(continuing&&mode==='lease-failed')throw Error('MEMBER_BUSY');leases++;return()=>{leases--}},ToolPolicy:async()=>({allow:false}),OnEngineReady:async()=>{if(continuing&&mode==='engine-ready'){entered.resolve();await boundary.promise}},CreateEngine:()=>{
    const state={ran:false,closed:false,stopped:false};engines.push(state);
    const engine:AgentEngine={kind:'test',start:async(context:EngineContext)=>{await context.emit({type:'session.bound',data:{sessionId:context.nativeSessionId??task.taskId,sessionFile:context.sessionFile??path.join(context.directory,'native.jsonl')}});if(continuing&&mode==='engine-start'){entered.resolve();await boundary.promise}},run:async()=>{state.ran=true;return {status:'completed'}},stop:async()=>{state.stopped=true},close:async()=>{state.closed=true}};return engine;
  }});
  try{
    const original=await runtime.Start(task);await original.done;expect(leases).toBe(0);continuing=true;
    const controller=new AbortController(),beforeRun=vi.fn(async(input:{task:TaskSpec;runId:string})=>{expect(input.task).toEqual(task);expect(input.runId).not.toBe(original.runId);if(mode==='before-intent'){entered.resolve();await boundary.promise}});
    if(mode==='aborted-before-start')controller.abort(Error('Stopped before startup'));
    const pending=runtime.Start(task,'Explicit format supplement',{runId:original.runId},source,{signal:controller.signal,BeforeRun: beforeRun});
    if(mode==='lease-failed'||mode==='aborted-before-start'){
      await expect(pending).rejects.toThrow(mode==='lease-failed'?'MEMBER_BUSY':'Stopped before startup');expect(beforeRun).not.toHaveBeenCalled();expect(engines).toHaveLength(1);
    }else if(mode==='before-intent'){
      const rejected=expect(pending).rejects.toThrow('Stopped during startup');await entered.promise;controller.abort(Error('Stopped during startup'));boundary.resolve();await rejected;expect(beforeRun).toHaveBeenCalledTimes(1);expect(engines).toHaveLength(1);
    }else{
      if(mode==='journal-init'){await entered.promise;controller.abort(Error('Stopped during journal init'));boundary.resolve()}
      const started=await pending;
      if(mode!=='journal-init'){await entered.promise;controller.abort(Error('Stopped during startup'));boundary.resolve()}
      const result=await started.done;
      expect(result.status).toBe('cancelled');expect(result.source).toEqual(source);expect(engines).toHaveLength(2);expect(engines[1]).toEqual({ran:false,closed:true,stopped:true});expect(beforeRun).toHaveBeenCalledTimes(1);
    }
    expect(leases).toBe(0);
    const logs=await new FileRunStorage().List(path.join(directory,task.taskId));expect(logs).toHaveLength(['journal-init','engine-start','engine-ready'].includes(mode)?2:1);
    for(const id of logs){const record=await storage.Read(path.join(directory,task.taskId,id));expect(record.task).toEqual(task);expect(record.events[0].type).toBe('run.started');expect(record.status).toBe(id===original.runId?'completed':'cancelled')}
  }finally{boundary.resolve();await runtime.Close();const target=path.resolve(directory);if(path.dirname(target)!==path.resolve(os.tmpdir())||!path.basename(target).startsWith('cbim-runtime-continue-'))throw Error('Unexpected test cleanup path');await fs.rm(target,{recursive:true,force:true})}
});

/** Engine history is a precondition of durable acceptance, not a failed run after acceptance. */
it.each(['oversized','cancelled','valid','factory-failed','wrong-engine'] as const)('checks declared engine history before accepting continuation: %s',async mode=>{
  const directory=await fs.mkdtemp(path.join(os.tmpdir(),'cbim-preflight-'));
  const storage=new FileRunStorage(),controller=new AbortController();
  const task:TaskSpec={taskId:'session',workspaceId:'workspace',root:directory,goal:'Original request',mode:'chat',agentId:'cbim:main',moduleIds:[],acceptance:[]};
  let leases=0;
  const acquireLease=async()=>{leases++;return()=>{leases--}};
  let originalContext:EngineContext|undefined,nextContext:EngineContext|undefined;
  const first=new LoopRuntime({directory,storage,engineKind:'pi',AcquireLease: acquireLease,ToolPolicy:async()=>({allow:false}),CreateEngine:()=>({kind:'pi',start:async context=>{
    originalContext=context;await context.emit({type:'session.bound',data:{sessionId:context.runId,sessionFile:path.join(context.directory,'native.jsonl')}});
  },run:async()=>{await originalContext!.emit({type:'message',data:{text:mode==='oversized'?'x'.repeat(1024*1024):'Original result'}});return {status:'completed'}},stop:async()=>{},close:async()=>{}})});
  const beforeRun=vi.fn(async()=>{}),close=vi.fn(async()=>{});
  const createEngine=vi.fn(()=>{
    expect(beforeRun).toHaveBeenCalledTimes(1);
    if(mode==='factory-failed')throw Error('Assembly failed');
    const engine:AgentEngine={kind:mode==='wrong-engine'?'pi':'codex',start:async context=>{
      nextContext=context;await context.emit({type:'session.bound',data:{sessionId:context.runId,sessionFile:path.join(context.directory,'native.jsonl')}});
    },run:async()=>({status:'completed'}),stop:async()=>{},close: close};return engine;
  });
  const second=new LoopRuntime({directory,storage,engineKind:'codex',AcquireLease: acquireLease,ToolPolicy:async()=>({allow:false}),CreateEngine: createEngine});
  try{
    const old=await first.Start(task);await old.done;await first.Close();
    const read=storage.Read.bind(storage);
    storage.Read=async location=>{const result=await read(location);if(mode==='cancelled')controller.abort(Error('Cancelled during history check'));return result};
    const start=second.Start(task,'Continue with Codex',{runId:old.runId},undefined,{signal:controller.signal,BeforeRun: beforeRun});
    if(mode==='oversized'||mode==='cancelled'){
      await expect(start).rejects.toThrow(mode==='oversized'?'1 MiB':'Cancelled during history check');
      expect(beforeRun).not.toHaveBeenCalled();expect(createEngine).not.toHaveBeenCalled();
    }else if(mode==='factory-failed'||mode==='wrong-engine'){
      await expect(start).rejects.toThrow(mode==='factory-failed'?'Assembly failed':'冻结引擎身份不一致');
      expect(beforeRun).toHaveBeenCalledTimes(1);
      if(mode==='wrong-engine')expect(close).toHaveBeenCalledTimes(1);
    }else{
      expect((await (await start).done).status).toBe('completed');
      expect(JSON.parse(nextContext!.engineHandoff!)).toMatchObject([{runId:old.runId,input:task.goal}]);
      expect(nextContext!.sessionFile).toBeUndefined();
    }
    expect(leases).toBe(0);
    expect(await storage.List(path.join(directory,task.taskId))).toHaveLength(mode==='valid'?2:1);
  }finally{
    await first.Close();await second.Close();
    const target=path.resolve(directory);if(path.dirname(target)!==path.resolve(os.tmpdir())||!path.basename(target).startsWith('cbim-preflight-'))throw Error('Unexpected cleanup path');
    await fs.rm(target,{recursive:true,force:true});
  }
});
