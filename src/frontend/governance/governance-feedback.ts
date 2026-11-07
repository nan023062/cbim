/**
 * 作用定位：将本机治理决定草稿转换为明确提交的反馈与回应评价，并绑定实际审阅的提案和来源版本。
 * 设计原因：空评价保持未评价，批准不补造“已回应”；刷新后的来源或最新决定变化会使旧勾选失效，避免沿用已过期的审阅。
 * 职责边界：这里只校验表单，后端仍须在原串行队列复核来源、CAS 和知识基线。
 */
import type {ModuleGovernanceList,ModuleGovernanceFeedback,ModuleGovernanceResponseAssessment} from '../../bridge/contracts/governance';

export type GovernanceSelected=NonNullable<ModuleGovernanceList['selected']>;
export interface GovernanceDecisionDraft {
  comment:string;revisitCondition:string;includeFeedback:boolean;focus:ModuleGovernanceFeedback['focus'];expectedResponse:string;
  /** 只有用户明确选择的 outcome 才提交；空选择不是 addressed。 */
  assessments:Record<string,{outcome:ModuleGovernanceResponseAssessment['outcome']|'';explanation:string}>;
}
/** 新表单无默认评价或补证要求，不自动改变任何历史决定。 */
export function newGovernanceDecisionDraft():GovernanceDecisionDraft{return {comment:'',revisitCondition:'',includeFeedback:false,focus:'evidence',expectedResponse:'',assessments:{}}}
/** 审阅键覆盖原方案、最新决定及引用的当前状态；不用于授予后端权限。 */
export function governanceDecisionReviewKey(selected:GovernanceSelected){return JSON.stringify([selected.proposal.proposalId,selected.proposal.basis,selected.decisions.at(-1)?.revision??0,selected.responseStates??[]])}
/** 缺失来源状态也不能乐观视为当前有效；已提交记录仍可查看，不以本函数撤销历史。 */
export function governanceResponsesCurrent(selected:GovernanceSelected){
  const refs=selected.proposal.respondsTo??[],states=selected.responseStates??[];
  return refs.length===states.length&&refs.every(ref=>states.some(state=>state.reference.decisionId===ref.decisionId&&state.reference.proposalId===ref.proposalId&&state.reference.basis===ref.basis&&state.reference.decisionRevision===ref.decisionRevision&&state.state==='current'));
}
/** 生成本次明确的字段；所有旧确认、额外评价和空说明在发起 IPC 前拒绝。 */
export function governanceDecisionFields(selected:GovernanceSelected,draft:GovernanceDecisionDraft,decision:'approve'|'reject'|'defer',reviewedKey?:string){
  if(reviewedKey!==governanceDecisionReviewKey(selected))throw Error('提案或来源已变化，请重新审阅后勾选确认');
  if(decision!=='approve'&&!draft.comment.trim())throw Error('驳回或暂缓须填写具体意见');
  if(decision==='defer'&&!draft.revisitCondition.trim())throw Error('暂缓须填写复查条件');
  const refs=selected.proposal.respondsTo??[],assessments:ModuleGovernanceResponseAssessment[]=[];
  for(const [decisionId,value]of Object.entries(draft.assessments)){
    if(!refs.some(ref=>ref.decisionId===decisionId))throw Error('评价不属于当前提案回应的意见');
    if(!value.outcome)continue;
    if(!value.explanation.trim()||value.explanation.length>1024)throw Error('回应评价须填写不超过 1024 字的具体说明');
    assessments.push({decisionId,outcome:value.outcome,explanation:value.explanation});
  }
  if((decision==='approve'||assessments.length>0)&&!governanceResponsesCurrent(selected))throw Error('来源意见已被替代；请基于当前意见重新提出方案，或仅记录驳回/暂缓');
  let feedback:ModuleGovernanceFeedback|undefined;
  if(draft.includeFeedback){
    if(decision==='approve')throw Error('补证或异议请记录为暂缓或驳回，不能同时批准');
    if(!draft.expectedResponse.trim()||draft.expectedResponse.length>1024)throw Error('请填写不超过 1024 字的期望回应');
    feedback={kind:decision==='defer'?'evidence_request':'objection',focus:draft.focus,expectedResponse:draft.expectedResponse};
  }
  return {decision,comment:draft.comment,...(decision==='defer'?{revisitCondition:draft.revisitCondition}:{}),...(feedback?{feedback}:{}),...(assessments.length?{assessments}:{})};
}
