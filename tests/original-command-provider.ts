import assert from 'node:assert/strict';
import http from 'node:http';
import type {OwnerExecutionSelection} from '../src/backend/core/team/member-execution-binding';
import {commandVerificationReportSchema,type CommandVerificationReport} from '../src/backend/core/tasks/command-verification';
import {goalCompleteArguments,goalPlanArguments,type GoalFixtureRequest} from './goal-provider-fixture';
import {mainToolValue} from './main-tool-contract-provider';

export type OriginalCommandMode='bad-plan'|'bad-dispatch'|'absent-plan';
export const originalCommandData={goal:'ORIGINAL_COMMAND_MAIN: 核实原调度命令后，用真实独立成员证据完成目标',otherGoal:'ORIGINAL_COMMAND_OTHER_ROOT: 仅回答此独立会话，不执行任务',memberGoal:'ORIGINAL_COMMAND_MEMBER: 读取 original-command.txt 并提交本轮真实读取候选',model:'original-command-fixture',file:'original-command.txt',fact:'ORIGINAL_COMMAND_ACTUAL_FILE_71b2',acceptance:['独立成员实际读取指定文件，提交本轮可追溯读取证据'],draft:'普通草稿：原命令查询不能自动发送、清除或恢复执行。'};
export type OriginalCommandRequest=GoalFixtureRequest&{model:string;tools?:{function:{name:string}}[]};
export type OriginalCommandState={runId?:string;scopeId?:string;fault?:unknown;lastReport?:CommandVerificationReport;report?:CommandVerificationReport;historyReport?:CommandVerificationReport;readonlyReport?:CommandVerificationReport;taskId?:string;absentReady?:boolean};

function text(request:OriginalCommandRequest){return JSON.stringify(request.messages)}
export function originalCommandReport(request:OriginalCommandRequest,callId:string){return commandVerificationReportSchema.parse(mainToolValue(request,callId))}
export const originalFaultCall=(mode:OriginalCommandMode)=>mode==='bad-dispatch'?'original-dispatch':'original-plan';

