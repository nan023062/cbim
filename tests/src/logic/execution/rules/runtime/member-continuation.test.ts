import { fixtureEngines } from '../../../../../support/engine-instances';
// logic/execution/rules/runtime: module-owned contract coverage; keep the original scenario and cleanup semantics.
import {expect,it} from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {LoopRuntime,checkedRunInputSource,type AgentEngine,type EngineContext,type TaskSpec,type RunInputSource} from '../../../../../../src/logic/execution/rules/index';
import {FileRunStorage} from '../../../../../../src/logic/execution/storage/run-storage';
import {transcript} from '../../../../../../src/view/execution-view/transcript';
import {openBridge} from '../../../../../../src/engine-plugins/pi/bridge';

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
  const runtime=new LoopRuntime({directory,storage:new FileRunStorage(),AcquireLease:async()=>()=>{},ToolPolicy:async()=>({allow:false}),engines:fixtureEngines(identity=>{identities.push(identity);const engine=new Engine(result);engines.push(engine);return engine})});
  return {directory,task,runtime,engines,identities,cleanup:async()=>{await runtime.Close();const target=path.resolve(directory);if(path.dirname(target)!==path.resolve(os.tmpdir())||!path.basename(target).startsWith('cbim-continuation-'))throw Error('Unexpected test cleanup path');await fs.rm(target,{recursive:true,force:true})}};
}

it('requires a completed original main conversation before accepting trusted result data',async()=>{
  for(const status of ['failed','cancelled'] as const){const f=await setup(status);try{
    await expect(f.runtime.Start(f.task,'data',undefined,source())).rejects.toThrow('已有主对话');
    const first=await f.runtime.Start(f.task);await first.done;
    await expect(f.runtime.Start(f.task,'data',{runId:first.runId},source())).rejects.toThrow('未安全完成');
    expect(f.engines).toHaveLength(1);
  }finally{await f.cleanup()}}
});

it('rejects corrupt trusted metadata in a durable journal instead of treating it as user input',async()=>{
  const f=await setup();try{
    const first=await f.runtime.Start(f.task);await first.done;
    const second=await f.runtime.Start(f.task,'candidate',{runId:first.runId},source());await second.done;
    const file=path.join(f.directory,f.task.taskId,second.runId,'events.jsonl');
    const lines=(await fs.readFile(file,'utf8')).trimEnd().split('\n'),entry=JSON.parse(lines[0]);entry.data.source.taskIds=[];lines[0]=JSON.stringify(entry);await fs.writeFile(file,lines.join('\n')+'\n');
    await expect(f.runtime.Inspect(f.task.taskId,second.runId)).rejects.toMatchObject({code:'RUN_LOG_INVALID'});
  }finally{await f.cleanup()}
});
