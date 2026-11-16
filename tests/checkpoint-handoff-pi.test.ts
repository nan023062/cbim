import {it,expect,vi} from 'vitest';
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

it.each(['complete','answer-retry','prepare-stop','lost-output'] as const)('hands off from the original paused call to fresh registered-owner calls (%s)',async mode=>{
 const f=await fixture(),provider=await recursiveHandoffProvider(mode==='lost-output');let app=f.app,lost=0;
 try{
  const seed=await seedCheckpointHandoff(app,f.a,provider.urls),id=seed.entry.id;provider.bind(seed.moduleId);
  if(mode==='lost-output'){
   const bind=AgentCallScheduler.prototype.Bind;
   vi.spyOn(AgentCallScheduler.prototype,'Bind').mockImplementation(function(this:AgentCallScheduler,...args:Parameters<typeof bind>){
    const binding=bind.apply(this,args),call=binding.capability.tools.call.bind(binding.capability.tools);
    binding.capability.tools.call=async(...input:Parameters<typeof call>)=>{const result=await call(...input);if(input[0]==='cbim_agent_call'&&input[3]==='handoff-new-0'){lost++;return {...jsonToolResult(input[0],{error:{code:'HANDOFF_REPLY_LOST'}}),isError:true}}return result};return binding;
   });
  }
  const start=await app.Dispatch('loop.chat',{id,message:data.goal,options:seed.mainOptions}),until=(check:()=>void|Promise<void>)=>vi.waitFor(async()=>{expect(provider.errors).toEqual([]);await check()},{timeout:60000,interval:30});
  const state=()=>app.Workspace(id).dispatchStore.Read(),questions=()=>app.Dispatch('loop.questions',{id,taskId:start.taskId});
  await until(async()=>expect(await questions()).toHaveLength(1));const question=(await questions())[0];
  const before=await state(),old=before.agentBusinessRuns![0];expect(old.status).toBe('active');expect(provider.a).toHaveLength(5);expect(provider.b).toEqual([]);
  const directory=path.join(f.user,id,'loop-engine/tasks',old.binding.taskId,old.binding.runId),storage=new FileRunStorage(),original=await storage.Read(directory),marker=(await fs.stat(path.join(f.a,data.files[0]))).mtimeMs;
  const prefix=await fs.readFile(path.join(directory,'events.jsonl'));expect(original.task.ownerBinding?.memberId).toBe(seed.positions[0].member.memberId);
  await changeCheckpointOwner(app,seed);
  expect((await state()).agentBusinessRuns).toEqual(before.agentBusinessRuns);expect(provider.b).toEqual([]);
  const answer=()=>app.Dispatch('loop.answerQuestion',{id,taskId:start.taskId,questionId:question.id,answers:[{option:0,other:''}]});
  if(mode==='prepare-stop')await app.Dispatch('loop.stop',{id,taskId:start.taskId});
  else{await answer();if(mode==='answer-retry'){await until(async()=>expect(await questions()).toEqual([]));await expect(answer()).rejects.toThrow()}}
  await until(async()=>{expect((await state()).scopes?.[0].status).toBe('closed');expect(app.runtime.Snapshot().pressure.activeRuns).toBe(0)});
  const saved=await state(),runs=saved.agentBusinessRuns!,summaries=await Promise.all(runs.map(r=>storage.Read(path.join(f.user,id,'loop-engine/tasks',r.binding.taskId,r.binding.runId))));
  expect(saved.scopes?.[0].outcome).toBe(mode==='prepare-stop'?'cancelled':'completed');expect(saved.graphs[0].tasks).toEqual([]);expect(saved.runs??[]).toEqual([]);
  expect(runs).toHaveLength(mode==='prepare-stop'?1:4);expect(runs[0].prepared).toEqual(old.prepared);expect(runs[0].binding).toEqual(old.binding);expect(runs.every(r=>r.status==='closed')).toBe(true);
  expect(summaries[0].sessionFile).toBe(original.sessionFile);expect(summaries[0].taskProgress?.delivery).toBeUndefined();
  expect((await fs.readFile(path.join(directory,'events.jsonl'))).subarray(0,prefix.length)).toEqual(prefix);
  expect(summaries.flatMap(s=>s.toolReceipts??[]).filter(r=>r.toolName==='write'&&r.outcome==='succeeded')).toHaveLength(1);
  expect((await fs.stat(path.join(f.a,data.files[0]))).mtimeMs).toBe(marker);
  expect(provider.a).toHaveLength(mode==='prepare-stop'?5:6);expect(provider.b).toHaveLength(mode==='prepare-stop'?0:15);
  if(mode!=='prepare-stop'){
   expect(provider.state.oldResult.error).toBeDefined();expect(provider.state.results).toHaveLength(3);
   for(const [index,s] of summaries.slice(1).entries()){
    expect(s.task.ownerBinding?.memberId).toBe(seed.positions[1].member.memberId);expect(s.status).toBe('completed');
    expect(s.toolReceipts?.find(r=>r.toolCallId==='handoff-b-'+index+'-read')?.outcome).toBe('succeeded');
    expect(s.taskProgress?.delivery?.summary).toContain(data.facts[index]);expect(s.runId).not.toBe(old.binding.runId);expect(s.sessionFile).not.toBe(original.sessionFile);
   }
   expect(new Set(summaries.map(s=>s.sessionFile)).size).toBe(4);
  }
  if(mode==='lost-output'){expect(lost).toBe(1);expect(provider.state.checks).toMatchObject({state:'verified',acceptance:'not_evaluated'})}
  const thread=await app.Execution(id).Thread(start.taskId);expect(thread).toHaveLength(1);
  const paths=[...thread,...summaries].flatMap(s=>[path.join(f.user,id,'loop-engine/tasks',s.task.taskId,s.runId,'events.jsonl'),s.sessionFile!]),bytes=await Promise.all(paths.map(p=>fs.readFile(p))),counts=[provider.main.length,provider.a.length,provider.b.length];
  vi.restoreAllMocks();await app.Shutdown();app=new Application(new Paths(f.user,path.resolve('.')),path.resolve('assets'));await app.Init();
  expect(await state()).toEqual(saved);expect(await Promise.all(paths.map(p=>fs.readFile(p)))).toEqual(bytes);expect([provider.main.length,provider.a.length,provider.b.length]).toEqual(counts);
 }finally{vi.restoreAllMocks();await app.Shutdown();await provider.close();await f.cleanup()}
},120000);
