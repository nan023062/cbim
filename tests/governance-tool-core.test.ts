import {describe,it,expect,vi} from 'vitest';
import {randomUUID} from 'node:crypto';
import {hash} from '../src/backend/core/foundation/serialization';
import {
  moduleGovernanceOriginSchema,moduleGovernanceObservationSchema,moduleGovernanceProposalSchema,
  type ModuleGovernanceList,type ModuleGovernanceMainOrigin,type ModuleGovernanceObservation,type ModuleGovernanceProposal,type ModuleGovernanceProtection,
} from '../src/backend/core/governance/module-governance';
import {moduleGovernanceMainCommandId,moduleGovernanceProposalBasis,validateModuleGovernanceRecordOrigin,validateModuleGovernanceMainObservation,validateModuleGovernanceProposal} from '../src/backend/core/governance/module-governance-rules';
import {
  governanceGetInputSchema,governanceObserveInputSchema,governanceProposeInputSchema,governanceReceiptInputSchema,governanceGetOutputSchema,governanceReceiptOutputSchema,
  governanceToolBodyLimit,governanceToolOutputLimit,governanceToolEffects,projectGovernanceGet,projectGovernanceBody,projectGovernanceReceipt,
} from '../src/backend/core/governance/module-governance-tools';
import {authorizeRunTool,type RunToolDescriptor} from '../src/backend/core/tools/policy/tool-policy';
import type {ToolReceipt} from '../src/backend/core/tools/types';
import {TaskProgressTools} from '../src/backend/core/evidence/progress-tools';
import {evaluateWorkflowDelivery} from '../src/backend/core/evidence/workflow-evidence';
import {artifactSources,type ArtifactEvidenceEvent} from '../src/backend/core/evidence/artifact-evidence';

const workspaceId='workspace',rootSessionId='main-root',identity={workspaceId,rootSessionId},now='2026-11-07T08:00:00.000Z',moduleId='.cbim/workspace/module';
const source:ModuleGovernanceMainOrigin={kind:'main_agent',rootSessionId,agentInstanceId:'main-instance',agentSessionId:'main-channel',runId:'main-run',toolCallId:'observe-call',toolName:'cbim_governance_observe'};
const local={kind:'local_desktop',interaction:'explicit_submit'} as const;
function fixture(text='# Module\n完整原文'){
  const protection:ModuleGovernanceProtection={protectionId:randomUUID(),workspaceId,moduleId,revision:1,definition:{path:moduleId+'/module.json',hash:hash('definition')},overview:{path:moduleId+'/module.md',hash:hash(text)},registeredAt:now,actor:local};
  const observation:ModuleGovernanceObservation={observationId:moduleGovernanceMainCommandId(workspaceId,source),workspaceId,protectionId:protection.protectionId,protectionRevision:1,knowledgeRevision:hash('knowledge'),definitionHash:protection.definition.hash,overviewHash:hash(text),overview:{...protection.overview,text},statement:'记录当前知识边界',validation:{structural:true,issues:[],architecture:'review-required',business:'not-run'},observedAt:now,origin:source};
  const origin:ModuleGovernanceMainOrigin={...source,toolCallId:'propose-call',toolName:'cbim_governance_propose'};
  const draft:Omit<ModuleGovernanceProposal,'basis'>={proposalId:moduleGovernanceMainCommandId(workspaceId,origin),workspaceId,moduleId,protectionId:protection.protectionId,observationId:observation.observationId,base:{knowledgeRevision:observation.knowledgeRevision,protectionRevision:1,definitionHash:protection.definition.hash,overviewHash:hash(text)},change:{path:protection.overview.path,beforeText:text,afterText:text+'\n解释',beforeHash:hash(text),afterHash:hash(text+'\n解释')},reason:'补充说明',alternatives:['保持原状'],invariants:['身份不变'],rollbackNotes:'经新提案恢复',createdAt:now,origin};
  const proposal={...draft,basis:moduleGovernanceProposalBasis(draft)};
  const {overview,validation:_,...summary}=observation;
  const list:ModuleGovernanceList={identity:{workspaceId,instanceId:randomUUID()},moduleId,knowledgeRevision:observation.knowledgeRevision,protection,observations:[{...summary,overview:{path:overview.path,hash:overview.hash}}],proposals:[{proposalId:proposal.proposalId,protectionId:proposal.protectionId,observationId:proposal.observationId,basis:proposal.basis,reason:proposal.reason,createdAt:now,decisionRevision:0,origin}],issues:[]};
  const observe={protectionId:protection.protectionId,expectedProtectionRevision:1,expectedKnowledgeRevision:observation.knowledgeRevision,statement:'观察'};
  const propose={...observe,observationId:observation.observationId,newOverviewText:'新正文',reason:'原因',alternatives:['原状'],invariants:['身份不变'],rollbackNotes:'回退说明'};delete (propose as Partial<typeof propose>).statement;
  return {protection,observation,proposal,list,observe,propose};
}

