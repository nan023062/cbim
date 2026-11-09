import {describe,it,expect} from 'vitest';
import {randomUUID} from 'node:crypto';
import {hash} from '../src/backend/core/foundation/serialization';
import {
  moduleGovernanceDecideInputSchema,moduleGovernanceDecisionSchema,moduleGovernanceFeedbackSchema,moduleGovernanceProposeInputSchema,moduleGovernanceResponseRefsSchema,moduleGovernanceListSchema,
  type ModuleGovernanceProposal,type ModuleGovernanceDecision,type ModuleGovernanceList,type ModuleGovernanceResponseAssessment,
} from '../src/backend/core/governance/module-governance';
import {moduleGovernanceProposalBasis} from '../src/backend/core/governance/module-governance-rules';
import {resolveModuleGovernanceResponses,validateModuleGovernanceResponseSources,validateModuleGovernanceAssessments,type ModuleGovernanceResponseSource} from '../src/backend/core/governance/module-governance-feedback';
import {governanceProposeInputSchema,projectGovernanceGet,governanceGetOutputSchema,governanceToolOutputLimit} from '../src/backend/core/governance/module-governance-tools';

const workspaceId='workspace',instanceId=randomUUID(),moduleId='.cbim/workspace/engine',now='2026-11-07T10:00:00.000Z',actor={kind:'local_desktop',interaction:'explicit_submit'} as const;
const feedback={kind:'evidence_request',focus:'evidence',expectedResponse:'请补充真实调用方异常恢复约定'} as const;
const finish=(draft:Omit<ModuleGovernanceProposal,'basis'>):ModuleGovernanceProposal=>({...draft,basis:moduleGovernanceProposalBasis(draft)});
function fixture(){
  const protectionId=randomUUID(),proposal=finish({proposalId:randomUUID(),workspaceId,moduleId,protectionId,observationId:randomUUID(),base:{knowledgeRevision:hash('old-knowledge'),protectionRevision:1,definitionHash:hash('definition'),overviewHash:hash('original')},change:{path:moduleId+'/module.md',beforeText:'original',beforeHash:hash('original'),afterText:'draft',afterHash:hash('draft')},reason:'明确契约',alternatives:['保持现状'],invariants:['接口身份不变'],rollbackNotes:'单独提案恢复',createdAt:now});
  const decision:ModuleGovernanceDecision={decisionId:randomUUID(),workspaceId,proposalId:proposal.proposalId,revision:1,basis:proposal.basis,decision:'defer',comment:'没有说明请求失败后的状态',revisitCondition:'明确恢复条件',actor,recordedAt:now,feedback};
  const sources:ModuleGovernanceResponseSource[]=[{proposal,decisions:[decision]}];
  const respondsTo=resolveModuleGovernanceResponses({workspaceId,protectionId},[decision.decisionId],sources);
  const target=finish({...proposal,proposalId:randomUUID(),observationId:randomUUID(),base:{...proposal.base,knowledgeRevision:hash('new-knowledge')},change:{...proposal.change,afterText:'draft with failure contract',afterHash:hash('draft with failure contract')},respondsTo});
  return {proposal,decision,sources,target,protectionId};
}
function supersede(f:ReturnType<typeof fixture>,decision:'approve'|'reject'|'defer'='approve'){
  const next:ModuleGovernanceDecision={...f.decision,decisionId:randomUUID(),revision:2,decision,feedback:decision==='approve'?undefined:decision==='reject'?{kind:'objection',focus:'risk',expectedResponse:'新的风险问题'}:feedback,supersedesDecisionId:f.decision.decisionId};
  f.sources[0]={proposal:f.proposal,decisions:[f.decision,next]};return next;
}
function view(f:ReturnType<typeof fixture>):ModuleGovernanceList{
  return {identity:{workspaceId,instanceId},moduleId,knowledgeRevision:f.target.base.knowledgeRevision,observations:[],proposals:[],selected:{proposal:f.target,decisions:[],applications:[],responseStates:validateModuleGovernanceResponseSources(f.target,f.sources,'historical')},issues:[]};
}

