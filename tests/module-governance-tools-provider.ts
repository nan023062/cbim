import assert from 'node:assert/strict';
import http from 'node:http';
import type {GoalFixtureRequest} from './goal-provider-fixture';
import {governanceGetOutputSchema,governanceRecordedReceiptSchema,governanceReceiptOutputSchema} from '../src/backend/core/governance/module-governance-tools';

export type ModuleGovernanceToolsMode='complete'|'invalid'|'lost-reply'|'lost-observation'|'stop'|'member';
export const moduleGovernanceToolsFixture={model:'module-governance-tools-fixture',moduleId:'.cbim/workspace/governed',goal:'MODULE_GOVERNANCE_TOOLS_MAIN: 核实受保护模块并提出精确知识方案，等待人工决定',marker:'MODULE_GOVERNANCE_REAL_PROPOSAL_18b_93ef',draft:'主治理对话草稿保持，不自动提交。',otherDraft:'另一个主会话的草稿保持独立。',final:'真实观察与精确提案已保存，正式知识未修改；请在业务架构审阅，人工决定与实施仍需分别操作。',statement:'模块说明需要明确知识维护与业务实现的区别，保持已有边界。',reason:'依据真实现状提出精确正文，不代替人工决定或业务实现。',alternative:'保留现有原文，通过临时人工说明补充含义。',invariant:'模块身份、维护人、路径和定义不变。',rollback:'如需调整，重新观察并提出新的精确方案，不直接覆盖受保护正文。'};
export const moduleGovernanceToolNames=['cbim_governance_get','cbim_governance_observe','cbim_governance_propose','cbim_governance_receipt'] as const;
export type GovernanceToolsRequest=GoalFixtureRequest&{model:string;tools?:{function:{name:string}}[]};

export function governanceToolsResult(body:GovernanceToolsRequest,id:string):any{
  const message=body.messages.find(item=>item.role==='tool'&&item.tool_call_id===id);assert.ok(message,'缺少真实治理工具响应 '+id);
  const text=typeof message.content==='string'?message.content:Array.isArray(message.content)?message.content.map(item=>item&&typeof item==='object'&&'text'in item?String(item.text):'').join(''):'';
  const parse=(value:string)=>{try{return JSON.parse(value)}catch{return {error:value}}};let value=parse(text);
  if(Array.isArray(value.content))value=parse(value.content.filter((item:{type:string})=>item.type==='text').map((item:{text:string})=>item.text).join(''));
  return value;
}

