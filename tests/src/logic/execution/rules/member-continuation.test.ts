import { fixtureEngines } from '../../../../support/engine-instances';
// logic/execution/rules: module-owned contract coverage; keep the original scenario and cleanup semantics.
import {expect,it} from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {LoopRuntime,checkedRunInputSource,type AgentEngine,type EngineContext,type TaskSpec,type RunInputSource} from '../../../../../src/logic/execution/rules/index';
import {FileRunStorage} from '../../../../../src/logic/execution/storage/run-storage';
import {transcript} from '../../../../../src/view/execution-view/transcript';
import {openBridge} from '../../../../../src/engine-plugins/pi/bridge';

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

it('validates source independently of payload and allows failed-member batches without result envelopes',()=>{
  expect(checkedRunInputSource({...source(),messageIds:[]})).toMatchObject({messageIds:[],taskIds:['member-task']});
  for(const value of [null,{...source(),kind:'user'},{...source(),taskIds:[]},{...source(),messageIds:['one','one']},{...source(),taskIds:['one','one']},{...source(),continuationId:'../escape'},{...source(),permission:'full-access'}])expect(()=>checkedRunInputSource(value)).toThrow();
});
