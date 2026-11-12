import {expect,it} from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {LoopRuntime,type AgentEngine,type EngineContext,type TaskSpec,type RuntimeOptions,type MemberRunLaunch} from '../src/backend/core/execution';
import {FileRunStorage} from '../src/backend/main/run-storage/run-storage';
import {RunJournal} from '../src/backend/main/run-storage/run-journal';

class Engine implements AgentEngine {
  readonly kind='pi';context!:EngineContext;ran=false;closed=false;
  async start(context:EngineContext){this.context=context;await context.emit({type:'session.bound',data:{sessionId:context.nativeSessionId,sessionFile:path.join(context.directory,'native.jsonl')}})}
  async run(_message:string){this.ran=true;return {status:'completed' as const}}
  async stop(){}
  async close(){this.closed=true}
}

async function setup(onEngineReady?:RuntimeOptions['onEngineReady']){
  const directory=await fs.mkdtemp(path.join(os.tmpdir(),'cbim-member-run-'));
  const engines:Engine[]=[];let leases=0;
  const runtime=new LoopRuntime({directory,storage:new FileRunStorage(),acquireLease:async()=>{leases++;return()=>{leases--}},createEngine:()=>{const engine=new Engine();engines.push(engine);return engine},toolPolicy:async()=>({allow:true}),onEngineReady});
  const task:TaskSpec={taskId:'task-one',workspaceId:'workspace-one',root:directory,goal:'Implement the assigned module',agentId:'.cbim/team/engineer',moduleIds:['.cbim/workspace/product/game'],acceptance:['Verification passes']};
  const launch:MemberRunLaunch={binding:{workspaceId:task.workspaceId,teamId:'.cbim/team',agentId:task.agentId!,agentInstanceId:'member-one',agentSessionId:'channel-one',rootSessionId:'root-session',taskId:task.taskId,runId:'run-one',leaseEpoch:2,planRevision:1},session:{nativeSessionId:'native-one'}};
  return {directory,runtime,engines,task,launch,get leases(){return leases},cleanup:async()=>{
    await runtime.close();
    const target=path.resolve(directory);
    if(path.dirname(target)!==path.resolve(os.tmpdir())||!path.basename(target).startsWith('cbim-member-run-'))throw Error('Unexpected test cleanup path');
    await fs.rm(target,{recursive:true,force:true});
  }};
}

it('persists the preallocated member binding and continues the channel under a different task without faking resume',async()=>{
  const f=await setup();try{
    const expected=structuredClone(f.launch.binding);
    const first=await f.runtime.startMember(f.task,'first assignment',f.launch);
    f.launch.binding.leaseEpoch=99;
    const summary=await first.done;
    expect(first.runId).toBe('run-one');expect(summary.memberBinding).toEqual(expected);
    expect(summary.status).toBe('completed');expect(summary.acceptance).toBe('not_evaluated');
    expect(summary.taskProgress).toBeUndefined();
    expect(summary.events[0].data).toMatchObject({memberBinding:expected,nativeSessionId:'native-one'});
    expect(f.engines[0].context).toMatchObject({runId:'run-one',nativeSessionId:'native-one',memberBinding:expected});
    const nextTask={...f.task,taskId:'task-two',goal:'Complete a second assignment'};
    const nextLaunch={binding:{...expected,taskId:nextTask.taskId,runId:'run-two'},session:{nativeSessionId:'native-one',sessionFile:summary.sessionFile}};
    const next=await f.runtime.startMember(nextTask,'second assignment',nextLaunch),nextSummary=await next.done;
    expect(nextSummary.memberBinding).toEqual(nextLaunch.binding);
    expect(f.engines[1].context).toMatchObject({task:nextTask,runId:'run-two',sessionFile:summary.sessionFile,nativeSessionId:'native-one'});
    expect(f.leases).toBe(0);
    await expect(f.runtime.startMember(nextTask,'do not replay',nextLaunch)).rejects.toMatchObject({code:'EEXIST'});
    await expect(f.runtime.start(f.task,'do not fake ordinary resume',{runId:first.runId})).rejects.toThrow('成员任务不能');
    expect(f.engines).toHaveLength(2);
  }finally{await f.cleanup()}
});

