import {DependencyReviewRounds,serveFixtureCompaction} from './dependency-review-provider-fixture';
import assert from 'node:assert/strict';
import http from 'node:http';
import type {OwnerExecutionSelection} from '../src/backend/core/team/member-execution-binding';
import type {GraphSnapshot} from '../src/backend/core/tasks/graph-types';
import {reviseQueuedDependenciesReceiptSchema,type ReviseQueuedDependenciesInput,type ReviseQueuedDependenciesReceipt} from '../src/backend/core/tasks/queued-dependency-revision';
import {goalCompleteArguments,goalInspection,goalPlanArguments,type GoalFixtureRequest} from './goal-provider-fixture';

export const dependencyRevisionData={model:'dependency-revision-fixture',goal:'DEPENDENCY_REVISE_MAIN: 原子退役B到C并新增A和D到C，保留四个原任务，真实核实四份材料',
 goals:['DEPENDENCY_REVISE_A: 读取来源A','DEPENDENCY_REVISE_B: 读取独立B','DEPENDENCY_REVISE_C: 等待A和D后读取目标C','DEPENDENCY_REVISE_D: 等待A后读取来源D'],
 files:['revision-a.txt','revision-b.txt','revision-c.txt','revision-d.txt'],facts:['REVISION_A_108a','REVISION_B_265b','REVISION_C_391c','REVISION_D_417d'],
 acceptance:['按真实前置读取四份材料并保留原任务与依赖修订审计'],reason:'C不再依赖尚未执行的B；原子改为依赖A和D，四个任务保持。',
 held:'前置增删已保存，当前主轮尚未结束，成员不得提前领取。',final:'四个原任务均已实际读取材料并提交候选，按新图核实完成。',draft:'普通草稿：依赖修订和查询不能清除或自动发送。'};
type Request=GoalFixtureRequest&{model:string;tools?:{function:{name:string}}[]};
const value=(body:Request,id:string)=>{const m=body.messages.find(m=>m.role==='tool'&&m.tool_call_id===id);assert.ok(m);assert.equal(typeof m.content,'string');return JSON.parse(m.content as string)};

