/**
 * 作用定位：核实新提案对原本机反馈的精确回应引用，并派生当前/已替代状态与逐项评价范围。
 * 设计原因：最新决定变化只能使当前依据失效，不能改写合法历史；同一套纯规则供保存、实施门禁和按命令顺序的账本重放使用。
 * 职责边界：不授予批准或执行权，不推断理解程度，不发起任务；current 必须消费调用方同串行边界内的真实来源。
 */
import {fail} from '../foundation/errors';
import {
  moduleGovernanceProposalSchema,moduleGovernanceDecisionSchema,moduleGovernanceDecisionIdsSchema,moduleGovernanceResponseRefsSchema,moduleGovernanceAssessmentsSchema,
  type ModuleGovernanceProposal,type ModuleGovernanceDecision,type ModuleGovernanceResponseRef,type ModuleGovernanceResponseAssessment,type ModuleGovernanceResponseState,
} from './module-governance';
import {moduleGovernanceProposalBasis,validateModuleGovernanceDecisionAppend} from './module-governance-rules';

/** 来源只读快照；decisions 按该提案已保存的 revision 顺序排列，不按时间或任意 UI 筛选重排。 */
export interface ModuleGovernanceResponseSource {proposal:ModuleGovernanceProposal;decisions:readonly ModuleGovernanceDecision[]}
export interface ModuleGovernanceResponseTarget {workspaceId:string;protectionId:string;proposalId?:string}
function check(value:unknown,code:string,message:string):asserts value{if(!value)fail(code,message)}
function checkedSource(target:ModuleGovernanceResponseTarget,decisionId:string,sources:readonly ModuleGovernanceResponseSource[]){
  const found=sources.flatMap(source=>source.decisions.filter(decision=>decision.decisionId===decisionId).map(decision=>({source,decision})));
  check(found.length===1,'GOVERNANCE_FEEDBACK_SOURCE','回应必须引用唯一真实本机反馈决定');
  const {source}=found[0],proposal=moduleGovernanceProposalSchema.parse(source.proposal),decisions=source.decisions.map(value=>moduleGovernanceDecisionSchema.parse(value));
  check(proposal.workspaceId===target.workspaceId&&proposal.protectionId===target.protectionId&&proposal.proposalId!==target.proposalId&&proposal.basis===moduleGovernanceProposalBasis(proposal),'GOVERNANCE_FEEDBACK_SOURCE','回应来源不属于同一保护对象或精确提案依据');
  check(decisions.length>0&&decisions.every(decision=>decision.workspaceId===proposal.workspaceId&&decision.proposalId===proposal.proposalId&&decision.basis===proposal.basis),'GOVERNANCE_FEEDBACK_SOURCE','来源决定不属于其原提案');
  validateModuleGovernanceDecisionAppend(decisions.slice(0,-1),decisions.at(-1)!);
  const decision=decisions.find(value=>value.decisionId===decisionId)!,latest=decisions.at(-1)!;
  check(decision.feedback&&(decision.decision==='defer'||decision.decision==='reject'),'GOVERNANCE_FEEDBACK_SOURCE','所选决定没有明确补证或异议反馈，不能回退猜测旧问题');
  return {proposal,decision,latest};
}

/** 创建时只接受各来源提案当下最新反馈；缺省仍返回 undefined，不给旧提案补造空引用字段。 */
export function resolveModuleGovernanceResponses(target:ModuleGovernanceResponseTarget,ids:readonly string[]|undefined,sources:readonly ModuleGovernanceResponseSource[]):ModuleGovernanceResponseRef[]|undefined{
  if(ids===undefined)return;
  return moduleGovernanceDecisionIdsSchema.parse(ids).map(id=>{
    const {proposal,decision,latest}=checkedSource(target,id,sources);
    check(latest.decisionId===id,'GOVERNANCE_FEEDBACK_STALE','原反馈已被后续决定替代，请读取最新决定并重新准备方案');
    return {decisionId:id,proposalId:proposal.proposalId,basis:proposal.basis,decisionRevision:decision.revision};
  });
}

/**
 * historical 保留冻结引用并派生是否被替代；current 还要求其仍是最新决定。
 * 账本追加按当时已见记录使用 current；读取旧已提交 journal 不应套用后来来源的 current 门禁。
 */
export function validateModuleGovernanceResponseSources(raw:ModuleGovernanceProposal,sources:readonly ModuleGovernanceResponseSource[],mode:'historical'|'current'):ModuleGovernanceResponseState[]{
  check(mode==='historical'||mode==='current','GOVERNANCE_FEEDBACK_SOURCE','未知回应核验模式');
  const proposal=moduleGovernanceProposalSchema.parse(raw);
  if(!proposal.respondsTo)return [];
  check(proposal.basis===moduleGovernanceProposalBasis(proposal),'GOVERNANCE_FEEDBACK_SOURCE','回应引用未冻结在提案依据中');
  return moduleGovernanceResponseRefsSchema.parse(proposal.respondsTo).map(reference=>{
    const source=checkedSource(proposal,reference.decisionId,sources),{decision,latest}=source;
    check(reference.proposalId===source.proposal.proposalId&&reference.basis===source.proposal.basis&&reference.decisionRevision===decision.revision,'GOVERNANCE_FEEDBACK_SOURCE','冻结回应引用与原决定版本不一致');
    const state=latest.decisionId===reference.decisionId?'current':'superseded';
    if(mode==='current')check(state==='current','GOVERNANCE_FEEDBACK_STALE','回应引用已被后续决定替代，当前批准、评价或实施不能沿用旧问题');
    return {reference:structuredClone(reference),state,latestDecisionId:latest.decisionId,latestDecisionRevision:latest.revision,feedback:structuredClone(decision.feedback!),comment:decision.comment};
  });
}

/** 评价只能明确引用本提案实际回应的意见，可只评价部分；没有评价不产生 addressed，也不要求全部已回应。 */
export function validateModuleGovernanceAssessments(proposal:ModuleGovernanceProposal,raw:readonly ModuleGovernanceResponseAssessment[]|undefined):void{
  if(raw===undefined)return;
  const values=moduleGovernanceAssessmentsSchema.parse(raw),refs=moduleGovernanceResponseRefsSchema.optional().parse(proposal.respondsTo)??[];
  check(values.every(value=>refs.some(ref=>ref.decisionId===value.decisionId)),'GOVERNANCE_ASSESSMENT','本机评价只能针对本提案冻结引用的原意见');
}
