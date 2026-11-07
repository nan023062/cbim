import type {OwnerExecutionSelection} from '../src/backend/core/team/member-execution-binding';
import assert from 'node:assert/strict';
import http from 'node:http';
import {goalInspection,goalPlanArguments,type GoalFixtureRequest} from './goal-provider-fixture';
import {memberHelpResultSchema} from '../src/backend/core/tasks/member-help';

export const memberHelpFixture={
  mainGoal:'MEMBER_HELP_MAIN: 根据已有记录核实模块事实；遇到输入缺口先求助，再由主调度决定补做或等待',
  memberGoal:'MEMBER_HELP_FIRST: 读取 help-source.txt，说明验证材料缺口，不伪造交付',
  replacementGoal:'MEMBER_HELP_REPLACEMENT: 重新读取 help-source.txt 和 help-supplement.txt，补齐验证证据',
  acceptance:['真实读取模块记录与补充验证材料并提交可追溯工具证据'],
  source:'help-source.txt',sourceText:'HELP_SOURCE_38a2: 当前记录尚需补充材料验证。',
  supplement:'help-supplement.txt',supplementText:'HELP_SUPPLEMENT_9b41: 补充材料已具备，事实一致。',
  marker:'help-original-effect.txt',markerText:'HELP_EFFECT_ONCE_48a9\n',
  reason:'已读取现有记录，但当前任务未说明补充验证材料；仅凭现有记录不能提交完成候选。',
  question:'请主调度明确补充材料并派发独立补做任务，或等待用户提供资料。',
  stagedLive:'已登记结构化求助，尚未结束执行；此时还不能交接给主调度。',
  handoff:'成员求助已安全交接，主调度将重新规划新的补做任务。',
  waitReason:'成员已经报告输入缺口，需要用户提供验证资料；当前目标尚未完成。',
  final:'新成员已补齐读取证据；原求助节点保留，替代关系已登记，目标完成不等于人工验收。',
  draft:'保留普通对话草稿；不要把草稿当作成员求助的授权。',
};
type Request=GoalFixtureRequest&{model:string;tools?:{function:{name:string}}[]};
function toolValue(body:Request,id:string){const message=body.messages.find(item=>item.role==='tool'&&item.tool_call_id===id);assert.ok(message);assert.equal(typeof message.content,'string');return JSON.parse(message.content as string)}

