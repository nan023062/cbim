/**
 * 目标分配分开展示登记岗位与自动兜底原因，human 验收状态仍由真实决定驱动。
 * 作用定位：复用展示本轮真实目标、冻结岗位分配、逐项审阅及历史周期，供主对话摘要和任务根详情使用。
 * 设计原因：周期状态、冻结软限额与模型声明分开呈现；替代关系只定位本周期真实节点，不生成派发边或迁移旧成果。岗位、模型和显式流程只读原计划，人工意见与继续各自独立。
 * 接续历史：展示已受理资料与明确保留的成员清单；等待没有模型占用，继续仍须后台重核，不把保留或接收当作验收。
 * 逐请求摘要固定绑定所选周期和当前图身份，只在用户刷新时读取，历史目标不借全局设置补新模式。
 */
import type {ScopeGoalState} from './scope-state';
import {Icon} from '../components/Icon';
import {ScopeContinuationForm} from './ScopeContinuationForm';
import {ContinuationAttachmentHistory} from './ContinuationAttachmentHistory';
import type {ScopeContinuationView} from './useScopeContinuation';
import {ScopeReplanForm} from './ScopeReplanForm';
import {ScopeBudgetPanel} from './ScopeBudgetPanel';
import {ScopeActiveInputs} from './ScopeActiveInputs';
import type {ScopeReplanView} from './useScopeReplan';
import {HumanDecisionPanel} from './HumanDecisionPanel';
import type {HumanDecisionsView} from './useHumanDecisions';
import {HumanContinuationForm} from './HumanContinuationForm';
import type {HumanContinuationView} from './useHumanContinuation';
import {isHumanContinuation} from '../../bridge/contracts/human-continue';
import {OwnerExecutionDetails,AutomaticExecutionDetails} from './OwnerExecutionDetails';
import './scope-goal.css';