describe('本机反馈与精确回应契约',()=>{
  it('补证只能明确暂缓、异议只能明确驳回，旧决定缺省不补理解或评价',()=>{
    const f=fixture(),request={workspaceId,instanceId,commandId:randomUUID(),proposalId:f.proposal.proposalId,expectedDecisionRevision:0,expectedBasis:f.proposal.basis,decision:'defer',comment:'说明缺少证据',revisitCondition:'收到验证结果',feedback};
    expect(moduleGovernanceDecideInputSchema.safeParse(request).success).toBe(true);
    expect(moduleGovernanceDecideInputSchema.safeParse({...request,decision:'approve'}).success).toBe(false);
    expect(moduleGovernanceDecideInputSchema.safeParse({...request,decision:'reject'}).success).toBe(false);
    expect(moduleGovernanceDecideInputSchema.safeParse({...request,decision:'reject',feedback:{...feedback,kind:'objection'}}).success).toBe(true);
    const parsed=moduleGovernanceDecisionSchema.parse({...f.decision,decision:'approve',feedback:undefined});expect(parsed.assessments).toBeUndefined();expect(parsed.feedback).toBeUndefined();
    expect(moduleGovernanceFeedbackSchema.safeParse({...feedback,expectedResponse:'   '}).success).toBe(false);expect(moduleGovernanceFeedbackSchema.safeParse({...feedback,understood:true}).success).toBe(false);
  });
  it('回应请求只接唯一决定ID，不接受冻结证明或模型人工评价',()=>{
    const f=fixture(),input={protectionId:f.protectionId,observationId:f.target.observationId,expectedProtectionRevision:1,expectedKnowledgeRevision:f.target.base.knowledgeRevision,newOverviewText:'revised',reason:'回应反馈',alternatives:['不改'],invariants:['边界不变'],rollbackNotes:'回退说明',respondsToDecisionIds:[f.decision.decisionId]};
    expect(governanceProposeInputSchema.safeParse(input).success).toBe(true);
    for(const bad of [{respondsTo:f.target.respondsTo},{assessments:[{decisionId:f.decision.decisionId,outcome:'addressed',explanation:'模型自评'}]},{feedback}])expect(governanceProposeInputSchema.safeParse({...input,...bad}).success).toBe(false);
    for(const ids of [[],[f.decision.decisionId,f.decision.decisionId],Array.from({length:9},()=>randomUUID())])expect(governanceProposeInputSchema.safeParse({...input,respondsToDecisionIds:ids}).success).toBe(false);
    expect(moduleGovernanceProposeInputSchema.safeParse({...input,workspaceId,instanceId,commandId:randomUUID()}).success).toBe(true);
  });
  it('新方案只能使用同一保护对象的最新真实反馈，冻结原提案依据和决定版本',()=>{
    const f=fixture();expect(f.target.respondsTo).toEqual([{decisionId:f.decision.decisionId,proposalId:f.proposal.proposalId,basis:f.proposal.basis,decisionRevision:1}]);
    expect(()=>resolveModuleGovernanceResponses({workspaceId,protectionId:randomUUID()},[f.decision.decisionId],f.sources)).toThrow();
    expect(()=>resolveModuleGovernanceResponses({workspaceId:'other',protectionId:f.protectionId},[f.decision.decisionId],f.sources)).toThrow();
    expect(()=>resolveModuleGovernanceResponses({workspaceId,protectionId:f.protectionId,proposalId:f.proposal.proposalId},[f.decision.decisionId],f.sources)).toThrow();
    expect(()=>resolveModuleGovernanceResponses({workspaceId,protectionId:f.protectionId},[randomUUID()],f.sources)).toThrow();
    expect(validateModuleGovernanceResponseSources(f.target,f.sources,'current')[0]).toMatchObject({state:'current',feedback,comment:f.decision.comment});
  });
  it('知识版本可以更新但反馈依据不能移植；引用变化必须改变newproposal basis',()=>{
    const f=fixture();expect(f.target.base.knowledgeRevision).not.toBe(f.proposal.base.knowledgeRevision);
    expect(()=>validateModuleGovernanceResponseSources(f.target,f.sources,'current')).not.toThrow();
    const broken={...f.target,respondsTo:f.target.respondsTo!.map(ref=>({...ref,decisionRevision:2}))};
    expect(()=>validateModuleGovernanceResponseSources(broken,f.sources,'historical')).toThrow();
    expect(moduleGovernanceProposalBasis(broken)).not.toBe(f.target.basis);
    expect(()=>validateModuleGovernanceResponseSources(finish(broken),f.sources,'historical')).toThrow();
  });
  it('后续决定没有feedback也不能回退把更早意见当当前问题',()=>{
    const f=fixture(),next=supersede(f);
    expect(()=>resolveModuleGovernanceResponses({workspaceId,protectionId:f.protectionId},[f.decision.decisionId],f.sources)).toThrowError(expect.objectContaining({code:'GOVERNANCE_FEEDBACK_STALE'}));
    expect(()=>resolveModuleGovernanceResponses({workspaceId,protectionId:f.protectionId},[next.decisionId],f.sources)).toThrowError(expect.objectContaining({code:'GOVERNANCE_FEEDBACK_SOURCE'}));
  });
  it('后续反馈是新精确问题；不能让旧引用自动迁移到新决定',()=>{
    const f=fixture(),next=supersede(f,'reject'),before=structuredClone(f.target);
    const old=validateModuleGovernanceResponseSources(f.target,f.sources,'historical');expect(old[0]).toMatchObject({state:'superseded',latestDecisionId:next.decisionId,latestDecisionRevision:2,reference:{decisionId:f.decision.decisionId},feedback});
    const fresh=resolveModuleGovernanceResponses({workspaceId,protectionId:f.protectionId},[next.decisionId],f.sources);expect(fresh?.[0]).toMatchObject({decisionId:next.decisionId,decisionRevision:2});expect(f.target).toEqual(before);
  });
  it('historical保留合法旧事实而current拒过期，纯读取不修改提案或决定',()=>{
    const f=fixture(),captured=structuredClone(f.target);supersede(f);const sourcesBefore=structuredClone(f.sources);
    expect(validateModuleGovernanceResponseSources(f.target,f.sources,'historical')[0].state).toBe('superseded');
    expect(()=>validateModuleGovernanceResponseSources(f.target,f.sources,'current')).toThrowError(expect.objectContaining({code:'GOVERNANCE_FEEDBACK_STALE'}));
    expect(f.target).toEqual(captured);expect(f.sources).toEqual(sourcesBefore);
  });
  it('来源链被改写、伪actor、重复决定和乱序不能变成可消费反馈',()=>{
    const f=fixture(),target={workspaceId,protectionId:f.protectionId};
    const cases=[
      [{proposal:{...f.proposal,basis:hash('fake')},decisions:[f.decision]}],
      [{proposal:f.proposal,decisions:[{...f.decision,actor:{kind:'main_agent'}}]}],
      [{proposal:f.proposal,decisions:[{...f.decision,revision:2}]}],
      [f.sources[0],f.sources[0]],
    ];
    for(const sources of cases)expect(()=>resolveModuleGovernanceResponses(target,[f.decision.decisionId],sources as ModuleGovernanceResponseSource[])).toThrow();
  });
  it('单来源提案不能引用两个历史决定，也不能悄悄裁剪超限引用',()=>{
    const f=fixture(),first=f.target.respondsTo![0];
    expect(moduleGovernanceResponseRefsSchema.safeParse([first,{...first,decisionId:randomUUID(),decisionRevision:2}]).success).toBe(false);
    expect(()=>resolveModuleGovernanceResponses({workspaceId,protectionId:f.protectionId},[f.decision.decisionId,f.decision.decisionId],f.sources)).toThrow();
    expect(()=>resolveModuleGovernanceResponses({workspaceId,protectionId:f.protectionId},Array.from({length:9},()=>randomUUID()),f.sources)).toThrow();
  });
  it('没有评价就是未评价，允许部分评价或仍需补证，不制造全部addressed门禁',()=>{
    const f=fixture(),assessment:ModuleGovernanceResponseAssessment={decisionId:f.decision.decisionId,outcome:'needs_evidence',explanation:'还没有真实调用方例子'};
    expect(()=>validateModuleGovernanceAssessments(f.target,undefined)).not.toThrow();expect(f.target).not.toHaveProperty('assessments');
    expect(()=>validateModuleGovernanceAssessments(f.target,[assessment])).not.toThrow();
    const approved=moduleGovernanceDecisionSchema.parse({...f.decision,proposalId:f.target.proposalId,basis:f.target.basis,decision:'approve',feedback:undefined,assessments:[assessment]});expect(approved.assessments?.[0].outcome).toBe('needs_evidence');
    expect(()=>validateModuleGovernanceAssessments(f.target,[{...assessment,outcome:'addressed'}])).not.toThrow();
  });
  it('人工评价必须明确选择和具体说明，只对本方案冻结的反馈且不得重复',()=>{
    const f=fixture(),assessment={decisionId:f.decision.decisionId,outcome:'addressed' as const,explanation:'已核对新增失败状态约定'};
    for(const invalid of [[{...assessment,explanation:' '}],[{...assessment,explanation:'x'.repeat(1025)}],[{...assessment,decisionId:randomUUID()}],[assessment,assessment],[]])expect(()=>validateModuleGovernanceAssessments(f.target,invalid)).toThrow();
    expect(()=>validateModuleGovernanceAssessments(f.proposal,[assessment])).toThrow();
    const input={workspaceId,instanceId,commandId:randomUUID(),proposalId:f.target.proposalId,expectedDecisionRevision:0,expectedBasis:f.target.basis,decision:'approve',comment:'批准',assessments:[assessment]};
    expect(moduleGovernanceDecideInputSchema.safeParse(input).success).toBe(true);expect(moduleGovernanceDecideInputSchema.safeParse({...input,actor:{kind:'main_agent'}}).success).toBe(false);
  });
  it('旧无回应字段保持原basis且不需要凭空读取来源',()=>{
    const f=fixture(),before=JSON.stringify(f.proposal);expect(resolveModuleGovernanceResponses({workspaceId,protectionId:f.protectionId},undefined,[])).toBeUndefined();
    expect(validateModuleGovernanceResponseSources(f.proposal,[],'current')).toEqual([]);expect(()=>validateModuleGovernanceAssessments(f.proposal,undefined)).not.toThrow();
    expect(JSON.stringify(f.proposal)).toBe(before);expect(f.proposal).not.toHaveProperty('respondsTo');
  });
  it('当前来源状态必须完整对应refs，显示superseded但不修改历史评价',()=>{
    const f=fixture(),assessment={decisionId:f.decision.decisionId,outcome:'addressed' as const,explanation:'当时核对了约定'};supersede(f);
    const raw=view(f);raw.selected!.decisions=[{...f.decision,proposalId:f.target.proposalId,basis:f.target.basis,decision:'approve',feedback:undefined,assessments:[assessment]}];
    const projected=projectGovernanceGet(raw,{workspaceId,rootSessionId:'root'});
    expect(projected.selectedProposal?.responseStates?.[0]).toMatchObject({state:'superseded',comment:{text:f.decision.comment,truncated:false}});
    expect(projected.selectedProposal?.decisions.items[0].assessments).toEqual([assessment]);expect(governanceGetOutputSchema.safeParse(projected).success).toBe(true);
    expect(moduleGovernanceListSchema.safeParse({...raw,selected:{...raw.selected,responseStates:[]}}).success).toBe(false);
    expect(governanceGetOutputSchema.safeParse({...projected,selectedProposal:{...projected.selectedProposal,responseStates:[]}}).success).toBe(false);
  });
  it('多个来源的原意见与评价投影保持有界，截断明确、不丢反馈身份',()=>{
    const first=fixture(),sources:ModuleGovernanceResponseSource[]=Array.from({length:8},()=>{const f=fixture();f.proposal=finish({...f.proposal,protectionId:first.protectionId});f.decision={...f.decision,proposalId:f.proposal.proposalId,basis:f.proposal.basis,comment:'中'.repeat(8000),feedback:{...feedback,expectedResponse:'问'.repeat(1024)}};return {proposal:f.proposal,decisions:[f.decision]}});
    const refs=resolveModuleGovernanceResponses({workspaceId,protectionId:first.protectionId},sources.map(s=>s.decisions[0].decisionId),sources),target=finish({...first.target,respondsTo:refs});
    const raw=view(first);raw.selected={proposal:target,decisions:[],applications:[],responseStates:validateModuleGovernanceResponseSources(target,sources,'historical')};
    const output=projectGovernanceGet(raw,{workspaceId,rootSessionId:'root'});expect(output.selectedProposal?.responseStates).toHaveLength(8);expect(output.selectedProposal?.responseStates?.every(state=>state.comment.truncated)).toBe(true);expect(Buffer.byteLength(JSON.stringify(output))).toBeLessThanOrEqual(governanceToolOutputLimit);
  });
});
