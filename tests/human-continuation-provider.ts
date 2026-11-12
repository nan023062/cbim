import type {OwnerExecutionSelection} from '../src/backend/core/team/member-execution-binding';
import assert from 'node:assert/strict';
import http from 'node:http';
import {goalPlanArguments,type GoalFixtureRequest} from './goal-provider-fixture';
import {humanDecisionFixture as original} from './human-decisions-provider';

export type HumanContinuationMode='accept'|'reject'|'request_evidence'|'subject-changed'|'review-file-changed'|'stop';
export const humanContinuationFixture={...original,goal:'HUMAN_CONTINUATION_MAIN: 保存明确人工意见后由用户显式继续原目标',memberGoal:'HUMAN_CONTINUATION_MEMBER: 真实生成文件并提交候选供人工决定',reworkGoal:'HUMAN_CONTINUATION_REWORK: 根据本次人工意见产生新的真实候选',reworked:'HUMAN_CONTINUATION_REWORKED_813ba',chatDraft:'保留普通草稿，人工意见接续不发送此内容。',queued:'HUMAN_CONTINUATION_QUEUED: 暂停的独立后续目标',final:'根据精确的已消费人工接受及当前有效成果完成重新审阅。'};
type Request=GoalFixtureRequest&{model:string;tools?:{function:{name:string}}[]};
function result(request:Request,id:string):any{const message=request.messages.find(value=>value.role==='tool'&&value.tool_call_id===id);assert.ok(message,'Missing actual tool response '+id);const text=typeof message.content==='string'?message.content:Array.isArray(message.content)?message.content.map(value=>value&&typeof value==='object'&&'text'in value?String(value.text):'').join(''):'';const parse=(raw:string)=>{try{return JSON.parse(raw)}catch{return {error:raw}}};let value=parse(text);if(Array.isArray(value.content))value=parse(value.content.filter((part:{type:string})=>part.type==='text').map((part:{text:string})=>part.text).join(''));return value}
function gate(){let release=()=>{};const promise=new Promise<void>(resolve=>{release=resolve});return {promise,release}}

