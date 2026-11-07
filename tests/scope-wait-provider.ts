import type {OwnerExecutionSelection} from '../src/backend/core/team/member-execution-binding';
import assert from 'node:assert/strict';
import http from 'node:http';
import {goalInspection,goalPlanArguments,type GoalFixtureRequest} from './goal-provider-fixture';

export const waitFixture={
  mainGoal:'SCOPE_WAIT_MAIN: 核实模块文件，保留必要的人类确认后等待补充',
  memberGoal:'SCOPE_WAIT_MEMBER: 读取 wait-input.txt 并提交真实读取证据',
  acceptance:['实际读取 wait-input.txt 并提交工具回执'],
  fact:'SCOPE_WAIT_REAL_FILE_6c091f',
  humanId:'human-confirmation',
  humanCriterion:'需要用户确认下一阶段展示方案',
  waitReason:'需要用户补充展示方案；普通排队消息不能代替正式人工决定',
  final:'已有读取证据，仍需要补充展示方案；本次目标未完成。',
  liveFinal:'已请求补充，等待当前运行安全结束。',
};
type ProviderRequest=GoalFixtureRequest&{model:string;tools?:{function:{name:string}}[]};

/** Deterministic localhost model only; all tools, canonical records and Pi sessions remain real. */
export async function scopeWaitProvider(options:{missingReview?:boolean;holdFinal?:boolean}={}){
  const mainRequests:ProviderRequest[]=[],memberRequests:ProviderRequest[]=[],errors:string[]=[];
  let ownerSelection:OwnerExecutionSelection|undefined;let agentId='',moduleId='',releaseFinal=()=>{};
  const finalGate=new Promise<void>(resolve=>{releaseFinal=resolve});
  const server=http.createServer(async(req,res)=>{
    try{
      assert.equal(req.method,'POST');assert.ok(req.url?.endsWith('/chat/completions'));
      let raw='';for await(const chunk of req)raw+=chunk;
      const body=JSON.parse(raw) as ProviderRequest,isMain=body.tools?.some(tool=>tool.function.name==='cbim_dispatch_task')===true;
      const list=isMain?mainRequests:memberRequests,turn=list.length;list.push(body);
      res.writeHead(200,{'Content-Type':'text/event-stream'});
      const emit=(delta:unknown,finish_reason:string|null=null)=>res.write('data: '+JSON.stringify({id:'scope-wait-'+(mainRequests.length+memberRequests.length),object:'chat.completion.chunk',created:1,model:body.model,choices:[{index:0,delta,finish_reason}]})+'\n\n');
      const tool=(id:string,name:string,args:unknown)=>{emit({role:'assistant',tool_calls:[{index:0,id,type:'function',function:{name,arguments:JSON.stringify(args)}}]});emit({},'tool_calls')};
      const reply=(content:string)=>{emit({role:'assistant',content});emit({},'stop')};
      if(isMain){
        if(turn===0){
          const plan=goalPlanArguments({objective:waitFixture.mainGoal,agentId,ownerSelection,moduleIds:[moduleId],acceptance:waitFixture.acceptance});
          tool('wait-goal-plan','cbim_goal_plan',{...plan,criteria:[...plan.criteria,{id:waitFixture.humanId,text:waitFixture.humanCriterion,kind:'human'}],assignments:plan.assignments.map(item=>({...item,criterionIds:[...item.criterionIds,waitFixture.humanId]}))});
        }else if(turn===1)tool('wait-dispatch','cbim_dispatch_task',{agentId,ownerSelection,moduleIds:[moduleId],goal:waitFixture.memberGoal,acceptance:waitFixture.acceptance.map((text,index)=>({id:'criterion-'+index,text})),prerequisites:[]});
        else if(turn===2)reply('成员已派发，等待读取结果。');
        else if(options.missingReview){assert.equal(turn,3);reply('没有结构化审阅，但文字声称已完成。')}
        else if(turn===3)tool('wait-goal-inspect','cbim_goal_inspect',{});
        else if(turn===4){
          const {scope,graph}=goalInspection(body,'wait-goal-inspect'),task=graph.tasks.find(item=>item.scopeId===scope.scopeId)!;
          assert.ok(task?.result);assert.equal(task.status,'result_ready');assert.deepEqual(task.result.evidenceRefs,['wait-member-read']);
          const evidence={kind:'member-result',taskId:task.taskId,runId:task.result.runId,resultId:task.result.resultId,planRevision:task.result.planRevision,toolCallIds:task.result.evidenceRefs};
          tool('wait-goal-review','cbim_goal_review',{expectedRevision:scope.goal.revision,decision:'awaiting_user',checks:scope.goal.plan.criteria.map(item=>({criterionId:item.id,outcome:item.kind==='human'?'needs_human':'satisfied',reason:item.kind==='human'?waitFixture.waitReason:'已核实成员真实读取证据',evidence:item.kind==='human'?[]:[evidence]})),superseded:[],gaps:[waitFixture.waitReason],reason:waitFixture.waitReason});
        }else if(turn===5){if(options.holdFinal){emit({role:'assistant',content:waitFixture.liveFinal});await finalGate}reply(waitFixture.final)}
        else throw Error('等待状态不应启动额外主模型请求：'+turn);
      }else{
        if(turn===0)tool('wait-member-plan','cbim_task_plan',{expectedVersion:0,goal:waitFixture.memberGoal,reason:'执行已派发的文件核实',acceptance:waitFixture.acceptance,steps:[{id:'verify',title:'核实真实文件',owner:'开发者'}]});
        else if(turn===1)tool('wait-member-read','read',{path:'wait-input.txt'});
        else if(turn===2){assert.ok(JSON.stringify(body.messages).includes(waitFixture.fact));tool('wait-member-step','cbim_task_step',{expectedVersion:1,id:'verify',state:'reported_done',evidenceIds:['wait-member-read']})}
        else if(turn===3)tool('wait-member-delivery','cbim_delivery_prepare',{expectedVersion:2,summary:'核实文件内容为 '+waitFixture.fact,limitations:['用户展示方案尚待补充']});
        else if(turn===4)reply('读取证据已提交，等待主 Agent 审阅。');
        else throw Error('等待状态不应重跑成员：'+turn);
      }
      res.end('data: [DONE]\n\n');
    }catch(error){errors.push(String(error));if(!res.headersSent)res.writeHead(500);res.end('Scope wait fixture failed')}
  });
  await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));const address=server.address();assert.ok(address&&typeof address!=='string');
  return {url:`http://127.0.0.1:${address.port}/v1`,mainRequests,memberRequests,errors,bind:(agent:string,module:string,selection?:OwnerExecutionSelection)=>{agentId=agent;moduleId=module;ownerSelection=selection?structuredClone(selection):undefined},releaseFinal,close:async()=>{releaseFinal();server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()))}};
}
