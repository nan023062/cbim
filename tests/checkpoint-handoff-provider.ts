import {DependencyReviewRounds,serveFixtureCompaction} from './dependency-review-provider-fixture';
import assert from 'node:assert/strict';
import http from 'node:http';
import type {GraphSnapshot} from '../src/backend/core/tasks/graph-types';
import {ownerExecutionDiscoverySchema} from '../src/backend/core/team/owner-execution-discovery';
import type {OwnerExecutionSelection} from '../src/backend/core/team/member-execution-binding';
import {abandonCheckpointReceiptSchema,type AbandonCheckpointInput,type AbandonCheckpointReceipt} from '../src/backend/core/tasks/checkpoint-handoff';
import {goalInspection,goalPlanArguments,type GoalFixtureRequest} from './goal-provider-fixture';

export const checkpointHandoffData={
  goal:'CHECKPOINT_HANDOFF_MAIN: 原岗位安全停泊后明确处置旧任务及后继，按当前负责人重新核实三份材料，保留全部旧身份与记录。',
  oldGoals:['CHECKPOINT_HANDOFF_OLD_A: 写入首份材料并安全停泊，等待主调度明确处置','CHECKPOINT_HANDOFF_OLD_B: 等待原 A 后核实第二份材料','CHECKPOINT_HANDOFF_OLD_C: 等待原 B 后核实第三份材料'],
  newGoals:['CHECKPOINT_HANDOFF_NEW_A: 新负责岗位读取原首份材料，提交本任务新证据','CHECKPOINT_HANDOFF_NEW_B: 等待新 A 候选后读取第二份材料','CHECKPOINT_HANDOFF_NEW_C: 等待新 B 候选后读取第三份材料'],
  files:['handoff-a.txt','handoff-b.txt','handoff-c.txt'],facts:['HANDOFF_REAL_A_73c4','HANDOFF_REAL_B_95e1','HANDOFF_REAL_C_28a6'],
  models:{main:'handoff-main',a:'handoff-owner-a',b:'handoff-owner-b'},
  names:['交接原负责岗位 A','交接新负责岗位 B'],adaptations:['HANDOFF_OWNER_A: 原岗位按本任务写入并安全停泊，不替新负责岗位验证。','HANDOFF_OWNER_B: 接任后只执行主调度新派的任务，重新读取真实材料，不借旧候选或恢复旧任务。'],
  acceptance:['三份材料均由当前负责人新建的独立任务实际读取并提交可追溯候选，保留原写入与停泊历史'],
  checkpointReason:'首份材料已由原岗位实际写入、读取并采集基线，需要主调度决定后续安排。',
  abandonReason:'模块负责人已明确更换，放弃原岗位未消费的检查点；不恢复原任务、不回滚原文件，另建当前负责人任务。',
  cancelReason:'原检查点已为交接放弃，明确撤销仍未领取的原 B 和 C 完整后继闭包。',
  held:'原岗位已安全停泊，主调度正在等待本机明确更换负责人；尚未放弃检查点。',
  saved:'检查点交接处置已结束本次调用，主调度尚未重新派发。',
  final:'新负责岗位已在三个独立任务中重新核实真实材料，原检查点与后继仅按实际新候选替代，当前目标已审阅。',
  draft:'普通草稿：负责人交接不得发送或清除此文字。',
} as const;
export type CheckpointHandoffMode='complete'|'reserved'|'prepare-stop'|'lost-output';
export type HandoffRequest=GoalFixtureRequest&{model:string;tools?:{function:{name:string}}[]};
export function handoffToolValue(body:GoalFixtureRequest,id:string){const result=body.messages.find(message=>message.role==='tool'&&message.tool_call_id===id);assert.ok(result,'Missing actual tool reply '+id);assert.equal(typeof result.content,'string');return JSON.parse(result.content as string)}