/** Real Pi, native tools, waiting and resumed native context; only local model responses are scripted. */
export async function humanContinuationProvider(mode:HumanContinuationMode='accept'){
  const d=humanContinuationFixture,main:Request[]=[],member:Request[]=[],errors:string[]=[],sequence:string[]=[],continued=gate(),final=gate();let agentId='',moduleId='';
  const state:{baselineId?:string;reworkBaselineId?:string;continuation?:any;continuedScope?:any;finalReview?:any}={};
  const plan=(expectedRevision=1)=>{const value=goalPlanArguments({objective:d.goal,agentId,moduleIds:[moduleId],ownerSelection,acceptance:d.acceptance},expectedRevision);return {...value,criteria:[...value.criteria,{id:d.humanId,text:d.humanCriterion,kind:'human'}],assignments:value.assignments.map(item=>({...item,criterionIds:[...item.criterionIds,d.humanId]}))}};
  const evidence=(task:any)=>{assert.equal(task.status,'result_ready');assert.ok(task.result);return {kind:'member-result',taskId:task.taskId,runId:task.result.runId,resultId:task.result.resultId,planRevision:task.result.planRevision,toolCallIds:task.result.evidenceRefs}};
  let ownerSelection:OwnerExecutionSelection|undefined;
  const server=http.createServer(async(req,res)=>{try{
    assert.equal(req.method,'POST');assert.ok(req.url?.endsWith('/chat/completions'));let raw='';for await(const chunk of req)raw+=chunk;const body=JSON.parse(raw) as Request;assert.equal(body.model,d.model);const isMain=body.tools?.some(value=>value.function.name==='cbim_dispatch_task')===true,list=isMain?main:member,turn=list.length;list.push(body);sequence.push(`${isMain?'main':'member'}:${turn}`);
    assert.ok(body.tools?.every(value=>!value.function.name.startsWith('cbim_human')));res.writeHead(200,{'Content-Type':'text/event-stream'});
    const emit=(delta:unknown,finish_reason:string|null=null)=>res.write('data: '+JSON.stringify({id:'human-continuation-'+sequence.length,object:'chat.completion.chunk',created:1,model:body.model,choices:[{index:0,delta,finish_reason}],...(finish_reason?{usage:{prompt_tokens:7,completion_tokens:3,total_tokens:10}}:{})})+'\n\n');
    const tool=(id:string,name:string,args:unknown)=>{emit({role:'assistant',tool_calls:[{index:0,id,type:'function',function:{name,arguments:JSON.stringify(args)}}]});emit({},'tool_calls')},reply=(text:string)=>{emit({role:'assistant',content:text});emit({},'stop')};
    if(isMain){
      assert.ok(body.tools?.every(value=>!['cbim_task_help','cbim_task_checkpoint'].includes(value.function.name)));
      if(turn===0)tool('human-continuation-plan','cbim_goal_plan',plan());
      else if(turn===1)tool('human-continuation-dispatch','cbim_dispatch_task',{agentId,moduleIds:[moduleId],ownerSelection,goal:d.memberGoal,acceptance:d.acceptance.map((text,index)=>({id:'criterion-'+index,text})),prerequisites:[]});
      else if(turn===2)reply('已派发真实成果任务。');
      else if(turn===3)tool('human-continuation-inspect','cbim_goal_inspect',{});
      else if(turn===4){const {scope,graph}=result(body,'human-continuation-inspect'),task=graph.tasks.find((value:any)=>value.scopeId===scope.scopeId);tool('human-continuation-wait','cbim_goal_review',{expectedRevision:scope.goal.revision,decision:'awaiting_user',checks:scope.goal.plan.criteria.map((item:any)=>({criterionId:item.id,outcome:item.kind==='human'?'needs_human':'satisfied',reason:item.kind==='human'?d.reason:'已核实实际读取',evidence:[evidence(task)]})),superseded:[],gaps:[d.reason],reason:d.reason})}
      else if(turn===5)reply(original.final);
      else if(turn===6){emit({role:'assistant',content:'已收到已保存人工意见的系统接续，先核对当前目标。'});await continued.promise;tool('human-continued-inspect','cbim_goal_inspect',{})}
      else if(turn===7){const {scope}=result(body,'human-continued-inspect');state.continuedScope=scope;state.continuation=scope.continuations.at(-1);assert.equal(state.continuation.kind,'human_decisions');assert.equal(state.continuation.input,undefined);assert.equal(state.continuation.inputRevision,2);const next=plan(scope.goal.revision);if(mode==='subject-changed')next.objective+='（已改变业务主体）';tool('human-continued-plan','cbim_goal_plan',next)}
      else if(mode==='reject'||mode==='request_evidence'){
        if(turn===8)tool('human-rework-dispatch','cbim_dispatch_task',{agentId,moduleIds:[moduleId],ownerSelection,goal:d.reworkGoal,acceptance:d.acceptance.map((text,index)=>({id:'criterion-'+index,text})),prerequisites:[]});
        else if(turn===9)reply('旧候选保留，根据人工意见派发新任务。');
        else if(turn===10)tool('human-rework-inspect','cbim_goal_inspect',{});
        else if(turn===11){const {scope,graph}=result(body,'human-rework-inspect'),old=graph.tasks.find((value:any)=>value.goal===d.memberGoal),next=graph.tasks.find((value:any)=>value.goal===d.reworkGoal);assert.ok(old?.result);assert.ok(next?.result);tool('human-rework-wait','cbim_goal_review',{expectedRevision:scope.goal.revision,decision:'awaiting_user',checks:scope.goal.plan.criteria.map((item:any)=>({criterionId:item.id,outcome:item.kind==='human'?'needs_human':'satisfied',reason:item.kind==='human'?'新候选需要新的人工决定':'已核实真实新候选',evidence:[evidence(next)]})),superseded:[{taskId:old.taskId,replacementTaskIds:[next.taskId],reason:'按本次消费的人工决定保留旧结果并补做',humanDecision:{decisionId:state.continuation.decisionIds[0],continuationId:state.continuation.continuationId}}],gaps:['新候选需要新的人工决定'],reason:'保留旧意见，不将旧批准扩展到新成果'})}
        else if(turn===12){state.finalReview=result(body,'human-rework-wait');assert.equal(state.finalReview.goal?.review?.decision,'awaiting_user');reply('新成果已交付，继续等待用户明确决定。')}
        else throw Error('Unexpected rework replay '+turn);
      }else if(turn===8)tool('human-final-inspect','cbim_goal_inspect',{});
      else if(turn===9){const {scope,graph}=result(body,'human-final-inspect'),task=graph.tasks.find((value:any)=>value.goal===d.memberGoal);tool('human-final-review','cbim_goal_review',{expectedRevision:scope.goal.revision,decision:'complete',checks:scope.goal.plan.criteria.map((item:any)=>({criterionId:item.id,outcome:'satisfied',reason:item.kind==='human'?'引用本次显式继续消费的精确人工接受':'重新核实原候选仍有效',evidence:item.kind==='human'?[{kind:'human-decision',decisionId:state.continuation.decisionIds[0],continuationId:state.continuation.continuationId}]:[evidence(task)]})),superseded:[],gaps:[],reason:'对照原目标、当前结果及本次消费的人工意见重新审阅'})}
      else if(turn===10){state.finalReview=result(body,'human-final-review');if(mode==='subject-changed')assert.ok(state.finalReview.error);else assert.equal(state.finalReview.goal?.review?.decision,'complete');if(mode==='review-file-changed'){emit({role:'assistant',content:'已提交完成审阅候选，最终关闭前仍须复核文件。'});await final.promise}reply(d.final)}
      else if(mode==='subject-changed'&&turn>=11&&turn<=12){
        // 无完成审阅允许有限反馈，但旧人工接受始终不能授权已经改变的业务主体。
        assert.ok(state.finalReview.error);assert.ok(JSON.stringify(body.messages.at(-1)?.content).includes('CBIM 最终验收未通过'));
        reply('原人工批准不能用于已改变的业务主体，仍未取得合法完成审阅。');
      }else throw Error('Explicit human continuation unexpectedly replayed main '+turn);
    }else{
      const rework=turn>=7,stage=turn%7,prefix=rework?'human-rework':'human-first',goal=rework?d.reworkGoal:d.memberGoal,fact=rework?d.reworked:d.fact;assert.ok(turn<14);
      if(stage===0)tool(prefix+'-plan','cbim_task_plan',{expectedVersion:0,goal,acceptance:d.acceptance,reason:rework?'按人工意见派发的新实例':'生成真实成果',steps:[{id:'verify',title:'生成并核实成果',owner:'开发者'}]});
      else if(stage===1)tool(prefix+'-write','write',{path:d.file,content:fact});
      else if(stage===2)tool(prefix+'-read','read',{path:d.file});
      else if(stage===3)tool(prefix+'-capture','cbim_task_artifact_capture',{expectedTaskProgressVersion:2,sourceToolCallIds:[prefix+'-write',prefix+'-read']});
      else if(stage===4){const capture=result(body,prefix+'-capture');assert.equal(capture.state,'captured');if(rework)state.reworkBaselineId=capture.baseline.baselineId;else state.baselineId=capture.baseline.baselineId;tool(prefix+'-step','cbim_task_step',{expectedVersion:2,id:'verify',state:'reported_done',evidenceIds:[prefix+'-read']})}
      else if(stage===5)tool(prefix+'-delivery','cbim_delivery_prepare',{expectedVersion:3,summary:(rework?'新候选：':'原候选：')+fact,limitations:['业务符合性须由用户明确判断']});
      else reply(rework?'新任务成果已提交，不改写旧任务或人工记录。':'真实候选及基线已提交。');
    }
    res.end('data: [DONE]\n\n');
  }catch(error){errors.push(String(error));if(!res.headersSent)res.writeHead(500);res.end('Human continuation fixture failed')}});
  await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));const address=server.address();assert.ok(address&&typeof address!=='string');const releaseAll=()=>{continued.release();final.release()};
  return {url:`http://127.0.0.1:${address.port}/v1`,main,member,errors,sequence,state,bind:(agent:string,module:string,selection:OwnerExecutionSelection)=>{agentId=agent;moduleId=module;ownerSelection=structuredClone(selection)},releaseContinuation:()=>continued.release(),releaseFinal:()=>final.release(),releaseAll,close:async()=>{releaseAll();server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()))}};
}
