/**
 * 作用定位：展示当前主会话的办公室及用量，人物详情和历史任务只导航对应对话。
 * 设计原因：办公室不重复展示右侧任务详情；完整核实由显式入口打开，任务及草稿仍归原控制器。
 */
import type {ReactNode} from 'react';
import type {RunSummary,QueuedMessage} from '../../bridge/contracts/execution';
import type {GraphSnapshot} from '../../bridge/contracts/dispatch';
import type {ScopeGoalState} from './scope-state';
import {sessionRuns} from './session-task-state';
import {OfficeScene} from './OfficeScene';
import {ScopeUsagePanel} from './ScopeUsagePanel';
import './task-graph.css';

/** 只接收已同步投影与只读导航回调；没有停止、续接或执行操作端口。 */
export interface SessionTaskViewProps {
  viewAction?:ReactNode;
  selectedAgentSessionId?:string;
  workspaceId:string;taskId?:string;runs:RunSummary[];queued:QueuedMessage[];
  /** 已知坏日志数量只说明记录缺口，不补造执行次数。 */
  historyIssueCount?:number;
  graph?:GraphSnapshot;graphLoading?:boolean;graphError?:string;scopeState?:ScopeGoalState;active?:boolean;
  /** 用于保留历史展开，不在办公室挂载详情。 */
  selectedTaskId?:string;
  onSelectTask:(id:string)=>void;
  onAgentChat:(sessionId?:string,scopeId?:string)=>void;
  onChat:()=>void;
}

/** 点击人物或历史任务只把原身份交回 Conversation，不在舞台右侧另开面板。 */
export function SessionTaskView({workspaceId,taskId,runs,queued,graph,graphLoading,graphError,scopeState,...props}:SessionTaskViewProps){
  const history=sessionRuns(runs,workspaceId,taskId),pending=taskId?queued.filter(message=>message.taskId===taskId):[];
  const matching=graph&&graph.identity.workspaceId===workspaceId&&graph.identity.rootSessionId===taskId?graph:undefined;
  const error=graph&&!matching?'任务图身份不匹配，请重新同步':graphError;
  return <div className="session-task-view graph-mode" data-testid="session-task-view"><header><div><h2>团队办公室</h2><p>当前会话 · {matching?.tasks.length??0} 个派发任务 · 已读 {history.length} 轮记录{props.historyIssueCount?` · ${props.historyIssueCount} 轮待核实`:''}</p></div>{props.viewAction&&<div className="task-view-actions">{props.viewAction}</div>}</header>
    {error&&<p role="alert" className="task-graph-error">任务图同步中断：{error}{matching?'。保留上次已确认的图。':''}</p>}
    {graphLoading&&<p role="status" className="task-graph-loading">正在同步任务图…</p>}
    {taskId&&scopeState?.selectedScopeId&&<details className="office-usage"><summary>话题用量</summary><ScopeUsagePanel key={JSON.stringify([workspaceId,taskId,scopeState.selectedScopeId])} identity={{workspaceId,rootSessionId:taskId,scopeId:scopeState.selectedScopeId}}/></details>}
    {!taskId?<div className="task-graph-draft"><h3>尚未开始会话</h3><p>发送第一条消息后，这里显示主 Agent；派发成员任务后显示团队办公室。</p><button onClick={props.onChat}>开始对话</button></div>:
      matching?<OfficeScene selectedAgentSessionId={props.selectedAgentSessionId} key={JSON.stringify([workspaceId,taskId])} selectedTaskId={props.selectedTaskId} graph={matching} sessions={scopeState?.teamSessions} scopes={scopeState?.scopes??[]} mainRunning={history.some(run=>run.status==='running')} queued={pending.length} active={props.active} onChat={props.onAgentChat} onTask={props.onSelectTask}/>:
      <div className="task-graph-draft"><p>尚未取得办公室成员记录，正在自动同步；也可切换视图重新同步。</p><button onClick={props.onChat}>打开主 Agent 对话</button></div>}
  </div>;
}
