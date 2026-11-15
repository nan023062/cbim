/**
 * 作用定位：按原工作区和主会话过滤轮次，并投影主 Agent 的公开状态与目标。
 * 设计原因：办公室导航与显式运行核实共用身份过滤，展示位置调整不改写任务事实或历史目标。
 */
import type {RunSummary} from '../../bridge/contracts/execution';
import type {GraphSnapshot} from '../../bridge/contracts/dispatch';
import type {ScopeGoalState} from './scope-state';

/** 只接收当前工作区、当前会话的记录；草稿会话没有 taskId，因此没有运行历史。 */
export function sessionRuns(runs:RunSummary[],workspaceId:string,taskId?:string){return taskId?runs.filter(run=>run.task.workspaceId===workspaceId&&run.task.taskId===taskId):[]}
/** 根只是主会话显示锚点；主会话执行事实不能当作已派发给其他成员的业务任务。 */
export function sessionRoot(history:RunSummary[],taskId:string,pending:number,graph?:GraphSnapshot,scopeState?:ScopeGoalState,historyIssueCount=0){
  const latest=history.at(-1),status=latest?{running:'正在工作',completed:'本轮结束',cancelled:'已停止',failed:'执行失败',interrupted:'执行中断'}[latest.status]:historyIssueCount?'主会话记录待核实':'尚无可读记录';
  const selected=scopeState?.scopes.find(scope=>scope.scopeId===scopeState.selectedScopeId);
  // 有明确周期时绝不借用其他轮次的标题；legacy 缺少目标只能如实展示未知。
  const goal=selected?(selected.hasGoal?selected.objective??selected.inputPreview??'本轮目标':'旧周期 · 未保存原始目标'):latest?.taskProgress?.goal??latest?.task.goal??'当前会话';
  return {nodeId:graph?.root.nodeId??'session:'+taskId,name:graph?.root.agent.name??'主 Agent',goal,status:selected?scopeState!.selectedGoalView.label:status,running:selected?selected.status==='active':latest?.status==='running',runCount:history.length,pendingCount:pending,unreadableRunCount:historyIssueCount};
}