/** Local responses choose calls only; every returned record must come from the real Pi/runtime/governance service. */
export async function moduleGovernanceToolsProvider(mode:ModuleGovernanceToolsMode='complete',holdBeforeProposal=false,permission:'read'|'ask'|'execute'=mode==='invalid'?'ask':'read'){
  const requests:GovernanceToolsRequest[]=[],errors:string[]=[],state:Record<string,any>={};let release!:()=>void;const held=new Promise<void>(resolve=>{release=resolve});
  const server=http.createServer(async(req,res)=>{try{
    assert.equal(req.method,'POST');assert.ok(req.url?.endsWith('/chat/completions'));let raw='';for await(const chunk of req)raw+=chunk;
    const body=JSON.parse(raw) as GovernanceToolsRequest,turn=requests.length;requests.push(body);assert.equal(body.model,moduleGovernanceToolsFixture.model);
    const names=body.tools?.map(item=>item.function.name)??[];
    if(mode==='member'){assert.ok(moduleGovernanceToolNames.every(name=>!names.includes(name)));assert.ok(!names.includes('cbim_dispatch_task'))}
    else{assert.ok(moduleGovernanceToolNames.every(name=>names.includes(name)));assert.equal(['write','edit','bash'].every(name=>names.includes(name)),permission!=='read');assert.ok(!names.some(name=>/^cbim_governance_(register|decide|apply)$/.test(name)))}
    res.writeHead(200,{'Content-Type':'text/event-stream'});const emit=(delta:unknown,finish_reason:string|null=null)=>res.write('data: '+JSON.stringify({id:'governance-tools-'+turn,object:'chat.completion.chunk',created:1,model:body.model,choices:[{index:0,delta,finish_reason}]})+'\n\n');
    const tool=(id:string,name:string,args:unknown)=>{emit({role:'assistant',tool_calls:[{index:0,id,type:'function',function:{name,arguments:JSON.stringify(args)}}]});emit({},'tool_calls')};
    if(mode==='member'){assert.equal(turn,0);emit({role:'assistant',content:'执行者没有主治理四工具。本轮只核实能力清单，不宣称业务交付。'});emit({},'stop')}
    else{
      const steps=['get',...(mode==='invalid'?['invalid-identity']:[]),'observe',...(mode==='lost-observation'?['observation-recovery']:[]),'observation','observation-receipt',...(mode==='invalid'?['oversized']:[]),'propose','proposal-receipt','proposal','done'],step=steps[turn],data=moduleGovernanceToolsFixture;
      const proposalArguments=()=>({protectionId:state.get.protection.protectionId,observationId:state.observed.record.observationId,expectedProtectionRevision:state.get.protection.revision,expectedKnowledgeRevision:state.get.knowledgeRevision,newOverviewText:state.observation.selectedObservation.body.text.replace('管理资源。','管理资源。\n\n'+data.marker+'\n\n知识维护与业务实现分别核实，所有变更保持既有模块身份与责任边界。'),reason:data.reason,alternatives:[data.alternative],invariants:[data.invariant],rollbackNotes:data.rollback});
      if(step==='get')tool('governance-get','cbim_governance_get',{moduleId:data.moduleId});
      else if(step==='invalid-identity'){state.get=governanceGetOutputSchema.parse(governanceToolsResult(body,'governance-get'));tool('governance-invalid-identity','cbim_governance_get',{moduleId:data.moduleId,workspaceId:'forged-workspace',actor:{kind:'local_desktop'}})}
      else if(step==='observe'){
        state.get=governanceGetOutputSchema.parse(governanceToolsResult(body,'governance-get'));assert.ok(state.get.protection);assert.equal(state.get.observations.total,0);assert.equal(state.get.proposals.total,0);
        if(mode==='invalid'){state.invalidIdentity=governanceToolsResult(body,'governance-invalid-identity');assert.equal(typeof state.invalidIdentity.error,'string')}
        tool('governance-observe','cbim_governance_observe',{protectionId:state.get.protection.protectionId,expectedProtectionRevision:state.get.protection.revision,expectedKnowledgeRevision:state.get.knowledgeRevision,statement:data.statement});
      }else if(step==='observation-recovery'){
        state.observedReply=governanceToolsResult(body,'governance-observe');assert.match(String(state.observedReply.error),/GOVERNANCE_UNKNOWN/);assert.match(String(state.observedReply.error),/commandId=[a-f0-9-]{36}/);assert.ok(!String(state.observedReply.error).includes('TEST_RESPONSE_LOST'));
        tool('governance-observe-recovery','cbim_governance_receipt',{action:'observe',toolCallId:'governance-observe'});
      }else if(step==='observation'){
        state.observed=governanceRecordedReceiptSchema.parse(governanceToolsResult(body,mode==='lost-observation'?'governance-observe-recovery':'governance-observe'));assert.equal(state.observed.action,'observe');assert.equal(state.observed.record.origin.toolCallId,'governance-observe');
        if(mode==='lost-observation')assert.ok(String(state.observedReply.error).includes(state.observed.commandId));
        tool('governance-observation','cbim_governance_get',{moduleId:data.moduleId,observationId:state.observed.record.observationId});
      }else if(step==='observation-receipt'){
        state.observation=governanceGetOutputSchema.parse(governanceToolsResult(body,'governance-observation'));assert.equal(state.observation.selectedObservation.body.state,'complete');assert.equal(state.observation.selectedObservation.structural,true);
        tool('governance-observe-receipt','cbim_governance_receipt',{action:'observe',toolCallId:'governance-observe'});
      }else if(step==='oversized'){
        state.observedReceipt=governanceReceiptOutputSchema.parse(governanceToolsResult(body,'governance-observe-receipt'));assert.deepEqual(state.observedReceipt,state.observed);
        tool('governance-oversized','cbim_governance_propose',{...proposalArguments(),newOverviewText:'界'.repeat(6000)});
      }else if(step==='propose'){
        state.observedReceipt=governanceReceiptOutputSchema.parse(governanceToolsResult(body,'governance-observe-receipt'));assert.deepEqual(state.observedReceipt,state.observed);
        if(mode==='invalid'){state.oversized=governanceToolsResult(body,'governance-oversized');assert.equal(typeof state.oversized.error,'string')}
        state.readyToPropose=true;if(mode==='stop'||holdBeforeProposal)await held;
        tool('governance-propose','cbim_governance_propose',proposalArguments());
      }else if(step==='proposal-receipt'){
        state.proposedReply=governanceToolsResult(body,'governance-propose');
        if(mode==='lost-reply'){assert.match(String(state.proposedReply.error),/GOVERNANCE_UNKNOWN/);assert.match(String(state.proposedReply.error),/commandId=[a-f0-9-]{36}/);assert.ok(!String(state.proposedReply.error).includes('TEST_RESPONSE_LOST'),'公开未知结果不泄露底层注入错误')}else{state.proposed=governanceRecordedReceiptSchema.parse(state.proposedReply);assert.equal(state.proposed.action,'propose')}
        tool('governance-propose-receipt','cbim_governance_receipt',{action:'propose',toolCallId:'governance-propose'});
      }else if(step==='proposal'){
        state.proposalReceipt=governanceRecordedReceiptSchema.parse(governanceToolsResult(body,'governance-propose-receipt'));assert.equal(state.proposalReceipt.action,'propose');assert.equal(state.proposalReceipt.record.origin.toolCallId,'governance-propose');if(state.proposed)assert.deepEqual(state.proposalReceipt,state.proposed);if(mode==='lost-reply')assert.ok(String(state.proposedReply.error).includes(state.proposalReceipt.commandId),'必须恢复错误提示中的同一原命令');
        tool('governance-proposal','cbim_governance_get',{moduleId:data.moduleId,proposalId:state.proposalReceipt.record.proposalId});
      }else if(step==='done'){
        state.proposal=governanceGetOutputSchema.parse(governanceToolsResult(body,'governance-proposal'));assert.equal(state.proposal.proposals.total,1);assert.equal(state.proposal.selectedProposal.decisions.total,0);assert.equal(state.proposal.selectedProposal.applications.total,0);assert.equal(state.proposal.selectedProposal.before.text,state.observation.selectedObservation.body.text);assert.equal(state.proposal.selectedProposal.after.text,proposalArguments().newOverviewText);assert.equal(state.proposal.knowledgeRevision,state.get.knowledgeRevision);
        emit({role:'assistant',content:data.final});emit({},'stop');
      }else throw Error('治理工具验收禁止自动重放 '+turn);
    }
    res.end('data: [DONE]\n\n');
  }catch(error){errors.push(String(error));if(!res.headersSent)res.writeHead(500);res.end('Module governance fixture failed')}});
  await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));const address=server.address();assert.ok(address&&typeof address!=='string');
  return {url:`http://127.0.0.1:${address.port}/v1`,requests,errors,state,release,held,close:async()=>{release();server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()))}};
}