/** 本机确定性响应只提出真实工具调用；runId 来自本轮真实 inspect，不编造命令、结果或事务身份。 */
export async function originalCommandProvider(mode:OriginalCommandMode){
  const main:OriginalCommandRequest[]=[],member:OriginalCommandRequest[]=[],other:OriginalCommandRequest[]=[],errors:string[]=[],state:OriginalCommandState={};
  let agentId='',moduleId='',selection:OwnerExecutionSelection|undefined,release=()=>{};const held=new Promise<void>(resolve=>{release=resolve});
  const server=http.createServer(async(req,res)=>{try{
    assert.equal(req.method,'POST');assert.ok(req.url?.endsWith('/chat/completions'));let raw='';for await(const chunk of req)raw+=chunk;const body=JSON.parse(raw)as OriginalCommandRequest;assert.equal(body.model,originalCommandData.model);
    const auxiliary=text(body).includes(originalCommandData.otherGoal),isMain=body.tools?.some(item=>item.function.name==='cbim_dispatch_task')===true,list=auxiliary?other:isMain?main:member,turn=list.length;list.push(body);
    res.writeHead(200,{'Content-Type':'text/event-stream'});const emit=(delta:unknown,finish_reason:string|null=null)=>res.write('data: '+JSON.stringify({id:'original-command-'+(main.length+member.length+other.length),object:'chat.completion.chunk',created:1,model:body.model,choices:[{index:0,delta,finish_reason}]})+'\n\n');
    const tool=(id:string,name:string,args:unknown)=>{emit({role:'assistant',tool_calls:[{index:0,id,type:'function',function:{name,arguments:JSON.stringify(args)}}]});emit({},'tool_calls')},reply=(content:string)=>{emit({role:'assistant',content});emit({},'stop')};
    const d=originalCommandData;
    const report=(id:string,target=originalFaultCall(mode))=>{assert.ok(state.runId);tool(id,'cbim_dispatch_command_report',{runId:state.runId,toolCallId:target})};
    const dispatch=()=>{assert.ok(selection);tool('original-dispatch','cbim_dispatch_task',{agentId,moduleIds:[moduleId],ownerSelection:selection,goal:d.memberGoal,acceptance:d.acceptance.map((value,index)=>({id:'criterion-'+index,text:value}))})};
    const checked=(id:string,expected:'committed'|'absent')=>{const value=originalCommandReport(body,id);state.lastReport=value;assert.equal(value.command.state,expected,JSON.stringify(value));assert.equal(value.source.state,'verified');assert.equal(value.source.outcome,'failed');assert.equal(value.identity.runId,state.runId);assert.equal(value.identity.toolCallId,originalFaultCall(mode));assert.equal(value.readOnly,true);assert.equal(value.acceptance,'not_evaluated');assert.equal(value.consistency,'stable');return value};
    if(auxiliary){assert.equal(turn,0);reply('独立主会话，仅回答，不执行原会话的命令。')}
    else if(isMain){
      assert.ok(selection);assert.ok(body.tools?.some(item=>item.function.name==='cbim_dispatch_command_report'));assert.ok(body.tools?.every(item=>!['write','edit','bash'].includes(item.function.name)));
      if(turn===0)tool('original-initial-inspect','cbim_goal_inspect',{});
      else if(turn===1){const initial=mainToolValue(body,'original-initial-inspect');assert.equal(initial.scope.runTracking.mainRunIds.length,1);state.runId=initial.scope.runTracking.mainRunIds[0];state.scopeId=initial.scope.scopeId;tool('original-plan','cbim_goal_plan',goalPlanArguments({objective:d.goal,agentId,moduleIds:[moduleId],ownerSelection:selection,acceptance:d.acceptance}))}
      else if(mode==='absent-plan'){
        if(turn===2){state.fault=mainToolValue(body,'original-plan');assert.match(JSON.stringify(state.fault),/TEST_BEFORE_COMMIT/);report('original-report')}
        else if(turn===3){state.report=checked('original-report','absent');report('original-readonly-report','original-initial-inspect')}
        else if(turn===4){state.readonlyReport=originalCommandReport(body,'original-readonly-report');assert.equal(state.readonlyReport.command.state,'not_applicable');if(state.readonlyReport.command.state==='not_applicable')assert.equal(state.readonlyReport.command.reason,'readonly_tool');state.absentReady=true;emit({role:'assistant',content:'原键查无提交记录，仍不能推断从未执行；保留原失败，不自动重试。'});await held;reply('原调用保持未知，等待用户明确处置。')}
        else throw Error('Absent command must not be retried: '+turn);
      }else if(turn===2){if(mode==='bad-plan'){state.fault=mainToolValue(body,'original-plan');assert.match(JSON.stringify(state.fault),/TOOL_OUTPUT_INVALID/);report('original-report')}else{assert.equal(mainToolValue(body,'original-plan').goal.revision,2);dispatch()}}
      else if(turn===3){if(mode==='bad-plan'){state.report=checked('original-report','committed');assert.equal(state.report.command.state==='committed'&&state.report.command.result.toolName,'cbim_goal_plan');dispatch()}else{state.fault=mainToolValue(body,'original-dispatch');assert.match(JSON.stringify(state.fault),/TOOL_OUTPUT_INVALID/);report('original-report')}}
      else if(turn===4){if(mode==='bad-dispatch'){state.report=checked('original-report','committed');assert.ok(state.report.command.state==='committed'&&state.report.command.result.toolName==='cbim_dispatch_task');state.taskId=state.report.command.result.taskId}else state.taskId=mainToolValue(body,'original-dispatch').taskId;tool('original-graph','cbim_dispatch_inspect',{})}
      else if(turn===5){const graph=mainToolValue(body,'original-graph');assert.equal(graph.tasks.length,1);assert.equal(graph.tasks[0].taskId,state.taskId);assert.deepEqual(graph.tasks[0].runIds,[]);reply('已核实原命令保存事实；保留原工具失败，只等待唯一真实任务执行。')}
      else if(turn===6)report('original-history-report');
      else if(turn===7){state.historyReport=checked('original-history-report','committed');assert.deepEqual(state.historyReport.command,state.report?.command);tool('original-final-inspect','cbim_goal_inspect',{})}
      else if(turn===8)tool('original-review','cbim_goal_review',goalCompleteArguments(body,'original-final-inspect'));
      else if(turn===9){assert.equal(mainToolValue(body,'original-review').goal.review.decision,'complete');reply('按新运行的真实成员读取候选审阅完成，原命令核实不是业务完成证据。')}
      else throw Error('Unexpected main command replay '+turn);
    }else{
      assert.ok(body.tools?.every(item=>!item.function.name.startsWith('cbim_dispatch_')&&!item.function.name.startsWith('cbim_goal_')));
      if(turn===0)tool('original-member-plan','cbim_task_plan',{expectedVersion:0,goal:d.memberGoal,reason:'核实真实文件并独立提交证据',acceptance:d.acceptance,steps:[{id:'verify',title:'读取原文件',owner:'开发者'}]});
      else if(turn===1)tool('original-member-read','read',{path:d.file});
      else if(turn===2){assert.ok(text(body).includes(d.fact));tool('original-member-step','cbim_task_step',{expectedVersion:1,id:'verify',state:'reported_done',evidenceIds:['original-member-read']})}
      else if(turn===3)tool('original-member-delivery','cbim_delivery_prepare',{expectedVersion:2,summary:'实际读取 '+d.fact,limitations:['原命令查询不替代业务证据或人工验收']});
      else if(turn===4)reply('本成员已提交本轮真实读取候选。');
      else throw Error('Unexpected member replay '+turn);
    }
    res.end('data: [DONE]\n\n');
  }catch(error){errors.push(String(error));if(!res.headersSent)res.writeHead(500);res.end('Original command fixture failed')}});
  await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));const address=server.address();assert.ok(address&&typeof address!=='string');
  return {url:`http://127.0.0.1:${address.port}/v1`,main,member,other,errors,state,bind:(agent:string,module:string,owner:OwnerExecutionSelection)=>{agentId=agent;moduleId=module;selection=structuredClone(owner)},release:()=>release(),close:async()=>{release();server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()))}};
}
