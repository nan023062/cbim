import assert from 'node:assert/strict';
import http from 'node:http';
import type {OwnerExecutionSelection} from '../../../../team/rules/member-execution-binding';
import type {GoalFixtureRequest} from '../../../../tasks/rules/unittest/support/goal-provider-fixture';
import {memberCheckpointFixture as data} from '../../../../team/runtime/unittest/support/member-checkpoint-provider';
type Request=GoalFixtureRequest&{tools?:{function:{name:string}}[]};
const value=(body:Request,id:string)=>{const m=body.messages.find(m=>m.role==='tool'&&m.tool_call_id===id);assert.ok(m,id);let v=JSON.parse(typeof m.content==='string'?m.content:JSON.stringify(m.content));if(Array.isArray(v.content))v=JSON.parse(v.content.map((p:{text?:string})=>p.text??'').join(''));return v};
export const pauseQueuedGoal='PAUSE_QUEUED_FOLLOWUP: 此独立要求不能充当暂停问题的答复';
export const pauseQuestion={questions:[{question:'已保存 A 的真实文件依据，是否继续原调用并核实后继？',options:[{label:'继续核实'},{label:'停止'}]}]};
/** 仅脚本化模型输出；暂停保持实际 Pi 原 task/run，依赖数据经过真实文件工具传递。 */
export async function recursivePauseProvider(holdAfterAnswer=false,secondQuestion=false,endWhileWaiting=false,invalidateByCommand=false){
 const queued:Request[]=[],main:Request[]=[],member:Request[]=[],errors:string[]=[],sequence:string[]=[],byChild:Request[][]=[[],[],[]];
 let selection:OwnerExecutionSelection|undefined,moduleId='',childIndex=-1,release!:()=>void;
 const gate=new Promise<void>(resolve=>release=resolve);if(!holdAfterAnswer)release();
 const state:{waiting?:any;waitingAgain?:any;result?:any;results:any[];continued?:boolean}={results:[]};
 const server=http.createServer(async(req,res)=>{try{
  let raw='';for await(const chunk of req)raw+=chunk;const body=JSON.parse(raw) as Request;
  const isMain=body.tools?.some(t=>t.function.name==='cbim_agent_result_review')===true;
  res.writeHead(200,{'content-type':'text/event-stream'});
  const emit=(delta:unknown,finish_reason:string|null=null)=>res.write('data: '+JSON.stringify({id:'pause-'+(main.length+member.length),object:'chat.completion.chunk',created:1,model:data.model,choices:[{index:0,delta,finish_reason}]})+'\n\n');
  const tool=(id:string,name:string,args:unknown)=>{assert.ok(body.tools?.some(t=>t.function.name===name),name);emit({role:'assistant',tool_calls:[{index:0,id,type:'function',function:{name,arguments:JSON.stringify(args)}}]});emit({},'tool_calls')};
  const reply=(content:string)=>{emit({role:'assistant',content});emit({},'stop')};
  if(isMain&&JSON.stringify(body.messages.filter(m=>m.role==='user').at(-1)?.content).includes(pauseQueuedGoal)){queued.push(body);reply('原调用结束后才处理独立排队要求，不重放子执行。')}
  else if(isMain){
   const turn=main.length;main.push(body);sequence.push('main:'+turn);
   const call=(index:number)=>{childIndex=index;assert.ok(selection);tool('pause-call-'+index,'cbim_agent_call',{agentId:selection.memberId,message:'按原调用核实阶段 '+index,business:{moduleIds:[moduleId],acceptance:['真实文件与原采集字节一致']}})};
   if(turn===0)call(0);
   else if(turn===1){state.waiting=value(body,'pause-call-0');assert.equal(state.waiting.status,'waiting');if(endWhileWaiting)reply('问题尚未答复，不能声称任务完成。');else tool('pause-relay','cbim_ask_user_question',state.waiting.questions)}
   else if(turn===2)tool('pause-answer','cbim_agent_reply',{callId:'pause-call-0',questionId:state.waiting.questionId,result:value(body,'pause-relay')});
   else if(turn===3&&secondQuestion){state.waitingAgain=value(body,'pause-answer');assert.equal(state.waitingAgain.status,'waiting');tool('pause-relay-again','cbim_ask_user_question',state.waitingAgain.questions)}
   else if(turn===4&&secondQuestion)tool('pause-answer-again','cbim_agent_reply',{callId:'pause-call-0',questionId:state.waitingAgain.questionId,result:value(body,'pause-relay-again')});
   else if(turn===(secondQuestion?5:3)){state.result=value(body,secondQuestion?'pause-answer-again':'pause-answer');state.results.push(state.result);if(state.result.error)reply('原成果变化或执行失败，后继未启动。');else{assert.equal(state.result.status,'completed');call(1)}}
   else if(turn===(secondQuestion?6:4)){const result=value(body,'pause-call-1');state.results.push(result);if(result.error)reply('后继调用条件已变化，未切换岗位或模型执行。');else{assert.equal(result.status,'completed');call(2)}}
   else if(turn===(secondQuestion?7:5)){const result=value(body,'pause-call-2');assert.equal(result.status,'completed');state.results.push(result);reply('原调用已完成，三个阶段的真实依据已返回。')}
   else throw Error('Unexpected main replay '+turn);
  }else{
   assert.ok(childIndex>=0);const index=childIndex,requests=byChild[index],actualTurn=requests.length,turn=index===0&&secondQuestion&&actualTurn>=8?actualTurn-2:index===0&&invalidateByCommand&&actualTurn>=5?actualTurn-1:actualTurn;
   requests.push(body);member.push(body);sequence.push('child'+index+':'+turn);
   if(index===0){
    if(invalidateByCommand&&actualTurn===4)tool('pause-unsafe-command','bash',{command: `node -e "require('fs').appendFileSync('${data.files[0]}','UNSAFE_AFTER_CAPTURE')"`});
    else if(secondQuestion&&actualTurn===6)tool('pause-ask-again','cbim_ask_user_question',{questions:[{question:'原 A 已重新读取，是否继续最终交付？',options:[{label:'继续核实'},{label:'停止'}]}]});
    else if(secondQuestion&&actualTurn===7){if(value(body,'pause-ask-again').cancelled)reply('已放弃继续，不提交完成交付。');else tool('pause-last-read','read',{path:data.files[0]})}
    else if(turn===0)tool('pause-plan','cbim_task_plan',{expectedVersion:0,goal:'按原调用核实阶段 '+index,acceptance:['真实文件与原采集字节一致'],reason:'保留实际文件依据',steps:[{id:'verify',title:'核实原文件',owner:'执行者'}]});
    else if(turn===1)tool('pause-write','write',{path:data.files[0],content:data.facts[0]});
    else if(turn===2)tool('pause-read','read',{path:data.files[0]});
    else if(turn===3)tool('pause-capture','cbim_task_artifact_capture',{expectedTaskProgressVersion:2,sourceToolCallIds:['pause-write','pause-read']});
    else if(turn===4){assert.equal(value(body,'pause-capture').state,'captured');tool('pause-ask','cbim_ask_user_question',pauseQuestion)}
    else if(turn===5){state.continued=true;await gate;tool('pause-reread','read',{path:data.files[0]})}
    else if(turn===6)tool('pause-step','cbim_task_step',{expectedVersion:invalidateByCommand?3:2,id:'verify',state:'reported_done',evidenceIds:[secondQuestion?'pause-last-read':'pause-reread']});
    else if(turn===7)tool('pause-delivery','cbim_delivery_prepare',{expectedVersion:invalidateByCommand?4:3,summary:'已在原调用中复核',limitations:['需主调用验证原采集字节']});
    else if(turn===8)reply('原文件读取与交付完成。');
    else throw Error('Unexpected paused child replay '+turn);
   }else{
    if(turn===0)tool('next-plan','cbim_task_plan',{expectedVersion:0,goal:'按原调用核实阶段 '+index,acceptance:['真实文件与原采集字节一致'],reason:'依赖通过已完成工具结果按序推进',steps:[{id:'verify',title:'核实前置与当前文件',owner:'执行者'}]});
    else if(turn===1)tool('next-prior','read',{path:data.files[index-1]});
    else if(turn===2){assert.ok(JSON.stringify(body.messages).includes(data.facts[index-1]));tool('next-read','read',{path:data.files[index]})}
    else if(turn===3){assert.ok(JSON.stringify(body.messages).includes(data.facts[index]));tool('next-step','cbim_task_step',{expectedVersion:1,id:'verify',state:'reported_done',evidenceIds:['next-prior','next-read']})}
    else if(turn===4)tool('next-delivery','cbim_delivery_prepare',{expectedVersion:2,summary:'前置与本阶段文件均已读取',limitations:[]});
    else if(turn===5)reply('真实依赖文件已核实。');
    else throw Error('Unexpected dependent replay '+turn);
   }
  }
  res.end('data: [DONE]\n\n');
 }catch(error){errors.push(String(error));if(!res.headersSent)res.writeHead(500);res.end('Recursive pause fixture failed')}});
 await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));const address=server.address();assert.ok(address&&typeof address!=='string');
 return {url:'http://127.0.0.1:'+address.port+'/v1',queued,main,member,byChild,errors,sequence,state,bind:(_agent:string,module:string,owner:OwnerExecutionSelection)=>{moduleId=module;selection=structuredClone(owner)},releaseContinuation:release,close:async()=>{release();server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()))}};
}