/** Local deterministic provider only controls response timing; all assignments, native tools, handoff transactions and reviews are real. */
export async function checkpointHandoffProvider(mode:CheckpointHandoffMode='complete'){
  const d=checkpointHandoffData,main:HandoffRequest[]=[],a:HandoffRequest[]=[],b:HandoffRequest[]=[],errors:string[]=[],sequence:string[]=[];
  const state:{parked?:GraphSnapshot;readyForHandoff?:boolean;reservation?:{requestId:string};before?:GraphSnapshot;input?:AbandonCheckpointInput;receipt?:AbandonCheckpointReceipt;badOutput?:unknown;after?:GraphSnapshot;final?:GraphSnapshot;initialProgressVersion?:number}={};
  let agentId='',moduleId='',releaseHandoff!:()=>void,releaseAfterAbandon!:()=>void;
  const handoffGate=new Promise<void>(resolve=>releaseHandoff=resolve),afterGate=new Promise<void>(resolve=>releaseAfterAbandon=resolve),reserved=mode==='reserved',shift=reserved?1:0;
  const discovery=(body:HandoffRequest,id:string):OwnerExecutionSelection=>{const result=ownerExecutionDiscoverySchema.parse(handoffToolValue(body,id).execution);assert.equal(result.groups.length,1);assert.equal(result.groups[0].agentId,agentId);assert.ok(result.groups[0].selection);return result.groups[0].selection};
  const reviews=new DependencyReviewRounds();
  const compactions:GoalFixtureRequest[]=[];
  const server=http.createServer(async(req,res)=>{try{
    let raw='';for await(const chunk of req)raw+=chunk;const body=JSON.parse(raw) as HandoffRequest;
    const role=req.url==='/main/v1/chat/completions'?'main':req.url==='/a/v1/chat/completions'?'a':req.url==='/b/v1/chat/completions'?'b':undefined;assert.ok(role);assert.equal(body.model,d.models[role]);
    const requests=role==='main'?main:role==='a'?a:b,turn=requests.length-(role==='main'?reviews.offset:0);if(serveFixtureCompaction(body,res,compactions))return;requests.push(body);sequence.push(role+':'+turn);
    res.writeHead(200,{'Content-Type':'text/event-stream'});const emit=(delta:unknown,finish_reason:string|null=null)=>res.write('data: '+JSON.stringify({id:'checkpoint-handoff-'+sequence.length,object:'chat.completion.chunk',created:1,model:body.model,choices:[{index:0,delta,finish_reason}]})+'\n\n');
    const tool=(id:string,name:string,input:unknown)=>{emit({role:'assistant',tool_calls:[{index:0,id,type:'function',function:{name,arguments:JSON.stringify(input)}}]});emit({},'tool_calls')},reply=(text:string)=>{emit({role:'assistant',content:text});emit({},'stop')};
    const assign=(prefix:string,index:number,selection:OwnerExecutionSelection,prior?:string)=>tool(prefix,'cbim_dispatch_task',{agentId,moduleIds:[moduleId],ownerSelection:selection,goal:(prefix.startsWith('handoff-old-')?d.oldGoals:d.newGoals)[index],acceptance:d.acceptance.map((text,index)=>({id:'criterion-'+index,text})),prerequisites:prior?[{taskId:prior,expectedPlanRevision:1}]:[]});
    if((role==='main')&&reviews.handle(body,'handoff-final',tool,reply)){res.end('data: [DONE]\n\n');return}
    if(role==='main'){
      assert.ok(body.tools?.some(item=>item.function.name==='cbim_dispatch_abandon_checkpoint'));assert.ok(body.tools?.every(item=>!['cbim_task_help','cbim_task_checkpoint'].includes(item.function.name)));
      if(turn===0)tool('handoff-discover-a','cbim_module_owner_inspect',{moduleIds:[moduleId]});
      else if(turn===1)tool('handoff-plan-a','cbim_goal_plan',goalPlanArguments({objective:d.goal,agentId,moduleIds:[moduleId],ownerSelection:discovery(body,'handoff-discover-a'),acceptance:[...d.acceptance]}));
      else if(turn===2)assign('handoff-old-a',0,discovery(body,'handoff-discover-a'));
      else if(turn===3)assign('handoff-old-b',1,discovery(body,'handoff-discover-a'),handoffToolValue(body,'handoff-old-a').taskId);
      else if(turn===4)assign('handoff-old-c',2,discovery(body,'handoff-discover-a'),handoffToolValue(body,'handoff-old-b').taskId);
      else if(turn===5)reply('原 A、B、C 按真实依赖派发，等待原 A 的实际安全停泊。');
      else if(turn===6)tool('handoff-parked','cbim_goal_inspect',{});
      else if(turn===7){
        const {scope,graph}=goalInspection(body,'handoff-parked'),task=graph.tasks.find(item=>item.goal===d.oldGoals[0]);assert.ok(task);assert.equal(task.status,'checkpointed');assert.equal(task.checkpoints?.length,1);assert.equal(task.runIds.length,1);assert.ok(graph.tasks.filter(item=>item!==task).every(item=>item.runIds.length===0));state.parked=structuredClone(graph);
        if(reserved)tool('handoff-reserve','cbim_dispatch_resume',{expectedGraphCursor:{streamId:graph.cursor.streamId,seq:graph.cursor.seq},expectedGoalRevision:scope.goal.revision,taskId:task.taskId,expectedRevision:task.revision,checkpointId:task.checkpoints![0].checkpointId,reason:'在负责人尚未变更时真实预约，当前主轮未结束，因此原预约尚未领取。'});
        else{state.readyForHandoff=true;emit({role:'assistant',content:d.held});await handoffGate;tool('handoff-current','cbim_goal_inspect',{})}
      }else if(reserved&&turn===8){const receipt=handoffToolValue(body,'handoff-reserve');assert.ok(receipt.requestId);state.reservation=receipt;state.readyForHandoff=true;emit({role:'assistant',content:d.held});await handoffGate;tool('handoff-current','cbim_goal_inspect',{})}
      else if(turn===8+shift){
        const {scope,graph}=goalInspection(body,'handoff-current'),task=graph.tasks.find(item=>item.goal===d.oldGoals[0]);assert.ok(task?.checkpoints?.[0]);assert.equal(task.runIds.length,1);state.before=structuredClone(graph);
        state.input={expectedGraphCursor:{streamId:graph.cursor.streamId,seq:graph.cursor.seq},expectedGoalRevision:scope.goal.revision,taskId:task.taskId,expectedRevision:task.revision,expectedPlanRevision:task.planRevision,checkpointId:task.checkpoints[0].checkpointId,expectedResumeRequestId:task.resumeRequest?.requestId??null,reason:d.abandonReason};
        assert.equal(state.input.expectedResumeRequestId,reserved?state.reservation!.requestId:null);tool('handoff-abandon','cbim_dispatch_abandon_checkpoint',state.input);
      }else if(turn===9+shift){
        if(mode==='lost-output'){const failed=body.messages.find(message=>message.role==='tool'&&message.tool_call_id==='handoff-abandon');assert.ok(failed);assert.equal(typeof failed.content,'string');assert.ok(String(failed.content).includes('TOOL_OUTPUT_INVALID'));state.badOutput=failed.content}else{state.receipt=abandonCheckpointReceiptSchema.parse(handoffToolValue(body,'handoff-abandon'));assert.equal(state.receipt.status,'cancelled')}
        emit({role:'assistant',content:d.saved});await afterGate;tool('handoff-after','cbim_goal_inspect',{});
      }else if(turn===10+shift){
        const {graph}=goalInspection(body,'handoff-after'),oldA=graph.tasks.find(item=>item.goal===d.oldGoals[0]);assert.ok(oldA);assert.equal(oldA.status,'cancelled');assert.equal(oldA.runIds.length,1);assert.equal(oldA.checkpointAbandonment?.kind,'abandoned_by_handoff');state.after=structuredClone(graph);
        const targets=graph.tasks.filter(item=>d.oldGoals.slice(1).some(goal=>goal===item.goal));assert.equal(targets.length,2);assert.ok(targets.every(item=>item.runIds.length===0));tool('handoff-cancel-successors','cbim_dispatch_cancel',{expectedGraphCursor:{streamId:graph.cursor.streamId,seq:graph.cursor.seq},targets:targets.map(item=>({taskId:item.taskId,expectedRevision:item.revision})),reason:d.cancelReason});
      }else if(turn===11+shift){assert.ok(!handoffToolValue(body,'handoff-cancel-successors').error);tool('handoff-discover-b','cbim_module_owner_inspect',{moduleIds:[moduleId]})}
      else if(turn===12+shift){assert.notEqual(discovery(body,'handoff-discover-b').memberId,discovery(body,'handoff-discover-a').memberId);tool('handoff-replan-basis','cbim_goal_inspect',{})}
      else if(turn===13+shift){const {scope}=goalInspection(body,'handoff-replan-basis');tool('handoff-plan-b','cbim_goal_plan',{...goalPlanArguments({objective:d.goal,agentId,moduleIds:[moduleId],ownerSelection:discovery(body,'handoff-discover-b'),acceptance:[...d.acceptance]},scope.goal.revision),reason:'旧节点保留为历史，按当前负责岗位新建三项任务及依赖，不恢复原检查点'})}
      else if(turn===14+shift)assign('handoff-new-a',0,discovery(body,'handoff-discover-b'));
      else if(turn===15+shift)assign('handoff-new-b',1,discovery(body,'handoff-discover-b'),handoffToolValue(body,'handoff-new-a').taskId);
      else if(turn===16+shift)assign('handoff-new-c',2,discovery(body,'handoff-discover-b'),handoffToolValue(body,'handoff-new-b').taskId);
      else if(turn===17+shift)reply('当前负责岗位的新 A、B、C 已独立派发，旧节点和原记录保持原样。');
      else if(turn===18+shift)tool('handoff-final','cbim_goal_inspect',{});
      else if(turn===19+shift){
        const {scope,graph}=goalInspection(body,'handoff-final'),old=d.oldGoals.map(goal=>graph.tasks.find(item=>item.goal===goal)),fresh=d.newGoals.map(goal=>graph.tasks.find(item=>item.goal===goal));assert.equal(graph.tasks.length,6);assert.ok(old.every(item=>item?.status==='cancelled'));assert.ok(fresh.every(item=>item?.status==='result_ready'&&item.result));assert.equal(new Set(graph.tasks.map(item=>item.assignee.agentInstanceId)).size,6);state.final=structuredClone(graph);
        const evidence=fresh.map(item=>({kind:'member-result',taskId:item!.taskId,runId:item!.result!.runId,resultId:item!.result!.resultId,planRevision:item!.result!.planRevision,toolCallIds:item!.result!.evidenceRefs}));
        tool('handoff-review','cbim_goal_review',{expectedRevision:scope.goal.revision,decision:'complete',checks:scope.goal.plan.criteria.map(criterion=>({criterionId:criterion.id,outcome:'satisfied',reason:'逐项核对新负责岗位独立任务的真实读取候选',evidence})),superseded:old.map((item,index)=>({taskId:item!.taskId,replacementTaskIds:[fresh[index]!.taskId],reason:'后来创建的当前负责人任务已提交独立真实候选，原取消和放弃不是完成证据'})),gaps:[],reason:'保留旧检查点和全部旧节点，以新候选完成原目标'});
      }else if(turn===20+shift){assert.ok(!handoffToolValue(body,'handoff-review').error);reply(d.final)}
      else throw Error('Unexpected handoff main request '+turn);
    }else if(role==='a'){
      assert.ok(JSON.stringify(body.messages).includes(d.adaptations[0]));assert.ok(body.tools?.every(item=>!item.function.name.startsWith('cbim_dispatch_')));
      if(turn===0)tool('handoff-a-plan','cbim_task_plan',{expectedVersion:0,goal:d.oldGoals[0],acceptance:d.acceptance,reason:'保存原岗位文件阶段计划',steps:[{id:'read',title:'实际写入、读取与安全停泊',owner:'原负责岗位'}]});
      else if(turn===1)tool('handoff-a-write','write',{path:d.files[0],content:d.facts[0]});
      else if(turn===2)tool('handoff-a-read','read',{path:d.files[0]});
      else if(turn===3)tool('handoff-a-inspect','cbim_task_inspect',{});
      else if(turn===4){const inspected=handoffToolValue(body,'handoff-a-inspect');state.initialProgressVersion=inspected.plan.version;assert.ok(Number.isSafeInteger(state.initialProgressVersion));tool('handoff-a-capture','cbim_task_artifact_capture',{expectedTaskProgressVersion:state.initialProgressVersion,sourceToolCallIds:['handoff-a-write','handoff-a-read']})}
      else if(turn===5){const result=handoffToolValue(body,'handoff-a-capture');assert.equal(result.state,'captured');tool('handoff-a-checkpoint','cbim_task_checkpoint',{expectedTaskProgressVersion:state.initialProgressVersion,baselineId:result.baseline.baselineId,reason:d.checkpointReason})}
      else if(turn===6){assert.equal(handoffToolValue(body,'handoff-a-checkpoint').state,'staged');reply('原岗位本轮结束，待可靠停泊后由主调度处置。')}
      else throw Error('Old owner must never resume or run queued successors: '+turn);
    }else{
      const index=Math.floor(turn/5),step=turn%5,prefix='handoff-b-'+index;assert.ok(index<3);assert.ok(JSON.stringify(body.messages).includes(d.adaptations[1]));assert.ok(body.tools?.every(item=>!item.function.name.startsWith('cbim_dispatch_')));
      if(step===0){assert.ok(JSON.stringify(body.messages).includes(d.newGoals[index]));tool(prefix+'-plan','cbim_task_plan',{expectedVersion:0,goal:d.newGoals[index],acceptance:d.acceptance,reason:'新任务使用当前负责岗位和独立证据',steps:[{id:'read',title:'实际读取本项材料',owner:'新负责岗位'}]})}
      else if(step===1)tool(prefix+'-read','read',{path:d.files[index]});
      else if(step===2){assert.ok(JSON.stringify(body.messages).includes(d.facts[index]));tool(prefix+'-step','cbim_task_step',{expectedVersion:1,id:'read',state:'reported_done',evidenceIds:[prefix+'-read']})}
      else if(step===3)tool(prefix+'-delivery','cbim_delivery_prepare',{expectedVersion:2,summary:'新负责岗位实际核实 '+d.facts[index],limitations:['不借原检查点读取或旧候选，不代表人工验收']});
      else reply('本任务独立读取候选已提交。');
    }
    res.end('data: [DONE]\n\n');
  }catch(error){errors.push(String(error));if(!res.headersSent)res.writeHead(500);res.end('Checkpoint handoff fixture failed')}});
  await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));const address=server.address();assert.ok(address&&typeof address!=='string');const base=`http://127.0.0.1:${address.port}`;
  return {compactions,reviews,mode,urls:{main:base+'/main/v1',a:base+'/a/v1',b:base+'/b/v1'},main,a,b,errors,sequence,state,bind:(agent:string,module:string)=>{agentId=agent;moduleId=module},releaseHandoff,releaseAfterAbandon,close:async()=>{releaseHandoff();releaseAfterAbandon();server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()))}};
}
