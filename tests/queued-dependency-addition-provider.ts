import type {OwnerExecutionSelection} from '../src/backend/core/team/member-execution-binding';
import assert from 'node:assert/strict';
import http from 'node:http';
import {goalCompleteArguments,goalInspection,goalPlanArguments,type GoalFixtureRequest} from './goal-provider-fixture';
import type {GraphSnapshot} from '../src/backend/core/tasks/graph-types';
import {dependencyAdditionSchema,type AddQueuedDependencyInput,type AddQueuedDependencyReceipt} from '../src/backend/core/tasks/queued-dependency-addition';

export const dependencyAdditionData={
  model:'dependency-addition-fixture',goal:'DEPENDENCY_ADD_MAIN: 先建B和C再建A，给B追加A前置，保留原任务并顺序核实三份材料',
  goals:['DEPENDENCY_ADD_A: 核实首份材料并提交真实候选','DEPENDENCY_ADD_B: 等待A候选后核实第二份材料','DEPENDENCY_ADD_C: 等待B候选后核实第三份材料'],
  files:['addition-a.txt','addition-b.txt','addition-c.txt'],facts:['ADDITION_REAL_A_46c1','ADDITION_REAL_B_87f2','ADDITION_REAL_C_93d8'],
  acceptance:['依照真实A→B→C前置结果依次读取三份材料'],reason:'A在B/C之后登记，补上原B需要的A结果前置；保留三项任务及原执行实例。',
  held:'新增A→B前置已经保存，本主轮尚未结束，三个成员均不得提前启动。',
  final:'原A、B、C已依次首次核实真实材料，并按固定候选证据完成当前目标。',draft:'普通草稿：追加依赖不应清除或作为新任务发送。',
};
type Request=GoalFixtureRequest&{model:string;tools?:{function:{name:string}}[]};
function value(body:Request,id:string){const message=body.messages.find(item=>item.role==='tool'&&item.tool_call_id===id);assert.ok(message);assert.equal(typeof message.content,'string');return JSON.parse(message.content as string)}

