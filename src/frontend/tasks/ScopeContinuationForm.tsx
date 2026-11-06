/**
 * 作用定位：目标卡片中的显式纯文本补充入口，展示已冻结请求、查询与同命令重试。
 * 设计原因：补充原目标独立于普通聊天队列，受理与模型运行分开；历史只读，结果未知不能换正文重发，也不包含人工批准或附件操作。
 */
import type {ScopeContinuationView} from './useScopeContinuation';

/** 所有操作交给主会话唯一控制器；两处表单不会各自生成命令或保存独立草稿。 */
export function ScopeContinuationForm({state}:{state:ScopeContinuationView}){
  const attempt=state.record?.attempt,phase=attempt?.phase;
  return <div className="scope-continuation" data-testid="scope-continuation" data-continuation-phase={state.pending?'pending':phase??'draft'}>
    <h4>补充原目标</h4><p className="scope-goal-muted">本入口仅补充原目标，不代表人工验收；聊天输入仍用于排队新任务。</p>
    <textarea aria-label="目标补充说明" data-testid="scope-continuation-input" value={state.text} readOnly={!state.editable} maxLength={64000} placeholder="补充缺少的信息，继续原目标…" onChange={event=>state.edit(event.target.value)}/>
    <p className="scope-goal-muted" data-testid="scope-continuation-model">{state.modelLabel}</p>
    {state.error&&<p role="alert">{state.error}</p>}
    {phase==='rejected'&&<p role="alert">补充未受理，草稿已保留：{attempt?.error}</p>}
    {phase==='unknown'&&<p role="status" data-testid="scope-continuation-unknown">提交结果尚未确认：{attempt?.error||'请查询原请求结果。'}</p>}
    {phase==='accepted'&&<p role="status" data-testid="scope-continuation-accepted">{attempt?.receipt?.scopeStatus==='closed'?'补充已受理，目标周期已结束。':'补充已受理；执行状态以当前目标和任务视图为准。'}</p>}
    {state.pending&&<p role="status">正在确认本次补充…</p>}
    <div className="scope-continuation-actions">
      {state.editable&&(!attempt||phase==='rejected')&&<button data-testid="scope-continuation-submit" disabled={!state.canSubmit} onClick={()=>void state.submit()}>补充并继续</button>}
      {(phase==='unknown'||phase==='accepted'||phase==='submitting')&&<button data-testid="scope-continuation-query" disabled={state.pending} onClick={()=>void state.query()}>查询提交状态</button>}
      {phase==='unknown'&&state.canRetry&&<button data-testid="scope-continuation-retry" disabled={state.pending} onClick={()=>void state.retry()}>原请求重试</button>}
    </div>
    {attempt&&<details><summary>本次提交标识</summary><code>{attempt.request.commandId}</code></details>}
  </div>;
}
