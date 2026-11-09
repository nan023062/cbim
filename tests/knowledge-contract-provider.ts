import assert from 'node:assert/strict';
import http from 'node:http';
import {randomUUID} from 'node:crypto';
import type {Snapshot,ChangeRequest} from '../src/backend/core/knowledge/types';
import type {GoalFixtureRequest} from './goal-provider-fixture';

export type KnowledgeContractMode='complete'|'stop'|'malformed-after-commit';
export const knowledgeContractFixture={model:'knowledge-contract-fixture',goal:'KNOWLEDGE_CONTRACT_MAIN: 查询真实工具契约并受控更新团队知识',marker:'KNOWLEDGE_CONTRACT_REAL_COMMIT_17a_70d8',draft:'保留知识治理会话草稿，不自动发送。',otherDraft:'另一个会话的草稿保持独立。',final:'真实知识提交与当前版本已经核实；本轮没有执行业务文件或命令。'};
type Request=GoalFixtureRequest&{model:string;tools?:{function:{name:string}}[]};
export function knowledgeContractResult(body:Request,id:string):any{
  const message=body.messages.find(value=>value.role==='tool'&&value.tool_call_id===id);assert.ok(message,'缺少真实工具返回 '+id);
  const text=typeof message.content==='string'?message.content:Array.isArray(message.content)?message.content.map(value=>value&&typeof value==='object'&&'text'in value?String(value.text):'').join(''):'';
  const parse=(raw:string)=>{try{return JSON.parse(raw)}catch{return {error:raw}}};let value=parse(text);
  if(Array.isArray(value.content))value=parse(value.content.filter((part:{type:string})=>part.type==='text').map((part:{text:string})=>part.text).join(''));
  return value;
}

