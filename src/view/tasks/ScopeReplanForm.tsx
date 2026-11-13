/**
 * 作用定位：已完成只读核实周期之后的正式业务新目标表单，复用于对话目标卡和任务根。
 * 设计原因：条件预览只核对真实来源、模块和继承约束；新目标及执行权限由用户另行明确提交，不能把核实完成当作旧业务验收或人工批准。
 * 处置关联：新来源须先明确选择新业务修复处置；切换处置使预览失效，旧无关联核实仍按原协议读取。
 */
import type {ScopeReplanView} from './useScopeReplan';
import {EffectObservationPanel} from './EffectObservationPanel';
import {effectSelectionKey} from './effect-observation-state';
import './scope-replan.css';

/** 纯显示组件；显示、展开及权限选择均不调用模型，只有显式提交才创建独立业务周期。 */
export function ScopeReplanForm({state}:{state:ScopeReplanView}){
  if(!state.visible)return null;
  const attempt=state.record?.attempt,phase=attempt?.phase,preview=state.previewState?.result;
  return <section className="scope-replan" data-testid="scope-replan-form" data-inspection-scope={state.inspectionScopeId} data-replan-phase={state.pending?'pending':phase??'draft'}>
    <h4>新建业务任务</h4><p className="scope-goal-muted">依据这次只读核实，在当前会话创建独立业务周期。保留旧记录，由成员执行新的业务工作；不会重放旧任务或更改原核实周期的只读权限。</p>
    {state.effectSource&&<details className="replan-effect-source" data-testid="replan-effect-source"><summary>原调用影响与修复处置{state.dispositionId?' · 已明确选择':''}</summary><p>先保存或选择“新业务修复”处置。保存不启动任务，最终创建仍须通过以下条件核验。</p><EffectObservationPanel key={effectSelectionKey(state.effectSource)} identity={state.effectSource} anchor={state.effectAnchor??''}/></details>}
    {state.dispositionId&&<p data-testid="replan-disposition-link">本次新业务关联处置 <code>{state.dispositionId}</code></p>}
    <label>新业务目标<textarea data-testid="scope-replan-input" aria-label="新业务目标" maxLength={64000} readOnly={!state.editable} value={state.message} placeholder="说明这次需要实现的业务结果及约束。" onChange={event=>state.edit(event.target.value,state.permission)}/></label>
    <label>新任务权限<select data-testid="scope-replan-permission" aria-label="新业务任务权限" disabled={!state.editable} value={state.permission} onChange={event=>state.edit(state.message,event.target.value as 'ask'|'execute')}><option value="ask">默认权限 · 操作前确认</option><option value="execute">完全访问 · 允许执行</option></select></label>
    <p className="scope-goal-muted" data-testid="scope-replan-model">{state.modelLabel}</p>
    {state.reason&&!attempt&&<p className="scope-goal-muted">{state.reason}</p>}
    {state.error&&<p role="alert">{state.error}</p>}
    {state.previewState?.loading&&<p role="status" data-testid="scope-replan-preview-loading">正在核验新任务条件…</p>}
    {state.previewState?.error&&<p role="alert" data-testid="scope-replan-preview-error">{state.previewState.error}</p>}
    {preview&&<div className="scope-replan-proof" data-testid="scope-replan-proof" data-eligible={preview.eligible}>
      <p>{preview.eligible?'当前条件已核验，提交时还会再次核对。':'当前条件不足，暂不能创建新业务周期。'}</p>
      <p className="scope-goal-muted">这是来源与约束核验，不是已经生成的执行计划。</p>
      <h5>必须覆盖的模块</h5>{preview.requiredModules.length?<ul data-testid="scope-replan-modules">{preview.requiredModules.map(item=><li key={item.moduleId}>{item.name} <code>{item.moduleId}</code></li>)}</ul>:<p className="scope-goal-muted">尚未核实到完整模块范围。</p>}
      {!!preview.inheritedHuman.length&&<><h5>保留的人工验收要求</h5><ul data-testid="scope-replan-human">{preview.inheritedHuman.map(item=><li key={item.sourceScopeId+':'+item.id}><p>{item.text}</p><small>来源周期 {item.sourceScopeId} · 目标第 {item.sourceGoalRevision} 版 · 尚未取得人工批准</small></li>)}</ul><p className="scope-goal-muted">创建新任务不会批准或删除这些要求。</p></>}
      {!!preview.issues.length&&<ul data-testid="scope-replan-issues">{preview.issues.map((issue,index)=><li key={issue.code+':'+index}>{issue.message}<small>{issue.code}</small></li>)}</ul>}
      {preview.basis&&<details><summary>条件核验依据</summary><code>{preview.basis}</code><p>核实目标第 {preview.inspectionGoalRevision} 版 · 知识版本 {preview.knowledgeRevision}</p></details>}
    </div>}
    {phase==='rejected'&&<p role="alert">请求未受理，草稿已保留：{attempt?.error}</p>}
    {phase==='unknown'&&<p role="status" data-testid="scope-replan-unknown">创建结果尚未确认：{attempt?.error||'请查询原请求。'}</p>}
    {phase==='accepted'&&<p role="status" data-testid="scope-replan-accepted">{attempt?.receipt?.scopeStatus==='closed'?'新业务周期已受理，周期已结束。':'新业务周期已受理；执行状态以当前目标与任务图为准。'}</p>}
    {phase==='accepted'&&attempt?.error&&<p role="alert">{attempt.error}；保留上次受理回执。</p>}
    {state.pending&&<p role="status">正在确认本次业务请求…</p>}
    <div className="scope-replan-actions">
      {(!attempt||phase==='rejected')&&<><button data-testid="scope-replan-preview" disabled={!state.canPreview} onClick={()=>void state.preview()}>核验新任务条件</button><button data-testid="scope-replan-submit" disabled={!state.canSubmit} onClick={()=>void state.submit()}>创建新业务任务</button></>}
      {(phase==='accepted'||phase==='unknown'||phase==='submitting')&&<button data-testid="scope-replan-query" disabled={state.pending} onClick={()=>void state.query()}>查询创建状态</button>}
      {phase==='unknown'&&<button data-testid="scope-replan-retry" disabled={state.pending} onClick={()=>void state.retry()}>原请求重试</button>}
      {phase==='accepted'&&<button data-testid="scope-replan-view" onClick={state.showCreated}>查看新目标</button>}
    </div>
    {attempt&&<details><summary>请求与核实来源</summary><p>命令 <code>{attempt.request.commandId}</code></p><p>来源周期 <code>{attempt.request.source.inspectionScopeId}</code></p><p>条件依据 <code>{attempt.request.source.expectedBasis}</code></p></details>}
  </section>;
}
