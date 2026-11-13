import {describe,it,expect} from 'vitest';
import {randomUUID} from 'node:crypto';
import {hash,json} from '../src/core/platform/node/serialization';
import {
  moduleGovernanceRegisterInputSchema,moduleGovernanceProposeInputSchema,moduleGovernanceDecideInputSchema,moduleGovernanceApplyInputSchema,moduleGovernanceApplicationSchema,moduleGovernanceUnacceptedSchema,
  type ModuleGovernanceProtection,type ModuleGovernanceObservation,type ModuleGovernanceProposal,type ModuleGovernanceDecision,type ModuleGovernanceApplyIntent,
} from '../src/logic/governance/rules/module-governance';
import {
  moduleGovernanceBinding,moduleGovernanceProposalBasis,validateModuleGovernanceProposal,validateModuleGovernanceDecisionAppend,validateModuleGovernanceWrite,advanceModuleGovernanceProtection,
  type ModuleGovernanceFile,type ModuleGovernanceWriteInput,
} from '../src/logic/governance/rules/module-governance-rules';

const now='2026-11-07T08:00:00.000Z',workspaceId='workspace',instanceId=randomUUID(),moduleId='.cbim/workspace/engine',actor={kind:'local_desktop',interaction:'explicit_submit'} as const;
const fact=(path:string,text:string):ModuleGovernanceFile=>({path,text,hash:hash(text)});
function fixture(){
  const files=[fact(moduleId+'/module.json',json({id:moduleId,overview:'module.md',name:'engine'})),fact(moduleId+'/module.md','# 正式契约\n原有正文'),fact('.cbim/README.md','项目说明')],binding=moduleGovernanceBinding(moduleId,files,[moduleId]);
  const protection:ModuleGovernanceProtection={protectionId:randomUUID(),workspaceId,moduleId,revision:1,...binding,registeredAt:now,actor};
  const knowledgeRevision=hash('knowledge'),observation:ModuleGovernanceObservation={observationId:randomUUID(),workspaceId,protectionId:protection.protectionId,protectionRevision:1,knowledgeRevision,definitionHash:binding.definition.hash,overviewHash:binding.overview.hash,overview:{...binding.overview,text:files[1].text},statement:'发现契约需要说明异常路径',validation:{structural:true,issues:[],architecture:'review-required',business:'not-run'},observedAt:now};
  const draft:Omit<ModuleGovernanceProposal,'basis'>={proposalId:randomUUID(),workspaceId,moduleId,protectionId:protection.protectionId,observationId:observation.observationId,base:{knowledgeRevision,protectionRevision:1,definitionHash:binding.definition.hash,overviewHash:binding.overview.hash},change:{path:binding.overview.path,beforeText:files[1].text,afterText:'# 正式契约\n补齐异常路径',beforeHash:binding.overview.hash,afterHash:hash('# 正式契约\n补齐异常路径')},reason:'明确调用方恢复责任',alternatives:['保持当前约定并继续观察'],invariants:['模块对外身份不变'],rollbackNotes:'经新提案恢复原正文；不自动回放业务操作',createdAt:now};
  const proposal:ModuleGovernanceProposal={...draft,basis:moduleGovernanceProposalBasis(draft)},decision:ModuleGovernanceDecision={decisionId:randomUUID(),workspaceId,proposalId:proposal.proposalId,revision:1,basis:proposal.basis,decision:'approve',comment:'批准所列知识差异',actor,recordedAt:now};
  const request={workspaceId,instanceId,revision:knowledgeRevision,requestId:randomUUID(),changes:[{path:proposal.change.path,text:proposal.change.afterText}]};
  const intent:ModuleGovernanceApplyIntent={intentId:request.requestId,workspaceId,proposalId:proposal.proposalId,decisionId:decision.decisionId,protectionId:protection.protectionId,basis:proposal.basis,request,requestFingerprint:hash(json(request)),createdAt:now};
  const projectedFiles=files.map(file=>file.path===proposal.change.path?fact(file.path,proposal.change.afterText):file);
  const input:ModuleGovernanceWriteInput={workspaceId,currentRevision:knowledgeRevision,request,protections:[protection],currentFiles:files,projectedFiles,visibleModuleIds:[moduleId],authorized:{intent,proposal,decision,latestDecisionRevision:1}};
  return {files,protection,observation,proposal,decision,intent,input,knowledgeRevision};
}
const copy=<T>(value:T):T=>structuredClone(value);

