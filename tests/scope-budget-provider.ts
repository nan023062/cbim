import assert from 'node:assert/strict';
import http from 'node:http';
import {goalCompleteArguments,goalInspection,goalPlanArguments,type GoalFixtureRequest} from './goal-provider-fixture';

export type BudgetFixtureMode='main-limit'|'member-limit'|'cost-limit'|'unknown-price'|'tokens-unpriced'|'complete'|'waiting';
export const scopeBudgetFixture={
  goal:'SCOPE_BUDGET: 独立核实业务文件，按照真实证据完成目标',
  memberGoal:'SCOPE_BUDGET_MEMBER: 读取 budget-source.txt 并提交真实读取证据。',
  file:'budget-source.txt',fact:'SCOPE_BUDGET_NATIVE_READ_b81d',model:'scope-budget-fixture',
  acceptance:['实际读取 budget-source.txt 并提交读取回执'],
  humanId:'display-choice',humanCriterion:'展示方案必须由用户明确决定',
  waitReason:'读取事实已核实，展示方案仍需用户补充；本目标尚未完成。',
  queued:'SCOPE_BUDGET_QUEUED: 后续独立目标草稿，不得因调整限额自动运行。',
  supplement:'仅补充展示偏好，不代替人工验收签署。',
};
type Request=GoalFixtureRequest&{model:string;tools?:{function:{name:string}}[]};
function gate(){let release=()=>{};const promise=new Promise<void>(resolve=>{release=resolve});return {promise,release}}

/** Each real Pi run may cross the limit internally; deterministic usage makes the next-run boundary observable. */
export async function scopeBudgetProvider(mode:BudgetFixtureMode){
  const d=scopeBudgetFixture,main:Request[]=[],member:Request[]=[],errors:string[]=[],sequence:string[]=[],mainGate=gate(),memberGate=gate();let agentId='',moduleId='';
  const server=http.createServer(async(req,res)=>{try{
    assert.equal(req.method,'POST');assert.ok(req.url?.endsWith('/chat/completions'));let raw='';for await(const chunk of req)raw+=chunk;
    const body=JSON.parse(raw) as Request;assert.equal(body.model,d.model);const isMain=body.tools?.some(tool=>tool.function.name==='cbim_dispatch_task')===true,requests=isMain?main:member,turn=requests.length;requests.push(body);sequence.push(`${isMain?'main':'member'}:${turn}`);
    res.writeHead(200,{'Content-Type':'text/event-stream'});
    const emit=(delta:unknown,finish_reason:string|null=null)=>res.write('data: '+JSON.stringify({id:'budget-'+sequence.length,object:'chat.completion.chunk',created:1,model:body.model,choices:[{index:0,delta,finish_reason}],...(finish_reason?{usage:{prompt_tokens:isMain?100:200,completion_tokens:isMain?20:40,total_tokens:isMain?120:240}}:{})})+'\n\n');
    const tool=(id:string,name:string,args:unknown)=>{emit({role:'assistant',tool_calls:[{index:0,id,type:'function',function:{name,arguments:JSON.stringify(args)}}]});emit({},'tool_calls')},reply=(text:string)=>{emit({role:'assistant',content:text});emit({},'stop')};
    if(isMain){
      assert.ok(body.tools?.every(item=>!['write','edit','bash'].includes(item.function.name)));
      if(turn===0){const plan=goalPlanArguments({objective:d.goal,agentId,moduleIds:[moduleId],acceptance:d.acceptance});tool('budget-goal-plan','cbim_goal_plan',mode==='waiting'?{...plan,criteria:[...plan.criteria,{id:d.humanId,text:d.humanCriterion,kind:'human'}],assignments:plan.assignments.map(item=>({...item,criterionIds:[...item.criterionIds,d.humanId]}))}:plan)}
      else if(turn===1)tool('budget-dispatch','cbim_dispatch_task',{agentId,moduleIds:[moduleId],goal:d.memberGoal,acceptance:d.acceptance.map((text,index)=>({id:'criterion-'+index,text})),prerequisites:[]});
      else if(turn===2){emit({role:'assistant',content:'已派发成员，主轮尚未结算。'});await mainGate.promise;reply('本主轮结束，由调度系统核实下一轮准入。')}
      else if(turn===3)tool('budget-goal-inspect','cbim_goal_inspect',{});
      else if(turn===4){
        if(mode==='waiting'){
          // The shared helper deliberately rejects human criteria; build the awaiting_user review from real evidence instead.
          const {scope,graph}=goalInspection(body,'budget-goal-inspect'),task=graph.tasks.find(item=>item.scopeId===scope.scopeId);assert.ok(task?.result);const result=task.result,evidence=[{kind:'member-result',taskId:task.taskId,runId:result.runId,resultId:result.resultId,planRevision:result.planRevision,toolCallIds:result.evidenceRefs}];
          tool('budget-goal-review','cbim_goal_review',{expectedRevision:scope.goal.revision,decision:'awaiting_user',checks:scope.goal.plan.criteria.map(item=>({criterionId:item.id,outcome:item.kind==='human'?'needs_human':'satisfied',reason:item.kind==='human'?d.waitReason:'已核实成员真实读取证据',evidence:item.kind==='human'?[]:evidence})),superseded:[],gaps:[d.waitReason],reason:d.waitReason});
        }else tool('budget-goal-review','cbim_goal_review',goalCompleteArguments(body,'budget-goal-inspect'));
      }else if(turn===5)reply(mode==='waiting'?d.waitReason:'成员事实已核实，当前目标完成。');
      else throw Error('Budget boundary unexpectedly started or replayed a main request: '+turn);
    }else{
      assert.ok(body.tools?.every(item=>item.function.name!=='cbim_dispatch_task'));
      if(turn===0){emit({role:'assistant',content:'独立执行成员已启动，等待本机验证闸门。'});await memberGate.promise;tool('budget-task-plan','cbim_task_plan',{expectedVersion:0,goal:d.memberGoal,reason:'读取已授权业务文件',acceptance:d.acceptance,steps:[{id:'verify',title:'读取并核实文件',owner:'开发者'}]})}
      else if(turn===1)tool('budget-read','read',{path:d.file});
      else if(turn===2){assert.ok(JSON.stringify(body.messages).includes(d.fact));tool('budget-step','cbim_task_step',{expectedVersion:1,id:'verify',state:'reported_done',evidenceIds:['budget-read']})}
      else if(turn===3)tool('budget-delivery','cbim_delivery_prepare',{expectedVersion:2,summary:'真实读取证据：'+d.fact,limitations:['只核实读取事实，不替代人工验收']});
      else if(turn===4)reply('读取证据已提交。');else throw Error('Budget boundary unexpectedly replayed a member: '+turn);
    }
    res.end('data: [DONE]\n\n');
  }catch(error){errors.push(String(error));if(!res.headersSent)res.writeHead(500);res.end('Scope budget fixture failed')}});
  await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));const address=server.address();assert.ok(address&&typeof address!=='string');const releaseAll=()=>{mainGate.release();memberGate.release()};
  return {url:`http://127.0.0.1:${address.port}/v1`,main,member,errors,sequence,bind:(agent:string,module:string)=>{agentId=agent;moduleId=module},releaseMain:()=>mainGate.release(),releaseMember:()=>memberGate.release(),releaseAll,close:async()=>{releaseAll();server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()))}};
}
