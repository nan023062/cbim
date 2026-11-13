import {DependencyReviewRounds} from './dependency-review-provider-fixture';
import http from 'node:http';
import assert from 'node:assert/strict';
import {memberCheckpointProvider,memberCheckpointFixture} from './member-checkpoint-provider';
import {goalInspection,goalPlanArguments,goalCompleteArguments,type GoalFixtureRequest} from './goal-provider-fixture';
import type {OwnerExecutionSelection} from '../src/backend/core/team/member-execution-binding';
export const memberChainData={...memberCheckpointFixture,waitReason:'两段检查点逐次保留，等待用户明确继续',supplement:'继续原任务，核实全部检查点链和累计文件。',abandonReason:'用户本轮决定终止最新检查点，保留先前已消费历史。'};
type Request=GoalFixtureRequest&{model:string;tools?:{function:{name:string}}[]};
function value(request:Request,id:string):any{const message=request.messages.find(m=>m.role==='tool'&&m.tool_call_id===id);assert.ok(message,'缺少真实回包 '+id);let data=JSON.parse(typeof message.content==='string'?message.content:JSON.stringify(message.content));if(Array.isArray(data.content))data=JSON.parse(data.content.filter((x:{type:string})=>x.type==='text').map((x:{text:string})=>x.text).join(''));return data}
/** Only model text is scripted; both persistent waits, user continuation, Pi histories and file effects are real. */
export async function memberCheckpointChainProvider(abandon=false){
  const members=await memberCheckpointProvider('complete',true),main:Request[]=[],compactions:Request[]=[],errors:string[]=[],sequence:string[]=[],data=memberChainData,state={waits:[] as unknown[],resumes:[] as unknown[],abandonment:undefined as unknown};
  let agentId='',moduleId='',ownerSelection:OwnerExecutionSelection|undefined;
  const reviews=new DependencyReviewRounds();
  const server=http.createServer(async(req,res)=>{try{
    let raw='';for await(const chunk of req)raw+=chunk;const body=JSON.parse(raw) as Request,isMain=body.tools?.some(t=>t.function.name==='cbim_dispatch_task')===true;
    assert.equal(req.method,'POST');assert.ok(req.url?.endsWith('/chat/completions'));assert.equal(body.model,data.model);
    // Real Pi may compact the long main history. It has no tools and must not advance the member dialogue.
    if(!body.tools?.length&&typeof body.messages[0]?.content==='string'&&body.messages[0].content.includes('context summarization assistant')){
      compactions.push(body);sequence.push('compaction:'+compactions.length);res.writeHead(200,{'Content-Type':'text/event-stream'});
      const summary='## Goal\n'+data.goal+'\n## Constraints & Preferences\n保留原身份、权限和证据；用户明确继续才运行。\n## Progress\n### Done\n已登记A、B、C及真实检查点；只以调度工具读取的当前状态判断进展。\n### In Progress\n沿同一任务分段核实。\n### Blocked\n等待中的任务不得自动运行。\n## Key Decisions\n旧记录不重放，完成需要新候选。\n## Next Steps\n1. 用 cbim_goal_inspect 查询最新图和目标，再决定预约或审阅。\n## Critical Context\n摘要不是证明或授权，版本、检查点ID和预约均取真实工具回包。';
      for(const [delta,finish_reason]of [[{role:'assistant',content:summary},null],[{},'stop']])res.write('data: '+JSON.stringify({id:'chain-compaction-'+compactions.length,object:'chat.completion.chunk',created:1,model:body.model,choices:[{index:0,delta,finish_reason}]})+'\n\n');res.end('data: [DONE]\n\n');return;
    }
    if(!isMain){sequence.push('member:'+members.member.length);const response=await fetch(members.url+'/chat/completions',{method:'POST',headers:{'Content-Type':'application/json'},body:raw});res.writeHead(response.status,{'Content-Type':'text/event-stream'});assert.ok(response.body);for await(const chunk of response.body)res.write(chunk);res.end();return}
    const turn=main.length-(true?reviews.offset:0);main.push(body);sequence.push('main:'+turn);res.writeHead(200,{'Content-Type':'text/event-stream'});
    const emit=(delta:unknown,finish_reason:string|null=null)=>res.write('data: '+JSON.stringify({id:'chain-'+turn,object:'chat.completion.chunk',created:1,model:body.model,choices:[{index:0,delta,finish_reason}]})+'\n\n');
    const tool=(id:string,name:string,args:unknown)=>{emit({role:'assistant',tool_calls:[{index:0,id,type:'function',function:{name,arguments:JSON.stringify(args)}}]});emit({},'tool_calls')},reply=(content:string)=>{emit({role:'assistant',content});emit({},'stop')};
    const plan={objective:data.goal,agentId,moduleIds:[moduleId],ownerSelection,acceptance:data.acceptance};
    if((true)&&reviews.handle(body,'chain-final-inspect',tool,reply)){res.end('data: [DONE]\n\n');return}
    if(turn===0)tool('chain-plan','cbim_goal_plan',goalPlanArguments(plan));
    else if(turn>=1&&turn<=3)tool('chain-dispatch-'+turn,'cbim_dispatch_task',{agentId,moduleIds:[moduleId],ownerSelection,goal:data.goals[turn-1],acceptance:data.acceptance.map((text,index)=>({id:'criterion-'+index,text})),prerequisites:turn===1?[]:[{taskId:value(body,'chain-dispatch-'+(turn-1)).taskId,expectedPlanRevision:1}]});
    else if(turn===4)reply('按原依赖执行A，并逐段保存可靠检查点。');
    else if(turn>=5&&turn<=20){
      const round=turn<13?1:2,stage=turn-(round===1?5:13),prefix='chain-'+round;
      if(stage===0)tool(prefix+'-wait-inspect','cbim_goal_inspect',{});
      else if(stage===1){const {scope,graph}=goalInspection(body,prefix+'-wait-inspect'),task=graph.tasks[0];assert.equal(task.status,'checkpointed');assert.equal(task.checkpoints?.length,round);tool(prefix+'-review','cbim_goal_review',{expectedRevision:scope.goal.revision,decision:'awaiting_user',checks:scope.goal.plan.criteria.map(c=>({criterionId:c.id,outcome:'unmet',reason:'保留最新未消费段及原后继',evidence:[]})),superseded:[],gaps:['等待明确继续'],reason:data.waitReason+' '+round,memberPause:{version:1,expectedGraphCursor:{streamId:graph.cursor.streamId,seq:graph.cursor.seq},tasks:graph.tasks.map(t=>({taskId:t.taskId,expectedRevision:t.revision,expectedPlanRevision:t.planRevision,...(t.status==='checkpointed'?{kind:'checkpoint',checkpointId:t.checkpoints!.at(-1)!.checkpointId}:{kind:'unstarted'})}))}})}
      else if(stage===2){state.waits.push(value(body,prefix+'-review'));reply(data.waitReason+' '+round)}
      else if(stage===3){assert.ok(JSON.stringify(body.messages).includes(data.supplement));tool(prefix+'-continue-inspect','cbim_goal_inspect',{})}
      else if(stage===4){const {scope}=goalInspection(body,prefix+'-continue-inspect');tool(prefix+'-replan','cbim_goal_plan',goalPlanArguments(plan,scope.goal.revision))}
      else if(stage===5)tool(prefix+'-resume-inspect','cbim_goal_inspect',{});
      else if(stage===6){const {scope,graph}=goalInspection(body,prefix+'-resume-inspect'),task=graph.tasks[0];assert.equal(task.checkpoints?.length,round);const common={expectedGraphCursor:{streamId:graph.cursor.streamId,seq:graph.cursor.seq},expectedGoalRevision:scope.goal.revision,taskId:task.taskId,expectedRevision:task.revision,checkpointId:task.checkpoints!.at(-1)!.checkpointId};
        if(abandon&&round===2)tool(prefix+'-abandon','cbim_dispatch_abandon_checkpoint',{...common,expectedPlanRevision:task.planRevision,expectedResumeRequestId:null,reason:data.abandonReason});
        else tool(prefix+'-resume','cbim_dispatch_resume',{...common,reason:'明确继续第 '+round+' 段：'+data.resumeReason});
      }else if(abandon&&round===2){state.abandonment=value(body,prefix+'-abandon');assert.equal((state.abandonment as {status:string}).status,'cancelled');tool('chain-abandon-inspect','cbim_goal_inspect',{})}
      else{const receipt=value(body,prefix+'-resume');assert.equal(typeof receipt.requestId,'string');state.resumes.push(receipt);reply('本次预约已保存，后续由调度领取。')}
    }else if(abandon){
      if(turn===21){const {scope}=goalInspection(body,'chain-abandon-inspect');tool('chain-abandon-review','cbim_goal_review',{expectedRevision:scope.goal.revision,decision:'blocked',checks:scope.goal.plan.criteria.map(c=>({criterionId:c.id,outcome:'unmet',reason:'用户明确放弃最新段',evidence:[]})),superseded:[],gaps:['原任务尚未交付，未启动后继不应执行'],reason:data.abandonReason})}
      else if(turn===22)reply('最新检查点已明确放弃，原历史保留；没有第三段执行或后继交付。');else throw Error('Unexpected abandon replay '+turn);
    }else if(turn===21)tool('chain-final-inspect','cbim_goal_inspect',{});
    else if(turn===22)tool('chain-final-review','cbim_goal_review',goalCompleteArguments(body,'chain-final-inspect'));
    else if(turn===23)reply(data.final);
    else throw Error('Unexpected main replay '+turn);
    res.end('data: [DONE]\n\n');
  }catch(error){errors.push(String(error));if(!res.headersSent)res.writeHead(500);res.end('Member chain fixture failed')}});
  await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));const address=server.address();assert.ok(address&&typeof address!=='string');
  return {reviews,url:`http://127.0.0.1:${address.port}/v1`,main,compactions,member:members.member,get errors(){return [...errors,...members.errors]},sequence,state,bind:(agent:string,module:string,selection:OwnerExecutionSelection)=>{agentId=agent;moduleId=module;ownerSelection=structuredClone(selection);members.bind(agent,module,selection)},close:async()=>{server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));await members.close()}};
}
