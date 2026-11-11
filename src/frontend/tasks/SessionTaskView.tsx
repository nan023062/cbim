/**
 * 作用定位：以节点流程图展示当前主会话的派发任务，并在选择根或任务后显示对应执行详情。
 * 设计原因：全局项目架构与会话派工分开；所选周期提供按需用量核对，读取不触发模型或持续扫日志。根详情共享目标、审阅与显式补充，整图保留并突出所选周期，持久等待不触发队列恢复。 人工决定接续与文本补充分开，共享意图但不共享自动启动权。
 * 职责边界：运行轮次不是派发节点；根审阅中的原任务/新成果只导航本周期真实节点，不新增连线或执行。正式业务重规划与只读核实各有独立控制器，新周期准入取真实开放状态。
 * 文件补偿：当前工作区实例沿真实会话传给成员详情；图身份不签发新的文件操作许可。
 * 异常核实：根与成员详情共享真实会话的显式观察/新核实入口，不用根节点伪造业务任务来源。
 * 停止入口：使用会话独立的停止在途状态，消息插入或附件准备忙碌时仍可停止。
 * 共享运行展示不持有恢复上下文；本页用 RunToolDetails 插槽显式组合原控制面板。
 */
import {useEffect,useState} from 'react';
import type {RunSummary,QueuedMessage} from '../../bridge/contracts/execution';
import type {GraphSnapshot} from '../../bridge/contracts/dispatch';
import {RunToolDetails} from '../conversation/RunToolDetails';
import {WorkStatus} from '../run-view/WorkStatus';
import {MessageQueue} from '../conversation/MessageQueue';
import {DispatchGraph,type DispatchRootView} from './DispatchGraph';
import {MemberTaskDetail} from './MemberTaskDetail';
import {ScopeGoalPanel} from './ScopeGoalPanel';
import {ScopeUsagePanel} from './ScopeUsagePanel';
import type {ScopeGoalState} from './scope-state';
import type {ScopeContinuationView} from './useScopeContinuation';
import type {ExecutionRecoveryContext} from './useExecutionRecovery';
import type {ScopeReplanView} from './useScopeReplan';
import type {HumanDecisionsView} from './useHumanDecisions';
import type {HumanContinuationView} from './useHumanContinuation';
import './task-graph.css';

/** 只接收当前工作区、当前会话的记录；草稿会话没有 taskId，因此没有运行历史。 */
export function sessionRuns(runs:RunSummary[],workspaceId:string,taskId?:string){return taskId?runs.filter(run=>run.task.workspaceId===workspaceId&&run.task.taskId===taskId):[]}
/** 根只是主会话显示锚点；主会话执行事实不能当作已派发给其他成员的业务任务。 */
export function sessionRoot(history:RunSummary[],taskId:string,pending:number,graph?:GraphSnapshot,scopeState?:ScopeGoalState,historyIssueCount=0):DispatchRootView{
  const latest=history.at(-1),status=latest?{running:'正在工作',completed:'本轮结束',cancelled:'已停止',failed:'执行失败',interrupted:'执行中断'}[latest.status]:historyIssueCount?'主会话记录待核实':'尚无可读记录';
  const selected=scopeState?.scopes.find(scope=>scope.scopeId===scopeState.selectedScopeId);
  // 有明确周期时绝不借用其他轮次的标题；legacy 缺少目标只能如实展示未知。
  const goal=selected?(selected.hasGoal?selected.objective??selected.inputPreview??'本轮目标':'旧周期 · 未保存原始目标'):latest?.taskProgress?.goal??latest?.task.goal??'当前会话';
  return {nodeId:graph?.root.nodeId??'session:'+taskId,name:graph?.root.agent.name??'主 Agent',goal,status:selected?scopeState!.selectedGoalView.label:status,running:selected?selected.status==='active':latest?.status==='running',runCount:history.length,pendingCount:pending,unreadableRunCount:historyIssueCount};
}
/** 主会话视图输入；图与日志由外层读取，本组件只过滤展示并转交显式操作。 */
export interface SessionTaskViewProps {
  workspaceId:string;
  /** 当前已打开的工作区所有者实例，仅供新的显式文件补偿；不从历史运行推导。 */
  workspaceInstanceId?:string;
  /** 主对话沿用的 taskId，在派发图中对应 rootSessionId；草稿尚无此值。 */
  taskId?:string;
  runs:RunSummary[];queued:QueuedMessage[];
  /** 后端报告的待核实轮次；记录可读数量不代表实际执行总次数，也不按缺口补造摘要。 */
  historyIssueCount?:number;
  /** 当前时间戳（毫秒），供根详情显示运行时长，不据此推断任务进度。 */
  now:number;busy:boolean;
  /** 只禁用重复停止，不借普通操作 busy 阻断正在插入消息时的停止。 */
  stopping?:boolean;
  onQueueChange:(id:string,action:string)=>void;onQueueContinue:()=>void;onChat:()=>void;onStop:()=>void;
  graph?:GraphSnapshot;graphLoading?:boolean;graphError?:string;onRefreshGraph?:()=>void;
  /** 与主对话共享目标摘要/选中详情，历史选择只突出节点，不移除其他周期或改变执行。 */
  scopeState?:ScopeGoalState;
  /** 与对话卡共享已冻结补充请求；不会在任务页重新创建控制器。 */
  continuation?:ScopeContinuationView;
  /** 与主对话共享正式业务新目标草稿和稳定请求；不会在任务根另外启动预览或模型。 */
  replan?:ScopeReplanView;
  /** 当前人工项的持久草稿与决定共享主对话控制器；保存不启动调度。 */
  humanDecisions?:HumanDecisionsView;
  /** 独立显式接续，不把保存意见或任务根选择变成启动动作。 */
  humanContinuation?:HumanContinuationView;
  /** 从历史报告新建只读核实周期；模型与真实开放周期来自主会话，历史选择不改变两者。 */
  recovery?:ExecutionRecoveryContext;
  /** 隐藏的会话仍保留节点选择，但其成员详情降低同步频率。 */
  active?:boolean;
  /** 根节点用 session:<rootSessionId>；业务节点用 taskId；undefined 关闭详情。 */
  selectedTaskId?:string;
  /** 提供时由外层控制选择以跨对话/任务页签保留；缺省时使用本组件局部选择。 */
  onSelectTask?:(id?:string)=>void;
}