/** The provider only chooses tool calls; metadata, knowledge diagnostics, authorization and commit are real application operations. */
export async function knowledgeContractProvider(mode:KnowledgeContractMode='complete'){
  const requests:Request[]=[],errors:string[]=[],requestId=randomUUID(),previewId=randomUUID();
  const state:{identity?:{workspaceId:string;instanceId:string};catalog?:any;description?:any;snapshot?:Snapshot;invalidPreview?:any;notFound?:any;commit?:any;after?:Snapshot;request?:ChangeRequest}={};
  const server=http.createServer(async(req,res)=>{try{
    assert.equal(req.method,'POST');assert.ok(req.url?.endsWith('/chat/completions'));let raw='';for await(const chunk of req)raw+=chunk;
    const body=JSON.parse(raw) as Request,turn=requests.length;requests.push(body);assert.equal(body.model,knowledgeContractFixture.model);
    const names=body.tools?.map(value=>value.function.name)??[];assert.ok(names.includes('cbim_dispatch_task'));assert.ok(names.every(name=>!['write','edit','bash'].includes(name)),'主调度知识能力不能扩大业务执行权限');
    res.writeHead(200,{'Content-Type':'text/event-stream'});const emit=(delta:unknown,finish_reason:string|null=null)=>res.write('data: '+JSON.stringify({id:'knowledge-contract-'+turn,object:'chat.completion.chunk',created:1,model:body.model,choices:[{index:0,delta,finish_reason}]})+'\n\n');
    const tool=(id:string,name:string,args:unknown)=>{emit({role:'assistant',tool_calls:[{index:0,id,type:'function',function:{name,arguments:JSON.stringify(args)}}]});emit({},'tool_calls')};
    if(turn===0)tool('contract-identity','cbim_workspace_identity',{});
    else if(turn===1){const identity=knowledgeContractResult(body,'contract-identity');state.identity={workspaceId:identity.workspaceId,instanceId:identity.instanceId};tool('contract-catalog','cbim_knowledge_tool_catalog',state.identity)}
    else if(turn===2){state.catalog=knowledgeContractResult(body,'contract-catalog');assert.equal(state.catalog.family,'knowledge');assert.equal(state.catalog.tools.length,30);for(const entry of state.catalog.tools){assert.ok(names.includes(entry.name));assert.equal(entry.version,entry.name==='cbim_knowledge_refresh'?2:1);assert.ok(entry.effects.length>0);assert.ok(!entry.outputSchema,'列表不一次灌入全部业务Schema')}assert.ok(!state.catalog.tools.some((entry:{name:string})=>entry.name==='cbim_dispatch_task'));tool('contract-describe','cbim_knowledge_tool_describe',{...state.identity,name:'cbim_knowledge_commit'})}
    else if(turn===3){state.description=knowledgeContractResult(body,'contract-describe');assert.equal(state.description.family,'knowledge');const described=state.description.tool;assert.equal(described.name,'cbim_knowledge_commit');assert.equal(described.version,1);assert.deepEqual(described.effects,['knowledge-write']);assert.ok(described.inputSchema&&described.outputSchema);assert.equal(described.cancellation.mode,'preflight_only');assert.equal(described.recovery.mode,'same_request');assert.ok(described.recovery.keyFields.includes('requestId'));tool('contract-snapshot','cbim_knowledge_snapshot',state.identity)}
    else if(turn===4){state.snapshot=knowledgeContractResult(body,'contract-snapshot');assert.equal(state.snapshot?.validation?.structural,true);tool('contract-invalid-preview','cbim_knowledge_preview',{...state.identity,revision:state.snapshot.revision,requestId:previewId,changes:[{path:'.cbim/team/people.json',text:'{"people":"INVALID_CANDIDATE_ONLY"}'}]})}
    else if(turn===5){state.invalidPreview=knowledgeContractResult(body,'contract-invalid-preview');assert.equal(state.invalidPreview.validation?.structural,false,'知识结构不合格是合法诊断，不能当作工具协议损坏');assert.ok(state.invalidPreview.validation.issues.some((item:{severity:string})=>item.severity==='error'));tool('contract-not-found','cbim_task_status',{...state.identity,taskId:'nonexistent-maintenance-task'})}
    else if(turn===6){state.notFound=knowledgeContractResult(body,'contract-not-found');assert.equal(state.notFound.state,'not_found');emit({role:'assistant',content:'真实工具契约、结构无效预览和不存在任务的诊断均已读取，正式知识尚未修改。'});tool('contract-plan','cbim_goal_plan',{expectedRevision:1,objective:knowledgeContractFixture.goal,constraints:['只通过知识服务更新团队知识，不执行业务写入或命令'],criteria:[{id:'knowledge',text:'团队说明真实提交且当前版本可追溯',kind:'evidence'}],assignments:[{agentId:'cbim:main',moduleIds:[],criterionIds:['knowledge'],reason:'主角色负责知识治理'}],reason:'先登记本轮知识治理目标'})}
    else if(turn===7){const previous=state.snapshot!.files.find(value=>value.path==='.cbim/README.md');assert.ok(previous);state.request={...state.identity!,revision:state.snapshot!.revision,requestId,changes:[{path:previous.path,text:previous.text+'\n'+knowledgeContractFixture.marker+'\n'}]};tool('contract-commit','cbim_knowledge_commit',state.request)}
    else if(turn===8){state.commit=knowledgeContractResult(body,'contract-commit');if(mode==='malformed-after-commit'){assert.match(String(state.commit.error),/TOOL_OUTPUT_INVALID/);assert.ok(!JSON.stringify(state.commit).includes('PRIVATE_INVALID_OUTPUT_SENTINEL'))}else assert.equal(state.commit.state,'committed');tool('contract-after','cbim_knowledge_snapshot',state.identity)}
    else if(turn===9){state.after=knowledgeContractResult(body,'contract-after');assert.ok(state.after!.files.find(value=>value.path==='.cbim/README.md')?.text.includes(knowledgeContractFixture.marker));assert.notEqual(state.after!.revision,state.snapshot!.revision);const malformed=mode==='malformed-after-commit';tool('contract-review','cbim_goal_review',{expectedRevision:2,decision:malformed?'blocked':'complete',checks:[{criterionId:'knowledge',outcome:malformed?'unmet':'satisfied',reason:malformed?'提交后的输出契约损坏，实际知识已改变；不能重放或宣称完整回执':'真实提交回执与当前知识版本一致',evidence:malformed?[]:[{kind:'main-knowledge',toolCallIds:['contract-commit']}]}],superseded:[],gaps:malformed?['输出错误不等于事务回滚，保留已发生提交供核实']:[],reason:malformed?'保留已发生的知识变更，不自动重试':'按当前知识版本完成真实审阅'})}
    else if(turn===10){emit({role:'assistant',content:mode==='malformed-after-commit'?'提交已经发生，但工具输出契约无效；已保留真实记录，没有重试。':knowledgeContractFixture.final});emit({},'stop')}
    else throw Error('知识契约验收禁止自动重放 '+turn);
    res.end('data: [DONE]\n\n');
  }catch(error){errors.push(String(error));if(!res.headersSent)res.writeHead(500);res.end('Knowledge contract fixture failed')}});
  await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));const address=server.address();assert.ok(address&&typeof address!=='string');
  return {url:`http://127.0.0.1:${address.port}/v1`,requests,errors,state,requestId,close:async()=>{server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()))}};
}