/** compact 仅改变默认展开状态；testId 支持对话与任务详情稳定定位，不影响业务状态。 */
export interface ScopeGoalPanelProps {state:ScopeGoalState;compact?:boolean;testId?:string;/** 仅定位已同步的本周期节点，不触发工具、恢复或授权。 */onSelectTask?:(id:string)=>void;/** 两处卡片共享主会话控制器；缺省为纯只读展示。 */continuation?:ScopeContinuationView;/** 正式业务新目标独立于只读核实和等待补充。 */replan?:ScopeReplanView;/** 人工意见与执行分离；两处卡片共用持久草稿和原命令。 */humanDecisions?:HumanDecisionsView;/** 明确把已保存决定交回主调度，不构造新用户正文。 */humanContinuation?:HumanContinuationView}
const shortId=(value:string)=>value.length>20?value.slice(0,8)+'…'+value.slice(-6):value;
const reviewLabels={complete:'完成申请',replan:'继续重规划',blocked:'报告阻塞',awaiting_user:'需要用户补充'};
/** 只有所选周期、任务图和唯一节点归属一致才可导航；缺失历史保留 ID，不猜相近名称。 */
export function goalTaskReference(state:ScopeGoalState,taskId:string){
  const scope=state.selectedScope,graph=state.graph;
  if(!scope||scope.scopeId!==state.selectedScopeId||!graph||graph.identity.workspaceId!==scope.workspaceId||graph.identity.rootSessionId!==scope.rootSessionId)return;
  const matches=graph.tasks.filter(task=>task.taskId===taskId);
  const task=matches.length===1?matches[0]:undefined;
  if(task?.scopeId===scope.scopeId&&task.identity.workspaceId===scope.workspaceId&&task.identity.rootSessionId===scope.rootSessionId)return task;
}
function GoalTaskReference({state,taskId,onSelectTask}:{state:ScopeGoalState;taskId:string;onSelectTask?:ScopeGoalPanelProps['onSelectTask']}){
  const task=goalTaskReference(state,taskId);
  return task&&onSelectTask?<button type="button" className="scope-task-reference" data-testid="scope-task-reference" data-task-id={taskId} title={task.goal} onClick={()=>onSelectTask(taskId)}>{task.assignee.name} · {shortId(taskId)}</button>:<code>{shortId(taskId)}</code>;
}
/** 所有“已满足”都明确是审阅声明；人工决定显示实际记录，不自动形成完成结论。 */
export function ScopeGoalPanel({state,compact=false,testId='scope-goal-panel',continuation,replan,humanDecisions,humanContinuation,onSelectTask}:ScopeGoalPanelProps){
  const {scopes,selectedScopeId,historyScopeId,selectedScope:scope,selectedGoalView:view,detailLoading,loading,error}=state;
  const summary=scopes.find(value=>value.scopeId===selectedScopeId),goal=scope?.goal,plan=goal?.plan,review=goal?.review;
  const title=plan?.objective??summary?.objective??summary?.inputPreview??'本轮目标';
  // origin 来自已受理周期；无计划只是执行进度，不撤销该周期的业务或只读核实身份。
  const noPlanText=summary?.origin==='business_replan'?(summary.status==='active'?'主 Agent 正在制定业务执行计划。':'本轮业务任务尚未登记执行计划。'):summary?.origin==='inspection'?(summary.status==='active'?'主 Agent 正在制定只读核实计划；核实期间保持只读权限。':'本轮只读核实尚未登记核实计划。'):'本轮没有登记业务目标计划；普通问答无需派发任务。';
  const sorted=[...scopes].reverse();
  return <section className={'scope-goal-panel'+(compact?' compact':'')} data-testid={testId} data-scope-id={selectedScopeId} data-goal-state={view.phase} aria-label="本轮目标与审阅">
    <header><div className={'scope-goal-status '+view.tone} data-testid="scope-goal-status"><Icon name={view.tone==='success'?'check':view.tone==='warning'?'warning':'flow'} size={14}/><strong>{view.label}</strong></div>
      {!!scopes.length&&<label className="scope-goal-history"><span>任务周期</span><select aria-label="选择目标历史" data-testid="scope-history-select" value={historyScopeId??''} onChange={event=>state.selectScope(event.target.value||undefined)}><option value="">当前 / 最新目标</option>{sorted.map(item=><option key={item.scopeId} value={item.scopeId}>{item.objective??item.inputPreview??'旧周期'} · {new Date(item.createdAt).toLocaleString()}</option>)}</select></label>}
    </header>
    {error&&<p className="scope-goal-alert" role="alert">{error}；保留上次已确认的目标记录。</p>}
    {!summary?<p className="scope-goal-muted">{loading?'正在同步本轮目标…':'当前会话还没有保存目标周期。普通聊天不会被补造成业务任务。'}</p>:<>
      <p className="scope-goal-title" title={title}>{title}</p>
      <ScopeBudgetPanel budget={summary.budget} waiting={summary.status==='waiting'} query={state.graph?{...state.graph.identity,scopeId:summary.scopeId}:undefined}/>
      {summary.activeInputStatus&&<p className="scope-goal-blocked" role="status" data-testid="scope-active-input-notice">{summary.activeInputStatus==='unknown'?'运行内补充的接收结果待核实，不能沿旧审阅完成或自动重发。':summary.status==='closed'?'本周期已结束，仍有补充未确认接收；重开不会自动发送。':'正在确认运行内补充，旧目标的完成与派工暂时停用。'}</p>}
      {summary.status==='waiting'&&<div className="scope-goal-waiting" data-testid="scope-goal-waiting"><p>{summary.wait?.reason}</p><p className="scope-goal-muted">在本目标卡片补充说明后继续。普通排队消息不会恢复本目标或代替人工验收。</p></div>}
      {continuation&&continuation.scopeId===selectedScopeId&&<ScopeContinuationForm state={continuation}/>}
      {replan&&replan.inspectionScopeId===selectedScopeId&&<ScopeReplanForm state={replan}/>}
      {humanDecisions&&humanDecisions.scopeId===selectedScopeId&&<HumanDecisionPanel state={humanDecisions}/>}
      {humanContinuation&&humanContinuation.scopeId===selectedScopeId&&!scope?.wait?.memberPause&&<HumanContinuationForm state={humanContinuation}/>}
      {summary.blockedReason&&<p role="status" className="scope-goal-blocked" data-testid="scope-goal-blocked">未完成原因：{summary.blockedReason}</p>}
      {summary.status==='closed'&&summary.outcome!=='completed'&&!summary.blockedReason&&<p className="scope-goal-muted">本周期已结束，不能将本轮输出视为目标完成。</p>}
      {!summary.hasGoal?<p className="scope-goal-muted">旧记录没有持久化原始输入或目标计划；这里不根据会话标题推断。</p>:<details className="scope-goal-details" key={selectedScopeId} open={!compact} data-testid="scope-goal-details"><summary>查看目标计划与审阅<span>{summary.goalRevision===undefined?'':` · 第 ${summary.goalRevision} 版`}</span></summary>
        {detailLoading||!scope?<p role="status" className="scope-goal-muted">正在同步目标详情…</p>:<>
          {scope.wait&&<div className="scope-goal-section" data-testid="scope-goal-wait-detail"><h4>{scope.status==='waiting'?'等待补充原因':'等待记录'}</h4><p className="scope-goal-wait-reason">{scope.wait.reason}</p><p className="scope-goal-muted">记录于 {new Date(scope.wait.createdAt).toLocaleString()} · 目标第 {scope.wait.goalRevision} 版</p>{scope.wait.memberPause&&<div data-testid="scope-member-pause"><h5>{scope.status==='waiting'?'已保留的成员任务':'本次等待曾保留的成员任务'}</h5><p className="scope-goal-muted">{scope.status==='waiting'?'重启后仍保持等待，不占用模型。点击“补充并继续”后，重新核实岗位、知识、原会话和文件；主调度再明确安排原任务。':'等待已经结束；原检查点与后继记录保持，不能从历史重新启动。'}</p><ul>{scope.wait.memberPause.tasks.map(ref=><li key={ref.taskId}>{ref.kind==='checkpoint'?'可靠检查点':'未启动后继'} · <GoalTaskReference state={state} taskId={ref.taskId} onSelectTask={onSelectTask}/></li>)}</ul></div>}</div>}
          {goal?.blocked&&<div className="scope-goal-section" data-testid="scope-goal-blocked-detail"><h4>完整受阻原因</h4><p className="scope-goal-blocked">{goal.blocked.reason}</p></div>}
          <div className="scope-goal-section"><h4>本轮原始输入</h4><div className="scope-goal-input" data-testid="scope-goal-input">{goal!.input.message}</div>{goal!.input.attachmentIds.length>0&&<p className="scope-goal-muted">{goal!.input.attachmentIds.length} 份附件快照</p>}</div>
          {scope.activeInputs&&<ScopeActiveInputs items={scope.activeInputs}/>}
          {!!scope.continuations?.length&&<div className="scope-goal-section" data-testid="scope-goal-continuations"><h4>已受理的目标接续</h4>{scope.continuations.map(item=><div key={item.continuationId}><p className="scope-goal-metadata">输入第 {item.inputRevision} 版 · {new Date(item.acceptedAt).toLocaleString()}</p><div className="scope-goal-input">{isHumanContinuation(item)?<>系统按已保存人工决定接续 · {item.decisionIds.length} 条决定<br/><span className="scope-goal-muted">原始输入保留；此记录不是新增用户正文。</span></>:item.input.message}</div>{!isHumanContinuation(item)&&item.attachmentManifest&&<ContinuationAttachmentHistory manifest={item.attachmentManifest}/>}</div>)}</div>}
          {plan?<div className="scope-goal-section" data-testid="scope-goal-plan"><h4>目标计划 <small>第 {plan.revision} 版 · 输入第 {plan.inputRevision??1} 版</small></h4>{summary.needsReplan&&<p className="scope-goal-muted">此计划早于最新补充，等待主 Agent 更新。</p>}<p>{plan.objective}</p><p className="scope-goal-muted">{plan.reason}</p>
            {plan.constraints.length>0&&<><h5>约束</h5><ul>{plan.constraints.map((item,index)=><li key={index}>{item}</li>)}</ul></>}
            <h5>验收要求</h5><ol className="scope-goal-criteria">{plan.criteria.map(criterion=>{const check=review?.checks.find(item=>item.criterionId===criterion.id);return <li key={criterion.id}><div><strong>{criterion.text}</strong><span className="scope-goal-kind">{criterion.kind==='human'?'人工确认':'证据核验'}</span></div><p className="scope-goal-muted">{criterion.kind==='human'?(check?.outcome==='satisfied'&&check.evidence.some(value=>value.kind==='human-decision')?'主 Agent 已引用人工决定并复核当前依据':scope.humanDecisions?.records.some(value=>value.criterionId===criterion.id)?'已有人工作出决定；请查看记录与当时依据，不代表整体目标完成':'尚未取得人工验收决定'):check?.outcome==='satisfied'?'主 Agent 报告已满足，有证据引用':check?.outcome==='unmet'?'尚未满足':check?.outcome==='needs_human'?'需要人工判断':'尚未审阅'}</p>{check?.reason&&<p>{check.reason}</p>}</li>})}</ol>
            <h5>责任分配</h5><ul className="scope-goal-assignments">{plan.assignments.map((item,index)=><li key={index}><strong>{item.agentName}</strong><p>{item.moduleNames.length?item.moduleNames.join('、'):'团队 / 业务知识治理'}</p>{item.fallbackBinding?<AutomaticExecutionDetails binding={item.fallbackBinding} workspaceId={scope.workspaceId} scopeId={scope.scopeId} agentId={item.agentId} moduleIds={item.moduleIds}/>:item.ownerBinding?<OwnerExecutionDetails binding={item.ownerBinding} workspaceId={scope.workspaceId} agentId={item.agentId} moduleIds={item.moduleIds}/>:item.agentId!=='cbim:main'&&<p className="scope-goal-muted" data-testid="goal-owner-legacy">旧分配没有岗位绑定；新业务派发须按当前模块负责人重新规划。</p>}{item.workflowSelections?.map(selection=><p className="scope-goal-muted" key={selection.moduleId} data-testid="goal-workflow-selection" data-module-id={selection.moduleId} data-workflow-id={selection.workflowId}>指定流程：{item.moduleNames[item.moduleIds.indexOf(selection.moduleId)]??selection.moduleId} · {selection.workflowId}</p>)}<p className="scope-goal-muted">{item.reason}</p><small>对应验收：{item.criterionIds.map(id=>plan.criteria.find(criterion=>criterion.id===id)?.text??id).join('；')}</small></li>)}</ul>
          </div>:<p className="scope-goal-muted">{noPlanText}</p>}
          {review&&<div className="scope-goal-section" data-testid="scope-goal-review"><h4>目标审阅 <small>第 {review.revision} 版 · {reviewLabels[review.decision]}</small></h4><p>{review.reason}</p>{review.decision==='complete'&&<p className="scope-goal-muted">{scope.status==='closed'&&scope.outcome==='completed'?'程序已核验证据、任务终态及适用的人工决定；完成范围以逐项审阅为准。':'这是完成申请，仍需等待主运行结束和程序复核。'}</p>}
            {review.gaps.length>0&&<><h5>剩余缺口</h5><ul>{review.gaps.map((gap,index)=><li key={index}>{gap}</li>)}</ul></>}
            {review.checks.some(item=>item.evidence.length>0)&&<details className="scope-goal-evidence"><summary>查看证据引用</summary>{review.checks.map(item=>item.evidence.length>0&&<div key={item.criterionId}><p><strong>{plan?.criteria.find(criterion=>criterion.id===item.criterionId)?.text??item.criterionId}</strong></p>{item.evidence.map((evidence,index)=><p key={index}>{evidence.kind==='human-decision'?`人工决定 ${shortId(evidence.decisionId)} · 接续 ${shortId(evidence.continuationId)}`:evidence.kind==='main-knowledge'?'主 Agent 知识提交':`成员任务 ${shortId(evidence.taskId)} · 运行 ${shortId(evidence.runId)}`}<br/><span className="scope-goal-muted">{evidence.kind==='human-decision'?'本机明确决定经当前接续与成果复核':`工具回执：${evidence.toolCallIds.join('、')}`}</span></p>)}</div>)}</details>}
            {review.superseded.length>0&&<><h5>原任务与替代成果</h5><p className="scope-goal-muted">点击查看各自执行记录；替代审阅不更改原负责人或任务连线。</p><ul data-testid="scope-superseded-tasks">{review.superseded.map(item=><li key={item.taskId}><span>原任务 </span><GoalTaskReference state={state} taskId={item.taskId} onSelectTask={onSelectTask}/><span> → 新成果 </span>{item.replacementTaskIds.map(id=><GoalTaskReference key={id} state={state} taskId={id} onSelectTask={onSelectTask}/>)}<p>{item.reason}</p></li>)}</ul></>}
          </div>}
          <p className="scope-goal-metadata">创建于 {new Date(scope.createdAt).toLocaleString()}{scope.closedAt?` · 结束于 ${new Date(scope.closedAt).toLocaleString()}`:''}</p>
        </>}
      </details>}
    </>}
  </section>;
}
