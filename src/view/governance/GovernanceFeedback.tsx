/**
 * 作用定位：展示治理意见与修订方案的精确关系，提供本机显式补证、异议和回应评价表单。
 * 设计原因：来源被替代与历史评价分开显示，用户未评价时不生成肯定状态；确认绑定本次看到的版本，表单本身不调用模型或实施知识变更。
 */
import {useState} from 'react';
import type {ModuleGovernanceDecision} from '../../bridge/contracts/governance';
import {governanceDecisionFields,governanceDecisionReviewKey,governanceResponsesCurrent,newGovernanceDecisionDraft,type GovernanceDecisionDraft,type GovernanceSelected} from './governance-feedback';

const focusLabels={evidence:'验证依据',invariant:'不变量与约束',risk:'风险与影响',rollback:'排查与恢复'};
const outcomeLabels={addressed:'已回应',needs_evidence:'需要补证',disputed:'仍有异议'};

/** 只展示该历史决定真正保存的反馈和评价；不会从 approve 推导认知结论。 */
export function GovernanceDecisionFeedback({decision}:{decision:ModuleGovernanceDecision}){return <>
  {decision.feedback&&<div data-testid="governance-saved-feedback"><b>{decision.feedback.kind==='evidence_request'?'要求补证':'提出异议'} · {focusLabels[decision.feedback.focus]}</b><p>期望回应：{decision.feedback.expectedResponse}</p></div>}
  {!!decision.assessments?.length&&<div data-testid="governance-saved-assessments"><small>以下是该次本机评价，不表示理解认证或专业验收。</small>{decision.assessments.map(item=><p key={item.decisionId}>{outcomeLabels[item.outcome]} · {item.explanation}<code>{item.decisionId}</code></p>)}</div>}
</>}

/** 反馈引用保持原样；current/superseded 来自后端当前投影，旧评价不会自动变成对新意见的回应。 */
export function GovernanceResponseDetails({selected}:{selected:GovernanceSelected}){
  if(!selected.proposal.respondsTo?.length)return null;
  return <section data-testid="governance-response-sources"><h4>本方案回应的原意见</h4>{!governanceResponsesCurrent(selected)&&<p role="status">来源意见已被替代或尚未核实，不能继续沿用它批准或实施。历史记录保持不变。</p>}{selected.responseStates?.map(state=><article key={state.reference.decisionId}><b>{state.state==='current'?'来源仍有效':'来源已被替代'}</b><code>{state.reference.decisionId}</code><p>{state.comment}</p><p>{focusLabels[state.feedback.focus]} · 期望回应：{state.feedback.expectedResponse}</p>{state.state==='superseded'&&<small>当前决定 {state.latestDecisionId} · 版本 {state.latestDecisionRevision}</small>}</article>)}<p>回应评价独立记录；没有评价就是未评价，批准不表示已回应或已理解。</p></section>;
}

/** 同一提案刷新保留草稿；勾选键随来源/决定变更失效，提交字段由纯校验器一次生成。 */
export function GovernanceDecisionForm({selected,disabled,onSubmit}:{selected:GovernanceSelected;disabled:boolean;onSubmit(fields:ReturnType<typeof governanceDecisionFields>):void|Promise<void>}){
  const [draft,setDraft]=useState(newGovernanceDecisionDraft),[reviewedKey,setReviewedKey]=useState<string>(),[error,setError]=useState('');
  const key=governanceDecisionReviewKey(selected),confirmed=reviewedKey===key,current=governanceResponsesCurrent(selected);
  function change(update:Partial<GovernanceDecisionDraft>){setDraft(value=>({...value,...update}));setReviewedKey(undefined);setError('')}
  function eligible(decision:'approve'|'reject'|'defer'){try{governanceDecisionFields(selected,draft,decision,reviewedKey);return true}catch{return false}}
  function submit(decision:'approve'|'reject'|'defer'){try{const fields=governanceDecisionFields(selected,draft,decision,reviewedKey);setReviewedKey(undefined);void onSubmit(fields)}catch(cause){setError(cause instanceof Error?cause.message:String(cause))}}
  return <fieldset disabled={disabled} data-testid="governance-decision-form"><legend>独立记录人工决定</legend>
    <label>意见<textarea aria-label="治理决定意见" value={draft.comment} onChange={event=>change({comment:event.target.value})} maxLength={8000}/></label>
    <label>暂缓后的复查条件<input aria-label="治理复查条件" value={draft.revisitCondition} onChange={event=>change({revisitCondition:event.target.value})} maxLength={8000}/></label>
    <label className="governance-checkbox"><input type="checkbox" aria-label="附带补证或异议反馈" checked={draft.includeFeedback} onChange={event=>change({includeFeedback:event.target.checked})}/>附带补证或异议反馈</label>
    {draft.includeFeedback&&<><label>关注点<select aria-label="治理反馈关注点" value={draft.focus} onChange={event=>change({focus:event.target.value as GovernanceDecisionDraft['focus']})}>{Object.entries(focusLabels).map(([value,label])=><option key={value} value={value}>{label}</option>)}</select></label><label>期望回应<textarea aria-label="治理反馈期望回应" value={draft.expectedResponse} onChange={event=>change({expectedResponse:event.target.value})} maxLength={1024}/></label><p>要求补证请选择暂缓；提出异议请选择驳回。此操作不会启动模型或修改正文。</p></>}
    {!!selected.proposal.respondsTo?.length&&<div data-testid="governance-assessment-form"><h4>逐项记录本机回应评价（可选）</h4>{!current&&<p>来源意见已更新，不能记录对旧来源的评价；如需单独驳回或暂缓，请将本次评价设为“未评价”。</p>}{selected.proposal.respondsTo.map(ref=>{
      const value=draft.assessments[ref.decisionId]??{outcome:'',explanation:''};
      const update=(next:Partial<typeof value>)=>change({assessments:{...draft.assessments,[ref.decisionId]:{...value,...next}}});
      return <div className="governance-assessment" key={ref.decisionId}><code>{ref.decisionId}</code><label>本次评价<select aria-label={'回应评价 '+ref.decisionId} value={value.outcome} onChange={event=>update({outcome:event.target.value as typeof value.outcome})}><option value="">未评价</option>{Object.entries(outcomeLabels).map(([outcome,label])=><option key={outcome} value={outcome} disabled={!current}>{label}</option>)}</select></label>{value.outcome&&<label>具体说明<textarea aria-label={'回应评价说明 '+ref.decisionId} value={value.explanation} onChange={event=>update({explanation:event.target.value})} maxLength={1024}/></label>}</div>;
    })}</div>}
    {error&&<p role="alert">{error}</p>}
    <label className="governance-checkbox"><input type="checkbox" aria-label="确认已审阅治理提案" checked={confirmed} onChange={event=>setReviewedKey(event.target.checked?key:undefined)}/>我已审阅以上精确提案与来源，本次仅记录决定。</label>
    <div className="governance-actions">{(['approve','reject','defer'] as const).map(decision=><button key={decision} data-testid={'governance-'+decision} disabled={!eligible(decision)} onClick={()=>submit(decision)}>{decision==='approve'?'批准':decision==='reject'?(draft.includeFeedback?'驳回并提出异议':'驳回'):(draft.includeFeedback?'暂缓并要求补证':'暂缓')}</button>)}</div>
  </fieldset>;
}
