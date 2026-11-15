/**
 * 作用定位：在显式运行核实中展示原主会话或成员任务的完整记录、恢复与人工操作。
 * 设计原因：核实与办公室页面导航分开；普通人物点击只打开对应对话，核实入口才挂载原详情。
 * 状态归属：继续复用 Conversation 的恢复、停止和未知回执控制器，不因打开/关闭而启动或重放任务。
 */
import {useEffect,useRef} from 'react';
import {createPortal} from 'react-dom';
import {sessionRuns,sessionRoot} from './session-task-state';
import type {RunSummary,QueuedMessage} from '../../bridge/contracts/execution';
import type {GraphSnapshot} from '../../bridge/contracts/dispatch';
import {ToolActivity} from './ToolActivity';
import {WorkStatus} from '../execution-view/WorkStatus';
import {MessageQueue} from '../execution-view/MessageQueue';
import {MemberTaskDetail} from './MemberTaskDetail';
import {ScopeGoalPanel} from './ScopeGoalPanel';
import type {ScopeGoalState} from './scope-state';
import type {ScopeContinuationView} from './useScopeContinuation';
import type {ExecutionRecoveryContext} from './useExecutionRecovery';
import type {ScopeReplanView} from './useScopeReplan';
import type {HumanDecisionsView} from './useHumanDecisions';
import type {HumanContinuationView} from './useHumanContinuation';
import './task-graph.css';

/** 主会话视图输入；图与日志由外层读取，本组件只过滤展示并转交显式操作。 */
export interface SessionTaskReviewProps {
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
  graph?:GraphSnapshot;
  /** 与主对话共享目标摘要/选中详情；选择周期只改变核实对象，不改变执行。 */
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
  /** 核实框可见时观察所选成员；隐藏会话卸载核实框，不持有独立轮询。 */
  active?:boolean;
  /** 根节点用 session:<rootSessionId>；业务节点用 taskId；没有原身份时显示不可读取。 */
  selectedTaskId?:string;
  /** 显式核实中导航原任务引用；组件不持有局部任务选择。 */
  onSelectTask?:(id:string)=>void;
}

/** 主根详情保留调度与知识治理的对话轮次、计划和停止入口；业务执行详情仅由任务节点展开。 */
function RootTaskDetail({history,pending,now,busy,stopping,onQueueChange,onQueueContinue,onStop,graph,scopeState,continuation,replan,humanDecisions,humanContinuation,recovery,onSelectTask,historyIssueCount=0}:Pick<SessionTaskReviewProps,'now'|'busy'|'stopping'|'onQueueChange'|'onQueueContinue'|'onStop'|'graph'|'scopeState'|'continuation'|'replan'|'humanDecisions'|'humanContinuation'|'recovery'|'onSelectTask'|'historyIssueCount'>&{history:RunSummary[];pending:QueuedMessage[]}){
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
      <p>主 Agent 与成员均可执行任务；主 Agent 还负责协调和知识治理。</p>
    </details>
    {progress&&<article className="session-run" aria-label="执行计划"><h3>{progress.goal}</h3><p>计划版本 {progress.version} · {progress.state==='awaiting_review'?'交付待审阅':'执行与验证中'} · 尚未业务验收</p><p>{progress.reason}</p><ol>{progress.steps.map(step=><li key={step.id}><strong>{step.title}</strong> · {step.owner} · {{pending:'待处理',working:'进行中',reported_done:'已报告完成，待核验'}[step.state]}{step.evidence.length>0&&<details><summary>{step.evidence.length} 条工具回执</summary>{step.evidence.map(id=><p key={id}><code>{id}</code></p>)}</details>}</li>)}</ol><h4>验收要求</h4><ul>{progress.acceptance.map((item,index)=><li key={index}>{item}</li>)}</ul>{progress.delivery&&<><h4>交付候选</h4><p>{progress.delivery.summary}</p><ul>{progress.delivery.limitations.map((item,index)=><li key={index}>{item}</li>)}</ul></>}<details><summary>计划修订记录</summary>{history.flatMap(run=>run.events.filter(event=>event.type==='task.updated').map(event=><p key={run.runId+':'+event.seq}>{event.time} · {String((event.data.progress as {reason?:string})?.reason??'计划更新')}</p>))}</details></article>}
    <MessageQueue items={pending} busy={busy} continueDisabled={stopping||waiting||scopeState?.loading} onChange={onQueueChange} onContinue={onQueueContinue}/>
    {scopeState?.selectedScopeId&&history.length>0&&<h4>可读的主会话记录</h4>}
    {[...history].reverse().map((run,index)=><article className="session-run" key={run.runId}><h3>{run.source?.kind==='human_decisions'?'按已保存人工决定继续':String(run.events.find(event=>event.type==='run.started')?.data.message||run.task.goal).split('\n')[0]}</h3><small>已读记录 {history.length-index} · {run.events[0]?.time?new Date(run.events[0].time).toLocaleString():''}</small><WorkStatus run={run} now={now} activityDetails={<ToolActivity run={run} recovery={recovery}/>}/>{run.status==='running'&&<button disabled={stopping} onClick={onStop}>停止本次执行</button>}{run.unresolvedTools.length>0&&<p role="alert">有 {run.unresolvedTools.length} 项操作尚需在对话中核实。</p>}<details><summary>执行标识</summary><code>{run.runId}</code></details></article>)}
    {!history.length&&<p>{historyIssueCount?'当前没有可读的主会话记录；待核实轮次与已有任务节点仍保留，不能据此判定未执行。':'当前尚无可读的主会话记录。'}</p>}
  </div>;
}


