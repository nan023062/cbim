import assert from 'node:assert/strict';
import http from 'node:http';
import type {OwnerExecutionSelection} from '../src/logic/team/rules/member-execution-binding';
import type {GoalFixtureRequest} from './goal-provider-fixture';
import {dependencyAdditionData as data} from './queued-dependency-addition-provider';
import {mainToolValue} from './main-tool-contract-provider';
export type RecursiveDependencyFamily='addition'|'replacement'|'revision';
type Request=GoalFixtureRequest&{model:string;tools?:{function:{name:string}}[]};
export const dependencyQuestion={questions:[{question:'根据当前材料调整尚未执行的调用顺序，是否继续？',options:[{label:'按调整后的顺序继续'},{label:'停止'}]}]};
/** 真实工具结果决定后续输入；不构造旧队列节点、信封或换边回执。 */
export async function recursiveDependencyProvider(family:RecursiveDependencyFamily,lostOutput=false){
 const nodes:Array<{name:string;file:number;prior:number[];failed?:boolean}>=family==='replacement'?[{name:'old-a',file:0,prior:[],failed:true},{name:'new-a',file:0,prior:[]},{name:'b',file:1,prior:[1]},{name:'c',file:2,prior:[2]}]:family==='revision'?[{name:'a',file:0,prior:[]},{name:'c',file:2,prior:[]},{name:'b',file:1,prior:[0,1]}]:[{name:'a',file:0,prior:[]},{name:'b',file:1,prior:[0]},{name:'c',file:2,prior:[1]}];
 const heldIndex=family==='addition'?0:1,main:Request[]=[],byNode:Request[][]=nodes.map(()=>[]),errors:string[]=[],goals:string[]=[];
 const state:{readyToStart?:boolean;readyForSuccessors?:boolean;proofs:any[];oldFailure?:any}={proofs:[]};
 let selection:OwnerExecutionSelection,moduleId='',current=-1,releaseStart!:()=>void,releaseSuccessors!:()=>void;
 const startGate=new Promise<void>(r=>releaseStart=r),successorGate=new Promise<void>(r=>releaseSuccessors=r);
 const server=http.createServer(async(req,res)=>{try{
  let raw='';for await(const chunk of req)raw+=chunk;const body=JSON.parse(raw) as Request;assert.equal(body.model,data.model);
  const isMain=body.tools?.some(t=>t.function.name==='cbim_agent_result_review')===true;
  res.writeHead(200,{'Content-Type':'text/event-stream'});
  const emit=(delta:unknown,finish_reason:string|null=null)=>res.write('data: '+JSON.stringify({id:'recursive-dependency-'+main.length,object:'chat.completion.chunk',created:1,model:body.model,choices:[{index:0,delta,finish_reason}]})+'\n\n');
  const tool=(id:string,name:string,args:unknown)=>{assert.ok(body.tools?.some(t=>t.function.name===name));emit({role:'assistant',tool_calls:[{index:0,id,type:'function',function:{name,arguments:JSON.stringify(args)}}]});emit({},'tool_calls')};
  const reply=(content:string)=>{emit({role:'assistant',content});emit({},'stop')};
  const call=(index:number)=>{
   current=index;const node=nodes[index];
   goals[index]='DEPENDENCY '+family+' '+node.name+': 读取 '+data.files[node.file]+'；前置来源 '+JSON.stringify(node.prior.map(p=>({taskId:state.proofs[p].taskId,runId:state.proofs[p].runId,state:state.proofs[p].state})));
   tool('dependency-call-'+index,'cbim_agent_call',{agentId:selection.memberId,message:goals[index],business:{moduleIds:[moduleId],acceptance:['只使用明确前置原调用及实际文件读取证据']}});
  };
  if(isMain){
   const turn=main.length;main.push(body);
   assert.ok(body.tools?.every(t=>!t.function.name.startsWith('cbim_dispatch_')&&!t.function.name.startsWith('cbim_goal_')));
   if(turn===0)tool('dependency-decision','cbim_ask_user_question',dependencyQuestion);
   else if(turn===1){assert.equal(mainToolValue(body,'dependency-decision').answers[0].answer,dependencyQuestion.questions[0].options[0].label);state.readyToStart=true;emit({role:'assistant',content:'已接收调整，尚未启动新调用。'});await startGate;call(0)}
   else{
    const last=body.messages.filter(m=>m.role==='tool').at(-1);assert.ok(last?.tool_call_id);const checked=last.tool_call_id==='dependency-check',index=current;
    const result=mainToolValue(body,last.tool_call_id);
    if(lostOutput&&index===heldIndex&&!checked){assert.ok(JSON.stringify(result).includes('DEPENDENCY_REPLY_LOST'));tool('dependency-check','cbim_agent_result_check',{callId:'dependency-call-'+index})}
    else{
     if(nodes[index].failed){assert.ok(result.error);state.oldFailure=result}
     else{const proof=checked?result:result.verification;assert.equal(proof.state,'verified');state.proofs[index]=proof}
     if(index===heldIndex){state.readyForSuccessors=true;emit({role:'assistant',content:'实际前置已核实，尚未启动后继。'});await successorGate}
     if(index+1<nodes.length)call(index+1);else reply('按当前顺序完成实际调用，原失败与各次独立证明均已保留。');
    }
   }
  }else{
   assert.ok(current>=0);const node=nodes[current],list=byNode[current],turn=list.length;list.push(body);
   const reads=[...node.prior.map(p=>nodes[p].file),node.file],prefix='dependency-'+current;
   if(turn===0){assert.ok(JSON.stringify(body.messages).includes(JSON.stringify(goals[current]).slice(1,-1)));tool(prefix+'-plan','cbim_task_plan',{expectedVersion:0,goal:goals[current],acceptance:['只使用明确前置原调用及实际文件读取证据'],reason:'读取显式前置与本项材料',steps:[{id:'verify',title:'核实实际文件',owner:'执行 Agent'}]})}
   else if(turn<=reads.length)tool(prefix+'-read-'+(turn-1),'read',{path:data.files[reads[turn-1]]});
   else if(node.failed)reply('原方案未形成交付，需要父调用明确选择新调用。');
   else if(turn===reads.length+1){
    for(const index of reads)assert.ok(JSON.stringify(body.messages).includes(data.facts[index]));
    tool(prefix+'-step','cbim_task_step',{expectedVersion:1,id:'verify',state:'reported_done',evidenceIds:reads.map((_,index)=>prefix+'-read-'+index)});
   }else if(turn===reads.length+2)tool(prefix+'-delivery','cbim_delivery_prepare',{expectedVersion:2,summary:'实际核实 '+reads.map(i=>data.facts[i]).join(' / '),limitations:['不代替人工验收']});
   else if(turn===reads.length+3)reply('真实文件读取完成。');else throw Error('Unexpected child replay');
  }
  res.end('data: [DONE]\n\n');
 }catch(error){errors.push(String(error));if(!res.headersSent)res.writeHead(500);res.end('Recursive dependency fixture failed')}});
 await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));const address=server.address();assert.ok(address&&typeof address!=='string');
 return {url:'http://127.0.0.1:'+address.port+'/v1',main,byNode,errors,state,nodes,goals,heldIndex,bind:(_agent:string,module:string,owner:OwnerExecutionSelection)=>{moduleId=module;selection=owner},releaseStart,releaseSuccessors,close:async()=>{releaseStart();releaseSuccessors();server.closeAllConnections();await new Promise<void>(r=>server.close(()=>r()))}};
}
