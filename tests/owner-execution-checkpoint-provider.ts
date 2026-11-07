import assert from 'node:assert/strict';
import http from 'node:http';
import type {GraphSnapshot} from '../src/backend/core/tasks/graph-types';
import {ownerExecutionDiscoverySchema} from '../src/backend/core/team/owner-execution-discovery';
import {goalCompleteArguments,goalInspection} from './goal-provider-fixture';
import {ownerExecutionToolValue,type OwnerExecutionRequest} from './owner-execution-provider';
import {ownerExecutionData as data} from './owner-execution-fixture';

export type OwnerCheckpointMode='complete'|'before-reservation'|'before-claim';
export const ownerCheckpointData={goal:'OWNER_CHECKPOINT_MAIN: 同一负责岗位先写入并安全停泊，再按原身份续执行且重新读取，保留一次写入事实。',goalA:'OWNER_CHECKPOINT_A: 写入 owner-a.txt，安全停泊后重新读取并提交原任务候选。',acceptance:['由原负责岗位写入一次，续执行后重新读取当前文件并提交独立新证据'],reason:'文件阶段已保存并有实际基线，需要主调度明确预约一次原岗位续执行。'};

/** Real native write/read/capture/checkpoint and original-channel continuation; gates control only provider response timing. */
export async function ownerCheckpointProvider(mode:OwnerCheckpointMode){
  const main:OwnerExecutionRequest[]=[],member:OwnerExecutionRequest[]=[],errors:string[]=[],sequence:string[]=[];
  const state:{parked?:GraphSnapshot;queued?:unknown;resumeError?:unknown;initialVersion?:number;version?:number}={};let moduleId='',agentId='',before!:()=>void,after!:()=>void;
  const beforeGate=new Promise<void>(resolve=>before=resolve),afterGate=new Promise<void>(resolve=>after=resolve);
  const server=http.createServer(async(req,res)=>{try{
    let raw='';for await(const chunk of req)raw+=chunk;const body=JSON.parse(raw) as OwnerExecutionRequest,isMain=req.url==='/main/v1/chat/completions';assert.ok(isMain||req.url==='/a/v1/chat/completions');assert.equal(body.model,isMain?data.mainModel:data.models[0]);
    const list=isMain?main:member,turn=list.length;list.push(body);sequence.push((isMain?'main:':'member:')+turn);
    res.writeHead(200,{'Content-Type':'text/event-stream'});const emit=(delta:unknown,finish_reason:string|null=null)=>res.write('data: '+JSON.stringify({id:'owner-checkpoint-'+sequence.length,object:'chat.completion.chunk',created:1,model:body.model,choices:[{index:0,delta,finish_reason}]})+'\n\n');
    const tool=(id:string,name:string,input:unknown)=>{emit({role:'assistant',tool_calls:[{index:0,id,type:'function',function:{name,arguments:JSON.stringify(input)}}]});emit({},'tool_calls')},reply=(text:string)=>{emit({role:'assistant',content:text});emit({},'stop')};
    if(isMain){
      if(turn===0)tool('owner-checkpoint-discovery','cbim_module_owner_inspect',{moduleIds:[moduleId]});
      else if(turn===1){const discovered=ownerExecutionDiscoverySchema.parse(ownerExecutionToolValue(body,'owner-checkpoint-discovery').execution),selection=discovered.groups[0].selection;assert.ok(selection);assert.equal(discovered.groups[0].agentId,agentId);tool('owner-checkpoint-plan','cbim_goal_plan',{expectedRevision:1,objective:ownerCheckpointData.goal,constraints:['同一个原岗位和模型，仅一次安全停泊与续执行'],criteria:[{id:'proof',text:ownerCheckpointData.acceptance[0],kind:'evidence'}],assignments:[{agentId,moduleIds:[moduleId],ownerSelection:selection,criterionIds:['proof'],reason:'使用实际负责人查询所得岗位'}],reason:'安排同岗位文件工作与真实新读取验证'})}
      else if(turn===2){const selection=ownerExecutionDiscoverySchema.parse(ownerExecutionToolValue(body,'owner-checkpoint-discovery').execution).groups[0].selection;tool('owner-checkpoint-dispatch','cbim_dispatch_task',{agentId,moduleIds:[moduleId],ownerSelection:selection,goal:ownerCheckpointData.goalA,acceptance:ownerCheckpointData.acceptance.map((text,index)=>({id:'criterion-'+index,text})),prerequisites:[]})}
      else if(turn===3)reply('已派发原岗位文件工作，等待真实安全停泊记录。');
      else if(turn===4)tool('owner-checkpoint-parked','cbim_goal_inspect',{});
      else if(turn===5){const {scope,graph}=goalInspection(body,'owner-checkpoint-parked'),task=graph.tasks[0];assert.equal(task.status,'checkpointed');assert.equal(task.checkpoints?.length,1);assert.ok(task.ownerBinding);state.parked=structuredClone(graph);emit({role:'assistant',content:'原岗位已经安全停泊，尚未预约。'});await beforeGate;tool('owner-checkpoint-resume','cbim_dispatch_resume',{expectedGraphCursor:{streamId:graph.cursor.streamId,seq:graph.cursor.seq},expectedGoalRevision:scope.goal.revision,taskId:task.taskId,expectedRevision:task.revision,checkpointId:task.checkpoints![0].checkpointId,reason:'主调度明确预约同一个原岗位继续，不能使用当前主模型替代。'})}
      else if(turn===6){const value=ownerExecutionToolValue(body,'owner-checkpoint-resume');if(mode==='before-reservation'){assert.ok(value.error);state.resumeError=value;const {scope}=goalInspection(body,'owner-checkpoint-parked');tool('owner-checkpoint-blocked','cbim_goal_review',{expectedRevision:scope.goal.revision,decision:'blocked',checks:[{criterionId:'proof',outcome:'unmet',reason:'负责岗位关系已变化，原检查点不能被新岗位消费',evidence:[]}],superseded:[],gaps:['需显式重新规划，不自动恢复旧任务'],reason:'保留安全检查点历史，当前目标尚未完成'})}else{assert.ok(value.requestId);state.queued=value;emit({role:'assistant',content:'原岗位续执行已排入，当前主轮尚未结束。'});await afterGate;reply('主轮已结束，按原预约重新核实岗位后才可领取。')}}
      else if(mode==='before-reservation'&&turn===7)reply('原检查点未消费，目标保持未完成。');
      else if(turn===7)tool('owner-checkpoint-final','cbim_goal_inspect',{});
      else if(turn===8){const {scope,graph}=goalInspection(body,'owner-checkpoint-final');tool('owner-checkpoint-review','cbim_goal_review',mode==='complete'?goalCompleteArguments(body,'owner-checkpoint-final'):{expectedRevision:scope.goal.revision,decision:'blocked',checks:[{criterionId:'proof',outcome:'unmet',reason:'预约之后负责岗位关系变化，原任务不能建立新的运行',evidence:[]}],superseded:[],gaps:['不消费原检查点，不借主模型替换岗位模型'],reason:'记录真实领取拒绝，保留旧证据但不冒称完成'});if(mode==='before-claim')assert.equal(graph.tasks[0].runIds.length,1)}
      else if(turn===9){assert.ok(!ownerExecutionToolValue(body,'owner-checkpoint-review').error);reply('已核实原岗位检查点和实际续执行结果。')}
      else throw Error('Unexpected owner checkpoint main replay '+turn);
    }else{
      assert.ok(JSON.stringify(body.messages).includes(data.adaptations[0]));assert.ok(!JSON.stringify(body.messages).includes(data.adaptations[1]));
      if(turn===0)tool('owner-checkpoint-task-plan','cbim_task_plan',{expectedVersion:0,goal:ownerCheckpointData.goalA,acceptance:ownerCheckpointData.acceptance,reason:'先保存原岗位文件工作计划',steps:[{id:'verify',title:'实际写入后在续轮重新读取',owner:'开发者'}]});
      else if(turn===1)tool('owner-checkpoint-write','write',{path:data.files[0],content:data.facts[0]});
      else if(turn===2)tool('owner-checkpoint-read','read',{path:data.files[0]});
      else if(turn===3)tool('owner-checkpoint-current-progress','cbim_task_inspect',{});
      else if(turn===4){const inspected=ownerExecutionToolValue(body,'owner-checkpoint-current-progress');state.initialVersion=inspected.plan.version;assert.ok(Number.isSafeInteger(state.initialVersion));tool('owner-checkpoint-capture','cbim_task_artifact_capture',{expectedTaskProgressVersion:state.initialVersion,sourceToolCallIds:['owner-checkpoint-write','owner-checkpoint-read']})}
      else if(turn===5){const capture=ownerExecutionToolValue(body,'owner-checkpoint-capture');assert.equal(capture.state,'captured');tool('owner-checkpoint-park','cbim_task_checkpoint',{expectedTaskProgressVersion:state.initialVersion,baselineId:capture.baseline.baselineId,reason:ownerCheckpointData.reason})}
      else if(turn===6){assert.equal(ownerExecutionToolValue(body,'owner-checkpoint-park').state,'staged');reply('原岗位已请求停泊，由程序正常结算后才能交接。')}
      else if(turn===7)tool('owner-checkpoint-new-inspect','cbim_task_inspect',{});
      else if(turn===8){const inspected=ownerExecutionToolValue(body,'owner-checkpoint-new-inspect');state.version=inspected.plan.version;assert.ok(state.version!>state.initialVersion!);assert.deepEqual(inspected.evidence,[]);tool('owner-checkpoint-new-read','read',{path:data.files[0]})}
      else if(turn===9){assert.ok(JSON.stringify(body.messages).includes(data.facts[0]));tool('owner-checkpoint-new-step','cbim_task_step',{expectedVersion:state.version,id:'verify',state:'reported_done',evidenceIds:['owner-checkpoint-new-read']})}
      else if(turn===10)tool('owner-checkpoint-new-delivery','cbim_delivery_prepare',{expectedVersion:state.version!+1,summary:'原负责岗位续执行实际重新读取 '+data.facts[0],limitations:['旧轮读取不作为新轮完成证据']});
      else if(turn===11)reply('原岗位新轮已提交重新读取的真实候选。');
      else throw Error('Unexpected owner checkpoint member replay '+turn);
    }
    res.end('data: [DONE]\n\n');
  }catch(error){errors.push(String(error));if(!res.headersSent)res.writeHead(500);res.end('Owner checkpoint fixture failed')}});
  await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));const address=server.address();assert.ok(address&&typeof address!=='string');const base=`http://127.0.0.1:${address.port}`;
  return {urls:{main:base+'/main/v1',a:base+'/a/v1',b:base+'/b/v1'},main,member,errors,sequence,state,bind:(agent:string,module:string)=>{agentId=agent;moduleId=module},releaseBefore:before,releaseAfter:after,close:async()=>{before();after();server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()))}};
}