/** 仅渲染指定原身份的详情，不创建办公室或另选最新成员任务。 */
export function SessionTaskReview(props:SessionTaskReviewProps){
  const {workspaceId,taskId,runs,queued,graph,selectedTaskId,scopeState}=props;
  const history=sessionRuns(runs,workspaceId,taskId),pending=taskId?queued.filter(message=>message.taskId===taskId):[];
  const matching=graph&&graph.identity.workspaceId===workspaceId&&graph.identity.rootSessionId===taskId?graph:undefined;
  const root=taskId?sessionRoot(history,taskId,pending.length,matching,scopeState,props.historyIssueCount):undefined;
  const task=matching?.tasks.find(task=>task.taskId===selectedTaskId);
  if(root&&selectedTaskId===root.nodeId)return <RootTaskDetail {...props} history={history} pending={pending} graph={matching}/>;
  if(task&&taskId)return <MemberTaskDetail active={props.active} key={workspaceId+':'+taskId+':'+task.taskId} workspaceId={workspaceId} workspaceInstanceId={props.workspaceInstanceId} rootSessionId={taskId} task={task} graphCursor={matching?.cursor} scope={scopeState?.scopes.find(scope=>scope.scopeId===task.scopeId)} recovery={props.recovery}/>;
  return <p role="alert">原任务详情暂不可读取。<button onClick={props.onChat}>返回对话</button></p>;
}
/** 原生模态核实框仅由显式核实入口打开；Escape/关闭恢复入口焦点，不关闭后台任务。 */
export function SessionTaskReviewDialog({onClose,...props}:SessionTaskReviewProps&{onClose:()=>void}){
  const dialog=useRef<HTMLDialogElement>(null);
  useEffect(()=>{const node=dialog.current,previous=document.activeElement as HTMLElement|null;node?.showModal();return()=>{node?.close();if(previous?.isConnected)previous.focus()}},[]);
  return createPortal(<dialog ref={dialog} className="task-review-dialog" aria-label="运行记录与核实" onCancel={event=>{event.preventDefault();onClose()}}>
    <header><strong>运行记录与核实</strong><button onClick={onClose} aria-label="关闭运行核实">关闭</button></header>
    <SessionTaskReview {...props}/>
  </dialog>,document.body);
}
