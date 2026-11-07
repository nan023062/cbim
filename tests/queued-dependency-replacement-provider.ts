import assert from 'node:assert/strict';
import http from 'node:http';
import {goalInspection,goalPlanArguments,type GoalFixtureRequest} from './goal-provider-fixture';
import type {GraphSnapshot} from '../src/backend/core/tasks/graph-types';
import {dependencyReplacementSchema,type ReplaceQueuedDependencyReceipt} from '../src/backend/core/tasks/queued-dependency-replacement';

export const dependencyReplacementFixture={
  goal:'DEPENDENCY_REPLACE_MAIN: A求助后以A2真实候选替换B前置，保留原B和C身份顺序完成',
  goals:['DEPENDENCY_REPLACE_A: 核实首份材料并报告缺口','DEPENDENCY_REPLACE_B: 等待可信首份候选后读取第二份材料','DEPENDENCY_REPLACE_C: 等待B候选后读取第三份材料','DEPENDENCY_REPLACE_A2: 明确补齐首份材料验证并提交候选'],
  files:['dependency-a.txt','dependency-b.txt','dependency-c.txt'],facts:['DEPENDENCY_FACT_A_3ec1','DEPENDENCY_FACT_B_820f','DEPENDENCY_FACT_C_4bc9'],
  acceptance:['按实际前置结果依次核实三份材料，保留原求助及依赖替换审计'],
  helpReason:'首份材料需要主调度明确验证口径；当前任务不能生成前置候选。',
  helpQuestion:'请明确验证口径并派发新的A2任务，保留原B/C等待新的可靠候选。',
  reason:'A安全求助，A2已独立核实首份材料；以A2当前真实候选替换B的前置，原B/C任务不重建。',
  held:'依赖替换已提交，原B/C仍未启动，等待当前主轮安全结束。',
  final:'A2、原B和原C已按新前置顺序提交真实读取证据；原A求助与换边审计完整保留。',
  draft:'保留普通草稿，不作为依赖替换的额外任务。',
};
type Request=GoalFixtureRequest&{model:string;tools?:{function:{name:string}}[]};
function toolValue(body:Request,id:string){const item=body.messages.find(message=>message.role==='tool'&&message.tool_call_id===id);assert.ok(item);assert.equal(typeof item.content,'string');return JSON.parse(item.content as string)}