/** 主根详情保留调度与知识治理的对话轮次、计划和停止入口；业务执行详情仅由任务节点展开。 */
function RootTaskDetail({history,pending,now,busy,stopping,onQueueChange,onQueueContinue,onStop,graph,scopeState,continuation,replan,humanDecisions,humanContinuation,recovery,onSelectTask,historyIssueCount=0}:Pick<SessionTaskViewProps,'now'|'busy'|'stopping'|'onQueueChange'|'onQueueContinue'|'onStop'|'graph'|'scopeState'|'continuation'|'replan'|'humanDecisions'|'humanContinuation'|'recovery'|'onSelectTask'|'historyIssueCount'>&{history:RunSummary[];pending:QueuedMessage[]}){
  // 旧局部运行计划没有 scope 归属，不能借历史目标选择把它冒充所选周期的目标计划。
  const progress=scopeState?.selectedScopeId?undefined:history.at(-1)?.taskProgress;
  // 身份来自后端保存的绑定；旧日志无该字段时明确未知，不用角色名补造通道。
  const bound=[...history].reverse().find(run=>run.conversationBinding),binding=bound?.conversationBinding;
  const conflicting=Boolean(binding&&(binding.workspaceId!==bound!.task.workspaceId||binding.rootSessionId!==bound!.task.taskId||graph&&binding.agentInstanceId!==graph.root.agent.agentInstanceId));
  const instance=graph?.root.agent.agentInstanceId??(!conflicting?binding?.agentInstanceId:undefined);
  const openScope=scopeState?.openScope,waiting=openScope?.status==='waiting';
  return <div className="root-task-detail" aria-label="主 Agent 调度详情" data-testid="root-task-detail">
    <h3>主 Agent</h3><p>已读 {history.length} 轮记录{historyIssueCount?` · ${historyIssueCount} 轮待核实`:''} · {pending.length} 条待执行</p>
    {scopeState&&<ScopeGoalPanel state={scopeState} testId="dispatch-root-goal" continuation={continuation} replan={replan} humanDecisions={humanDecisions} humanContinuation={humanContinuation} onSelectTask={onSelectTask}/>}
    {openScope&&<div>{scopeState!.selectedScopeId!==openScope.scopeId&&<p>{waiting?'当前另有待补充任务：':'当前另有任务运行：'}{openScope.objective??openScope.inputPreview??'当前周期'}</p>}<button data-testid="scope-stop" disabled={stopping} onClick={onStop}>{waiting?'取消当前任务':scopeState!.selectedScopeId===openScope.scopeId?'停止当前任务':'停止正在运行的任务'}</button></div>}
    <details className="member-scope" open><summary>主会话实例与通道</summary>
      {instance?<p>主 Agent 实例 <code>{instance}</code></p>:<p>历史记录未保存主 Agent 实例绑定。</p>}
      {conflicting?<p role="alert">主会话运行与任务图的实例身份不一致，请重新同步。</p>:binding?<p>对话通道 <code>{binding.agentSessionId}</code></p>:<p>历史记录未保存对话通道绑定，不按角色名称推断。</p>}
      {graph&&<p>调度通道 <code>{graph.root.agent.agentSessionId}</code></p>}
      <p>主 Agent 负责调度与知识治理；业务任务由独立执行 Agent 实例完成。</p>
    </details>
    {progress&&<article className="session-run" aria-label="执行计划"><h3>{progress.goal}</h3><p>计划版本 {progress.version} · {progress.state==='awaiting_review'?'交付待审阅':'执行与验证中'} · 尚未业务验收</p><p>{progress.reason}</p><ol>{progress.steps.map(step=><li key={step.id}><strong>{step.title}</strong> · {step.owner} · {{pending:'待处理',working:'进行中',reported_done:'已报告完成，待核验'}[step.state]}{step.evidence.length>0&&<details><summary>{step.evidence.length} 条工具回执</summary>{step.evidence.map(id=><p key={id}><code>{id}</code></p>)}</details>}</li>)}</ol><h4>验收要求</h4><ul>{progress.acceptance.map((item,index)=><li key={index}>{item}</li>)}</ul>{progress.delivery&&<><h4>交付候选</h4><p>{progress.delivery.summary}</p><ul>{progress.delivery.limitations.map((item,index)=><li key={index}>{item}</li>)}</ul></>}<details><summary>计划修订记录</summary>{history.flatMap(run=>run.events.filter(event=>event.type==='task.updated').map(event=><p key={run.runId+':'+event.seq}>{event.time} · {String((event.data.progress as {reason?:string})?.reason??'计划更新')}</p>))}</details></article>}
    <MessageQueue items={pending} busy={busy} continueDisabled={stopping||waiting||scopeState?.loading} onChange={onQueueChange} onContinue={onQueueContinue}/>
    {scopeState?.selectedScopeId&&history.length>0&&<h4>可读的主会话记录</h4>}
    {[...history].reverse().map((run,index)=><article className="session-run" key={run.runId}><h3>{run.source?.kind==='human_decisions'?'按已保存人工决定继续':String(run.events.find(event=>event.type==='run.started')?.data.message||run.task.goal).split('\n')[0]}</h3><small>已读记录 {history.length-index} · {run.events[0]?.time?new Date(run.events[0].time).toLocaleString():''}</small><WorkStatus run={run} now={now} renderToolDetails={selection=><RunToolDetails {...selection} recovery={recovery}/>}/>{run.status==='running'&&<button disabled={stopping} onClick={onStop}>停止本次执行</button>}{run.unresolvedTools.length>0&&<p role="alert">有 {run.unresolvedTools.length} 项操作尚需在对话中核实。</p>}<details><summary>执行标识</summary><code>{run.runId}</code></details></article>)}
    {!history.length&&<p>{historyIssueCount?'当前没有可读的主会话记录；待核实轮次与已有任务节点仍保留，不能据此判定未执行。':'当前尚无可读的主会话记录。'}</p>}
  </div>;
}

