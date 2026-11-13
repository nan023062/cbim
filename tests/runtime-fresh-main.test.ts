import {expect,it,vi} from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {LoopRuntime} from '../src/logic/execution/rules/runtime/runtime';
import type {AgentEngine,EngineContext,TaskSpec} from '../src/logic/execution/rules/types';
import type {ConversationAgentBinding} from '../src/logic/execution/rules/conversation-binding';
import {FileRunStorage} from '../src/backend/main/run-storage/run-storage';

const deferred=()=>{let resolve!:()=>void;const promise=new Promise<void>(done=>{resolve=done});return {promise,resolve}};

/** Actual runtime and file journal, with only engine preparation delayed to expose cancellation boundaries. */
it.each(['complete','missing-intent','lease-failed','pre-aborted','before-intent','intent-rejected','journal-init','engine-ready','missing-directory','unbound-main'] as const)('opens a fresh native main channel without reading broken history (%s)',async(mode)=>{
  const directory=await fs.mkdtemp(path.join(os.tmpdir(),'cbim-runtime-fresh-')),boundary=deferred(),entered=deferred();
  const task:TaskSpec={taskId:mode==='missing-directory'?'missing-root':'main-root',workspaceId:'workspace',root:directory,goal:'Inspect existing effects without repeating execution',agentId:'cbim:main',mode:'chat',moduleIds:[],acceptance:[]};
  const binding:ConversationAgentBinding={workspaceId:task.workspaceId,rootSessionId:task.taskId,teamId:'.cbim/team',agentId:'cbim:main',agentInstanceId:'retained-main-instance',agentSessionId:'retained-conversation-channel'};
  const excludedRunIds=['old-run-a','old-run-b'],oldBytes='Unparseable old canonical log: keep this exact text';
  for(const id of excludedRunIds){const target=path.join(directory,'main-root',id);await fs.mkdir(target,{recursive:true});await fs.writeFile(path.join(target,'events.jsonl'),oldBytes);await fs.writeFile(path.join(target,'native.jsonl'),'PRIVATE_OLD_NATIVE_CONTEXT_MUST_NOT_BE_READ')}
  const storage=new FileRunStorage(),realRead=storage.read.bind(storage),read=vi.spyOn(storage,'read').mockImplementation(async target=>{if(excludedRunIds.includes(path.basename(target)))throw Error('Fresh main attempted to inspect broken history');return realRead(target)});
  const reserve=vi.spyOn(storage,'reserveTask').mockImplementation(async()=>{throw Error('Fresh main must not reserve or replace the existing root')});
  const createJournal=storage.createJournal.bind(storage);storage.createJournal=(target,task,runId)=>{const journal=createJournal(target,task,runId),init=journal.init.bind(journal);journal.init=async()=>{await init();if(mode==='journal-init'){entered.resolve();await boundary.promise}};return journal};
  let leases=0;const contexts:EngineContext[]=[],states:{ran:boolean;closed:boolean;stopped:boolean}[]=[];
  const runtime=new LoopRuntime({directory,storage,...(mode==='unbound-main'?{}:{conversationBinding:binding}),acquireLease:async()=>{if(mode==='lease-failed')throw Error('MEMBER_BUSY');leases++;return()=>{leases--}},toolPolicy:async()=>({allow:false}),onEngineReady:async()=>{if(mode==='engine-ready'){entered.resolve();await boundary.promise}},createEngine:()=>{
    const state={ran:false,closed:false,stopped:false};states.push(state);
    const engine:AgentEngine={kind:'test',start:async context=>{contexts.push(context);await context.emit({type:'session.bound',data:{sessionId:context.nativeSessionId,sessionFile:path.join(context.directory,'fresh-native.jsonl')}})},run:async()=>{state.ran=true;return {status:'completed'}},stop:async()=>{state.stopped=true},close:async()=>{state.closed=true}};return engine;
  }});
  try{
    const expectedExcluded=mode==='missing-intent'?['missing-intent',...excludedRunIds]:excludedRunIds,completed=mode==='complete'||mode==='missing-intent';
    const controller=new AbortController(),beforeRun=vi.fn(async(input:{task:TaskSpec;runId:string;nativeSessionId:string;excludedRunIds:string[]})=>{
      expect(input.task).toEqual(task);expect([...input.excludedRunIds].sort()).toEqual(expectedExcluded);expect(input.runId).not.toBe(input.nativeSessionId);expect(input.nativeSessionId).toMatch(/^[a-f0-9-]{36}$/);expect(input.nativeSessionId).not.toBe(task.taskId);
      if(mode==='intent-rejected')throw Error('Intent not committed');
      if(mode==='before-intent'){entered.resolve();await boundary.promise}
    });
    if(mode==='pre-aborted')controller.abort(Error('Stopped before fresh start'));
    const pending=runtime.startFreshMain(task,'Only inspect existing effects',{signal:controller.signal,beforeRun,...(mode==='missing-intent'?{knownRunIds:async()=>['missing-intent','old-run-a']}:{})});
    if(['lease-failed','pre-aborted','intent-rejected','missing-directory','unbound-main'].includes(mode)){
      await expect(pending).rejects.toThrow();expect(states).toEqual([]);expect(beforeRun).toHaveBeenCalledTimes(mode==='intent-rejected'?1:0);
    }else if(mode==='before-intent'){
      const rejected=expect(pending).rejects.toThrow('Stopped before durable startup');await entered.promise;controller.abort(Error('Stopped before durable startup'));boundary.resolve();await rejected;expect(states).toEqual([]);expect(beforeRun).toHaveBeenCalledTimes(1);
    }else{
      if(mode==='journal-init'){await entered.promise;controller.abort(Error('Stopped after journal initialization'));boundary.resolve()}
      const started=await pending;
      if(mode==='engine-ready'){await entered.promise;controller.abort(Error('Stopped before model invocation'));boundary.resolve()}
      const summary=await started.done,metadata=summary.events[0].data.freshMain as {nativeSessionId:string;excludedRunIds:string[]};
      expect(summary.status).toBe(completed?'completed':'cancelled');expect(summary.conversationBinding).toEqual(binding);expect(summary.source).toBeUndefined();expect(summary.memberBinding).toBeUndefined();expect(summary.events[0].data.resumeFrom).toBeUndefined();
      expect(metadata).toEqual({nativeSessionId:beforeRun.mock.calls[0][0].nativeSessionId,excludedRunIds:expectedExcluded});expect(states[0].closed).toBe(true);expect(states[0].ran).toBe(completed);
      for(const context of contexts){expect(context.sessionFile).toBeUndefined();expect(context.nativeSessionId).toBe(metadata.nativeSessionId);expect(context.conversationBinding).toEqual(binding);expect(context.source).toBeUndefined()}
      expect(beforeRun).toHaveBeenCalledTimes(1);
    }
    expect(leases).toBe(0);expect(reserve).not.toHaveBeenCalled();expect(read.mock.calls.every(([target])=>!excludedRunIds.includes(path.basename(target)))).toBe(true);
    for(const id of excludedRunIds)expect(await fs.readFile(path.join(directory,'main-root',id,'events.jsonl'),'utf8')).toBe(oldBytes);
    if(mode!=='missing-directory')for(const id of await fs.readdir(path.join(directory,'main-root'))){if(!excludedRunIds.includes(id)){const summary=await realRead(path.join(directory,'main-root',id));expect(summary.events[0].type).toBe('run.started');expect(summary.status).toBe(completed?'completed':'cancelled')}}
  }finally{boundary.resolve();await runtime.close();const target=path.resolve(directory);if(path.dirname(target)!==path.resolve(os.tmpdir())||!path.basename(target).startsWith('cbim-runtime-fresh-'))throw Error('Invalid fresh-runtime cleanup target');await fs.rm(target,{recursive:true,force:true})}
});
