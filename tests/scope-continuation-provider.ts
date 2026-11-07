import assert from 'node:assert/strict';
import http from 'node:http';
import {goalCompleteArguments,goalInspection,goalPlanArguments,type GoalFixtureRequest} from './goal-provider-fixture';
import type {DispatchScope} from '../src/backend/core/tasks/dispatch-scope';

export const continuationFixture={
  mainGoal:'SCOPE_CONTINUE_MAIN: 核实项目文件后，按补充的输出格式汇报',
  memberGoal:'SCOPE_CONTINUE_MEMBER: 读取 continue-input.txt 并提交真实读取证据',
  acceptance:['实际读取 continue-input.txt 并提交工具回执'],
  fact:'SCOPE_CONTINUE_REAL_FILE_79fc42',
  waitReason:'已有核实证据，请补充汇报格式：短句或列表；这不是人工验收。',
  waitingFinal:'文件核实完毕，等待补充输出格式，整体目标尚未完成。',
  supplement:'请用简短列表汇报已核实的文件事实；这是格式补充，不是业务验收批准。',
  liveContinuation:'正在依据显式补充重新检查原目标。',
  final:'已按补充要求用简短列表汇报真实文件事实。',
  queuedGoal:'同意',
  queuedFinal:'单独答复排队消息；没有把同意解释为原目标的验收。',
};
type ProviderRequest=GoalFixtureRequest&{model:string;tools?:{function:{name:string}}[]};

