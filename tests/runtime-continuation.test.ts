import {expect,it,vi} from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {LoopRuntime} from '../src/backend/core/execution/runtime/runtime';
import type {AgentEngine,EngineContext,TaskSpec} from '../src/backend/core/execution/types';
import type {UserContinuationSource} from '../src/backend/core/execution/input-source';
import {FileRunStorage} from '../src/backend/main/run-storage/run-storage';

const deferred=()=>{let resolve!:()=>void;const promise=new Promise<void>(done=>{resolve=done});return {promise,resolve}};
const source:UserContinuationSource={kind:'user-continuation',continuationId:'input-command',scopeId:'scope-one',waitId:'wait-one',inputRevision:2};

/** Stops use the real runtime and journal, with a deterministic engine only at the externally controlled preparation boundary. */
it.each(['before-intent','journal-init','engine-start','engine-ready','lease-failed','aborted-before-start'] as const)('does not launch a model or leak a lease when explicit continuation stops at %s',async(mode)=>{
  const directory=await fs.mkdtemp(path.join(os.tmpdir(),'cbim-runtime-continue-')),boundary=deferred(),entered=deferred(),engines:{ran:boolean;closed:boolean;stopped:boolean}[]=[];
  let leases=0,continuing=false;
  const task:TaskSpec={taskId:'main-session',workspaceId:'workspace',root:directory,goal:'Original goal',mode:'chat',moduleIds:[],acceptance:[]};
  const storage=new FileRunStorage(),createJournal=storage.createJournal.bind(storage);
  storage.createJournal=(directory,task,runId)=>{const journal=createJournal(directory,task,runId),initialize=journal.init.bind(journal);journal.init=async()=>{await initialize();if(continuing&&mode==='journal-init'){entered.resolve();await boundary.promise}};return journal};
  const runtime=new LoopRuntime({directory,storage,acquireLease:async()=>{if(continuing&&mode==='lease-failed')throw Error('MEMBER_BUSY');leases++;return()=>{leases--}},toolPolicy:async()=>({allow:false}),onEngineReady:async()=>{if(continuing&&mode==='engine-ready'){entered.resolve();await boundary.promise}},createEngine:()=>{
    const state={ran:false,closed:false,stopped:false};engines.push(state);
    const engine:AgentEngine={kind:'test',start:async(context:EngineContext)=>{await context.emit({type:'session.bound',data:{sessionId:context.nativeSessionId??task.taskId,sessionFile:context.sessionFile??path.join(context.directory,'native.jsonl')}});if(continuing&&mode==='engine-start'){entered.resolve();await boundary.promise}},run:async()=>{state.ran=true;return {status:'completed'}},stop:async()=>{state.stopped=true},close:async()=>{state.closed=true}};return engine;
  }});
  try{
    const original=await runtime.start(task);await original.done;expect(leases).toBe(0);continuing=true;
    const controller=new AbortController(),beforeRun=vi.fn(async(input:{task:TaskSpec;runId:string})=>{expect(input.task).toEqual(task);expect(input.runId).not.toBe(original.runId);if(mode==='before-intent'){entered.resolve();await boundary.promise}});
    if(mode==='aborted-before-start')controller.abort(Error('Stopped before startup'));
    const pending=runtime.start(task,'Explicit format supplement',{runId:original.runId},source,{signal:controller.signal,beforeRun});
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
    const logs=await new FileRunStorage().list(path.join(directory,task.taskId));expect(logs).toHaveLength(['journal-init','engine-start','engine-ready'].includes(mode)?2:1);
    for(const id of logs){const record=await storage.read(path.join(directory,task.taskId,id));expect(record.task).toEqual(task);expect(record.events[0].type).toBe('run.started');expect(record.status).toBe(id===original.runId?'completed':'cancelled')}
  }finally{boundary.resolve();await runtime.close();const target=path.resolve(directory);if(path.dirname(target)!==path.resolve(os.tmpdir())||!path.basename(target).startsWith('cbim-runtime-continue-'))throw Error('Unexpected test cleanup path');await fs.rm(target,{recursive:true,force:true})}
});