describe('主治理来源与有界工具协议',()=>{
  it('旧记录缺省来源保持未记录，新来源严格区分本机提交与主运行',()=>{
    const f=fixture(),old={...f.observation};delete old.origin;
    expect(moduleGovernanceObservationSchema.parse(old)).not.toHaveProperty('origin');
    expect(moduleGovernanceOriginSchema.parse(local)).toEqual(local);
    expect(moduleGovernanceOriginSchema.parse(source)).toEqual(source);
    for(const fake of [{...local,userId:'authenticated'},{...source,actor:local},{...source,toolName:'cbim_governance_apply'},{...source,rootSessionId:'../other'}])expect(moduleGovernanceOriginSchema.safeParse(fake).success).toBe(false);
  });
  it('同一真实调用命令ID稳定，运行/根/工具/工作区不同不混同',()=>{
    const first=moduleGovernanceMainCommandId(workspaceId,source);
    expect(first).toMatch(/^[a-f0-9]{8}-[a-f0-9]{4}-5[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/);
    expect(moduleGovernanceMainCommandId(workspaceId,structuredClone(source))).toBe(first);
    for(const changed of [{...source,runId:'next'},{...source,toolCallId:'next'},{...source,rootSessionId:'next'},{...source,toolName:'cbim_governance_propose' as const}])expect(moduleGovernanceMainCommandId(workspaceId,changed)).not.toBe(first);
    expect(moduleGovernanceMainCommandId('another',source)).not.toBe(first);
    expect(moduleGovernanceMainCommandId(workspaceId,{...source,agentInstanceId:'changed'})).toBe(first); // 原命令身份变化由持久指纹拒绝，不换ID规避。
  });
  it('主来源必须绑定记录原ID和工具，模型提案只消费自己逻辑通道观察',()=>{
    const f=fixture();expect(()=>validateModuleGovernanceRecordOrigin(f.observation)).not.toThrow();
    expect(()=>validateModuleGovernanceRecordOrigin({...f.observation,observationId:randomUUID()})).toThrow();
    expect(()=>validateModuleGovernanceRecordOrigin({...f.proposal,origin:source})).toThrow();
    expect(()=>validateModuleGovernanceMainObservation(f.observation,{...source,runId:'later-run',toolName:'cbim_governance_propose'})).not.toThrow();
    for(const origin of [undefined,local,{...source,rootSessionId:'another'},{...source,agentSessionId:'other'}])expect(()=>validateModuleGovernanceMainObservation({...f.observation,origin},source)).toThrow();
  });
  it('本机可据主观察另建明确提案，不强迫观察与提案同种来源；来源冻结在basis中',()=>{
    const f=fixture(),draft={...f.proposal,proposalId:randomUUID(),origin:local};const proposal={...draft,basis:moduleGovernanceProposalBasis(draft)};
    expect(()=>validateModuleGovernanceProposal(proposal,f.protection,f.observation)).not.toThrow();
    expect(moduleGovernanceProposalBasis({...f.proposal,origin:local})).not.toBe(f.proposal.basis);
    expect(moduleGovernanceProposalSchema.safeParse({...f.proposal,origin:{...source,permission:'execute'}}).success).toBe(false);
  });
  it('模型严格输入不能携带身份、原命令、作用域、actor或审批',()=>{
    const f=fixture();expect(governanceObserveInputSchema.safeParse(f.observe).success).toBe(true);expect(governanceProposeInputSchema.safeParse(f.propose).success).toBe(true);
    for(const injected of [{workspaceId},{runId:'fake'},{commandId:randomUUID()},{actor:local},{scope:{kind:'knowledge',workspaceId}},{origin:source},{approved:true},{path:'.cbim/README.md'}]){
      expect(governanceObserveInputSchema.safeParse({...f.observe,...injected}).success).toBe(false);
      expect(governanceProposeInputSchema.safeParse({...f.propose,...injected}).success).toBe(false);
    }
    expect(governanceGetInputSchema.safeParse({moduleId,observationId:randomUUID(),proposalId:randomUUID()}).success).toBe(false);
    expect(governanceReceiptInputSchema.safeParse({commandId:randomUUID(),action:'propose',toolCallId:'x'}).success).toBe(false);
    expect(governanceReceiptInputSchema.safeParse({action:'apply',toolCallId:'x'}).success).toBe(false);
  });
  it('模型正文按UTF8限制，说明与数组有界且无默认裁剪',()=>{
    const {propose}=fixture();expect(governanceProposeInputSchema.safeParse({...propose,newOverviewText:'a'.repeat(governanceToolBodyLimit)}).success).toBe(true);
    for(const invalid of [{newOverviewText:'中'.repeat(5500)},{reason:'a'.repeat(1025)},{alternatives:Array(9).fill('x')},{invariants:['a'.repeat(513)]}])expect(governanceProposeInputSchema.safeParse({...propose,...invalid}).success).toBe(false);
    const saved=globalThis.Buffer;try{globalThis.Buffer=undefined as unknown as typeof Buffer;expect(governanceProposeInputSchema.safeParse(propose).success).toBe(true)}finally{globalThis.Buffer=saved}
  });
  it('完整正文不裁剪，超限和高转义正文不携带片段text，伪指纹拒绝',()=>{
    const small='完整🙂\n';expect(projectGovernanceBody(small,hash(small))).toEqual({state:'complete',text:small,utf8Bytes:Buffer.byteLength(small),hash:hash(small)});
    const big='中'.repeat(6000),escaped='\u0000'.repeat(10000);
    expect(projectGovernanceBody(big,hash(big))).toMatchObject({state:'oversized',reason:'body_limit'});
    expect(projectGovernanceBody(big,hash(big))).not.toHaveProperty('text');
    expect(projectGovernanceBody(escaped,hash(escaped))).toMatchObject({state:'oversized',reason:'output_limit'});
    expect(()=>projectGovernanceBody(small,hash('other'))).toThrow();
  });
  it('目录最多20且声明真实总数，指定记录完整读取不偷偷挑最新',()=>{
    const f=fixture();f.list.observations=Array.from({length:25},(_,i)=>({...f.list.observations[0],observationId:randomUUID(),statement:'statement '+i}));
    const output=projectGovernanceGet(f.list,identity);expect(output.observations).toMatchObject({total:25,truncated:true});expect(output.observations.items).toHaveLength(20);expect(output).not.toHaveProperty('selectedObservation');
    const explicit=projectGovernanceGet({...f.list,selectedObservation:f.observation},identity);expect(explicit.selectedObservation?.body).toMatchObject({state:'complete',text:f.observation.overview.text});
    expect(governanceGetOutputSchema.safeParse({...output,actor:local}).success).toBe(false);
    expect(()=>projectGovernanceGet(f.list,{...identity,workspaceId:'other'})).toThrow();
  });
  it('桌面大提案只返回有标识元数据，正文及长取舍说明不撑爆模型输出',()=>{
    const f=fixture('中'.repeat(600000));f.proposal.reason='理'.repeat(8000);f.proposal.alternatives=Array(16).fill('替'.repeat(8000));f.proposal.invariants=Array(32).fill('守'.repeat(8000));
    const output=projectGovernanceGet({...f.list,selected:{proposal:f.proposal,decisions:[],applications:[]}},identity);
    expect(output.selectedProposal?.before).toMatchObject({state:'oversized'});expect(output.selectedProposal?.after).not.toHaveProperty('text');
    expect(output.selectedProposal?.reason.truncated).toBe(true);expect(output.selectedProposal?.invariants).toMatchObject({total:32,truncated:true});
    expect(Buffer.byteLength(JSON.stringify(output))).toBeLessThanOrEqual(governanceToolOutputLimit);
  });
  it('极端合法来源与摘要组合会缩短目录并保持总数，不超过最终128KiB',()=>{
    const f=fixture('x'.repeat(16000));const longSource={...source,toolCallId:'中'.repeat(512),rootSessionId:'r'.repeat(100),agentInstanceId:'a'.repeat(128),agentSessionId:'s'.repeat(128),runId:'n'.repeat(100)};
    f.list.observations=Array.from({length:40},()=>({...f.list.observations[0],origin:longSource,statement:'中'.repeat(8000)}));f.list.proposals=Array.from({length:40},()=>({...f.list.proposals[0],origin:longSource,reason:'中'.repeat(8000)}));
    const output=projectGovernanceGet({...f.list,selected:{proposal:f.proposal,decisions:[],applications:[]}},identity);
    expect(output.observations.total).toBe(40);expect(output.proposals.total).toBe(40);expect(Buffer.byteLength(JSON.stringify(output))).toBeLessThanOrEqual(governanceToolOutputLimit);
  });
  it('原回执投影不复制正文，缺记录保持unknown且跨根/伪来源拒绝',()=>{
    const f=fixture(),raw={identity:f.list.identity,commandId:f.observation.observationId,action:'observe' as const,record:f.observation};
    const result=projectGovernanceReceipt(raw,identity,raw.commandId);expect(result).toMatchObject({status:'recorded',record:{origin:source}});expect(result).not.toHaveProperty('record.overview.text');
    expect(projectGovernanceReceipt(undefined,identity,raw.commandId)).toEqual({identity,status:'unknown',commandId:raw.commandId});
    expect(()=>projectGovernanceReceipt(raw,{...identity,rootSessionId:'other'},raw.commandId)).toThrow();
    expect(()=>projectGovernanceReceipt({...raw,record:{...f.observation,origin:local}},identity,raw.commandId)).toThrow();
    expect(governanceReceiptOutputSchema.safeParse({...result,actor:local}).success).toBe(false);
  });
});

describe('治理作用域和业务证据边界',()=>{
  it('四个真实注册工具严格分类为knowledge，read/ask不冒用正式知识写审批',async()=>{
    const approve=vi.fn(async()=>({allow:true})),guard=vi.fn(async()=>({allow:true}));
    for(const [name,effect] of Object.entries(governanceToolEffects))for(const permission of ['read','ask','execute'] as const){
      const result=await authorizeRunTool({id:'call',name,input:{}},{native:false,effects:[effect],scope:{kind:'knowledge',workspaceId}},{workspaceId,permission,guard,approve});
      expect(result).toMatchObject({allow:true,effects:[effect],scope:{kind:'knowledge',workspaceId}});
    }
    expect(approve).not.toHaveBeenCalled();expect(guard).not.toHaveBeenCalled();
  });
  it('缺作用域、伪原生、多效果、跨workspace与未注册治理名均拒绝，不放宽普通工具',async()=>{
    const call={id:'c',name:'cbim_governance_propose',input:{}},context={workspaceId,permission:'execute' as const,guard:async()=>({allow:true})};
    const good:RunToolDescriptor={native:false,effects:['preview'],scope:{kind:'knowledge',workspaceId}};
    const bad:RunToolDescriptor[]=[{...good,scope:undefined},{...good,native:true},{...good,effects:['preview','knowledge-write']},{...good,effects:['read']},{...good,scope:{kind:'knowledge',workspaceId:'other'}},{...good,scope:{kind:'workspace',workspaceId}}];
    for(const descriptor of bad)expect((await authorizeRunTool(call,descriptor,context)).allow).toBe(false);
    expect((await authorizeRunTool({...call,name:'cbim_governance_apply'},good,context)).allow).toBe(false);
    expect((await authorizeRunTool({...call,name:'other_read'},{...good,effects:['read']},context)).allow).toBe(false);
  });
  it('治理成功回执不能成为步骤或Workflow交付证据，真实文件读取仍可用',async()=>{
    const p=new TaskProgressTools(undefined,async()=>{},{identity:{workspaceId,taskId:'task',runId:'run'}});const receipt=(name:string):ToolReceipt=>({version:1,toolCallId:name,toolName:name,workspaceId,taskId:'task',runId:'run',outcome:'succeeded',inputHash:hash('{}'),resultHash:hash('{}'),effects:['read'],scope:{kind:'knowledge',workspaceId},recordedAt:now});
    for(const name of [...Object.keys(governanceToolEffects),'cbim_governance_future']){
      p.record(receipt(name),p.generation);expect(()=>evaluateWorkflowDelivery([], [receipt(name)],{workspaceId,taskId:'task',runId:'run'})).toThrow();
    }
    expect(JSON.parse((await p.call('cbim_task_inspect',{})).content[0].text).evidence).toEqual([]);
    p.record({...receipt('read'),scope:{kind:'workspace',workspaceId}},p.generation);expect(JSON.parse((await p.call('cbim_task_inspect',{})).content[0].text).evidence).toHaveLength(1);
  });
  it('有真实成功回执的治理读取也不能伪装成单文件产物采集来源',()=>{
    const binding={workspaceId,teamId:'team',agentId:'agent',agentInstanceId:'instance',agentSessionId:'session',rootSessionId,taskId:'task',runId:'run',leaseEpoch:1,planRevision:1},events:ArtifactEvidenceEvent[]=[];
    const append=(type:string,data:Record<string,unknown>)=>events.push({seq:events.length+1,type,data,workspaceId,taskId:binding.taskId,runId:binding.runId});
    append('run.started',{task:{workspaceId,taskId:binding.taskId,agentId:binding.agentId},memberBinding:binding});
    const name='cbim_governance_get',input={moduleId},scope={kind:'knowledge' as const,workspaceId},result={content:[{type:'text',text:'{}'}]};
    append('tool.proposed',{id:'governance',name,input});append('tool.allowed',{id:'governance',name,input,effects:['read'],scope});
    append('tool.finished',{id:'governance',name,result,isError:false,receipt:{version:1,toolCallId:'governance',toolName:name,workspaceId,taskId:binding.taskId,runId:binding.runId,outcome:'succeeded',inputHash:hash(JSON.stringify(input)),resultHash:hash(JSON.stringify(result)),effects:['read'],scope,recordedAt:now}});
    expect(()=>artifactSources(events,binding,['governance'])).toThrow();
  });
});
