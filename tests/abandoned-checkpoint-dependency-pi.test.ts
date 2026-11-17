import {expect,it,vi} from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fixture} from './helpers';
import {Application} from '../src/bridge/server/application';
import {Paths} from '../src/logic/workspace/service/paths';
import {FileRunStorage} from '../src/logic/execution/storage/run-storage';
import {AgentCallScheduler} from '../src/logic/execution/assembly/agent-call-scheduler';
import {jsonToolResult} from '../src/logic/tools/rules/results';
import {seedCheckpointHandoff,changeCheckpointOwner} from './checkpoint-handoff-fixture';
import {checkpointHandoffData as data} from './checkpoint-handoff-provider';
import {recursiveHandoffProvider} from './recursive-handoff-provider';

it.each(['complete','bad-output','submitted-stop','restart-held'] as const)('uses only the fresh handoff result for subsequent recursive work (%s)',async mode=>{
 const f=await fixture(),provider=await recursiveHandoffProvider(mode==='bad-output',true);let app=f.app,returns=0;
 try{
  const seed=await seedCheckpointHandoff(app,f.a,provider.urls),id=seed.entry.id;provider.bind(seed.moduleId);
  if(mode==='bad-output'){
   const bind=AgentCallScheduler.prototype.Bind;
   vi.spyOn(AgentCallScheduler.prototype,'Bind').mockImplementation(function(this:AgentCallScheduler,...args:Parameters<typeof bind>){
    const result=bind.apply(this,args),call=result.capability.tools.call.bind(result.capability.tools);
    result.capability.tools.call=async(...input:Parameters<typeof call>)=>{const value=await call(...input);if(input[0]==='cbim_agent_call'&&input[3]==='handoff-new-0'){returns++;return {...jsonToolResult(input[0],{error:{code:'HANDOFF_REPLY_LOST'}}),isError:true}}return value};return result;
   });
  }
  const start=await app.Dispatch('loop.chat',{id,message:data.goal,options:seed.mainOptions}),state=()=>app.Workspace(id).dispatchStore.Read();
  const until=(check:()=>void|Promise<void>)=>vi.waitFor(async()=>{expect(provider.errors).toEqual([]);await check()},{timeout:60000,interval:30});
  const questions=()=>app.Dispatch('loop.questions',{id,taskId:start.taskId});
  await until(async()=>expect(await questions()).toHaveLength(1));const q=(await questions())[0];
  await changeCheckpointOwner(app,seed);await app.Dispatch('loop.answerQuestion',{id,taskId:start.taskId,questionId:q.id,answers:[{option:0,other:''}]});
  await until(()=>expect(provider.state.replacementReady).toBe(true));
  const held=await state(),initial=held.agentBusinessRuns!,storage=new FileRunStorage();
  expect(initial).toHaveLength(2);expect(initial.every(r=>r.status==='closed')).toBe(true);expect(provider.a).toHaveLength(6);expect(provider.b).toHaveLength(5);
  const summaries=await Promise.all(initial.map(r=>storage.Read(path.join(f.user,id,'loop-engine/tasks',r.binding.taskId,r.binding.runId))));
  expect(summaries[0].taskProgress?.delivery).toBeUndefined();expect(summaries[1].taskProgress?.delivery?.summary).toContain(data.facts[0]);
  const originals=summaries.flatMap(s=>[path.join(f.user,id,'loop-engine/tasks',s.task.taskId,s.runId,'events.jsonl'),s.sessionFile!]),bytes=await Promise.all(originals.map(p=>fs.readFile(p)));
  expect(provider.state.results).toHaveLength(1);
  if(mode==='submitted-stop')await app.Dispatch('loop.stop',{id,taskId:start.taskId});
  else if(mode==='restart-held'){await app.Shutdown();provider.releaseSuccessors();app=new Application(new Paths(f.user,path.resolve('.')));await app.Init()}
  provider.releaseSuccessors();
  await until(async()=>{expect((await state()).scopes?.[0].status).toBe('closed');expect(app.runtime.Snapshot().pressure.activeRuns).toBe(0)});
  const saved=await state(),runs=saved.agentBusinessRuns!,complete=mode==='complete'||mode==='bad-output';
  expect(saved.scopes?.[0].outcome).toBe(complete?'completed':'cancelled');expect(saved.graphs[0].tasks).toEqual([]);
  expect(runs.slice(0,2)).toEqual(initial);expect(runs).toHaveLength(complete?4:2);
  expect(await Promise.all(originals.map(p=>fs.readFile(p)))).toEqual(bytes);
  if(complete){
   expect(provider.b).toHaveLength(15);
   for(const index of [2,3]){
    const summary=await storage.Read(path.join(f.user,id,'loop-engine/tasks',runs[index].binding.taskId,runs[index].binding.runId));
    expect(summary.task.goal).toContain(runs[index-1].binding.runId);expect(summary.task.goal).not.toContain(runs[0].binding.runId);
    expect(summary.task.ownerBinding?.memberId).toBe(seed.positions[1].member.memberId);expect(summary.status).toBe('completed');
   }
  }else expect(provider.b).toHaveLength(5);
  if(mode==='bad-output'){expect(returns).toBe(1);expect(provider.state.checks).toMatchObject({state:'verified',runId:initial[1].binding.runId})}
  const counts=[provider.main.length,provider.a.length,provider.b.length],journal=await fs.readFile(path.join(f.user,id,'dispatch/dispatch.jsonl'));
  vi.restoreAllMocks();await app.Shutdown();app=new Application(new Paths(f.user,path.resolve('.')));await app.Init();
  expect(await state()).toEqual(saved);expect(await Promise.all(originals.map(p=>fs.readFile(p)))).toEqual(bytes);expect(await fs.readFile(path.join(f.user,id,'dispatch/dispatch.jsonl'))).toEqual(journal);expect([provider.main.length,provider.a.length,provider.b.length]).toEqual(counts);
 }finally{provider.releaseSuccessors();vi.restoreAllMocks();await app.Shutdown();await provider.close();await f.cleanup()}
},120000);
