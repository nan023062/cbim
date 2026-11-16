import type {OwnerExecutionSelection} from '../src/logic/team/rules/member-execution-binding';
import assert from 'node:assert/strict';
import http from 'node:http';
import type {GoalFixtureRequest} from './goal-provider-fixture';
import {mainToolContractFixture as data,mainToolValue} from './main-tool-contract-provider';

export type MemberToolFault='help'|'checkpoint';
type Request=GoalFixtureRequest&{model:string;tools?:{function:{name:string}}[]};
export const memberQuestion='后续任务应采用哪一项补充要求？';
export const memberAnswer='保留当前事实，停止交付';
/** 模型响应固定，问答、文件读写、证据采集与父子关联均由真实运行执行。checkpoint 表示写后求助，不恢复旧的换轮检查点。 */
export async function memberToolContractProvider(mode:MemberToolFault){
 const main:Request[]=[],member:Request[]=[],errors:string[]=[],state:{fault?:unknown;baselineId?:string;call?:any}={};
 let owner:OwnerExecutionSelection|undefined,moduleId='';
 const server=http.createServer(async(req,res)=>{try{
  assert.equal(req.method,'POST');assert.ok(req.url?.endsWith('/chat/completions'));
  let raw='';for await(const chunk of req)raw+=chunk;
  const body=JSON.parse(raw)as Request;assert.equal(body.model,data.model);
  const isMain=body.tools?.some(t=>t.function.name==='cbim_agent_result_review')===true,list=isMain?main:member,turn=list.length;list.push(body);
  res.writeHead(200,{'Content-Type':'text/event-stream'});
  const emit=(delta:unknown,finish_reason:string|null=null)=>res.write('data: '+JSON.stringify({id:'member-contract-'+(main.length+member.length),object:'chat.completion.chunk',created:1,model:body.model,choices:[{index:0,delta,finish_reason}]})+'\n\n');
  const tool=(id:string,name:string,args:unknown)=>{assert.ok(body.tools?.some(t=>t.function.name===name),name);emit({role:'assistant',tool_calls:[{index:0,id,type:'function',function:{name,arguments:JSON.stringify(args)}}]});emit({},'tool_calls')};
  const reply=(content:string)=>{emit({role:'assistant',content});emit({},'stop')};
  assert.ok(!body.tools?.some(t=>['cbim_dispatch_task','cbim_task_help','cbim_task_checkpoint'].includes(t.function.name)));
  if(isMain){
   if(turn===0)tool('member-contract-call','cbim_agent_call',{agentId:owner!.memberId,message:data.memberGoal,business:{moduleIds:[moduleId],acceptance:data.acceptance}});
   else if(turn===1){const waiting=mainToolValue(body,'member-contract-call');assert.equal(waiting.status,'waiting');assert.equal(waiting.questions.questions[0].question,memberQuestion);tool('member-contract-reply','cbim_agent_reply',{callId:'member-contract-call',questionId:waiting.questionId,result:{answers:[{question:memberQuestion,answer:memberAnswer}]}})}
   else if(turn===2){state.call=mainToolValue(body,'member-contract-reply');assert.notEqual(state.call.verification?.state,'verified');reply('回答已记录，但成员回包失败；保留原记录，不重新调用或宣称交付完成。')}
   else throw Error('Unexpected main replay '+turn);
  }else{
   if(turn===0)tool('member-contract-plan','cbim_task_plan',{expectedVersion:0,goal:data.memberGoal,reason:'真实文件证据与原调用内求助',acceptance:data.acceptance,steps:[{id:'verify',title:'核实单个文件',owner:'开发者'}]});
   else if(mode==='checkpoint'&&turn===1)tool('member-contract-write','write',{path:data.file,content:data.fact});
   else if(turn===(mode==='checkpoint'?2:1))tool('member-contract-read','read',{path:data.file});
   else if(mode==='checkpoint'&&turn===3)tool('member-contract-inspect','cbim_task_inspect',{});
   else if(mode==='checkpoint'&&turn===4)tool('member-contract-capture','cbim_task_artifact_capture',{expectedTaskProgressVersion:mainToolValue(body,'member-contract-inspect').plan.version,sourceToolCallIds:['member-contract-write','member-contract-read']});
   else if(turn===(mode==='checkpoint'?5:2)){
    if(mode==='checkpoint'){const capture=mainToolValue(body,'member-contract-capture');assert.equal(capture.state,'captured',JSON.stringify(capture));state.baselineId=capture.baseline.baselineId}
    tool('member-contract-stage','cbim_ask_user_question',{questions:[{question:memberQuestion,options:[{label:memberAnswer},{label:'继续核实'}]}]});
   }else if(turn===(mode==='checkpoint'?6:3)){state.fault=mainToolValue(body,'member-contract-stage');assert.match(JSON.stringify(state.fault),/TOOL_OUTPUT_INVALID/);reply('原答案已经消费但回包无效；不重问、不重新写入、不提交交付。')}
   else throw Error('Unexpected member replay '+turn);
  }
  res.end('data: [DONE]\n\n');
 }catch(error){errors.push(String(error));if(!res.headersSent)res.writeHead(500);res.end('Member tool contract fixture failed')}});
 await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));const address=server.address();assert.ok(address&&typeof address!=='string');
 return {url:`http://127.0.0.1:${address.port}/v1`,main,member,errors,state,bind:(_agent:string,module:string,selection:OwnerExecutionSelection)=>{moduleId=module;owner=structuredClone(selection)},close:async()=>{server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()))}};
}