/** The provider never edits state: every task, candidate, edge and receipt is obtained through real Pi tool calls. */
export async function dependencyReplacementProvider(){
  const main:Request[]=[],member:Request[]=[],errors:string[]=[],sequence:string[]=[],d=dependencyReplacementFixture;
  const state:{initialGraph?:GraphSnapshot;beforeReplacement?:GraphSnapshot;receipt?:ReplaceQueuedDependencyReceipt}={};let agentId='',moduleId='',release=()=>{};const gate=new Promise<void>(resolve=>{release=resolve});
  const server=http.createServer(async(req,res)=>{try{
    assert.equal(req.method,'POST');assert.ok(req.url?.endsWith('/chat/completions'));let raw='';for await(const chunk of req)raw+=chunk;
    const body=JSON.parse(raw) as Request,isMain=body.tools?.some(tool=>tool.function.name==='cbim_dispatch_task')===true,requests=isMain?main:member,turn=requests.length;requests.push(body);sequence.push(`${isMain?'main':'member'}:${turn}`);
    res.writeHead(200,{'Content-Type':'text/event-stream'});
    const emit=(delta:unknown,finish_reason:string|null=null)=>res.write('data: '+JSON.stringify({id:'dependency-replacement-'+sequence.length,object:'chat.completion.chunk',created:1,model:body.model,choices:[{index:0,delta,finish_reason}]})+'\n\n');
    const tool=(id:string,name:string,args:unknown)=>{emit({role:'assistant',tool_calls:[{index:0,id,type:'function',function:{name,arguments:JSON.stringify(args)}}]});emit({},'tool_calls')},reply=(text:string)=>{emit({role:'assistant',content:text});emit({},'stop')};
    const dispatch=(id:string,goal:string,prior?:string)=>tool(id,'cbim_dispatch_task',{agentId,moduleIds:[moduleId],goal,acceptance:d.acceptance.map((text,index)=>({id:'criterion-'+index,text})),prerequisites:prior?[{taskId:prior,expectedPlanRevision:1}]:[]});
    if(isMain){
      assert.ok(body.tools?.some(item=>item.function.name==='cbim_dispatch_replace_dependency'));
      if(turn===0)tool('replace-goal-plan','cbim_goal_plan',goalPlanArguments({objective:d.goal,agentId,moduleIds:[moduleId],acceptance:d.acceptance}));
      else if(turn===1)dispatch('replace-a',d.goals[0]);
      else if(turn===2)dispatch('replace-b',d.goals[1],toolValue(body,'replace-a').taskId);
      else if(turn===3)dispatch('replace-c',d.goals[2],toolValue(body,'replace-b').taskId);
      else if(turn===4)reply('A、B、C已按依赖派发，先执行A。');
      else if(turn===5){assert.ok(JSON.stringify(body.messages).includes(d.helpReason));tool('replace-help-inspect','cbim_goal_inspect',{})}
      else if(turn===6){const {scope,graph}=goalInspection(body,'replace-help-inspect');state.initialGraph=structuredClone(graph);assert.equal(graph.tasks.length,3);tool('replace-goal-replan','cbim_goal_plan',{...goalPlanArguments({objective:d.goal,agentId,moduleIds:[moduleId],acceptance:d.acceptance},scope.goal.revision),reason:'由新A2补齐验证口径；保留原B/C的目标、范围、责任及验收'})}
      else if(turn===7)dispatch('replace-a2',d.goals[3]);
      else if(turn===8)reply('独立A2已派发，原B/C继续等待可靠前置。');
      else if(turn===9)tool('replace-ready-inspect','cbim_goal_inspect',{});
      else if(turn===10){
        const {scope,graph}=goalInspection(body,'replace-ready-inspect'),[a,b,c,a2]=d.goals.map(goal=>graph.tasks.find(task=>task.goal===goal)!);state.beforeReplacement=structuredClone(graph);assert.ok(a.help);assert.equal(a.result,undefined);assert.ok(a2.result);assert.deepEqual(b.runIds,[]);assert.deepEqual(c.runIds,[]);
        const edge=graph.edges.find(edge=>edge.kind==='dependency'&&edge.enabled&&edge.fromNodeId===a.nodeId&&edge.toNodeId===b.nodeId)!;assert.ok(edge);
        tool('replace-exact','cbim_dispatch_replace_dependency',{expectedGraphCursor:{streamId:graph.cursor.streamId,seq:graph.cursor.seq},expectedGoalRevision:scope.goal.revision,target:{taskId:b.taskId,expectedRevision:b.revision,expectedPlanRevision:b.planRevision},replace:{edgeId:edge.edgeId,expectedRevision:edge.revision},with:{taskId:a2.taskId,expectedRevision:a2.revision,expectedPlanRevision:a2.planRevision,runId:a2.result!.runId,resultId:a2.result!.resultId},reason:d.reason});
      }else if(turn===11){const receipt=toolValue(body,'replace-exact') as ReplaceQueuedDependencyReceipt;dependencyReplacementSchema.parse(receipt.replacement);state.receipt=receipt;emit({role:'assistant',content:d.held});await gate;reply('当前主轮结束，由原B/C按新的前置证据首次执行。')}
      else if(turn===12)tool('replace-final-inspect','cbim_goal_inspect',{});
      else if(turn===13){
        const {scope,graph}=goalInspection(body,'replace-final-inspect'),[a,b,c,a2]=d.goals.map(goal=>graph.tasks.find(task=>task.goal===goal)!);assert.equal(graph.tasks.length,4);assert.ok([a2,b,c].every(task=>task.status==='result_ready'&&task.result));assert.deepEqual(a.help,state.beforeReplacement!.tasks.find(task=>task.taskId===a.taskId)!.help);
        const evidence=[a2,b,c].map(task=>({kind:'member-result',taskId:task.taskId,runId:task.result!.runId,resultId:task.result!.resultId,planRevision:task.result!.planRevision,toolCallIds:task.result!.evidenceRefs}));
        tool('replace-complete','cbim_goal_review',{expectedRevision:scope.goal.revision,decision:'complete',checks:scope.goal.plan.criteria.map(criterion=>({criterionId:criterion.id,outcome:'satisfied',reason:'核实A2和原B/C的首次运行候选及固定前置证据',evidence})),superseded:[{taskId:a.taskId,replacementTaskIds:[a2.taskId],reason:'A仅提交安全求助；独立A2已经补齐真实候选'}],gaps:[],reason:'原B/C沿替换后的真实依赖完成，没有复活原A或重建任务'});
      }else if(turn===14)reply(d.final);else throw Error('Unexpected main replay after dependency replacement: '+turn);
    }else{
      assert.ok(body.tools?.every(item=>item.function.name!=='cbim_dispatch_replace_dependency'));
      if(turn===0)tool('replace-original-plan','cbim_task_plan',{expectedVersion:0,goal:d.goals[0],reason:'核实首份材料并报告缺口',acceptance:d.acceptance,steps:[{id:'read',title:'读取首份材料',owner:'开发者'}]});
      else if(turn===1)tool('replace-original-read','read',{path:d.files[0]});
      else if(turn===2){assert.ok(JSON.stringify(body.messages).includes(d.facts[0]));tool('replace-original-help','cbim_task_help',{kind:'missing_input',reason:d.helpReason,question:d.helpQuestion,attemptedToolCallIds:['replace-original-read']})}
      else if(turn===3)reply('原A本轮结束，保留求助，不提交候选。');
      else{
        const index=Math.floor((turn-4)/5),step=(turn-4)%5;assert.ok(index>=0&&index<3);const prefix='replace-worker-'+index,goal=d.goals[index===0?3:index];
        if(step===0){assert.ok(JSON.stringify(body.messages).includes(goal));tool(prefix+'-plan','cbim_task_plan',{expectedVersion:0,goal,reason:'按当前可信前置首次执行本任务',acceptance:d.acceptance,steps:[{id:'read',title:'读取本任务材料',owner:'开发者'}]})}
        else if(step===1)tool(prefix+'-read','read',{path:d.files[index]});
        else if(step===2){assert.ok(JSON.stringify(body.messages).includes(d.facts[index]));tool(prefix+'-step','cbim_task_step',{expectedVersion:1,id:'read',state:'reported_done',evidenceIds:[prefix+'-read']})}
        else if(step===3)tool(prefix+'-delivery','cbim_delivery_prepare',{expectedVersion:2,summary:'真实材料证据：'+d.facts[index],limitations:['仅核实读取事实，不代表人工验收']});else reply('本任务首次运行已提交读取候选。');
      }
    }
    res.end('data: [DONE]\n\n');
  }catch(error){errors.push(String(error));if(!res.headersSent)res.writeHead(500);res.end('Queued dependency replacement fixture failed')}});
  await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));const address=server.address();assert.ok(address&&typeof address!=='string');
  return {url:`http://127.0.0.1:${address.port}/v1`,main,member,errors,sequence,state,releaseMain:()=>release(),bind:(agent:string,module:string)=>{agentId=agent;moduleId=module},close:async()=>{release();server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()))}};
}