/** Model transport fixture only: native Pi, tool authorization, evidence and continuation records are real. */
export async function scopeContinuationProvider(options:{holdContinuation?:boolean;waitAgain?:boolean}={}){
  const mainRequests:ProviderRequest[]=[],memberRequests:ProviderRequest[]=[],errors:string[]=[];
  let agentId='',moduleId='',releaseContinuation=()=>{};
  const continuationGate=new Promise<void>(resolve=>{releaseContinuation=resolve});
  const server=http.createServer(async(req,res)=>{
    try{
      assert.equal(req.method,'POST');assert.ok(req.url?.endsWith('/chat/completions'));
      let raw='';for await(const chunk of req)raw+=chunk;
      const body=JSON.parse(raw) as ProviderRequest,isMain=body.tools?.some(tool=>tool.function.name==='cbim_dispatch_task')===true;
      const list=isMain?mainRequests:memberRequests,turn=list.length;list.push(body);
      res.writeHead(200,{'Content-Type':'text/event-stream'});
      const emit=(delta:unknown,finish_reason:string|null=null)=>res.write('data: '+JSON.stringify({id:'scope-continue-'+(mainRequests.length+memberRequests.length),object:'chat.completion.chunk',created:1,model:body.model,choices:[{index:0,delta,finish_reason}]})+'\n\n');
      const tool=(id:string,name:string,args:unknown)=>{emit({role:'assistant',tool_calls:[{index:0,id,type:'function',function:{name,arguments:JSON.stringify(args)}}]});emit({},'tool_calls')};
      const reply=(content:string)=>{emit({role:'assistant',content});emit({},'stop')};
      if(isMain){
        if(turn===0)tool('continue-goal-plan','cbim_goal_plan',goalPlanArguments({objective:continuationFixture.mainGoal,agentId,moduleIds:[moduleId],acceptance:continuationFixture.acceptance}));
        else if(turn===1)tool('continue-dispatch','cbim_dispatch_task',{agentId,moduleIds:[moduleId],goal:continuationFixture.memberGoal,acceptance:continuationFixture.acceptance.map((text,index)=>({id:'criterion-'+index,text})),prerequisites:[]});
        else if(turn===2)reply('成员已派发，等待读取结果。');
        else if(turn===3)tool('continue-wait-inspect','cbim_goal_inspect',{});
        else if(turn===4){const review=goalCompleteArguments(body,'continue-wait-inspect');tool('continue-wait-review','cbim_goal_review',{...review,decision:'awaiting_user',gaps:[continuationFixture.waitReason],reason:continuationFixture.waitReason})}
        else if(turn===5)reply(continuationFixture.waitingFinal);
        else if(turn===6){
          const user=body.messages.filter(message=>message.role==='user').at(-1);assert.ok(JSON.stringify(user?.content).includes(continuationFixture.supplement),'显式补充必须作为真正用户输入进入同一原生会话');
          if(options.holdContinuation){emit({role:'assistant',content:continuationFixture.liveContinuation});await continuationGate}
          tool('continue-before-plan','cbim_goal_inspect',{});
        }else if(turn===7){
          const {scope}=goalInspection(body,'continue-before-plan') as unknown as {scope:DispatchScope};
          assert.deepEqual(scope.goal?.input,{message:continuationFixture.mainGoal,attachmentIds:[]});assert.equal(scope.goal?.inputRevision,2);assert.equal(scope.continuations?.length,1);const continuation=scope.continuations?.[0];assert.ok(continuation&&'input'in continuation);assert.equal(continuation.input.message,continuationFixture.supplement);
          tool('continue-stale-review','cbim_goal_review',goalCompleteArguments(body,'continue-before-plan'));
        }else if(turn===8){
          const result=body.messages.find(message=>message.role==='tool'&&message.tool_call_id==='continue-stale-review');assert.ok(result&&JSON.stringify(result.content).includes('GOAL_REPLAN_REQUIRED'),'补充后旧计划必须拒绝直接完成审阅');
          const {scope}=goalInspection(body,'continue-before-plan');
          tool('continue-replan','cbim_goal_plan',{...goalPlanArguments({objective:continuationFixture.mainGoal,agentId,moduleIds:[moduleId],acceptance:continuationFixture.acceptance},scope.goal.revision),constraints:['仅汇报已核实的文件事实','使用用户补充的简短列表格式'],reason:'根据已登记的用户补充重新核对计划；不授予人工验收'});
        }else if(turn===9)tool('continue-after-plan','cbim_goal_inspect',{});
        else if(turn===10){const review=goalCompleteArguments(body,'continue-after-plan');tool('continue-final-review','cbim_goal_review',options.waitAgain?{...review,decision:'awaiting_user',gaps:['还需要补充列表标题'],reason:'第二个明确补充请求'}:review)}
        else if(turn===11)reply(options.waitAgain?'补充已登记，还需要列表标题。':continuationFixture.final);
        else if(turn===12){assert.ok(JSON.stringify(body.messages.filter(message=>message.role==='user').at(-1)?.content).includes(continuationFixture.queuedGoal));reply(continuationFixture.queuedFinal)}
        else throw Error('显式补充不应重复执行模型：'+turn);
      }else{
        if(turn===0)tool('continue-member-plan','cbim_task_plan',{expectedVersion:0,goal:continuationFixture.memberGoal,reason:'执行已派发的文件核实',acceptance:continuationFixture.acceptance,steps:[{id:'verify',title:'核实真实文件',owner:'开发者'}]});
        else if(turn===1)tool('continue-member-read','read',{path:'continue-input.txt'});
        else if(turn===2){assert.ok(JSON.stringify(body.messages).includes(continuationFixture.fact));tool('continue-member-step','cbim_task_step',{expectedVersion:1,id:'verify',state:'reported_done',evidenceIds:['continue-member-read']})}
        else if(turn===3)tool('continue-member-delivery','cbim_delivery_prepare',{expectedVersion:2,summary:'核实文件内容为 '+continuationFixture.fact,limitations:['用户输出格式尚待补充']});
        else if(turn===4)reply('读取证据已提交，等待主 Agent 审阅。');
        else throw Error('格式补充不能重放已完成成员：'+turn);
      }
      res.end('data: [DONE]\n\n');
    }catch(error){errors.push(String(error));if(!res.headersSent)res.writeHead(500);res.end('Scope continuation fixture failed')}
  });
  await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));const address=server.address();assert.ok(address&&typeof address!=='string');
  return {url:`http://127.0.0.1:${address.port}/v1`,mainRequests,memberRequests,errors,bind:(agent:string,module:string)=>{agentId=agent;moduleId=module},releaseContinuation,close:async()=>{releaseContinuation();server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()))}};
}