/** Deterministic local model; actual Pi, native reads, help staging, handoff and leases stay real. */
export async function memberHelpProvider(options:{waiting?:boolean;holdHelp?:boolean;effectful?:boolean;unknownHelp?:boolean}={}){
  const mainRequests:Request[]=[],memberRequests:Request[]=[],errors:string[]=[];
  let agentId='',moduleId='',releaseHelp=()=>{};
  const helpGate=new Promise<void>(resolve=>{releaseHelp=resolve}),d=memberHelpFixture;
  let ownerSelection:OwnerExecutionSelection|undefined;
  const server=http.createServer(async(req,res)=>{try{
    assert.equal(req.method,'POST');assert.ok(req.url?.endsWith('/chat/completions'));let raw='';for await(const chunk of req)raw+=chunk;
    const body=JSON.parse(raw) as Request,isMain=body.tools?.some(tool=>tool.function.name==='cbim_dispatch_task')===true,list=isMain?mainRequests:memberRequests,turn=list.length;list.push(body);
    res.writeHead(200,{'Content-Type':'text/event-stream'});
    const emit=(delta:unknown,finish_reason:string|null=null)=>res.write('data: '+JSON.stringify({id:'member-help-'+(mainRequests.length+memberRequests.length),object:'chat.completion.chunk',created:1,model:body.model,choices:[{index:0,delta,finish_reason}]})+'\n\n');
    const tool=(id:string,name:string,args:unknown)=>{emit({role:'assistant',tool_calls:[{index:0,id,type:'function',function:{name,arguments:JSON.stringify(args)}}]});emit({},'tool_calls')};
    const reply=(content:string)=>{emit({role:'assistant',content});emit({},'stop')};
    const dispatch=(id:string,goal:string)=>tool(id,'cbim_dispatch_task',{agentId,moduleIds:[moduleId],ownerSelection,goal,acceptance:d.acceptance.map((text,index)=>({id:'criterion-'+index,text})),prerequisites:[]});
    if(isMain){
      assert.ok(body.tools?.every(item=>!['write','edit','bash','cbim_task_help'].includes(item.function.name)),'主调度不执行成员工具');
      if(turn===0)tool('help-goal-plan','cbim_goal_plan',goalPlanArguments({objective:d.mainGoal,agentId,moduleIds:[moduleId],ownerSelection,acceptance:d.acceptance}));
      else if(turn===1)dispatch('help-dispatch',d.memberGoal);
      else if(turn===2)reply('独立成员已派发，等待真实执行结果。');
      else if(turn===3){if(!options.unknownHelp)assert.ok(JSON.stringify(body.messages).includes(d.reason),'主续跑必须包含真实求助而非普通失败猜测');tool('help-goal-inspect','cbim_goal_inspect',{})}
      else if(turn===4){
        const {scope,graph}=goalInspection(body,'help-goal-inspect'),first=graph.tasks.find(task=>task.scopeId===scope.scopeId)!;
        assert.equal(first.result,undefined);assert.equal(first.activeRunId,undefined);
        if(options.unknownHelp){assert.ok(['interrupted','failed','blocked'].includes(first.status));assert.equal(first.help,undefined);assert.ok(first.waitReason);tool('help-invalid-review','cbim_goal_review',{expectedRevision:scope.goal.revision,decision:'blocked',checks:scope.goal.plan.criteria.map(criterion=>({criterionId:criterion.id,outcome:'unmet',reason:'成员日志无法核实，不把暂存请求当成求助交接',evidence:[]})),superseded:[],gaps:['必须先核实不完整成员记录，不可复用旧执行'],reason:'当前执行事实未知，停止自动补做，不重放旧操作'})}
        else if(options.waiting){assert.equal(first.help?.input.reason,d.reason);tool('help-wait-review','cbim_goal_review',{expectedRevision:scope.goal.revision,decision:'awaiting_user',checks:scope.goal.plan.criteria.map(criterion=>({criterionId:criterion.id,outcome:'unmet',reason:d.waitReason,evidence:[]})),superseded:[],gaps:[d.waitReason],reason:d.waitReason})}
        else tool('help-replan','cbim_goal_plan',{...goalPlanArguments({objective:d.mainGoal,agentId,moduleIds:[moduleId],ownerSelection,acceptance:d.acceptance},scope.goal.revision),reason:'原成员安全求助后，以新任务和独立实例补齐验证材料；保留原节点事实'});
      }else if(turn===5){if(options.unknownHelp)reply('成员记录不完整，已保留失败事实；没有消费求助或重放成员操作。');else if(options.waiting)reply(d.waitReason);else dispatch('help-replacement',d.replacementGoal)}
      else if(turn===6&&!options.waiting)reply(d.handoff);
      else if(turn===7&&!options.waiting)tool('help-final-inspect','cbim_goal_inspect',{});
      else if(turn===8&&!options.waiting){
        const {scope,graph}=goalInspection(body,'help-final-inspect'),tasks=graph.tasks.filter(task=>task.scopeId===scope.scopeId),original=tasks.find(task=>task.help)!,replacement=tasks.find(task=>task.result)!;
        assert.equal(tasks.length,2);assert.equal(original.status,'blocked');assert.equal(original.result,undefined);assert.equal(replacement.status,'result_ready');assert.notEqual(original.assignee.agentInstanceId,replacement.assignee.agentInstanceId);
        const result=replacement.result!,evidence={kind:'member-result',taskId:replacement.taskId,runId:result.runId,resultId:result.resultId,planRevision:result.planRevision,toolCallIds:result.evidenceRefs};
        tool('help-complete','cbim_goal_review',{expectedRevision:scope.goal.revision,decision:'complete',checks:scope.goal.plan.criteria.map(criterion=>({criterionId:criterion.id,outcome:'satisfied',reason:'新成员独立读取两份材料并提交真实回执',evidence:[evidence]})),superseded:[{taskId:original.taskId,replacementTaskIds:[replacement.taskId],reason:'原成员只报告材料缺口，新任务已补齐并提交候选'}],gaps:[],reason:'核对新任务证据及原求助替代关系，保留全部历史'});
      }else if(turn===9&&!options.waiting)reply(d.final);
      else throw Error('求助或重启不应产生额外主请求：'+turn);
    }else{
      assert.ok(body.tools?.some(item=>item.function.name==='cbim_task_help'),'正式执行者必须获得求助工具');
      assert.ok(body.tools?.every(item=>item.function.name!=='cbim_dispatch_task'),'执行成员不能自行派发任务');
      if(turn===0)tool('help-task-plan','cbim_task_plan',{expectedVersion:0,goal:d.memberGoal,reason:'核实现有材料，不伪造缺失事实',acceptance:d.acceptance,steps:[{id:'verify',title:'读取材料并核实缺口',owner:'开发者'}]});
      else if(turn===1){
        if(options.effectful){emit({role:'assistant',tool_calls:[{index:0,id:'help-original-effect',type:'function',function:{name:'bash',arguments:JSON.stringify({command:`node -e "require('node:fs').appendFileSync('${d.marker}','HELP_EFFECT_ONCE_48a9\\n')"`})}},{index:1,id:'help-read-source',type:'function',function:{name:'read',arguments:JSON.stringify({path:d.source})}}]});emit({},'tool_calls')}
        else tool('help-read-source','read',{path:d.source});
      }
      else if(turn===2){assert.ok(JSON.stringify(body.messages).includes(d.sourceText));tool('help-request','cbim_task_help',{kind:'missing_input',reason:d.reason,question:d.question,attemptedToolCallIds:options.effectful?['help-original-effect','help-read-source']:['help-read-source']})}
      else if(turn===3){memberHelpResultSchema.parse(toolValue(body,'help-request'));if(options.holdHelp){emit({role:'assistant',content:d.stagedLive});await helpGate}reply('执行结束，保留输入缺口，等待主调度决定后续任务。')}
      else if(turn===4)tool('replacement-plan','cbim_task_plan',{expectedVersion:0,goal:d.replacementGoal,reason:'新任务明确补充材料，独立核实原记录与补充内容',acceptance:d.acceptance,steps:[{id:'verify',title:'读取两份材料并提交证据',owner:'开发者'}]});
      else if(turn===5)tool('replacement-source','read',{path:d.source});
      else if(turn===6)tool('replacement-supplement','read',{path:d.supplement});
      else if(turn===7){assert.ok(JSON.stringify(body.messages).includes(d.supplementText));tool('replacement-step','cbim_task_step',{expectedVersion:1,id:'verify',state:'reported_done',evidenceIds:['replacement-source','replacement-supplement']})}
      else if(turn===8)tool('replacement-delivery','cbim_delivery_prepare',{expectedVersion:2,summary:'已独立核实原记录与补充材料：'+d.supplementText,limitations:['只证明读取证据，不代替人工业务验收']});
      else if(turn===9)reply('新的补做任务已提交候选，请主调度审阅。');
      else throw Error('求助不应复活旧执行实例：'+turn);
    }
    res.end('data: [DONE]\n\n');
  }catch(error){errors.push(String(error));if(!res.headersSent)res.writeHead(500);res.end('Member help fixture failed')}});
  await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));const address=server.address();assert.ok(address&&typeof address!=='string');
  return {url:`http://127.0.0.1:${address.port}/v1`,mainRequests,memberRequests,errors,releaseHelp,bind:(agent:string,module:string,selection:OwnerExecutionSelection)=>{agentId=agent;moduleId=module;ownerSelection=structuredClone(selection)},close:async()=>{releaseHelp();server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()))}};
}