/** Deterministic responses drive real Pi/dispatch/reads; identities and candidate references come only from tool replies. */
export async function dependencyAdditionProvider(options:{lostReply?:boolean}={}){
  const d=dependencyAdditionData,main:Request[]=[],member:Request[]=[],errors:string[]=[],sequence:string[]=[];
  const state:{before?:GraphSnapshot;recovered?:GraphSnapshot;input?:AddQueuedDependencyInput;receipt?:AddQueuedDependencyReceipt;scopeId?:string}={};
  let ownerSelection:OwnerExecutionSelection;let agentId='',moduleId='',release=()=>{};const gate=new Promise<void>(resolve=>release=resolve),heldTurn=options.lostReply?7:6;
  const server=http.createServer(async(req,res)=>{try{
    assert.equal(req.method,'POST');assert.ok(req.url?.endsWith('/chat/completions'));let raw='';for await(const chunk of req)raw+=chunk;
    const body=JSON.parse(raw) as Request;assert.equal(body.model,d.model);const isMain=body.tools?.some(tool=>tool.function.name==='cbim_dispatch_task')===true,requests=isMain?main:member,turn=requests.length;requests.push(body);sequence.push(`${isMain?'main':'member'}:${turn}`);
    res.writeHead(200,{'Content-Type':'text/event-stream'});const emit=(delta:unknown,finish_reason:string|null=null)=>res.write('data: '+JSON.stringify({id:'dependency-addition-'+sequence.length,object:'chat.completion.chunk',created:1,model:body.model,choices:[{index:0,delta,finish_reason}]})+'\n\n');
    const tool=(id:string,name:string,args:unknown)=>{emit({role:'assistant',tool_calls:[{index:0,id,type:'function',function:{name,arguments:JSON.stringify(args)}}]});emit({},'tool_calls')},reply=(text:string)=>{emit({role:'assistant',content:text});emit({},'stop')};
    const dispatch=(id:string,index:number,prior?:string)=>tool(id,'cbim_dispatch_task',{agentId,moduleIds:[moduleId],ownerSelection,goal:d.goals[index],acceptance:d.acceptance.map((text,index)=>({id:'criterion-'+index,text})),prerequisites:prior?[{taskId:prior,expectedPlanRevision:1}]:[]});
    if(isMain){
      assert.ok(body.tools?.some(item=>item.function.name==='cbim_dispatch_add_dependency'));assert.ok(body.tools?.every(item=>!['write','edit','bash'].includes(item.function.name)));
      if(turn===0)tool('addition-plan','cbim_goal_plan',goalPlanArguments({objective:d.goal,agentId,moduleIds:[moduleId],ownerSelection,acceptance:d.acceptance}));
      else if(turn===1)dispatch('addition-b',1);
      else if(turn===2)dispatch('addition-c',2,value(body,'addition-b').taskId);
      else if(turn===3)dispatch('addition-a',0);
      else if(turn===4)tool('addition-before','cbim_goal_inspect',{});
      else if(turn===5){
        const {scope,graph}=goalInspection(body,'addition-before'),[a,b,c]=d.goals.map(goal=>graph.tasks.find(task=>task.goal===goal)!);assert.ok(a&&b&&c);assert.deepEqual(graph.tasks.map(task=>task.goal),[d.goals[1],d.goals[2],d.goals[0]]);assert.ok(graph.tasks.every(task=>task.runIds.length===0&&!task.result));state.before=structuredClone(graph);state.scopeId=scope.scopeId;
        state.input={expectedGraphCursor:{streamId:graph.cursor.streamId,seq:graph.cursor.seq},expectedGoalRevision:scope.goal.revision,source:{taskId:a.taskId,expectedRevision:a.revision,expectedPlanRevision:a.planRevision},target:{taskId:b.taskId,expectedRevision:b.revision,expectedPlanRevision:b.planRevision},reason:d.reason};tool('addition-exact','cbim_dispatch_add_dependency',state.input);
      }else if(options.lostReply&&turn===6){assert.ok(JSON.stringify(body.messages.find(item=>item.tool_call_id==='addition-exact')).includes('TEST_ADDITION_REPLY_LOST'));tool('addition-recover-inspect','cbim_goal_inspect',{})}
      else if(turn===heldTurn){
        if(options.lostReply){const {graph}=goalInspection(body,'addition-recover-inspect');state.recovered=structuredClone(graph);const b=graph.tasks.find(task=>task.goal===d.goals[1])!;assert.equal(b.dependencyAdditions?.length,1);dependencyAdditionSchema.parse(b.dependencyAdditions[0]);}
        else{const receipt=value(body,'addition-exact') as AddQueuedDependencyReceipt;dependencyAdditionSchema.parse(receipt.addition);state.receipt=receipt;assert.equal(receipt.status,'waiting')}
        emit({role:'assistant',content:d.held});await gate;reply('主轮结束，请按已保存的真实依赖首次执行三个成员。');
      }else if(turn===heldTurn+1)tool('addition-final-inspect','cbim_goal_inspect',{});
      else if(turn===heldTurn+2){const inspection=goalInspection(body,'addition-final-inspect');assert.equal(inspection.graph.tasks.length,3);assert.ok(inspection.graph.tasks.every(task=>task.status==='result_ready'));tool('addition-final-review','cbim_goal_review',goalCompleteArguments(body,'addition-final-inspect'))}
      else if(turn===heldTurn+3)reply(d.final);
      else throw Error('Unexpected main replay after dependency addition: '+turn);
    }else{
      assert.ok(body.tools?.every(item=>!item.function.name.startsWith('cbim_dispatch_')));const index=Math.floor(turn/5),step=turn%5;assert.ok(index<3);const prefix='addition-worker-'+index;
      if(step===0){assert.ok(JSON.stringify(body.messages).includes(d.goals[index]));tool(prefix+'-plan','cbim_task_plan',{expectedVersion:0,goal:d.goals[index],reason:'按照本次可信前置首次核实材料',acceptance:d.acceptance,steps:[{id:'read',title:'真实读取本项材料',owner:'开发者'}]})}
      else if(step===1)tool(prefix+'-read','read',{path:d.files[index]});
      else if(step===2){assert.ok(JSON.stringify(body.messages).includes(d.facts[index]));tool(prefix+'-step','cbim_task_step',{expectedVersion:1,id:'read',state:'reported_done',evidenceIds:[prefix+'-read']})}
      else if(step===3)tool(prefix+'-delivery','cbim_delivery_prepare',{expectedVersion:2,summary:'真实读取证据：'+d.facts[index],limitations:['仅核实读取事实，不等同人工业务验收']});
      else reply('原任务首次运行已提交真实读取候选。');
    }
    res.end('data: [DONE]\n\n');
  }catch(error){errors.push(String(error));if(!res.headersSent)res.writeHead(500);res.end('Dependency addition fixture failed')}});
  await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));const address=server.address();assert.ok(address&&typeof address!=='string');
  return {url:`http://127.0.0.1:${address.port}/v1`,main,member,errors,sequence,state,heldTurn,releaseMain:()=>release(),bind:(agent:string,module:string,selection:OwnerExecutionSelection)=>{agentId=agent;moduleId=module;ownerSelection=selection},close:async()=>{release();server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()))}};
}