it('rejects mismatched member identities and missing module bindings before reserving or launching',async()=>{
  const f=await setup();try{
    for(const patch of [{taskId:'other'},{workspaceId:'other'},{agentId:'other'},{runId:'../escape'},{agentSessionId:undefined},{leaseEpoch:-1},{planRevision:0},{unknown:'extra'}]){
      const launch={...f.launch,binding:{...f.launch.binding,...patch}} as MemberRunLaunch;
      await expect(f.runtime.startMember(f.task,'assignment',launch)).rejects.toThrow();
    }
    await expect(f.runtime.startMember({...f.task,moduleIds:[]},'assignment',f.launch)).rejects.toThrow('明确的模块任务');
    await expect(f.runtime.startMember({...f.task,mode:'chat'},'assignment',f.launch)).rejects.toThrow('明确的模块任务');
    expect(f.engines).toEqual([]);expect(f.leases).toBe(0);expect(await fs.readdir(f.directory)).toEqual([]);
  }finally{await f.cleanup()}
});

it('waits for durable engine-ready acknowledgement before model generation',async()=>{
  let release!:()=>void,entered!:()=>void;
  const enteredGate=new Promise<void>(resolve=>{entered=resolve});
  const releaseGate=new Promise<void>(resolve=>{release=resolve});
  const notices:Parameters<NonNullable<RuntimeOptions['onEngineReady']>>[0][]=[];
  const f=await setup(async input=>{
    notices.push(input);
    const journal=await RunJournal.read(path.join(f.directory,input.taskId,input.runId));
    expect(journal.events.at(-1)?.type).toBe('session.bound');
    entered();await releaseGate;
  });
  try{
    const run=await f.runtime.startMember(f.task,'assignment',f.launch);await enteredGate;
    expect(f.engines[0].ran).toBe(false);expect(f.leases).toBe(1);
    expect(notices).toEqual([{taskId:f.task.taskId,runId:f.launch.binding.runId,sessionFile:path.join(f.directory,f.task.taskId,f.launch.binding.runId,'native.jsonl'),nativeSessionId:'native-one'}]);
    release();expect((await run.done).status).toBe('completed');expect(f.engines[0].ran).toBe(true);
  }finally{release();await f.cleanup()}
});

it('interrupts and closes a prepared engine if its durable startup acknowledgement fails',async()=>{
  const f=await setup(async()=>{throw Error('startup transaction unavailable')});try{
    const run=await f.runtime.startMember(f.task,'assignment',f.launch),summary=await run.done;
    expect(summary.status).toBe('interrupted');expect(f.engines[0].ran).toBe(false);expect(f.engines[0].closed).toBe(true);expect(f.leases).toBe(0);
    expect(summary.events.at(-1)).toMatchObject({type:'run.interrupted',data:{error:'startup transaction unavailable'}});
  }finally{await f.cleanup()}
});

it('validates restored member bindings against the journal run identity',async()=>{
  const f=await setup();try{
    const run=await f.runtime.startMember(f.task,'assignment',f.launch);await run.done;
    const file=path.join(f.directory,f.task.taskId,run.runId,'events.jsonl');
    const events=(await fs.readFile(file,'utf8')).trim().split('\n').map(line=>JSON.parse(line));
    events[0].data.memberBinding.runId='foreign-run';
    await fs.writeFile(file,events.map(event=>JSON.stringify(event)).join('\n')+'\n');
    await expect(f.runtime.inspect(f.task.taskId,run.runId)).rejects.toThrow('成员运行绑定与任务或轮次不一致');
  }finally{await f.cleanup()}
});
