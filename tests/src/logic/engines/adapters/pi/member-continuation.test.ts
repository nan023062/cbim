import { fixtureEngines } from '../../../../../support/engine-instances';
// logic/engines/adapters/pi: module-owned contract coverage; keep the original scenario and cleanup semantics.
import {expect,it} from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {LoopRuntime,checkedRunInputSource,type AgentEngine,type EngineContext,type TaskSpec,type RunInputSource} from '../../../../../../src/logic/execution/rules/index';
import {FileRunStorage} from '../../../../../../src/logic/execution/storage/run-storage';
import {transcript} from '../../../../../../src/view/execution-view/transcript';
import {openBridge} from '../../../../../../src/logic/engines/adapters/pi/bridge';

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