/** Local deterministic replies exercise real Pi, tools, journal and native reads; member interleaving is allowed. */
export async function dependencyRevisionProvider(options:{lostReply?:boolean}={}){
 const d=dependencyRevisionData,main:Request[]=[],member:Request[]=[],errors:string[]=[],sequence:string[]=[];
 const state:{before?:GraphSnapshot;recovered?:GraphSnapshot;input?:ReviseQueuedDependenciesInput;receipt?:ReviseQueuedDependenciesReceipt;scopeId?:string}={};
 let agentId='',moduleId='',ownerSelection:OwnerExecutionSelection,release=()=>{};const gate=new Promise<void>(r=>release=r),heldTurn=options.lostReply?8:7;
 const reviews=new DependencyReviewRounds();
  const compactions:GoalFixtureRequest[]=[];
  const server=http.createServer(async(req,res)=>{try{
  assert.equal(req.method,'POST');assert.ok(req.url?.endsWith('/chat/completions'));let raw='';for await(const c of req)raw+=c;const body=JSON.parse(raw) as Request;assert.equal(body.model,d.model);
  const isMain=body.tools?.some(t=>t.function.name==='cbim_dispatch_task'),requests=isMain?main:member,turn=requests.length-(isMain?reviews.offset:0);if(serveFixtureCompaction(body,res,compactions))return;requests.push(body);sequence.push((isMain?'main:':'member:')+turn);
  res.writeHead(200,{'Content-Type':'text/event-stream'});const emit=(delta:unknown,finish_reason:string|null=null)=>res.write('data: '+JSON.stringify({id:'revision-'+sequence.length,object:'chat.completion.chunk',created:1,model:d.model,choices:[{index:0,delta,finish_reason}]})+'\n\n');
  const tool=(id:string,name:string,args:unknown)=>{emit({role:'assistant',tool_calls:[{index:0,id,type:'function',function:{name,arguments:JSON.stringify(args)}}]});emit({},'tool_calls')},reply=(text:string)=>{emit({role:'assistant',content:text});emit({},'stop')};
  const dispatch=(id:string,i:number,prior?:string)=>tool(id,'cbim_dispatch_task',{agentId,ownerSelection,moduleIds:[moduleId],goal:d.goals[i],acceptance:d.acceptance.map((text,index)=>({id:'criterion-'+index,text})),prerequisites:prior?[{taskId:prior,expectedPlanRevision:1}]:[]});
    if((isMain)&&reviews.handle(body,'revision-final',tool,reply)){res.end('data: [DONE]\n\n');return}
  if(isMain){
   assert.ok(body.tools?.some(t=>t.function.name==='cbim_dispatch_revise_dependencies'));assert.ok(body.tools?.every(t=>!['write','edit','bash'].includes(t.function.name)));
   if(turn===0)tool('revision-plan','cbim_goal_plan',goalPlanArguments({objective:d.goal,agentId,moduleIds:[moduleId],ownerSelection,acceptance:d.acceptance}));
   else if(turn===1)dispatch('revision-b',1);
   else if(turn===2)dispatch('revision-c',2,value(body,'revision-b').taskId);
   else if(turn===3)dispatch('revision-a',0);
   else if(turn===4)dispatch('revision-d',3,value(body,'revision-a').taskId);
   else if(turn===5)tool('revision-before','cbim_goal_inspect',{});
   else if(turn===6){
    const {scope,graph}=goalInspection(body,'revision-before'),[a,b,c,other]=d.goals.map(goal=>graph.tasks.find(t=>t.goal===goal)!);assert.ok(a&&b&&c&&other);assert.ok(graph.tasks.every(t=>!t.runIds.length));state.before=structuredClone(graph);state.scopeId=scope.scopeId;
    const edge=graph.edges.find(e=>e.kind==='dependency'&&e.fromNodeId===b.nodeId&&e.toNodeId===c.nodeId)!;assert.ok(edge);const ref=(t:typeof a)=>({taskId:t.taskId,expectedRevision:t.revision,expectedPlanRevision:t.planRevision});
    state.input={expectedGraphCursor:{streamId:graph.cursor.streamId,seq:graph.cursor.seq},expectedGoalRevision:scope.goal.revision,target:ref(c),remove:[{edgeId:edge.edgeId,expectedRevision:edge.revision}],add:[ref(a),ref(other)],reason:d.reason};tool('revision-exact','cbim_dispatch_revise_dependencies',state.input);
   }else if(options.lostReply&&turn===7){assert.ok(JSON.stringify(body.messages.find(m=>m.tool_call_id==='revision-exact')).includes('TOOL_OUTPUT_INVALID'));tool('revision-recover','cbim_goal_inspect',{})}
   else if(turn===heldTurn){
    if(options.lostReply){const {graph}=goalInspection(body,'revision-recover');state.recovered=structuredClone(graph);assert.equal(graph.tasks.find(t=>t.goal===d.goals[2])!.dependencyRevisions?.length,1)}else state.receipt=reviseQueuedDependenciesReceiptSchema.parse(value(body,'revision-exact'));
    emit({role:'assistant',content:d.held});await gate;reply('主轮结束，按新依赖图首次领取四个原任务。');
   }else if(turn===heldTurn+1)tool('revision-final','cbim_goal_inspect',{});
   else if(turn===heldTurn+2){const {graph}=goalInspection(body,'revision-final');assert.equal(graph.tasks.length,4);assert.ok(graph.tasks.every(t=>t.status==='result_ready'));tool('revision-review','cbim_goal_review',goalCompleteArguments(body,'revision-final'))}
   else if(turn===heldTurn+3)reply(d.final);else throw Error('Unexpected main revision replay '+turn);
  }else{
   assert.ok(body.tools?.every(t=>!t.function.name.startsWith('cbim_dispatch_')));
   const text=JSON.stringify(body.messages),index=d.goals.findIndex(g=>text.includes(g));assert.ok(index>=0);const prefix='revision-worker-'+index;
   const has=(suffix:string)=>body.messages.some(m=>m.role==='tool'&&m.tool_call_id===prefix+suffix);
   if(!has('-plan'))tool(prefix+'-plan','cbim_task_plan',{expectedVersion:0,goal:d.goals[index],reason:'按原任务实际读取',acceptance:d.acceptance,steps:[{id:'read',title:'核实材料',owner:'开发者'}]});
   else if(!has('-read'))tool(prefix+'-read','read',{path:d.files[index]});
   else if(!has('-step')){assert.ok(text.includes(d.facts[index]));tool(prefix+'-step','cbim_task_step',{expectedVersion:1,id:'read',state:'reported_done',evidenceIds:[prefix+'-read']})}
   else if(!has('-delivery'))tool(prefix+'-delivery','cbim_delivery_prepare',{expectedVersion:2,summary:'真实材料：'+d.facts[index],limitations:['仅实际读取，不代表人工验收']});
   else reply('原任务首次读取已保存候选。');
  }
  res.end('data: [DONE]\n\n');
 }catch(e){errors.push(String(e));if(!res.headersSent)res.writeHead(500);res.end('Dependency revision fixture failed')}});
 await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));const address=server.address();assert.ok(address&&typeof address!=='string');
 return {compactions,reviews,url:`http://127.0.0.1:${address.port}/v1`,main,member,errors,sequence,state,heldTurn,releaseMain:()=>release(),bind:(agent:string,module:string,selection:OwnerExecutionSelection)=>{agentId=agent;moduleId=module;ownerSelection=selection},close:async()=>{release();server.closeAllConnections();await new Promise<void>(r=>server.close(()=>r()))}};
}
