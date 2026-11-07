import assert from 'node:assert/strict';
import http from 'node:http';
import {goalInspection,goalPlanArguments,type GoalFixtureRequest} from './goal-provider-fixture';
import {dependencyReplacementFixture} from './queued-dependency-replacement-provider';
import type {OwnerExecutionSelection} from '../src/backend/core/team/member-execution-binding';
import type {GraphSnapshot} from '../src/backend/core/tasks/graph-types';
import type {ReplaceQueuedDependencyInput,ReplaceQueuedDependencyReceipt} from '../src/backend/core/tasks/queued-dependency-replacement';
import {dependencyReplacementSchema} from '../src/backend/core/tasks/queued-dependency-replacement';
import {abandonCheckpointReceiptSchema,type AbandonCheckpointReceipt} from '../src/backend/core/tasks/checkpoint-handoff';

export const abandonedDependencyData={...dependencyReplacementFixture,
  goal:'ABANDONED_DEPENDENCY_MAIN: 明确放弃A检查点，以A2真实候选接替原B和C前置',
  goals:['ABANDONED_DEPENDENCY_A: 读取首份材料并保存可靠检查点','ABANDONED_DEPENDENCY_B: 等待首份候选后读取第二份材料','ABANDONED_DEPENDENCY_C: 等待B后读取第三份材料','ABANDONED_DEPENDENCY_A2: 独立核实首份材料并提交候选'],
  acceptance:['以真实候选顺序核实三份材料，保留原检查点及明确放弃记录'],
  reason:'A检查点已明确放弃；A2独立提供真实候选，原B/C保留身份并按新前置首次执行。',
  held:'已放弃检查点的前置替换已保存，原B/C尚未启动。',
  final:'新A2、原B和原C实际候选均已核实；原A检查点和放弃记录完整保留。',
};
type Request=GoalFixtureRequest&{model:string;tools?:{function:{name:string}}[]};
function value(body:Request,id:string){const m=body.messages.find(m=>m.role==='tool'&&m.tool_call_id===id);assert.ok(m&&typeof m.content==='string');return JSON.parse(m.content)}

