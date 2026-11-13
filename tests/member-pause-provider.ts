import {DependencyReviewRounds} from './dependency-review-provider-fixture';
import http from 'node:http';
import assert from 'node:assert/strict';
import {memberCheckpointProvider,memberCheckpointFixture} from './member-checkpoint-provider';
import {goalInspection,goalPlanArguments,goalCompleteArguments,type GoalFixtureRequest} from './goal-provider-fixture';
import type {OwnerExecutionSelection} from '../src/logic/team/rules/member-execution-binding';
import type {GraphSnapshot} from '../src/logic/tasks/rules/graph-types';
import type {DispatchScope} from '../src/logic/tasks/rules/dispatch-scope';
export const memberPauseData={...memberCheckpointFixture,waitReason:'原检查点和后继已保留，等待用户补充后再继续',supplement:'继续原A、B、C，保持原目标和权限，重新核实文件与原会话。',live:'原等待已由用户明确消费，尚未预约成员续执行。'};
type Request=GoalFixtureRequest&{model:string;tools?:{function:{name:string}}[]};
function value(request:Request,id:string){
  const item=request.messages.find(m=>m.role==='tool'&&m.tool_call_id===id);assert.ok(item,'缺少真实回包 '+id);let parsed=JSON.parse(typeof item.content==='string'?item.content:JSON.stringify(item.content));
  if(Array.isArray(parsed.content))parsed=JSON.parse(parsed.content.filter((x:{type:string})=>x.type==='text').map((x:{text:string})=>x.text).join(''));return parsed;
}
/** Reuses the existing deterministic member dialogue; Pi, file effects, native sessions and all scheduler operations are real. */
export async function memberPauseProvider(holdContinuation=false){
  const members=await memberCheckpointProvider(),main:Request[]=[],compactions:Request[]=[],errors:string[]=[],sequence:string[]=[],data=memberPauseData;
  let agentId='',moduleId='',ownerSelection:OwnerExecutionSelection|undefined,release=()=>{};const gate=new Promise<void>(resolve=>{release=resolve});
  const state:{parked?:GraphSnapshot;reviewed?:DispatchScope;resume?:unknown;continued?:boolean}={};
  const reviews=new DependencyReviewRounds();
  const server=http.createServer(async(req,res)=>{try{
    let raw='';for await(const chunk of req)raw+=chunk;const body=JSON.parse(raw) as Request,isMain=body.tools?.some(t=>t.function.name==='cbim_dispatch_task')===true;
    assert.equal(req.method,'POST');assert.ok(req.url?.endsWith('/chat/completions'));assert.equal(body.model,data.model);
    // 原生摘要没有业务工具；它不推进成员脚本，也不代表任务重放。
    if(!body.tools?.length&&typeof body.messages[0]?.content==='string'&&body.messages[0].content.includes('context summarization assistant')){
      compactions.push(body);sequence.push('compaction:'+compactions.length);res.writeHead(200,{'Content-Type':'text/event-stream'});
      const summary='原A、B、C已登记。仅按 cbim_goal_inspect 的当前图和目标判断进展；用户明确继续才消费原等待。保留原检查点、身份、权限与文件证据，不重新执行已完成写入。';
      for(const [delta,finish_reason]of [[{role:'assistant',content:summary},null],[{},'stop']])res.write('data: '+JSON.stringify({id:'pause-compaction-'+compactions.length,object:'chat.completion.chunk',created:1,model:body.model,choices:[{index:0,delta,finish_reason}]})+'\n\n');res.end('data: [DONE]\n\n');return;
    }
    if(!isMain){sequence.push('member:'+members.member.length);const upstream=await fetch(members.url+'/chat/completions',{method:'POST',headers:{'Content-Type':'application/json'},body:raw});res.writeHead(upstream.status,{'Content-Type':'text/event-stream'});assert.ok(upstream.body);for await(const chunk of upstream.body)res.write(chunk);res.end();return}
    const turn=main.length-(true?reviews.offset:0);main.push(body);sequence.push('main:'+turn);res.writeHead(200,{'Content-Type':'text/event-stream'});
    const emit=(delta:unknown,finish_reason:string|null=null)=>res.write('data: '+JSON.stringify({id:'member-pause-'+turn,object:'chat.completion.chunk',created:1,model:body.model,choices:[{index:0,delta,finish_reason}]})+'\n\n');
    const tool=(id:string,name:string,args:unknown)=>{emit({role:'assistant',tool_calls:[{index:0,id,type:'function',function:{name,arguments:JSON.stringify(args)}}]});emit({},'tool_calls')},reply=(content:string)=>{emit({role:'assistant',content});emit({},'stop')};
    const plan={objective:data.goal,agentId,moduleIds:[moduleId],ownerSelection,acceptance:data.acceptance};
    if((true)&&reviews.handle(body,'pause-final-inspect',tool,reply)){res.end('data: [DONE]\n\n');return}
    if(turn===0)tool('pause-plan','cbim_goal_plan',goalPlanArguments(plan));
    else if(turn>=1&&turn<=3)tool('pause-dispatch-'+turn,'cbim_dispatch_task',{agentId,moduleIds:[moduleId],ownerSelection,goal:data.goals[turn-1],acceptance:data.acceptance.map((text,index)=>({id:'criterion-'+index,text})),prerequisites:turn===1?[]:[{taskId:value(body,'pause-dispatch-'+(turn-1)).taskId,expectedPlanRevision:1}]});
    else if(turn===4)reply('原任务已登记，先执行A并等待可靠检查点。');
    else if(turn===5)tool('pause-inspect','cbim_goal_inspect',{});
    else if(turn===6){const {scope,graph}=goalInspection(body,'pause-inspect');state.parked=graph;assert.equal(graph.tasks[0].status,'checkpointed');tool('pause-review','cbim_goal_review',{expectedRevision:scope.goal.revision,decision:'awaiting_user',checks:scope.goal.plan.criteria.map(c=>({criterionId:c.id,outcome:'unmet',reason:'原任务停泊，后继未领取',evidence:[]})),superseded:[],gaps:['等待用户明确继续'],reason:data.waitReason,memberPause:{version:1,expectedGraphCursor:{streamId:graph.cursor.streamId,seq:graph.cursor.seq},tasks:graph.tasks.map(t=>({taskId:t.taskId,expectedRevision:t.revision,expectedPlanRevision:t.planRevision,...(t.status==='checkpointed'?{kind:'checkpoint',checkpointId:t.checkpoints![0].checkpointId}:{kind:'unstarted'})}))}})}
    else if(turn===7){state.reviewed=value(body,'pause-review');assert.equal(state.reviewed?.goal?.review?.memberPause?.tasks.length,3);reply(data.waitReason)}
    else if(turn===8){state.continued=true;assert.ok(JSON.stringify(body.messages).includes(data.supplement));emit({role:'assistant',content:data.live});if(holdContinuation)await gate;tool('pause-continue-inspect','cbim_goal_inspect',{})}
    else if(turn===9){const {scope}=goalInspection(body,'pause-continue-inspect');tool('pause-replan','cbim_goal_plan',goalPlanArguments(plan,scope.goal.revision))}
    else if(turn===10)tool('pause-resume-inspect','cbim_goal_inspect',{});
    else if(turn===11){const {scope,graph}=goalInspection(body,'pause-resume-inspect'),task=graph.tasks.find(t=>t.goal===data.goals[0])!;assert.equal(task.status,'checkpointed');tool('pause-resume','cbim_dispatch_resume',{expectedGraphCursor:{streamId:graph.cursor.streamId,seq:graph.cursor.seq},expectedGoalRevision:scope.goal.revision,taskId:task.taskId,expectedRevision:task.revision,checkpointId:task.checkpoints![0].checkpointId,reason:data.resumeReason})}
    else if(turn===12){state.resume=value(body,'pause-resume');assert.equal(typeof (state.resume as {requestId?:string}).requestId,'string');reply('已重新核实，原任务继续后再领取后继。')}
    else if(turn===13)tool('pause-final-inspect','cbim_goal_inspect',{});
    else if(turn===14)tool('pause-final-review','cbim_goal_review',goalCompleteArguments(body,'pause-final-inspect'));
    else if(turn===15)reply(data.final);
    else throw Error('Unexpected main replay '+turn);
    res.end('data: [DONE]\n\n');
  }catch(error){errors.push(String(error));if(!res.headersSent)res.writeHead(500);res.end('Member pause fixture failed')}});
  await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));const address=server.address();assert.ok(address&&typeof address!=='string');
  return {reviews,url:`http://127.0.0.1:${address.port}/v1`,main,compactions,member:members.member,get errors(){return [...errors,...members.errors]},sequence,state,bind:(agent:string,module:string,selection:OwnerExecutionSelection)=>{agentId=agent;moduleId=module;ownerSelection=structuredClone(selection);members.bind(agent,module,selection)},releaseContinuation:()=>release(),close:async()=>{release();server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));await members.close()}};
}
