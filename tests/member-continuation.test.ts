import {expect,it} from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {LoopRuntime,checkedRunInputSource,type AgentEngine,type EngineContext,type TaskSpec,type RunInputSource} from '../src/logic/execution/rules';
import {FileRunStorage} from '../src/backend/main/run-storage/run-storage';
import {transcript} from '../src/frontend/execution-view/transcript';
import {openBridge} from '../src/backend/engines/pi/bridge';

const source=():Extract<RunInputSource,{kind:'member-results'}>=>({kind:'member-results',continuationId:'batch-one',messageIds:['result-one'],taskIds:['member-task']});
class Engine implements AgentEngine {
  readonly kind='pi';context!:EngineContext;
  constructor(private result:'completed'|'failed'|'cancelled'='completed'){}
  async start(context:EngineContext){this.context=context;await context.emit({type:'session.bound',data:{sessionFile:context.sessionFile??path.join(context.directory,'session.jsonl')}})}
  async run(){await this.context.emit({type:'message',data:{role:'assistant',text:'First assistant response'}});return {status:this.result}}
  async stop(){}
  async close(){}
}
async function setup(result:'completed'|'failed'|'cancelled'='completed'){
  const directory=await fs.mkdtemp(path.join(os.tmpdir(),'cbim-continuation-')),engines:Engine[]=[],identities:{task:TaskSpec;runId:string}[]=[];
  const task:TaskSpec={taskId:'main-session',workspaceId:'workspace',root:directory,goal:'Deliver reviewed result',moduleIds:[],acceptance:[],mode:'chat'};
  const runtime=new LoopRuntime({directory,storage:new FileRunStorage(),acquireLease:async()=>()=>{},toolPolicy:async()=>({allow:false}),createEngine:identity=>{identities.push(identity);const engine=new Engine(result);engines.push(engine);return engine}});
  return {directory,task,runtime,engines,identities,cleanup:async()=>{await runtime.close();const target=path.resolve(directory);if(path.dirname(target)!==path.resolve(os.tmpdir())||!path.basename(target).startsWith('cbim-continuation-'))throw Error('Unexpected test cleanup path');await fs.rm(target,{recursive:true,force:true})}};
}

it('persists trusted continuation identity without a fake user message and keeps the first assistant response',async()=>{
  const f=await setup();try{
    const first=await f.runtime.start(f.task,'Original user goal'),original=await first.done;
    const input=source(),expected=source();
    const pending=f.runtime.start(f.task,'Candidate data, not authorization',{runId:first.runId},input);
    input.taskIds.push('mutated-after-start');
    const second=await pending,result=await second.done;
    expect(result.source).toEqual(expected);expect(result.events[0].data.source).toEqual(expected);
    expect(f.engines[1].context.source).toEqual(expected);expect(f.engines[1].context.sessionFile).toBe(original.sessionFile);
    expect(f.identities[1]).toEqual({task:f.task,runId:second.runId});
    const messages=transcript(result);expect(messages.map(item=>item.kind)).toEqual(['system','assistant']);
    expect(messages.slice(1)[0].text).toBe('First assistant response');expect(messages.some(item=>item.kind==='user')).toBe(false);
    expect((await f.runtime.inspect(f.task.taskId,second.runId)).source).toEqual(expected);
    const third=await f.runtime.start(f.task,'Genuine user follow-up',{runId:second.runId}),user=await third.done;
    expect(user.source).toBeUndefined();expect(transcript(user)[0]).toMatchObject({kind:'user',text:'Genuine user follow-up'});
  }finally{await f.cleanup()}
});

it('validates source independently of payload and allows failed-member batches without result envelopes',()=>{
  expect(checkedRunInputSource({...source(),messageIds:[]})).toMatchObject({messageIds:[],taskIds:['member-task']});
  for(const value of [null,{...source(),kind:'user'},{...source(),taskIds:[]},{...source(),messageIds:['one','one']},{...source(),taskIds:['one','one']},{...source(),continuationId:'../escape'},{...source(),permission:'full-access'}])expect(()=>checkedRunInputSource(value)).toThrow();
});

it('requires a completed original main conversation before accepting trusted result data',async()=>{
  for(const status of ['failed','cancelled'] as const){const f=await setup(status);try{
    await expect(f.runtime.start(f.task,'data',undefined,source())).rejects.toThrow('已有主对话');
    const first=await f.runtime.start(f.task);await first.done;
    await expect(f.runtime.start(f.task,'data',{runId:first.runId},source())).rejects.toThrow('未安全完成');
    expect(f.engines).toHaveLength(1);
  }finally{await f.cleanup()}}
});

it('rejects corrupt trusted metadata in a durable journal instead of treating it as user input',async()=>{
  const f=await setup();try{
    const first=await f.runtime.start(f.task);await first.done;
    const second=await f.runtime.start(f.task,'candidate',{runId:first.runId},source());await second.done;
    const file=path.join(f.directory,f.task.taskId,second.runId,'events.jsonl');
    const lines=(await fs.readFile(file,'utf8')).trimEnd().split('\n'),entry=JSON.parse(lines[0]);entry.data.source.taskIds=[];lines[0]=JSON.stringify(entry);await fs.writeFile(file,lines.join('\n')+'\n');
    await expect(f.runtime.inspect(f.task.taskId,second.runId)).rejects.toMatchObject({code:'RUN_LOG_INVALID'});
  }finally{await f.cleanup()}
});

it('passes the granted native call identity to dispatch tools and rejects attempts to reuse it',async()=>{
  const calls:{name:string;args:Record<string,unknown>;toolCallId?:string}[]=[];
  const bridge=await openBridge({list:async()=>[{name:'cbim_member_dispatch',inputSchema:{type:'object'}}],call:async(name,args,_signal,toolCallId)=>{calls.push({name,args,toolCallId});return {content:[{type:'text',text:'dispatched'}]}}},async()=>({allow:true}));
  try{
    const call={id:'trusted-native-id',name:'cbim_member_dispatch',input:{toolCallId:'untrusted-input-id',goal:'Verify result'}};
    const request=(route:string)=>fetch(bridge.url+route,{method:'POST',headers:{Authorization:'Bearer '+bridge.token,'Content-Type':'application/json'},body:JSON.stringify(call)});
    expect((await request('/call')).status).toBe(400);expect(calls).toEqual([]);
    expect((await request('/gate')).status).toBe(200);expect((await request('/call')).status).toBe(200);
    expect(calls).toEqual([{name:call.name,args:call.input,toolCallId:call.id}]);
    expect((await request('/call')).status).toBe(400);expect(calls).toHaveLength(1);
  }finally{await bridge.close()}
});
