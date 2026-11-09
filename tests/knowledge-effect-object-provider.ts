import assert from 'node:assert/strict';
import http from 'node:http';
import {knowledgeContractFixture as data,knowledgeContractResult} from './knowledge-contract-provider';
import type {GoalFixtureRequest} from './goal-provider-fixture';

/** 只提出原知识工具调用；对象计划、正文写入、授权和坏回复均由实际 Pi/服务完成。 */
export async function knowledgeEffectObjectProvider(){
 const requests:GoalFixtureRequest[]=[],errors:string[]=[],state:{identity?:{workspaceId:string;instanceId:string};planId?:string;revision?:string}={};
 const server=http.createServer(async(req,res)=>{try{
  assert.equal(req.method,'POST');assert.ok(req.url?.endsWith('/chat/completions'));let raw='';for await(const chunk of req)raw+=chunk;const body=JSON.parse(raw),turn=requests.length;requests.push(body);assert.equal(body.model,data.model);
  res.writeHead(200,{'Content-Type':'text/event-stream'});const emit=(delta:unknown,finish_reason:string|null=null)=>res.write('data: '+JSON.stringify({id:'knowledge-effect-object-'+turn,object:'chat.completion.chunk',created:1,model:data.model,choices:[{index:0,delta,finish_reason}]})+'\n\n');
  const tool=(id:string,name:string,args:unknown)=>{emit({role:'assistant',tool_calls:[{index:0,id,type:'function',function:{name,arguments:JSON.stringify(args)}}]});emit({},'tool_calls')};
  if(turn===0)tool('object-identity','cbim_workspace_identity',{});
  else if(turn===1){const value=knowledgeContractResult(body,'object-identity');state.identity={workspaceId:value.workspaceId,instanceId:value.instanceId};tool('object-snapshot','cbim_knowledge_snapshot',state.identity)}
  else if(turn===2){state.revision=knowledgeContractResult(body,'object-snapshot').revision;tool('object-goal-plan','cbim_goal_plan',{expectedRevision:1,objective:data.goal,constraints:['知识对象只通过原计划提交'],criteria:[{id:'knowledge',text:'对象变更有完整原事务证据',kind:'evidence'}],assignments:[{agentId:'cbim:main',moduleIds:[],criterionIds:['knowledge'],reason:'主角色治理知识'}],reason:'先保存原知识目标'})}
  else if(turn===3){const snapshot=knowledgeContractResult(body,'object-snapshot'),original=snapshot.files.find((f:{path:string})=>f.path==='.cbim/workspace/game/module.md');assert.ok(original);tool('object-preview','cbim_object_preview',{...state.identity,revision:state.revision,operations:[{kind:'module',action:'update',id:'.cbim/workspace/game',body:original.text+'\n'+data.marker+'_OBJECT\n'}]})}
  else if(turn===4){state.planId=knowledgeContractResult(body,'object-preview').planId;assert.ok(state.planId);tool('object-commit','cbim_object_commit',{...state.identity,planId:state.planId})}
  else if(turn===5){assert.match(JSON.stringify(knowledgeContractResult(body,'object-commit')),/TOOL_OUTPUT_INVALID/);tool('object-after','cbim_knowledge_snapshot',state.identity)}
  else if(turn===6){const after=knowledgeContractResult(body,'object-after');assert.notEqual(after.revision,state.revision);assert.ok(after.files.some((f:{text:string})=>f.text.includes(data.marker+'_OBJECT')));tool('object-goal-review','cbim_goal_review',{expectedRevision:2,decision:'blocked',checks:[{criterionId:'knowledge',outcome:'unmet',reason:'原对象工具输出损坏，实际知识已经改变',evidence:[]}],superseded:[],gaps:['保留已提交的原计划事务，原工具失败不能重放'],reason:'等待用户明确核实原事务'})}
  else if(turn===7){emit({role:'assistant',content:'原对象提交已经发生，工具输出未被接受；保留原计划与事务供明确核实。'});emit({},'stop')}
  else throw Error('Unexpected object knowledge replay '+turn);
  res.end('data: [DONE]\n\n');
 }catch(error){errors.push(String(error));if(!res.headersSent)res.writeHead(500);res.end('Knowledge effect fixture failed')}});
 await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));const address=server.address();assert.ok(address&&typeof address!=='string');
 return {url:`http://127.0.0.1:${address.port}/v1`,requests,errors,state,close:async()=>{server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()))}};
}
