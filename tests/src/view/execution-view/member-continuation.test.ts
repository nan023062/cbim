// view/execution-view: module-owned contract coverage; keep the original scenario and cleanup semantics.
import {expect,it} from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {LoopRuntime,checkedRunInputSource,type AgentEngine,type EngineContext,type TaskSpec,type RunInputSource} from '../../../../src/logic/execution/rules/index';
import {FileRunStorage} from '../../../../src/logic/execution/storage/run-storage';
import {transcript} from '../../../../src/view/execution-view/transcript';
import {openBridge} from '../../../../src/logic/execution/engines/pi/bridge';

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
  const runtime=new LoopRuntime({directory,storage:new FileRunStorage(),AcquireLease:async()=>()=>{},ToolPolicy:async()=>({allow:false}),CreateEngine:identity=>{identities.push(identity);const engine=new Engine(result);engines.push(engine);return engine}});
  return {directory,task,runtime,engines,identities,cleanup:async()=>{await runtime.Close();const target=path.resolve(directory);if(path.dirname(target)!==path.resolve(os.tmpdir())||!path.basename(target).startsWith('cbim-continuation-'))throw Error('Unexpected test cleanup path');await fs.rm(target,{recursive:true,force:true})}};
}

it('persists trusted continuation identity without a fake user message and keeps the first assistant response',async()=>{
  const f=await setup();try{
    const first=await f.runtime.Start(f.task,'Original user goal'),original=await first.done;
    const input=source(),expected=source();
    const pending=f.runtime.Start(f.task,'Candidate data, not authorization',{runId:first.runId},input);
    input.taskIds.push('mutated-after-start');
    const second=await pending,result=await second.done;
    expect(result.source).toEqual(expected);expect(result.events[0].data.source).toEqual(expected);
    expect(f.engines[1].context.source).toEqual(expected);expect(f.engines[1].context.sessionFile).toBe(original.sessionFile);
    expect(f.identities[1]).toEqual({task:f.task,runId:second.runId});
    const messages=transcript(result);expect(messages.map(item=>item.kind)).toEqual(['system','assistant']);
    expect(messages.slice(1)[0].text).toBe('First assistant response');expect(messages.some(item=>item.kind==='user')).toBe(false);
    expect((await f.runtime.Inspect(f.task.taskId,second.runId)).source).toEqual(expected);
    const third=await f.runtime.Start(f.task,'Genuine user follow-up',{runId:second.runId}),user=await third.done;
    expect(user.source).toBeUndefined();expect(transcript(user)[0]).toMatchObject({kind:'user',text:'Genuine user follow-up'});
  }finally{await f.cleanup()}
});
