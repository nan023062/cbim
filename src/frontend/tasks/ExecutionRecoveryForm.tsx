/**
 * 作用定位：异常执行报告后的显式新周期入口，将用户观察与新的只读核实目标分开呈现。
 * 设计原因：观察不是对旧结果的更正或人工批准；只有确认旧核实周期关闭并完整归档后才能准备新草稿。报告清空时仍保留表单和历史，未知结果只能查询原请求。
 */
import type {ExecutionRecoveryView} from './useExecutionRecovery';

/** 表单只转交明确点击；展示、编辑和挂载均不触发模型任务。 */
export function ExecutionRecoveryForm({state}:{state:ExecutionRecoveryView}){
  if(!state.visible)return null;
  const attempt=state.record?.attempt,phase=attempt?.phase;
  return <section className="execution-recovery" data-testid="execution-recovery-form" data-recovery-phase={state.pending?'pending':phase??'draft'}>
    <h4>新建只读核实任务</h4><p className="member-muted">在当前会话创建新周期，核实已有操作的实际影响。旧任务和原始记录保留，不重放旧工具，不代表人工验收。</p>
    <label>你的观察<textarea data-testid="execution-recovery-observation" aria-label="你的观察" maxLength={64000} readOnly={!state.editable} value={state.observation} placeholder="填写已看到的现象；尚未确认的情况请说明未知。" onChange={event=>state.edit({observation:event.target.value,message:state.message})}/></label>
    <label>新的核实目标<textarea data-testid="execution-recovery-input" aria-label="新的核实目标" maxLength={64000} readOnly={!state.editable} value={state.message} placeholder="例如：只读检查哪些文件发生改变，并列出仍未确认的影响。" onChange={event=>state.edit({observation:state.observation,message:event.target.value})}/></label>
    <p className="member-muted" data-testid="execution-recovery-model">{state.modelLabel}</p>
    {!attempt&&state.reason&&<p className="member-muted">{state.reason}</p>}
    {state.error&&<p role="alert" className="member-error">{state.error}</p>}
    {phase==='rejected'&&<p role="alert">请求未受理，草稿已保留：{attempt?.error}{state.reason&&'；'+state.reason}</p>}
    {phase==='unknown'&&<p role="status" data-testid="execution-recovery-unknown">创建结果尚未确认：{attempt?.error||'请查询原请求。'}</p>}
    {phase==='accepted'&&<p role="status" data-testid="execution-recovery-accepted">{attempt?.receipt?.scopeStatus==='closed'?'新核实周期已受理，周期已结束。':'新核实周期已受理；是否正在执行以当前目标和任务图为准。'}</p>}
    {phase==='accepted'&&attempt?.error&&<p role="alert">{attempt.error}；保留上次受理回执。</p>}
    {state.pending&&<p role="status">正在确认本次核实请求…</p>}
    <div className="execution-recovery-actions">
      {(!attempt||phase==='rejected')&&<button data-testid="execution-recovery-submit" disabled={!state.canSubmit} onClick={()=>void state.submit()}>新建只读核实任务</button>}
      {(phase==='unknown'||phase==='accepted'||phase==='submitting')&&<button data-testid="execution-recovery-query" disabled={state.pending} onClick={()=>void state.query()}>查询创建状态</button>}
      {phase==='unknown'&&<button data-testid="execution-recovery-retry" disabled={state.pending} onClick={()=>void state.retry()}>原请求重试</button>}
      {phase==='accepted'&&<button data-testid="execution-recovery-view" onClick={state.showCreated}>查看新目标</button>}
      {phase==='accepted'&&attempt?.receipt?.scopeStatus==='closed'&&<button data-testid="execution-recovery-prepare" disabled={!state.canPrepare} onClick={()=>void state.prepare()}>准备再次核实</button>}
    </div>
    {phase==='accepted'&&attempt?.receipt?.scopeStatus==='closed'&&<p className="member-muted">再次核实会先确认此周期已结束并保存原请求。准备后须重新核实来源报告，再明确提交新任务。{!state.canPrepare&&!state.pending&&state.reason&&' '+state.reason}</p>}
    {attempt&&<details><summary>请求与来源标识</summary><p>命令 <code>{attempt.request.commandId}</code></p><p>来源任务 <code>{attempt.request.source.taskId}</code></p><p>原报告依据 <code>{attempt.request.source.reportBasis}</code></p></details>}
    {!!state.record?.history?.length&&<details className="execution-recovery-history" data-testid="execution-recovery-history"><summary>已保存的核实历史（{state.record.history.length}）</summary>{state.record.history.map(item=><article data-testid="execution-recovery-history-item" key={item.request.commandId}><p>已受理 · 周期已结束</p><p>命令 <code>{item.request.commandId}</code></p><p>核实目标：{item.request.input.message}</p><p>用户观察：{item.request.observation.text}</p><p>目标周期 <code>{item.receipt.scopeId}</code> · 运行 <code>{item.receipt.recovery.runId}</code></p><p>来源依据 <code>{item.request.source.reportBasis}</code></p></article>)}</details>}
  </section>;
}
