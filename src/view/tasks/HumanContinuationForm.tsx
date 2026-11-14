/**
 * 作用定位：显示本等待最新人工决定及独立继续按钮，不把保存意见变成隐式执行。
 * 设计原因：用户可看清交给主调度的完整意见集合和模型配置；未知请求仅查原命令，受理成功不等于业务目标完成。
 */
import type {HumanContinuationView} from './useHumanContinuation';
import {humanDecisionLabels} from './HumanDecisionPanel';
import './human-continuation.css';

/** 共享控制器持有真实请求，展示组件不生成命令、不调用模型或改写决定。 */
export function HumanContinuationForm({state}:{state:HumanContinuationView}){
  const attempt=state.record?.attempt,phase=attempt?.phase;
  if(!state.eligible&&!attempt)return null;
  return <section className="human-continuation" data-testid="human-continuation" data-phase={state.pending?'pending':phase??'ready'} data-scope-id={state.scopeId} data-wait-id={state.waitId}>
    <h4>按已保存决定继续</h4><p className="scope-goal-muted">将本次等待的最新意见交回主 Agent 重新规划。未覆盖的人工项仍需确认；旧等待的接受不会自动继承。</p>
    <ul data-testid="human-continuation-decisions">{state.decisions.map(record=><li key={record.decisionId} data-decision-id={record.decisionId}><strong>{humanDecisionLabels[record.decision]} · {record.proof.source.criterion.text}</strong><p>{record.comment||'未附加意见'}</p></li>)}</ul>
    <p className="scope-goal-muted" data-testid="human-continuation-model">{state.modelLabel}</p>
    {state.error&&<p role="alert" data-testid="human-continuation-error">{state.error}</p>}
    {phase==='rejected'&&<p role="alert" data-testid="human-continuation-error">本次接续未受理，原等待和人工意见保留：{attempt?.error}</p>}
    {phase==='unknown'&&<p role="status" data-testid="human-continuation-unknown">启动结果未确认，保留原请求：{attempt?.error||'请查询提交结果。'}</p>}
    {phase==='accepted'&&<p role="status" data-testid="human-continuation-accepted" data-continuation-id={attempt?.receipt?.continuation.continuationId}>已受理按决定继续。执行及验收结果以当前目标和任务图为准。</p>}
    {state.pending&&<p role="status">正在确认本次接续…</p>}
    <div className="human-continuation-actions">
      {state.eligible&&(!attempt||phase==='rejected')&&<button data-testid="human-continuation-submit" disabled={!state.canSubmit} onClick={()=>void state.submit()}>按以上决定继续</button>}
      {(phase==='unknown'||phase==='accepted'||phase==='submitting')&&<button data-testid="human-continuation-query" disabled={state.pending} onClick={()=>void state.query()}>查询接续结果</button>}
      {phase==='unknown'&&state.canRetry&&<button data-testid="human-continuation-retry" disabled={state.pending} onClick={()=>void state.retry()}>重试原请求</button>}
    </div>
    {attempt&&<details><summary>接续标识</summary><code>{attempt.request.commandId}</code></details>}
  </section>;
}