/** 主区域始终保留图；选择节点才挂载实时详情，关闭详情不停止后台任务。 */
export function SessionTaskView(props:SessionTaskViewProps){
  const {workspaceId,taskId,runs,queued,now,busy,onQueueChange,onQueueContinue,onChat,onStop,graph,graphLoading,graphError,onRefreshGraph,selectedTaskId,onSelectTask,scopeState}=props;
  const [localSelection,setLocalSelection]=useState<string>();
  useEffect(()=>setLocalSelection(undefined),[workspaceId,taskId]);
  const selected=onSelectTask?selectedTaskId:localSelection;
  const select=(id?:string)=>{setLocalSelection(id);onSelectTask?.(id)};
  const history=sessionRuns(runs,workspaceId,taskId),pending=taskId?queued.filter(message=>message.taskId===taskId):[];
  const matching=graph&&graph.identity.workspaceId===workspaceId&&graph.identity.rootSessionId===taskId?graph:undefined;
  const error=graph&&!matching?'任务图身份不匹配，请重新同步':graphError;
  const root=taskId?sessionRoot(history,taskId,pending.length,matching,scopeState,props.historyIssueCount):undefined;
  const selectedTask=matching?.tasks.find(task=>task.taskId===selected),rootSelected=Boolean(root&&selected===root.nodeId),hasDetail=rootSelected||Boolean(selectedTask);
  return <div className="session-task-view graph-mode" data-testid="session-task-view"><header><div><h2>任务流程</h2><p>当前会话 · {matching?.tasks.length??0} 个派发任务 · 已读 {history.length} 轮记录{props.historyIssueCount?` · ${props.historyIssueCount} 轮待核实`:''}</p></div><div className="task-view-actions">{onRefreshGraph&&<button onClick={onRefreshGraph} disabled={graphLoading} aria-label="刷新任务图">刷新</button>}<button onClick={onChat}>返回对话</button></div></header>
    {error&&<p role="alert" className="task-graph-error">任务图同步中断：{error}{matching?'。保留上次已确认的图。':''}</p>}
    {graphLoading&&<p role="status" className="task-graph-loading">正在同步任务图…</p>}
    {scopeState&&scopeState.scopes.length>0&&<div className="task-scope-filter"><label>突出显示周期<select aria-label="任务图目标周期" data-testid="task-scope-select" value={scopeState.historyScopeId??''} onChange={event=>scopeState.selectScope(event.target.value||undefined)}><option value="">当前 / 最新目标</option>{[...scopeState.scopes].reverse().map(scope=><option value={scope.scopeId} key={scope.scopeId}>{scope.objective??scope.inputPreview??'旧周期'} · {new Date(scope.createdAt).toLocaleString()}</option>)}</select></label><span data-testid="task-scope-status">{scopeState.selectedGoalView.label}</span><small>全会话节点仍保留，其他周期降低突出显示。</small></div>}
    {taskId&&scopeState?.selectedScopeId&&<ScopeUsagePanel key={JSON.stringify([workspaceId,taskId,scopeState.selectedScopeId])} identity={{workspaceId,rootSessionId:taskId,scopeId:scopeState.selectedScopeId}}/>}
    {!root?<div className="task-graph-draft"><h3>尚未开始会话</h3><p>发送第一条消息后，这里显示主 Agent；派发成员任务后显示团队任务流程。</p><button onClick={onChat}>开始对话</button></div>:<div className={'session-graph-layout'+(hasDetail?' with-detail':'')}>
      <DispatchGraph key={workspaceId+':'+taskId} graph={matching} root={root} selectedTaskId={selected} onSelectTask={select} highlightedScopeId={scopeState?.selectedScopeId}/>
      {hasDetail&&<aside className="session-graph-detail" aria-label={rootSelected?'主 Agent 详情':'成员任务详情'} data-testid="session-graph-detail"><header><strong>{rootSelected?'主会话调度':'成员任务'}</strong><button onClick={()=>select(undefined)} aria-label="关闭详情，返回流程图">返回流程图</button></header>
        {rootSelected?<RootTaskDetail onSelectTask={select} history={history} pending={pending} now={now} busy={busy} stopping={props.stopping} onQueueChange={onQueueChange} onQueueContinue={onQueueContinue} onStop={onStop} graph={matching} scopeState={scopeState} continuation={props.continuation} replan={props.replan} humanDecisions={props.humanDecisions} humanContinuation={props.humanContinuation} recovery={props.recovery} historyIssueCount={props.historyIssueCount}/>:selectedTask&&taskId&&<MemberTaskDetail active={props.active} key={workspaceId+':'+taskId+':'+selectedTask.taskId} workspaceId={workspaceId} workspaceInstanceId={props.workspaceInstanceId} rootSessionId={taskId} task={selectedTask} graphCursor={matching?.cursor} scope={scopeState?.scopes.find(scope=>scope.scopeId===selectedTask.scopeId)} recovery={props.recovery}/>}
      </aside>}
    </div>}
  </div>;
}