describe('Module知识治理的纯契约与保护门禁',()=>{
  it('所有写请求拒绝调用方声称身份、路径或授权，申请实施没有正文',()=>{
    const f=fixture(),base={workspaceId,instanceId,commandId:randomUUID()};
    expect(moduleGovernanceRegisterInputSchema.safeParse({...base,moduleId,expectedKnowledgeRevision:f.knowledgeRevision}).success).toBe(true);
    expect(moduleGovernanceRegisterInputSchema.safeParse({...base,moduleId,expectedKnowledgeRevision:f.knowledgeRevision,actor}).success).toBe(false);
    const propose={...base,protectionId:f.protection.protectionId,observationId:f.observation.observationId,expectedProtectionRevision:1,expectedKnowledgeRevision:f.knowledgeRevision,newOverviewText:'正文',reason:'解释',alternatives:['保持原状'],invariants:['责任不变'],rollbackNotes:'核对后恢复'};
    expect(moduleGovernanceProposeInputSchema.safeParse(propose).success).toBe(true);
    for(const added of [{path:'.cbim/README.md'},{permit:true},{definitionHash:hash('fake')}])expect(moduleGovernanceProposeInputSchema.safeParse({...propose,...added}).success).toBe(false);
    const apply={...base,proposalId:f.proposal.proposalId,decisionId:f.decision.decisionId,expectedBasis:f.proposal.basis};
    expect(moduleGovernanceApplyInputSchema.safeParse(apply).success).toBe(true);
    expect(moduleGovernanceApplyInputSchema.safeParse({...apply,newOverviewText:'偷换'}).success).toBe(false);
  });
  it('正文限制按UTF-8字节且公开Schema在无Buffer环境可用',()=>{
    const f=fixture(),input={workspaceId,instanceId,commandId:randomUUID(),protectionId:f.protection.protectionId,observationId:f.observation.observationId,expectedProtectionRevision:1,expectedKnowledgeRevision:f.knowledgeRevision,newOverviewText:'中'.repeat(700000),reason:'解释',alternatives:['保持原状'],invariants:['责任不变'],rollbackNotes:'恢复说明'};
    expect(moduleGovernanceProposeInputSchema.safeParse(input).success).toBe(false);
    const saved=globalThis.Buffer;try{globalThis.Buffer=undefined as unknown as typeof Buffer;expect(moduleGovernanceProposeInputSchema.safeParse({...input,newOverviewText:'原文🙂'}).success).toBe(true)}finally{globalThis.Buffer=saved}
  });
  it('登记从真实定义核实绑定、当前哈希和可见模块，不能猜目标或绕过别名',()=>{
    const f=fixture();expect(moduleGovernanceBinding(moduleId,f.files,[moduleId])).toEqual({definition:f.protection.definition,overview:f.protection.overview});
    expect(()=>moduleGovernanceBinding(moduleId,f.files,[])).toThrow(/可见/);
    expect(()=>moduleGovernanceBinding(moduleId,[{...f.files[0],hash:hash('fake')},...f.files.slice(1)],[moduleId])).toThrow(/指纹/);
    expect(()=>moduleGovernanceBinding(moduleId,[fact(f.files[0].path,json({id:moduleId,overview:'elsewhere.md'})),...f.files.slice(1)],[moduleId])).toThrow(/绑定/);
    expect(()=>moduleGovernanceBinding(moduleId,[...f.files,{...f.files[1],path:f.files[1].path.toUpperCase()}],[moduleId])).toThrow(/重复/);
    expect(()=>moduleGovernanceBinding('.cbim/workspace/../team',f.files,[moduleId])).toThrow(/标识/);
  });
  it('提案精确绑定观察原文及保护版本，时钟不影响basis但方案说明参与',()=>{
    const f=fixture();expect(()=>validateModuleGovernanceProposal(f.proposal,f.protection,f.observation)).not.toThrow();
    expect(moduleGovernanceProposalBasis({...f.proposal,createdAt:'2026-11-08T00:00:00.000Z'})).toBe(f.proposal.basis);
    expect(moduleGovernanceProposalBasis({...f.proposal,reason:'更换目的'})).not.toBe(f.proposal.basis);
    expect(()=>validateModuleGovernanceProposal({...f.proposal,reason:'偷换'},f.protection,f.observation)).toThrow(/依据/);
    expect(()=>validateModuleGovernanceProposal(f.proposal,f.protection,{...f.observation,overview:{...f.observation.overview,text:'更旧正文'}})).toThrow(/观察/);
    expect(()=>validateModuleGovernanceProposal(f.proposal,{...f.protection,revision:2},f.observation)).toThrow(/过期/);
  });
  it('驳回暂缓必须明确说明，决定历史只连续追加且不覆盖旧决定',()=>{
    const f=fixture();expect(()=>validateModuleGovernanceDecisionAppend([],f.decision)).not.toThrow();
    const next={...f.decision,decisionId:randomUUID(),revision:2,decision:'reject' as const,comment:'证据不足',supersedesDecisionId:f.decision.decisionId};
    expect(()=>validateModuleGovernanceDecisionAppend([f.decision],next)).not.toThrow();expect(f.decision.decision).toBe('approve');
    expect(()=>validateModuleGovernanceDecisionAppend([f.decision],{...next,decisionId:f.decision.decisionId})).toThrow();
    expect(()=>validateModuleGovernanceDecisionAppend([f.decision],{...next,revision:3})).toThrow(/连续/);
    expect(()=>validateModuleGovernanceDecisionAppend([f.decision],{...next,basis:hash('other')})).toThrow(/依据/);
    const request={workspaceId,instanceId,commandId:randomUUID(),proposalId:f.proposal.proposalId,expectedDecisionRevision:0,expectedBasis:f.proposal.basis,decision:'defer',comment:'等待接口结果'};
    expect(moduleGovernanceDecideInputSchema.safeParse(request).success).toBe(false);expect(moduleGovernanceDecideInputSchema.safeParse({...request,revisitCondition:'新接口结果已核实'}).success).toBe(true);
  });
  it('普通原始CRUD不能修改受保护正文，无关文件与无实质差异保持可提交',()=>{
    const f=fixture();expect(()=>validateModuleGovernanceWrite({...f.input,authorized:undefined})).toThrow(/独立实施/);
    expect(()=>validateModuleGovernanceWrite({...f.input,authorized:undefined,projectedFiles:f.files})).not.toThrow();
    const unrelated=f.files.map(file=>file.path==='.cbim/README.md'?fact(file.path,'新的项目说明'):file);
    expect(()=>validateModuleGovernanceWrite({...f.input,authorized:undefined,request:{...f.input.request,changes:[{path:'.cbim/README.md',text:'新的项目说明'}]},projectedFiles:unrelated})).not.toThrow();
  });
  it('定义修改、删除移动和最终ignore隐藏都被同一门禁拦截',()=>{
    const f=fixture();for(const projectedFiles of [f.files.map((file,i)=>i===0?fact(file.path,file.text+'\n'):file),f.files.slice(1),f.files.map((file,i)=>i===0?{...file,path:'.cbim/workspace/else/module.json'}:file)])expect(()=>validateModuleGovernanceWrite({...f.input,authorized:undefined,projectedFiles})).toThrow();
    expect(()=>validateModuleGovernanceWrite({...f.input,authorized:undefined,projectedFiles:f.files,visibleModuleIds:[]})).toThrow(/可见/);
  });
  it('外部漂移不能通过普通提交或批准追认',()=>{
    const f=fixture(),currentFiles=f.files.map((file,i)=>i===1?fact(file.path,'外部改动'):file);
    for(const authorized of [undefined,f.input.authorized])expect(()=>validateModuleGovernanceWrite({...f.input,currentFiles,authorized})).toThrow(/偏离/);
  });
  it('精确获批唯一正文差异可实施，允许知识服务派生索引但不能夹带其他正文',()=>{
    const f=fixture();expect(()=>validateModuleGovernanceWrite(f.input)).not.toThrow();
    expect(()=>validateModuleGovernanceWrite({...f.input,projectedFiles:[...f.input.projectedFiles,fact('.cbim/workspace/registry.json','{}')]})).not.toThrow();
    const changed=f.input.projectedFiles.map(file=>file.path==='.cbim/README.md'?fact(file.path,'顺带修改'):file);
    expect(()=>validateModuleGovernanceWrite({...f.input,projectedFiles:changed})).toThrow(/夹带/);
    expect(()=>validateModuleGovernanceWrite({...f.input,request:{...f.input.request,changes:[...f.input.request.changes,{path:'.cbim/README.md',text:'顺带修改'}]}})).toThrow(/原知识请求/);
  });
  it('旧批准、驳回、变更的提案依据或当前知识版本不能实施',()=>{
    const f=fixture(),authorization=f.input.authorized!;
    for(const authorized of [{...authorization,latestDecisionRevision:2},{...authorization,decision:{...f.decision,decision:'reject' as const,comment:'不能实施'}},{...authorization,proposal:{...f.proposal,reason:'改动目标'}},{...authorization,intent:{...f.intent,basis:hash('other')}}])expect(()=>validateModuleGovernanceWrite({...f.input,authorized})).toThrow(/批准/);
    expect(()=>validateModuleGovernanceWrite({...f.input,currentRevision:hash('new knowledge'),request:{...f.input.request,revision:hash('new knowledge')}})).toThrow(/版本/);
    expect(()=>validateModuleGovernanceWrite({...f.input,protections:[{...f.protection,revision:2}]})).toThrow(/版本/);
  });
  it('跨工作区、错保护和改参数重用原意图均拒绝',()=>{
    const f=fixture(),a=f.input.authorized!;
    expect(()=>validateModuleGovernanceWrite({...f.input,protections:[{...f.protection,workspaceId:'elsewhere'}]})).toThrow(/跨工作区/);
    expect(()=>validateModuleGovernanceWrite({...f.input,authorized:{...a,intent:{...f.intent,proposalId:randomUUID()}}})).toThrow(/身份/);
    expect(()=>validateModuleGovernanceWrite({...f.input,request:{...f.input.request,instanceId:randomUUID()}})).toThrow(/原知识请求/);
    expect(()=>validateModuleGovernanceWrite({...f.input,authorized:{...a,intent:{...f.intent,intentId:randomUUID()}}})).toThrow(/原知识请求/);
  });
  it('一次批准不能授权另一个登记Module的正文',()=>{
    const f=fixture(),second='.cbim/workspace/second',extra=[fact(second+'/module.json',json({id:second,overview:'module.md'})),fact(second+'/module.md','其他契约')],binding=moduleGovernanceBinding(second,extra,[second]);
    const protection={...f.protection,protectionId:randomUUID(),moduleId:second,...binding};
    const input={...f.input,currentFiles:[...f.files,...extra],projectedFiles:[...f.input.projectedFiles,...extra],protections:[f.protection,protection],visibleModuleIds:[moduleId,second]};
    expect(()=>validateModuleGovernanceWrite(input)).not.toThrow();expect(()=>validateModuleGovernanceWrite({...input,projectedFiles:input.projectedFiles.map(file=>file.path===second+'/module.md'?fact(file.path,'越权变更'):file)})).toThrow(/独立实施/);
  });
  it('保护head只能按已核实committed回执递进；旧提案不能重复推进',()=>{
    const f=fixture(),receipt={state:'committed' as const,workspaceId,instanceId,requestId:f.intent.intentId,revision:hash('after'),changed:[f.proposal.change.path,'.cbim/workspace/registry.json']};
    const advanced=advanceModuleGovernanceProtection(f.protection,f.proposal,receipt);expect(advanced.revision).toBe(2);expect(advanced.overview.hash).toBe(f.proposal.change.afterHash);expect(advanced.definition).toEqual(f.protection.definition);expect(advanced.actor).toEqual(actor);
    expect(()=>advanceModuleGovernanceProtection(advanced,f.proposal,receipt)).toThrow(/回执/);
    expect(()=>advanceModuleGovernanceProtection(f.protection,f.proposal,{...receipt,changed:[f.protection.definition.path]})).toThrow(/回执/);
    expect(()=>advanceModuleGovernanceProtection(f.protection,f.proposal,{...receipt,workspaceId:'else'})).toThrow(/回执/);
  });
  it('公开应用区分pending/未实施/回滚，不允许它们携带伪成功回执',()=>{
    const f=fixture(),{request,...rest}=f.intent,application={...rest,requestId:request.requestId};
    for(const state of ['pending','not_applied','rolled_back','recovery_required']){
      expect(moduleGovernanceApplicationSchema.safeParse({...application,state}).success).toBe(true);
      expect(moduleGovernanceApplicationSchema.safeParse({...application,state,result:{state:'committed'}}).success).toBe(false);
    }
    expect(moduleGovernanceApplicationSchema.safeParse({...application,state:'committed'}).success).toBe(false);
    expect(moduleGovernanceUnacceptedSchema.safeParse({identity:{workspaceId,instanceId},commandId:request.requestId,action:'apply',unaccepted:true}).success).toBe(true);
  });
});
