import assert from 'node:assert/strict';
import http from 'node:http';
import {randomUUID} from 'node:crypto';
import {knowledgeContractFixture as data,knowledgeContractResult} from './knowledge-contract-provider';
import type {GoalFixtureRequest} from './goal-provider-fixture';

/** 只选择真实工具；原版本/身份来自真实返回，提交后的故障在测试服务边界注入。 */
export async function knowledgeRefreshProvider(){
 const requests:GoalFixtureRequest[]=[],errors:string[]=[],requestId=randomUUID(),state:{identity?:{workspaceId:string;instanceId:string};revision?:string}={};
 const server=http.createServer(async(req,res)=>{try{
  assert.equal(req.method,'POST');assert.ok(req.url?.endsWith('/chat/completions'));let raw='';for await(const chunk of req)raw+=chunk;const body=JSON.parse(raw),turn=requests.length;requests.push(body);assert.equal(body.model,data.model);
  res.writeHead(200,{'Content-Type':'text/event-stream'});const emit=(delta:unknown,finish_reason:string|null=null)=>res.write('data: '+JSON.stringify({id:'knowledge-refresh-'+turn,object:'chat.completion.chunk',created:1,model:body.model,choices:[{index:0,delta,finish_reason}]})+'\n\n');
  const tool=(id:string,name:string,args:unknown)=>{emit({role:'assistant',tool_calls:[{index:0,id,type:'function',function:{name,arguments:JSON.stringify(args)}}]});emit({},'tool_calls')};
  if(turn===0)tool('refresh-identity','cbim_workspace_identity',{});
  else if(turn===1){const value=knowledgeContractResult(body,'refresh-identity');state.identity={workspaceId:value.workspaceId,instanceId:value.instanceId};tool('refresh-describe','cbim_knowledge_tool_describe',{...state.identity,name:'cbim_knowledge_refresh'})}
  else if(turn===2){const described=knowledgeContractResult(body,'refresh-describe').tool;assert.equal(described.version,2);assert.equal(described.recovery.mode,'same_request');assert.ok(described.inputSchema.required.includes('requestId'));tool('refresh-snapshot','cbim_knowledge_snapshot',state.identity)}
  else if(turn===3){const snapshot=knowledgeContractResult(body,'refresh-snapshot');state.revision=snapshot.revision;assert.ok(snapshot.validation.issues.some((v:any)=>v.code==='index_stale'));tool('refresh-goal-plan','cbim_goal_plan',{expectedRevision:1,objective:data.goal,constraints:['只刷新派生索引，不改知识正文'],criteria:[{id:'knowledge',text:'刷新有完整原事务证据',kind:'evidence'}],assignments:[{agentId:'cbim:main',moduleIds:[],criterionIds:['knowledge'],reason:'主角色维护索引'}],reason:'先保存原知识刷新目标'})}
  else if(turn===4)tool('refresh-commit','cbim_knowledge_refresh',{...state.identity,revision:state.revision,requestId});
  else if(turn===5){assert.match(JSON.stringify(knowledgeContractResult(body,'refresh-commit')),/TOOL_OUTPUT_INVALID/);tool('refresh-after','cbim_knowledge_snapshot',state.identity)}
  else if(turn===6){const after=knowledgeContractResult(body,'refresh-after');assert.notEqual(after.revision,state.revision);assert.ok(!after.validation.issues.some((v:any)=>v.code==='index_stale'));tool('refresh-goal-review','cbim_goal_review',{expectedRevision:2,decision:'blocked',checks:[{criterionId:'knowledge',outcome:'unmet',reason:'刷新返回损坏，但索引已改变；等待原事务核实',evidence:[]}],superseded:[],gaps:['保留真实提交与原工具失败，不重放'],reason:'等待明确核实'})}
  else if(turn===7){emit({role:'assistant',content:'索引已发生更新，原刷新回包失败；保留原请求待核实，没有重新提交。'});emit({},'stop')}
  else throw Error('Unexpected refresh replay '+turn);
  res.end('data: [DONE]\n\n');
 }catch(error){errors.push(String(error));if(!res.headersSent)res.writeHead(500);res.end('Knowledge refresh fixture failed')}});
 await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));const address=server.address();assert.ok(address&&typeof address!=='string');
 return {url:`http://127.0.0.1:${address.port}/v1`,requests,errors,state,requestId,close:async()=>{server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()))}};
}
