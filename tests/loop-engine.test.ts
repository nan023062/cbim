import {RunJournal} from '../src/backend/main/persistence/tasks/run-journal';
import {FileRunStorage} from '../src/backend/main/persistence/tasks/run-storage';
import {it,expect} from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {LoopRuntime,type AgentEngine,type EngineContext,type TaskSpec} from '../src/backend/core/brain';

async function setup(factory:()=>AgentEngine){
  const directory=await fs.mkdtemp(path.join(os.tmpdir(),'cbim-loop-unit-'));let locked=false;
  const task:TaskSpec={taskId:'task-a',workspaceId:'workspace-a',root:directory,goal:'Implement a tested feature',moduleIds:[],acceptance:['Tests pass']};
  const runtime=new LoopRuntime({storage:new FileRunStorage(),directory,createEngine:factory,acquireLease:async()=>{if(locked)throw Error('locked');locked=true;return()=>{locked=false}},toolPolicy:async()=>({allow:true})});
  return {runtime,task,directory,cleanup:async()=>{await runtime.close();await fs.rm(directory,{recursive:true,force:true})}};
}
class StubEngine implements AgentEngine {
  readonly kind='pi';context!:EngineContext;
  async start(context:EngineContext){this.context=context;await context.emit({type:'session.bound',data:{sessionFile:path.join(context.directory,'native.jsonl')}})}
  async run(_message:string){return {status:'completed' as const}}
  async stop(){}
  async close(){}
}

it('shutdown fences new starts and waits for a start already acquiring its lease',async()=>{
  const f=await setup(()=>new StubEngine());try{
    const starting=f.runtime.start(f.task);const closing=f.runtime.close();
    const run=await starting;await closing;
    expect(['cancelled','completed']).toContain((await run.done).status);
    await expect(f.runtime.start({...f.task,taskId:'new-task'})).rejects.toThrow('正在关闭');
  }finally{await f.cleanup()}
});

it('durably records gates before execution; engine completion never means business acceptance',async()=>{
  let directory='';
  class Engine extends StubEngine{async run(){
    const call={id:'call-1',name:'read',input:{path:'src/test.ts'}};
    expect((await this.context.beforeTool(call)).allow).toBe(true);
    const recorded=await RunJournal.read(this.context.directory);expect(recorded.events.at(-1)?.type).toBe('tool.allowed');
    await this.context.emit({type:'tool.finished',data:{id:call.id,isError:false,result:'verified',receipt:{workspaceId:'forged',outcome:'accepted'}}});directory=this.context.directory;
    return {status:'completed' as const};
  }}
  const f=await setup(()=>new Engine());try{
    const run=await f.runtime.start(f.task),result=await run.done;
    expect(result.status).toBe('completed');expect(result.acceptance).toBe('not_evaluated');expect(result.unresolvedTools).toEqual([]);
    expect(result.toolReceipts).toMatchObject([{toolCallId:'call-1',outcome:'succeeded',workspaceId:f.task.workspaceId,taskId:f.task.taskId,runId:run.runId}]);
    expect(result.toolReceipts![0].inputHash).toHaveLength(64);
    expect((await RunJournal.read(directory)).events.map(e=>e.seq)).toEqual([1,2,3,4,5,6]);
    await expect(f.runtime.start(f.task)).rejects.toMatchObject({code:'EEXIST'});
  }finally{await f.cleanup()}
});

it('crashed tool operations require explicit reconciliation, and recovery keeps task identity',async()=>{
  let count=0;
  class Crash extends StubEngine{async run():Promise<{status:'completed'}>{await this.context.beforeTool({id:'uncertain-write',name:'write',input:{path:'src/result'}});throw Error('process lost')}}
  const f=await setup(()=>count++===0?new Crash():new StubEngine());try{
    const first=await f.runtime.start(f.task),result=await first.done;expect(result.status).toBe('interrupted');expect(result.unresolvedTools).toEqual(['uncertain-write']);
    expect(result.toolReceipts).toMatchObject([{toolCallId:'uncertain-write',outcome:'unknown'}]);
    await expect(f.runtime.start(f.task,'continue',{runId:first.runId})).rejects.toThrow('先核实');
    await expect(f.runtime.start({...f.task,root:'wrong'},'continue',{runId:first.runId})).rejects.toThrow('原任务');
    const next=await f.runtime.start(f.task,'verified file; continue',{runId:first.runId,reconciledToolIds:['uncertain-write']});
    expect((await next.done).status).toBe('completed');expect(next.runId).not.toBe(first.runId);
  }finally{await f.cleanup()}
});

it('stopping during approval cannot release a late allow decision',async()=>{
  let approve!:(decision:{allow:boolean})=>void,entered!:()=>void;
  const gate=new Promise<void>(resolve=>{entered=resolve});
  class Engine extends StubEngine{async run(){const decision=await this.context.beforeTool({id:'late',name:'write',input:{}});expect(decision.allow).toBe(false);return {status:'completed' as const}}}
  const f=await setup(()=>new Engine());
  (f.runtime as any).options.toolPolicy=async()=>{entered();return new Promise(resolve=>{approve=resolve})};
  try{const run=await f.runtime.start(f.task);await gate;await f.runtime.stop(f.task.taskId);approve({allow:true});const result=await run.done;expect(result.toolReceipts).toMatchObject([{toolCallId:'late',outcome:'denied'}]);expect(result.unresolvedTools).toEqual([])}finally{await f.cleanup()}
});

it('journal failure blocks a tool; observers do not control durable execution',async()=>{
  class Engine extends StubEngine{async run(){
    await fs.rename(path.join(this.context.directory,'events.jsonl'),path.join(this.context.directory,'events.saved'));
    await fs.mkdir(path.join(this.context.directory,'events.jsonl'));
    await expect(this.context.beforeTool({id:'blocked',name:'write',input:{}})).rejects.toThrow();
    return {status:'completed' as const};
  }}
  const f=await setup(()=>new Engine());try{const run=await f.runtime.start(f.task);await expect(run.done).rejects.toThrow()}finally{await f.cleanup()}
});

it('a truncated journal tail is never interpreted as completed',async()=>{
  const f=await setup(()=>new StubEngine());try{
    const run=await f.runtime.start(f.task);await run.done;
    const file=path.join(f.directory,f.task.taskId,run.runId,'events.jsonl');const text=await fs.readFile(file,'utf8');
    const lines=text.trimEnd().split('\n');lines.pop();await fs.writeFile(file,lines.join('\n')+'\n{"type":"run.settled"');
    expect((await f.runtime.inspect(f.task.taskId,run.runId)).status).toBe('interrupted');
  }finally{await f.cleanup()}
});
