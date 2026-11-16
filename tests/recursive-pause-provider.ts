import assert from 'node:assert/strict';
import http from 'node:http';
import type {OwnerExecutionSelection} from '../src/logic/team/rules/member-execution-binding';
import type {GoalFixtureRequest} from './goal-provider-fixture';
import {memberCheckpointFixture as data} from './member-checkpoint-provider';
type Request=GoalFixtureRequest&{tools?:{function:{name:string}}[]};
const value=(body:Request,id:string)=>{const m=body.messages.find(m=>m.role==='tool'&&m.tool_call_id===id);assert.ok(m,id);let v=JSON.parse(typeof m.content==='string'?m.content:JSON.stringify(m.content));if(Array.isArray(v.content))v=JSON.parse(v.content.map((p:{text?:string})=>p.text??'').join(''));return v};
export const pauseQuestion={questions:[{question:'已保存 A 的真实文件依据，是否继续原调用并核实后继？',options:[{label:'继续核实'},{label:'停止'}]}]};
/** 仅脚本化模型输出；暂停保持实际 Pi 原 task/run，依赖数据经过真实文件工具传递。 */
export async function recursivePauseProvider(holdAfterAnswer=false){
 const main:Request[]=[],member:Request[]=[],errors:string[]=[],sequence:string[]=[],byChild:Request[][]=[[],[],[]];
 let selection:OwnerExecutionSelection|undefined,moduleId='',childIndex=-1,release!:()=>void;
 const gate=new Promise<void>(resolve=>release=resolve);if(!holdAfterAnswer)release();
 const state:{waiting?:any;result?:any;results:any[];continued?:boolean}={results:[]};
 const server=http.createServer(async(req,res)=>{try{
  let raw='';for await(const chunk of req)raw+=chunk;const body=JSON.parse(raw) as Request;
  const isMain=body.tools?.some(t=>t.function.name==='cbim_agent_result_review')===true;
  res.writeHead(200,{'content-type':'text/event-stream'});
  const emit=(delta:unknown,finish_reason:string|null=null)=>res.write('data: '+JSON.stringify({id:'pause-'+(main.length+member.length),object:'chat.completion.chunk',created:1,model:data.model,choices:[{index:0,delta,finish_reason}]})+'\n\n');
  const tool=(id:string,name:string,args:unknown)=>{assert.ok(body.tools?.some(t=>t.function.name===name),name);emit({role:'assistant',tool_calls:[{index:0,id,type:'function',function:{name,arguments:JSON.stringify(args)}}]});emit({},'tool_calls')};
  const reply=(content:string)=>{emit({role:'assistant',content});emit({},'stop')};
  if(isMain){
   const turn=main.length;main.push(body);sequence.push('main:'+turn);
   const call=(index:number)=>{childIndex=index;assert.ok(selection);tool('pause-call-'+index,'cbim_agent_call',{agentId:selection.memberId,message:'按原调用核实阶段 '+index,business:{moduleIds:[moduleId],acceptance:['真实文件与原采集字节一致']}})};
   if(turn===0)call(0);
   else if(turn===1){state.waiting=value(body,'pause-call-0');assert.equal(state.waiting.status,'waiting');tool('pause-relay','cbim_ask_user_question',state.waiting.questions)}
   else if(turn===2)tool('pause-answer','cbim_agent_reply',{callId:'pause-call-0',questionId:state.waiting.questionId,result:value(body,'pause-relay')});
   else if(turn===3){state.result=value(body,'pause-answer');state.results.push(state.result);if(state.result.error)reply('原成果变化或执行失败，后继未启动。');else{assert.equal(state.result.status,'completed');call(1)}}
   else if(turn===4){const result=value(body,'pause-call-1');assert.equal(result.status,'completed');state.results.push(result);call(2)}
   else if(turn===5){const result=value(body,'pause-call-2');assert.equal(result.status,'completed');state.results.push(result);reply('原调用已完成，三个阶段的真实依据已返回。')}
   else throw Error('Unexpected main replay '+turn);
  }else{
   assert.ok(childIndex>=0);const index=childIndex,requests=byChild[index],turn=requests.length;
   requests.push(body);member.push(body);sequence.push('child'+index+':'+turn);
   if(index===0){
    if(turn===0)tool('pause-plan','cbim_task_plan',{expectedVersion:0,goal:'生成一次 A 并暂停核实',acceptance:['原文件字节一致'],reason:'保留实际文件依据',steps:[{id:'verify',title:'核实原文件',owner:'执行者'}]});
    else if(turn===1)tool('pause-write','write',{path:data.files[0],content:data.facts[0]});
    else if(turn===2)tool('pause-read','read',{path:data.files[0]});
    else if(turn===3)tool('pause-capture','cbim_task_artifact_capture',{expectedTaskProgressVersion:2,sourceToolCallIds:['pause-write','pause-read']});
    else if(turn===4){assert.equal(value(body,'pause-capture').state,'captured');tool('pause-ask','cbim_ask_user_question',pauseQuestion)}
    else if(turn===5){state.continued=true;await gate;tool('pause-reread','read',{path:data.files[0]})}
    else if(turn===6)tool('pause-step','cbim_task_step',{expectedVersion:2,id:'verify',state:'reported_done',evidenceIds:['pause-reread']});
    else if(turn===7)tool('pause-delivery','cbim_delivery_prepare',{expectedVersion:3,summary:'已在原调用中复核',limitations:['需主调用验证原采集字节']});
    else if(turn===8)reply('原文件读取与交付完成。');
    else throw Error('Unexpected paused child replay '+turn);
   }else{
    if(turn===0)tool('next-plan','cbim_task_plan',{expectedVersion:0,goal:'读取已完成前置与本阶段文件',acceptance:['实际读取两份文件'],reason:'依赖通过已完成工具结果按序推进',steps:[{id:'verify',title:'核实前置与当前文件',owner:'执行者'}]});
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
 return {url:'http://127.0.0.1:'+address.port+'/v1',main,member,byChild,errors,sequence,state,bind:(_agent:string,module:string,owner:OwnerExecutionSelection)=>{moduleId=module;selection=structuredClone(owner)},releaseContinuation:release,close:async()=>{release();server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()))}};
}