/** Every checkpoint, reservation, abandonment, candidate and edge is produced by real tools, never by fixture state writes. */
export async function abandonedDependencyProvider(options:{badOutput?:boolean}={}){
  const d=abandonedDependencyData,main:Request[]=[],member:Request[]=[],sequence:string[]=[],errors:string[]=[];
  const state:{initialGraph?:GraphSnapshot;beforeReplacement?:GraphSnapshot;receipt?:ReplaceQueuedDependencyReceipt;input?:ReplaceQueuedDependencyInput;abandonment?:AbandonCheckpointReceipt}={};
  let agentId='',moduleId='',ownerSelection:OwnerExecutionSelection,release!:()=>void;const held=new Promise<void>(r=>release=r),heldTurn=options.badOutput?15:14;
  const server=http.createServer(async(req,res)=>{try{
    assert.equal(req.method,'POST');assert.ok(req.url?.endsWith('/chat/completions'));let raw='';for await(const chunk of req)raw+=chunk;
    const body=JSON.parse(raw) as Request,isMain=!!body.tools?.some(t=>t.function.name==='cbim_dispatch_task'),requests=isMain?main:member,turn=requests.length;requests.push(body);sequence.push(`${isMain?'main':'member'}:${turn}`);
    res.writeHead(200,{'Content-Type':'text/event-stream'});
    const emit=(delta:unknown,finish_reason:string|null=null)=>res.write('data: '+JSON.stringify({id:'abandoned-dependency-'+sequence.length,object:'chat.completion.chunk',created:1,model:body.model,choices:[{index:0,delta,finish_reason}]})+'\n\n');
    const tool=(id:string,name:string,args:unknown)=>{emit({role:'assistant',tool_calls:[{index:0,id,type:'function',function:{name,arguments:JSON.stringify(args)}}]});emit({},'tool_calls')};
    const reply=(text:string)=>{emit({role:'assistant',content:text});emit({},'stop')};
    const dispatch=(id:string,index:number,prior?:string)=>tool(id,'cbim_dispatch_task',{agentId,moduleIds:[moduleId],ownerSelection,goal:d.goals[index],acceptance:d.acceptance.map((text,i)=>({id:'criterion-'+i,text})),prerequisites:prior?[{taskId:prior,expectedPlanRevision:1}]:[]});
    if(isMain){
      if(turn===0)tool('abandoned-plan','cbim_goal_plan',goalPlanArguments({objective:d.goal,agentId,moduleIds:[moduleId],ownerSelection,acceptance:d.acceptance}));
      else if(turn===1)dispatch('abandoned-a',0);
      else if(turn===2)dispatch('abandoned-b',1,value(body,'abandoned-a').taskId);
      else if(turn===3)dispatch('abandoned-c',2,value(body,'abandoned-b').taskId);
      else if(turn===4)reply('先由原A读取并形成可靠检查点。');
      else if(turn===5)tool('abandoned-parked','cbim_goal_inspect',{});
      else if(turn===6){const {scope,graph}=goalInspection(body,'abandoned-parked'),a=graph.tasks.find(t=>t.goal===d.goals[0])!;assert.equal(a.status,'checkpointed');state.initialGraph=structuredClone(graph);tool('abandoned-reserve','cbim_dispatch_resume',{expectedGraphCursor:{streamId:graph.cursor.streamId,seq:graph.cursor.seq},expectedGoalRevision:scope.goal.revision,taskId:a.taskId,expectedRevision:a.revision,checkpointId:a.checkpoints![0].checkpointId,reason:'真实登记一次未领取预约，随后明确处置，不能暗中恢复'})}
      else if(turn===7)tool('abandoned-current','cbim_goal_inspect',{});
      else if(turn===8){const {scope,graph}=goalInspection(body,'abandoned-current'),a=graph.tasks.find(t=>t.goal===d.goals[0])!;assert.ok(a.resumeRequest);tool('abandoned-end','cbim_dispatch_abandon_checkpoint',{expectedGraphCursor:{streamId:graph.cursor.streamId,seq:graph.cursor.seq},expectedGoalRevision:scope.goal.revision,taskId:a.taskId,expectedRevision:a.revision,expectedPlanRevision:a.planRevision,checkpointId:a.checkpoints![0].checkpointId,expectedResumeRequestId:a.resumeRequest.requestId,reason:'明确放弃原检查点及未领取预约，由独立新候选接替'})}
      else if(turn===9){state.abandonment=abandonCheckpointReceiptSchema.parse(value(body,'abandoned-end'));tool('abandoned-after','cbim_goal_inspect',{})}
      else if(turn===10){const {graph}=goalInspection(body,'abandoned-after');assert.equal(graph.tasks[0].status,'cancelled');assert.equal(graph.tasks[0].runIds.length,1);dispatch('abandoned-a2',3)}
      else if(turn===11)reply('独立A2执行，原B/C保持等待。');
      else if(turn===12)tool('abandoned-ready','cbim_goal_inspect',{});
      else if(turn===13){const {scope,graph}=goalInspection(body,'abandoned-ready'),[a,b,c,a2]=d.goals.map(goal=>graph.tasks.find(t=>t.goal===goal)!);assert.equal(a.status,'cancelled');assert.ok(a.checkpointAbandonment);assert.ok(a2.result);assert.deepEqual(b.runIds,[]);assert.deepEqual(c.runIds,[]);state.beforeReplacement=structuredClone(graph);
        const edge=graph.edges.find(e=>e.kind==='dependency'&&e.enabled&&e.fromNodeId===a.nodeId&&e.toNodeId===b.nodeId)!;
        state.input={expectedGraphCursor:{streamId:graph.cursor.streamId,seq:graph.cursor.seq},expectedGoalRevision:scope.goal.revision,target:{taskId:b.taskId,expectedRevision:b.revision,expectedPlanRevision:b.planRevision},replace:{edgeId:edge.edgeId,expectedRevision:edge.revision},with:{taskId:a2.taskId,expectedRevision:a2.revision,expectedPlanRevision:a2.planRevision,runId:a2.result!.runId,resultId:a2.result!.resultId},reason:d.reason};tool('abandoned-replace','cbim_dispatch_replace_dependency',state.input);
      }else if(turn===14&&options.badOutput){assert.ok(JSON.stringify(body.messages).includes('TOOL_OUTPUT_INVALID'));const scope=value(body,'abandoned-ready').scope;assert.ok(scope.runTracking?.mainRunIds.length);tool('abandoned-query','cbim_dispatch_command_report',{runId:scope.runTracking.mainRunIds.at(-1),toolCallId:'abandoned-replace'})}
      else if(turn===heldTurn){
        if(options.badOutput){const report=value(body,'abandoned-query');assert.equal(report.command.state,'committed');assert.equal(report.source.outcome,'failed')}
        else{const receipt=value(body,'abandoned-replace') as ReplaceQueuedDependencyReceipt;dependencyReplacementSchema.parse(receipt.replacement);state.receipt=receipt}
        emit({role:'assistant',content:d.held});await held;reply('原主轮结束，由原B/C按新候选执行。');
      }else if(turn===heldTurn+1)tool('abandoned-final','cbim_goal_inspect',{});
      else if(turn===heldTurn+2){const {scope,graph}=goalInspection(body,'abandoned-final'),[a,b,c,a2]=d.goals.map(goal=>graph.tasks.find(t=>t.goal===goal)!);assert.ok([a2,b,c].every(t=>t.status==='result_ready'&&t.result));assert.deepEqual(a,state.beforeReplacement!.tasks.find(t=>t.taskId===a.taskId));
        const evidence=[a2,b,c].map(t=>({kind:'member-result',taskId:t.taskId,runId:t.result!.runId,resultId:t.result!.resultId,planRevision:t.planRevision,toolCallIds:t.result!.evidenceRefs}));
        tool('abandoned-review','cbim_goal_review',{expectedRevision:scope.goal.revision,decision:'complete',checks:scope.goal.plan.criteria.map(c=>({criterionId:c.id,outcome:'satisfied',reason:'核实新候选及原两级后继实际证据',evidence})),superseded:[{taskId:a.taskId,replacementTaskIds:[a2.taskId],reason:'明确放弃的原检查点由新A2真实候选接替'}],gaps:[],reason:d.final});
      }else if(turn===heldTurn+3)reply(d.final);else throw Error('Unexpected main replay '+turn);
    }else{
      if(turn===0)tool('abandoned-original-plan','cbim_task_plan',{expectedVersion:0,goal:d.goals[0],acceptance:d.acceptance,reason:'保存首段读取检查点',steps:[{id:'read',title:'读取首份材料',owner:'执行者'}]});
      else if(turn===1)tool('abandoned-original-read','read',{path:d.files[0]});
      else if(turn===2){assert.ok(JSON.stringify(body.messages).includes(d.facts[0]));tool('abandoned-capture','cbim_task_artifact_capture',{expectedTaskProgressVersion:1,sourceToolCallIds:['abandoned-original-read']})}
      else if(turn===3){const b=value(body,'abandoned-capture');assert.equal(b.state,'captured');tool('abandoned-checkpoint','cbim_task_checkpoint',{expectedTaskProgressVersion:1,baselineId:b.baseline.baselineId,reason:'交回可靠首段，由主调度明确选择后续'})}
      else if(turn===4){assert.equal(value(body,'abandoned-checkpoint').state,'staged');reply('原检查点段结束，没有交付候选。')}
      else{const index=Math.floor((turn-5)/5),step=(turn-5)%5,prefix='abandoned-worker-'+index,goal=d.goals[index===0?3:index];assert.ok(index>=0&&index<3);
        if(step===0){assert.ok(JSON.stringify(body.messages).includes(goal));tool(prefix+'-plan','cbim_task_plan',{expectedVersion:0,goal,acceptance:d.acceptance,reason:'使用实际前置首次执行',steps:[{id:'read',title:'读取本项材料',owner:'执行者'}]})}
        else if(step===1)tool(prefix+'-read','read',{path:d.files[index]});
        else if(step===2){assert.ok(JSON.stringify(body.messages).includes(d.facts[index]));tool(prefix+'-step','cbim_task_step',{expectedVersion:1,id:'read',state:'reported_done',evidenceIds:[prefix+'-read']})}
        else if(step===3)tool(prefix+'-delivery','cbim_delivery_prepare',{expectedVersion:2,summary:'实际读取：'+d.facts[index],limitations:[]});else reply('独立候选已保存。');
      }
    }
    res.end('data: [DONE]\n\n');
  }catch(e){errors.push(String(e));if(!res.headersSent)res.writeHead(500);res.end('Abandoned checkpoint fixture failed')}});
  await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));const address=server.address();assert.ok(address&&typeof address!=='string');
  return {url:`http://127.0.0.1:${address.port}/v1`,main,member,sequence,errors,state,heldTurn,bind:(agent:string,module:string,selection:OwnerExecutionSelection)=>{agentId=agent;moduleId=module;ownerSelection=selection},releaseMain:()=>release(),close:async()=>{release();server.closeAllConnections();await new Promise<void>(r=>server.close(()=>r()))}};
}
