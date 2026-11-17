import type {OwnerExecutionSelection} from '../../../../team/rules/member-execution-binding';
import assert from 'node:assert/strict';
import http from 'node:http';
import {type GoalFixtureRequest} from '../../../../tasks/rules/unittest/support/goal-provider-fixture';

export type MainToolContractMode='complete'|'stop'|'lost-registration'|'lost-parent-link'|'lost-result'|'before-call';
export const mainToolContractFixture={goal:'MAIN_TOOL_CONTRACT: 独立成员读取真实文件，按真实候选审阅当前目标',memberGoal:'MAIN_TOOL_CONTRACT_MEMBER: 读取 main-tool-contract.txt 并提交真实读取回执',model:'main-tool-contract-fixture',file:'main-tool-contract.txt',fact:'MAIN_TOOL_CONTRACT_REAL_FILE_3a572',acceptance:['实际读取 main-tool-contract.txt 并提交读取回执'],draft:'原对话草稿保持，不随调度工具读取或停止自动发送。'};
type Request=GoalFixtureRequest&{model:string;tools?:{function:{name:string}}[]};

export function mainToolValue(request:Request,callId:string):any{
  const message=request.messages.find(item=>item.role==='tool'&&item.tool_call_id===callId);assert.ok(message,'Missing actual tool response '+callId);const text=typeof message.content==='string'?message.content:Array.isArray(message.content)?message.content.map(item=>item&&typeof item==='object'&&'text'in item?String(item.text):'').join(''):'';
  const parse=(value:string)=>{try{return JSON.parse(value)}catch{return {error:value}}};let result=parse(text);if(Array.isArray(result.content))result=parse(result.content.filter((item:{type:string})=>item.type==='text').map((item:{text:string})=>item.text).join(''));return result;
}

/** 固定模型响应；真实登记、父子关联、业务执行与结果复核由产品完成。 */
export async function mainToolContractProvider(mode:MainToolContractMode='complete',reconcileFailures=false){
 const main:Request[]=[],member:Request[]=[],other:Request[]=[],errors:string[]=[],state:{receipt?:any;check?:any;fault?:any;faultConfirmed?:boolean}={};
 let owner:OwnerExecutionSelection|undefined,moduleId='',release=()=>{};const gate=new Promise<void>(resolve=>{release=resolve});
 const server=http.createServer(async(req,res)=>{try{
  assert.equal(req.method,'POST');assert.ok(req.url?.endsWith('/chat/completions'));let raw='';for await(const chunk of req)raw+=chunk;
  const body=JSON.parse(raw)as Request,isMain=body.tools?.some(t=>t.function.name==='cbim_agent_result_review')===true,auxiliary=JSON.stringify(body.messages).includes('ORIGINAL_OTHER_ROOT'),list=auxiliary?other:isMain?main:member,turn=list.length;list.push(body);
  assert.equal(body.model,mainToolContractFixture.model);const d=mainToolContractFixture;
  res.writeHead(200,{'Content-Type':'text/event-stream'});
  const emit=(delta:unknown,finish_reason:string|null=null)=>res.write('data: '+JSON.stringify({id:'main-contract-'+(main.length+member.length),object:'chat.completion.chunk',created:1,model:body.model,choices:[{index:0,delta,finish_reason}]})+'\n\n');
  const tool=(id:string,name:string,args:unknown)=>{assert.ok(body.tools?.some(t=>t.function.name===name),name);emit({role:'assistant',tool_calls:[{index:0,id,type:'function',function:{name,arguments:JSON.stringify(args)}}]});emit({},'tool_calls')};
  const reply=(content:string)=>{emit({role:'assistant',content});emit({},'stop')};
  assert.ok(!body.tools?.some(t=>t.function.name.startsWith('cbim_dispatch_')||t.function.name.startsWith('cbim_goal_')));
  if(auxiliary){if(turn===0)tool('foreign-check','cbim_agent_result_check',{callId:'contract-call'});else{assert.equal(mainToolValue(body,'foreign-check').error.code,'AGENT_RESULT_UNAVAILABLE');reply('No result from another caller is available.')}}
  else if(isMain){
   if(turn===0)tool('contract-call','cbim_agent_call',{agentId:owner!.memberId,message:d.memberGoal,business:{moduleIds:[moduleId],acceptance:d.acceptance}});
   else if(turn===1){
    state.receipt=mainToolValue(body,'contract-call');
    if(reconcileFailures){tool('contract-check','cbim_agent_result_check',{callId:'contract-call'})}
    else if(mode.startsWith('lost-')){state.fault=state.receipt;assert.equal(state.fault.error?.code,'AGENT_CALL_FAILED',JSON.stringify(state.fault));assert.equal(state.fault.error.started,true);state.faultConfirmed=true;reply('原启动登记或调用关联可能已保存；没有重试，不宣称子任务已经执行。')}
    else{assert.equal(state.receipt.status,'completed');assert.equal(state.receipt.verification.state,'verified');tool('contract-check','cbim_agent_result_check',{callId:'contract-call'})}
   }else if(turn===2){state.check=mainToolValue(body,'contract-check');if(reconcileFailures&&mode!=='lost-result')assert.equal(state.check.error.code,'AGENT_RESULT_UNAVAILABLE');else assert.equal(state.check.state,'verified');reply('原调用返回真实读取证据并已复核；不代表人工业务验收。')}
   else throw Error('Unexpected main replay '+turn);
  }else{
   if(turn===0){emit({role:'assistant',content:'原子运行已启动，等待本机验证闸门。'});await gate;tool('contract-member-plan','cbim_task_plan',{expectedVersion:0,goal:d.memberGoal,reason:'读取实际文件并保留真实证据',acceptance:d.acceptance,steps:[{id:'verify',title:'读取真实文件',owner:'开发者'}]})}
   else if(turn===1)tool('contract-member-read','read',{path:d.file});
   else if(turn===2){assert.ok(JSON.stringify(body.messages).includes(d.fact));tool('contract-member-step','cbim_task_step',{expectedVersion:1,id:'verify',state:'reported_done',evidenceIds:['contract-member-read']})}
   else if(turn===3)tool('contract-member-delivery','cbim_delivery_prepare',{expectedVersion:2,summary:'实际读取 '+d.fact,limitations:['读取回执不代表人工业务验收']});
   else if(turn===4)reply('已提交真实读取候选。');
   else throw Error('Unexpected member replay '+turn);
  }
  res.end('data: [DONE]\n\n');
 }catch(error){errors.push(String(error));if(!res.headersSent)res.writeHead(500);res.end('Main tool contract fixture failed')}});
 await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));const address=server.address();assert.ok(address&&typeof address!=='string');
 return {url:`http://127.0.0.1:${address.port}/v1`,main,member,other,errors,state,bind:(_agent:string,module:string,selection:OwnerExecutionSelection)=>{moduleId=module;owner=structuredClone(selection)},release:()=>release(),close:async()=>{release();server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()))}};
}
