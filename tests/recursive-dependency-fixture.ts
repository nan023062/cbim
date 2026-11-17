import {expect,vi} from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fixture} from './helpers';
import {Application} from '../src/bridge/server/application';
import {Paths} from '../src/logic/workspace/service/paths';
import {FileRunStorage} from '../src/logic/execution/storage/run-storage';
import {AgentCallScheduler} from '../src/logic/execution/assembly/agent-call-scheduler';
import {jsonToolResult} from '../src/logic/tools/rules/results';
import {seedDependencyAddition} from './queued-dependency-addition-fixture';
import {dependencyAdditionData as data} from './queued-dependency-addition-provider';
import {recursiveDependencyProvider,type RecursiveDependencyFamily} from './recursive-dependency-provider';

/** Application integration only: actual calls and immutable source receipts, never synthetic task nodes. */
export async function verifyRecursiveDependency(family:RecursiveDependencyFamily,mode:string){
 const lost=mode==='reply-lost'||mode==='bad-output',complete=mode==='complete'||lost;
 const f=await fixture(),provider=await recursiveDependencyProvider(family,lost);let app=f.app,returns=0;
 try{
  const seed=await seedDependencyAddition(app,f.a,provider),id=seed.entry.id;
  if(lost){
   const bind=AgentCallScheduler.prototype.Bind;
   vi.spyOn(AgentCallScheduler.prototype,'Bind').mockImplementation(function(this:AgentCallScheduler,...args:Parameters<typeof bind>){
    const result=bind.apply(this,args),call=result.capability.tools.call.bind(result.capability.tools);
    result.capability.tools.call=async(...input:Parameters<typeof call>)=>{const value=await call(...input);if(input[0]==='cbim_agent_call'&&input[3]==='dependency-call-'+provider.heldIndex){returns++;return {...jsonToolResult(input[0],{error:{code:'DEPENDENCY_REPLY_LOST'}}),isError:true}}return value};return result;
   });
  }
  const start=await app.Dispatch('loop.chat',{id,message:data.goal,options:{permission:'read',turnTimeoutMs:60000}}),state=()=>app.Workspace(id).dispatchStore.Read();
  const until=(check:()=>void|Promise<void>)=>vi.waitFor(async()=>{expect(provider.errors).toEqual([]);await check()},{timeout:60000,interval:30});
  const questions=()=>app.Dispatch('loop.questions',{id,taskId:start.taskId});
  await until(async()=>expect(await questions()).toHaveLength(1));
  let originals:string[]=[],bytes:Buffer[]=[];
  const storage=new FileRunStorage();
  if(mode==='prepare-stop'){
   await app.Dispatch('loop.stop',{id,taskId:start.taskId});expect(provider.byNode.every(list=>list.length===0)).toBe(true);
  }else{
   const question=(await questions())[0];await app.Dispatch('loop.answerQuestion',{id,taskId:start.taskId,questionId:question.id,answers:[{option:0,other:''}]});
   await until(()=>expect(provider.state.readyToStart).toBe(true));expect(provider.byNode.every(list=>list.length===0)).toBe(true);provider.releaseStart();
   await until(()=>expect(provider.state.readyForSuccessors).toBe(true));
   const held=(await state()).agentBusinessRuns!;expect(held).toHaveLength(provider.heldIndex+1);expect(held.every(r=>r.status==='closed')).toBe(true);
   expect(provider.byNode.slice(provider.heldIndex+1).every(list=>list.length===0)).toBe(true);
   const summaries=await Promise.all(held.map(r=>storage.Read(path.join(f.user,id,'loop-engine/tasks',r.binding.taskId,r.binding.runId))));
   originals=summaries.flatMap(s=>[path.join(f.user,id,'loop-engine/tasks',s.task.taskId,s.runId,'events.jsonl'),s.sessionFile!]);bytes=await Promise.all(originals.map(p=>fs.readFile(p)));
   if(mode==='restart-held'){await app.Shutdown();provider.releaseSuccessors();app=new Application(new Paths(f.user,path.resolve('.')));await app.Init()}
   else if(!complete)await app.Dispatch('loop.stop',{id,taskId:start.taskId});
  }
  provider.releaseStart();provider.releaseSuccessors();
  await until(async()=>{expect((await state()).scopes?.[0].status).toBe('closed');expect(app.runtime.Snapshot().pressure.activeRuns).toBe(0)});
  const saved=await state(),runs=saved.agentBusinessRuns??[];
  expect(saved.scopes?.[0].outcome).toBe(complete?'completed':'cancelled');expect(saved.graphs[0].tasks).toEqual([]);
  expect(runs).toHaveLength(mode==='prepare-stop'?0:complete?provider.nodes.length:provider.heldIndex+1);
  expect(new Set(runs.map(r=>r.binding.runId)).size).toBe(runs.length);
  expect(await Promise.all(originals.map(p=>fs.readFile(p)))).toEqual(bytes);
  for(let index=0;index<runs.length;index++){
   const run=runs[index],node=provider.nodes[index],summary=await storage.Read(path.join(f.user,id,'loop-engine/tasks',run.binding.taskId,run.binding.runId));
   expect(summary.task.goal).toBe(provider.goals[index]);
   if(node.failed){expect(summary.taskProgress?.delivery).toBeUndefined();expect(provider.state.oldFailure.error).toBeDefined()}
   else{
    expect(summary.taskProgress?.delivery?.summary).toContain(data.facts[node.file]);
    for(const prior of node.prior){expect(summary.task.goal).toContain(runs[prior].binding.runId);expect(summary.taskProgress?.delivery?.summary).toContain(data.facts[provider.nodes[prior].file])}
    if(family==='replacement')expect(summary.task.goal).not.toContain(runs[0].binding.runId);
   }
  }
  if(lost)expect(returns).toBe(1);
  const counts=provider.byNode.map(list=>list.length),rootCount=provider.main.length,journal=await fs.readFile(path.join(f.user,id,'dispatch/dispatch.jsonl'));
  vi.restoreAllMocks();await app.Shutdown();app=new Application(new Paths(f.user,path.resolve('.')));await app.Init();
  expect(await state()).toEqual(saved);expect(await Promise.all(originals.map(p=>fs.readFile(p)))).toEqual(bytes);expect(await fs.readFile(path.join(f.user,id,'dispatch/dispatch.jsonl'))).toEqual(journal);expect(provider.byNode.map(list=>list.length)).toEqual(counts);expect(provider.main.length).toBe(rootCount);
 }finally{provider.releaseStart();provider.releaseSuccessors();vi.restoreAllMocks();await app.Shutdown();await provider.close();await f.cleanup()}
}
