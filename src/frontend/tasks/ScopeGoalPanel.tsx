/**
 * 作用定位：复用展示本轮真实目标、静态角色分配、逐项审阅及历史周期，供主对话摘要和任务根详情使用。
 * 设计原因：同一后端周期共享状态文案，普通问答、旧记录、完成申请、持久等待和可靠关闭分别呈现；展开只读取已同步详情，不触发调度或验收。
 */
import type {ScopeGoalState} from './scope-state';
import {Icon} from '../components/Icon';
import './scope-goal.css';

/** compact 仅改变默认展开状态；testId 支持对话与任务详情稳定定位，不影响业务状态。 */
export interface ScopeGoalPanelProps {state:ScopeGoalState;compact?:boolean;testId?:string}
const shortId=(value:string)=>value.length>20?value.slice(0,8)+'…'+value.slice(-6):value;
const reviewLabels={complete:'完成申请',replan:'继续重规划',blocked:'报告阻塞',awaiting_user:'需要用户补充'};
/** 所有“已满足”都明确是审阅声明；人工项没有真实批准接口时只能显示待确认。 */
export function ScopeGoalPanel({state,compact=false,testId='scope-goal-panel'}:ScopeGoalPanelProps){
  const {scopes,selectedScopeId,historyScopeId,selectedScope:scope,selectedGoalView:view,detailLoading,loading,error}=state;
  const summary=scopes.find(value=>value.scopeId===selectedScopeId),goal=scope?.goal,plan=goal?.plan,review=goal?.review;
  const title=plan?.objective??summary?.objective??summary?.inputPreview??'本轮目标';
  const sorted=[...scopes].reverse();
  return <section className={'scope-goal-panel'+(compact?' compact':'')} data-testid={testId} data-scope-id={selectedScopeId} data-goal-state={view.phase} aria-label="本轮目标与审阅">
    <header><div className={'scope-goal-status '+view.tone} data-testid="scope-goal-status"><Icon name={view.tone==='success'?'check':view.tone==='warning'?'warning':'flow'} size={14}/><strong>{view.label}</strong></div>
      {!!scopes.length&&<label className="scope-goal-history"><span>任务周期</span><select aria-label="选择目标历史" data-testid="scope-history-select" value={historyScopeId??''} onChange={event=>state.selectScope(event.target.value||undefined)}><option value="">当前 / 最新目标</option>{sorted.map(item=><option key={item.scopeId} value={item.scopeId}>{item.objective??item.inputPreview??'旧周期'} · {new Date(item.createdAt).toLocaleString()}</option>)}</select></label>}
    </header>
    {error&&<p className="scope-goal-alert" role="alert">{error}；保留上次已确认的目标记录。</p>}
    {!summary?<p className="scope-goal-muted">{loading?'正在同步本轮目标…':'当前会话还没有保存目标周期。普通聊天不会被补造成业务任务。'}</p>:<>
      <p className="scope-goal-title" title={title}>{title}</p>
      {summary.status==='waiting'&&<div className="scope-goal-waiting" data-testid="scope-goal-waiting"><p>{summary.wait?.reason}</p><p className="scope-goal-muted">恢复入口尚未接通，可取消当前任务后另发任务。普通排队消息不会恢复本目标或代替人工验收。</p></div>}
      {summary.blockedReason&&<p role="status" className="scope-goal-blocked" data-testid="scope-goal-blocked">未完成原因：{summary.blockedReason}</p>}
      {summary.status==='closed'&&summary.outcome!=='completed'&&!summary.blockedReason&&<p className="scope-goal-muted">本周期已结束，不能将本轮输出视为目标完成。</p>}
      {!summary.hasGoal?<p className="scope-goal-muted">旧记录没有持久化原始输入或目标计划；这里不根据会话标题推断。</p>:<details className="scope-goal-details" key={selectedScopeId} open={!compact} data-testid="scope-goal-details"><summary>查看目标计划与审阅<span>{summary.goalRevision===undefined?'':` · 第 ${summary.goalRevision} 版`}</span></summary>
        {detailLoading||!scope?<p role="status" className="scope-goal-muted">正在同步目标详情…</p>:<>
          {scope.wait&&<div className="scope-goal-section" data-testid="scope-goal-wait-detail"><h4>{scope.status==='waiting'?'等待补充原因':'等待记录'}</h4><p className="scope-goal-wait-reason">{scope.wait.reason}</p><p className="scope-goal-muted">记录于 {new Date(scope.wait.createdAt).toLocaleString()} · 目标第 {scope.wait.goalRevision} 版</p></div>}
          {goal?.blocked&&<div className="scope-goal-section" data-testid="scope-goal-blocked-detail"><h4>完整受阻原因</h4><p className="scope-goal-blocked">{goal.blocked.reason}</p></div>}
          <div className="scope-goal-section"><h4>本轮原始输入</h4><div className="scope-goal-input" data-testid="scope-goal-input">{goal!.input.message}</div>{goal!.input.attachmentIds.length>0&&<p className="scope-goal-muted">{goal!.input.attachmentIds.length} 份附件快照</p>}</div>
          {plan?<div className="scope-goal-section" data-testid="scope-goal-plan"><h4>目标计划 <small>第 {plan.revision} 版</small></h4><p>{plan.objective}</p><p className="scope-goal-muted">{plan.reason}</p>
            {plan.constraints.length>0&&<><h5>约束</h5><ul>{plan.constraints.map((item,index)=><li key={index}>{item}</li>)}</ul></>}
            <h5>验收要求</h5><ol className="scope-goal-criteria">{plan.criteria.map(criterion=>{const check=review?.checks.find(item=>item.criterionId===criterion.id);return <li key={criterion.id}><div><strong>{criterion.text}</strong><span className="scope-goal-kind">{criterion.kind==='human'?'人工确认':'证据核验'}</span></div><p className="scope-goal-muted">{criterion.kind==='human'?'尚未取得人工验收决定':check?.outcome==='satisfied'?'主 Agent 报告已满足，有证据引用':check?.outcome==='unmet'?'尚未满足':check?.outcome==='needs_human'?'需要人工判断':'尚未审阅'}</p>{check?.reason&&<p>{check.reason}</p>}</li>})}</ol>
            <h5>责任分配</h5><ul className="scope-goal-assignments">{plan.assignments.map((item,index)=><li key={index}><strong>{item.agentName}</strong><p>{item.moduleNames.length?item.moduleNames.join('、'):'团队 / 业务知识治理'}</p><p className="scope-goal-muted">{item.reason}</p><small>对应验收：{item.criterionIds.map(id=>plan.criteria.find(criterion=>criterion.id===id)?.text??id).join('；')}</small></li>)}</ul>
          </div>:<p className="scope-goal-muted">本轮没有登记业务目标计划；普通问答无需派发任务。</p>}
          {review&&<div className="scope-goal-section" data-testid="scope-goal-review"><h4>目标审阅 <small>第 {review.revision} 版 · {reviewLabels[review.decision]}</small></h4><p>{review.reason}</p>{review.decision==='complete'&&<p className="scope-goal-muted">{scope.status==='closed'&&scope.outcome==='completed'?'程序已核验证据与任务终态；目标符合性由主 Agent 审阅，不表示人工验收。':'这是完成申请，仍需等待主运行结束和程序复核。'}</p>}
            {review.gaps.length>0&&<><h5>剩余缺口</h5><ul>{review.gaps.map((gap,index)=><li key={index}>{gap}</li>)}</ul></>}
            {review.checks.some(item=>item.evidence.length>0)&&<details className="scope-goal-evidence"><summary>查看证据引用</summary>{review.checks.map(item=>item.evidence.length>0&&<div key={item.criterionId}><p><strong>{plan?.criteria.find(criterion=>criterion.id===item.criterionId)?.text??item.criterionId}</strong></p>{item.evidence.map((evidence,index)=><p key={index}>{evidence.kind==='main-knowledge'?'主 Agent 知识提交':`成员任务 ${shortId(evidence.taskId)} · 运行 ${shortId(evidence.runId)}`}<br/><span className="scope-goal-muted">工具回执：{evidence.toolCallIds.join('、')}</span></p>)}</div>)}</details>}
            {review.superseded.length>0&&<><h5>失败 / 过期任务替代</h5><ul>{review.superseded.map(item=><li key={item.taskId}><code>{shortId(item.taskId)}</code> → {item.replacementTaskIds.map(shortId).join('、')}<p>{item.reason}</p></li>)}</ul></>}
          </div>}
          <p className="scope-goal-metadata">创建于 {new Date(scope.createdAt).toLocaleString()}{scope.closedAt?` · 结束于 ${new Date(scope.closedAt).toLocaleString()}`:''}</p>
        </>}
      </details>}
    </>}
  </section>;
}
