import {runtimeToolGroup} from './runtime-tool-group';
import {RunJournal} from '../src/backend/main/run-storage/run-journal';
import {FileRunStorage} from '../src/backend/main/run-storage/run-storage';
import {it,expect} from 'vitest';
import {z} from 'zod';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {LoopRuntime,type AgentEngine,type EngineContext,type TaskSpec} from '../src/backend/core/execution';

async function setup(factory:()=>AgentEngine,describeTool?:ConstructorParameters<typeof LoopRuntime>[0]['describeTool'],normalizeToolInput?:ConstructorParameters<typeof LoopRuntime>[0]['normalizeToolInput']){
  const directory=await fs.mkdtemp(path.join(os.tmpdir(),'cbim-loop-unit-'));let locked=false;
  const task:TaskSpec={taskId:'task-a',workspaceId:'workspace-a',root:directory,goal:'Implement a tested feature',moduleIds:[],acceptance:['Tests pass']};
  const runtime=new LoopRuntime({storage:new FileRunStorage(),directory,createEngine:factory,describeTool,normalizeToolInput,acquireLease:async()=>{if(locked)throw Error('locked');locked=true;return()=>{locked=false}},toolPolicy:async()=>({allow:true})});
  return {runtime,task,directory,cleanup:async()=>{await runtime.close();await fs.rm(directory,{recursive:true,force:true})}};
}
class StubEngine implements AgentEngine {
  readonly kind='pi';context!:EngineContext;
  async start(context:EngineContext){this.context=context;await context.emit({type:'session.bound',data:{sessionFile:path.join(context.directory,'native.jsonl')}})}
  async run(_message:string){return {status:'completed' as const}}
  async stop(){}
  async close(){}
}

it.each(['describe','normalize'] as const)('执行前%s的Schema缺参产生可读拒绝及稳定错误码，不放行工具，也不误报可缺省字段',async stage=>{
  class Engine extends StubEngine{async run(){
    const decision=await this.context.beforeTool({id:'invalid',name:'cbim_example',input:{}});
    expect(decision.allow).toBe(false);const error=JSON.parse(decision.reason!);
    expect(error).toMatchObject({status:'rejected',code:'TOOL_INPUT_INVALID'});expect(error.message).toContain('name：缺少必填字段');expect(error.message).not.toContain('count：');expect(error.message).not.toContain('invalid_type');
    return {status:'completed' as const};
  }}
  const schema=z.object({name:z.string(),count:z.number().default(5),query:z.string().optional()});
  const f=await setup(()=>new Engine(),stage==='describe'?call=>{schema.parse(call.input);return {effects:['read'],native:false}}:undefined,stage==='normalize'?call=>schema.parse(call.input):undefined);
  try{const summary=await(await f.runtime.start(f.task)).done;expect(summary.events.some(e=>e.type==='tool.allowed')).toBe(false);expect(summary.events.find(e=>e.type==='tool.denied')?.data.reason).toContain('TOOL_INPUT_INVALID');expect(summary.unresolvedTools).toEqual([])}finally{await f.cleanup()}
});

it('同一工具同参数连续失败三次停止本轮，第四次不执行，熔断不能伪装 completed',async()=>{
 let effects=0,stops=0;
 class Engine extends StubEngine {
  async run(){
   for(let index=0;index<4;index++){
    const call={id:'attempt-'+index,name:'write',input:{path:'same.txt',content:'same'}};
    const decision=await this.context.beforeTool(call);
    if(decision.allow){effects++;await this.context.emit({type:'tool.finished',data:{id:call.id,isError:true,result:'failed'}})}
   }
   return {status:'completed' as const};
  }
  async stop(){stops++}
 }
 const f=await setup(()=>new Engine());try{
  const result=await(await f.runtime.start(f.task)).done;
  expect(effects).toBe(3);expect(stops).toBe(1);expect(result.status).toBe('failed');expect(result.unresolvedTools).toEqual([]);
  expect(result.events.find(event=>event.type==='engine.status'&&event.data.state==='blocked')?.data).toMatchObject({code:'TOOL_REPEAT_BLOCKED',consecutive:3});
  expect(result.events.at(-1)?.data).toMatchObject({status:'failed',blocked:{code:'TOOL_REPEAT_BLOCKED'}});
 }finally{await f.cleanup()}
});

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

it('unknown tools cannot resume their native context through bare reconciliation IDs',async()=>{
  let count=0;
  class Crash extends StubEngine{async run():Promise<{status:'completed'}>{await this.context.beforeTool({id:'uncertain-write',name:'write',input:{path:'src/result'}});throw Error('process lost')}}
  const f=await setup(()=>count++===0?new Crash():new StubEngine());try{
    const first=await f.runtime.start(f.task),result=await first.done;expect(result.status).toBe('interrupted');expect(result.unresolvedTools).toEqual(['uncertain-write']);
    expect(result.toolReceipts).toMatchObject([{toolCallId:'uncertain-write',outcome:'unknown'}]);
    await expect(f.runtime.start(f.task,'continue',{runId:first.runId})).rejects.toMatchObject({code:'RECOVERY_INSPECTION_REQUIRED'});
    await expect(f.runtime.start({...f.task,root:'wrong'},'continue',{runId:first.runId})).rejects.toThrow('原任务');
    const before=await fs.readFile(path.join(f.directory,f.task.taskId,first.runId,'events.jsonl'));
    await expect(f.runtime.start(f.task,'verified file; continue',{runId:first.runId,reconciledToolIds:['uncertain-write']})).rejects.toMatchObject({code:'RECOVERY_INSPECTION_REQUIRED'});
    expect(count).toBe(1);expect(await fs.readFile(path.join(f.directory,f.task.taskId,first.runId,'events.jsonl'))).toEqual(before);
    expect((await f.runtime.inspect(f.task.taskId,first.runId)).unresolvedTools).toEqual(['uncertain-write']);
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

it('task revisions survive logs and resume with stale evidence cleared, never auto-accepted',async()=>{
  let turn=0;
  class Engine extends StubEngine{async run(){
    const tools=runtimeToolGroup(this.context,'task-progress')!;
    if(turn++===0){
      await tools.call('cbim_task_plan',{expectedVersion:0,goal:'交付功能',reason:'用户目标',acceptance:['检查结果'],steps:[{id:'one',title:'验证功能',owner:'主 Agent'}]});
      await this.context.beforeTool({id:'proof',name:'read',input:{path:'proof.txt'}});
      await this.context.emit({type:'tool.finished',data:{id:'proof',name:'read',result:'actual result'}});
      await tools.call('cbim_task_step',{expectedVersion:1,id:'one',state:'reported_done',evidenceIds:['proof']});
      await tools.call('cbim_delivery_prepare',{expectedVersion:2,summary:'待核验结果',limitations:[]});
    }else{
      const state=JSON.parse((await tools.call('cbim_task_inspect',{})).content[0].text);
      expect(state.plan).toMatchObject({version:4,state:'executing',steps:[{state:'pending',evidence:[]}]});expect(state.evidence).toEqual([]);
    }
    return {status:'completed' as const};
  }}
  const f=await setup(()=>new Engine());try{
    const first=await f.runtime.start(f.task),result=await first.done;
    expect(result.taskProgress?.state).toBe('awaiting_review');expect(result.acceptance).toBe('not_evaluated');
    expect((await RunJournal.read(path.join(f.directory,f.task.taskId,first.runId))).taskProgress).toEqual(result.taskProgress);
    const second=await f.runtime.start(f.task,'继续修改',{runId:first.runId});await second.done;
  }finally{await f.cleanup()}
});
