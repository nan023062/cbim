import assert from 'node:assert/strict';
import http from 'node:http';
import {checkpointHandoffData as data} from './checkpoint-handoff-provider';
import {mainToolValue} from './main-tool-contract-provider';
import type {GoalFixtureRequest} from '../../../tasks/rules/support/goal-provider-fixture';
type Request=GoalFixtureRequest&{model:string;tools?:{function:{name:string}}[]};
export const handoffQuestion={questions:[{question:'原岗位已写入并采集文件，是否结束原调用并由当前负责人重新核实？',options:[{label:'交接给新岗位'},{label:'停止'}]}]};
/** 本地模型只提出工具调用；负责人切换、问答、实际写入与新模型读取均由真实应用执行。 */
export async function recursiveHandoffProvider(lostOutput=false,holdAfterReplacement=false){
 const main:Request[]=[],a:Request[]=[],b:Request[]=[],errors:string[]=[];
 const state:{waiting?:any;oldResult?:any;results:any[];checks?:any;replacementReady?:boolean}={results:[]};let moduleId='',releaseSuccessors!:()=>void;const successorGate=new Promise<void>(resolve=>releaseSuccessors=resolve);if(!holdAfterReplacement)releaseSuccessors();
 const goal=(index:number)=>data.newGoals[index]+(holdAfterReplacement&&index>0?'\\n本次前置调用依据：'+JSON.stringify(state.results[index-1].verification??state.results[index-1]):'');
 const server=http.createServer(async(req,res)=>{try{
  let raw='';for await(const chunk of req)raw+=chunk;const body=JSON.parse(raw) as Request;
  const role=req.url==='/main/v1/chat/completions'?'main':req.url==='/a/v1/chat/completions'?'a':req.url==='/b/v1/chat/completions'?'b':undefined;
  assert.ok(role);assert.equal(body.model,data.models[role]);const list=role==='main'?main:role==='a'?a:b,turn=list.length;list.push(body);
  res.writeHead(200,{'Content-Type':'text/event-stream'});
  const emit=(delta:unknown,finish_reason:string|null=null)=>res.write('data: '+JSON.stringify({id:'recursive-handoff-'+(main.length+a.length+b.length),object:'chat.completion.chunk',created:1,model:body.model,choices:[{index:0,delta,finish_reason}]})+'\n\n');
  const tool=(id:string,name:string,args:unknown)=>{assert.ok(body.tools?.some(t=>t.function.name===name));emit({role:'assistant',tool_calls:[{index:0,id,type:'function',function:{name,arguments:JSON.stringify(args)}}]});emit({},'tool_calls')};
  const reply=(content:string)=>{emit({role:'assistant',content});emit({},'stop')};
  const owner=(id:string)=>mainToolValue(body,id).execution.groups[0].selection.memberId;
  const call=(index:number)=>tool('handoff-new-'+index,'cbim_agent_call',{agentId:owner('handoff-owner-b'),message:goal(index),business:{moduleIds:[moduleId],acceptance:data.acceptance}});
  if(role==='main'){
   assert.ok(body.tools?.every(t=>!t.function.name.startsWith('cbim_dispatch_')&&!t.function.name.startsWith('cbim_goal_')));
   if(turn===0)tool('handoff-owner-a','cbim_module_owner_inspect',{moduleIds:[moduleId]});
   else if(turn===1)tool('handoff-old-call','cbim_agent_call',{agentId:owner('handoff-owner-a'),message:data.oldGoals[0],business:{moduleIds:[moduleId],acceptance:data.acceptance}});
   else if(turn===2){state.waiting=mainToolValue(body,'handoff-old-call');assert.equal(state.waiting.status,'waiting');tool('handoff-question','cbim_ask_user_question',state.waiting.questions)}
   else if(turn===3)tool('handoff-old-answer','cbim_agent_reply',{callId:'handoff-old-call',questionId:state.waiting.questionId,result:mainToolValue(body,'handoff-question')});
   else if(turn===4){state.oldResult=mainToolValue(body,'handoff-old-answer');assert.ok(state.oldResult.error);tool('handoff-owner-b','cbim_module_owner_inspect',{moduleIds:[moduleId]})}
   else if(turn===5){assert.notEqual(owner('handoff-owner-a'),owner('handoff-owner-b'));call(0)}
   else if(turn===6&&lostOutput){assert.ok(JSON.stringify(mainToolValue(body,'handoff-new-0')).includes('HANDOFF_REPLY_LOST'));tool('handoff-original-check','cbim_agent_result_check',{callId:'handoff-new-0'})}
   else if(turn===(lostOutput?7:6)){const proof=mainToolValue(body,lostOutput?'handoff-original-check':'handoff-new-0');if(lostOutput){assert.equal(proof.state,'verified');state.checks=proof}else assert.equal(proof.verification.state,'verified');state.results.push(proof);if(holdAfterReplacement){state.replacementReady=true;emit({role:'assistant',content:'新岗位第一项已验证，尚未启动后继。'});await successorGate}call(1)}
   else if(turn===(lostOutput?8:7)){const result=mainToolValue(body,'handoff-new-1');assert.equal(result.verification.state,'verified');state.results.push(result);call(2)}
   else if(turn===(lostOutput?9:8)){const result=mainToolValue(body,'handoff-new-2');assert.equal(result.verification.state,'verified');state.results.push(result);reply('新岗位已分别读取三份实际文件；旧调用的写入、暂停和未交付事实保留。')}
   else throw Error('Unexpected main replay '+turn);
  }else if(role==='a'){
   assert.ok(JSON.stringify(body.messages).includes(data.adaptations[0]));
   if(turn===0)tool('handoff-a-plan','cbim_task_plan',{expectedVersion:0,goal:data.oldGoals[0],acceptance:data.acceptance,reason:'原岗位只完成自己的文件阶段',steps:[{id:'read',title:'写入与读取实际材料',owner:'原岗位'}]});
   else if(turn===1)tool('handoff-a-write','write',{path:data.files[0],content:data.facts[0]});
   else if(turn===2)tool('handoff-a-read','read',{path:data.files[0]});
   else if(turn===3)tool('handoff-a-capture','cbim_task_artifact_capture',{expectedTaskProgressVersion:2,sourceToolCallIds:['handoff-a-write','handoff-a-read']});
   else if(turn===4){assert.equal(mainToolValue(body,'handoff-a-capture').state,'captured');tool('handoff-a-ask','cbim_ask_user_question',handoffQuestion)}
   else if(turn===5){assert.equal(mainToolValue(body,'handoff-a-ask').answers[0].answer,'交接给新岗位');reply('原调用到此结束，没有为新岗位提交交付。')}
   else throw Error('Old owner replay '+turn);
  }else{
   const index=Math.floor(turn/5),step=turn%5,id='handoff-b-'+index;assert.ok(index<3);assert.ok(JSON.stringify(body.messages).includes(data.adaptations[1]));
   if(step===0)tool(id+'-plan','cbim_task_plan',{expectedVersion:0,goal:goal(index),acceptance:data.acceptance,reason:'新岗位独立读取，不继承旧交付',steps:[{id:'read',title:'读取实际文件',owner:'新岗位'}]});
   else if(step===1)tool(id+'-read','read',{path:data.files[index]});
   else if(step===2){assert.ok(JSON.stringify(body.messages).includes(data.facts[index]));tool(id+'-step','cbim_task_step',{expectedVersion:1,id:'read',state:'reported_done',evidenceIds:[id+'-read']})}
   else if(step===3)tool(id+'-delivery','cbim_delivery_prepare',{expectedVersion:2,summary:'新岗位实际核实 '+data.facts[index],limitations:['不等于人工验收']});
   else reply('本次新调用交付已提交。');
  }
  res.end('data: [DONE]\n\n');
 }catch(error){errors.push(String(error));if(!res.headersSent)res.writeHead(500);res.end('Recursive handoff fixture failed')}});
 await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));const address=server.address();assert.ok(address&&typeof address!=='string');const base='http://127.0.0.1:'+address.port;
 return {urls:{main:base+'/main/v1',a:base+'/a/v1',b:base+'/b/v1'},main,a,b,errors,state,bind:(module:string)=>{moduleId=module},releaseSuccessors,close:async()=>{releaseSuccessors();server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()))}};
}
