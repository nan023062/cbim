/**
 * 作用定位：全局运行页面的纯筛选、状态说明与原会话定位契约。
 * 设计原因：模型轮次、调度周期和成员任务具有不同终态；统一展示词汇但不合并状态，更不从角色名或时间猜测会话身份。
 * 职责边界：这里只解释已确认的观察值，不签发任务、预算或验收。
 */
import type {RuntimeScope,RuntimeTask,RuntimeMember,RuntimeRun} from '../../bridge/contracts/runtime';

/** 一次页面定位，不是执行请求；taskId 仅指派发节点，缺省定位主会话根。 */
export interface RuntimeNavigationTarget {workspaceId:string;rootSessionId:string;taskId?:string;scopeId?:string}
export type RuntimeFilter='all'|'current'|'attention';
/** 任务号只在原根内唯一；列表键保留根身份，避免不同会话的同号任务复用 DOM。 */
export function runtimeTaskKey(task:RuntimeTask){return JSON.stringify([task.workspaceId,task.source,task.source==='dispatch'?task.rootSessionId:null,task.taskId])}
/** 旧日志的 runId 也须连同 taskId 核对，不假定所有历史 UUID 都全局唯一。 */
export function runtimeRunKey(run:RuntimeRun){return JSON.stringify([run.workspaceId,run.taskId,run.runId])}
export const runtimeRunLabels:Record<RuntimeRun['status'],string>={running:'运行中',completed:'本轮结束',cancelled:'已停止',failed:'运行失败',interrupted:'运行中断'};
export const runtimeTaskLabels={planned:'已规划',queued:'待执行',running:'执行中',waiting:'等待依赖',result_ready:'交付候选',blocked:'任务受阻',failed:'执行失败',cancelled:'已取消',interrupted:'已中断',checkpointed:'检查点停泊'};
export const runtimeMemberLabels={idle:'空闲',working:'工作中',waiting:'等待其他成员',communicating:'沟通中'};
export const runtimeAdmissionLabels={global_capacity:'等待全局名额',workspace_conflict:'等待工作区执行占用',agent_busy:'等待成员空闲',fairness:'按队列公平等待'};
/** closed/completed 仍可能只是普通对话；只有实际完成审阅才显示目标周期完成，不把 goal 输入存在当业务计划。 */
export function runtimeScopeLabel(scope:RuntimeScope){
  if(scope.status==='closed')return scope.outcome?({completed:scope.reviewDecision==='complete'?'目标周期完成':'周期已结束',failed:'周期失败',cancelled:'周期已取消',interrupted:'周期中断'} as const)[scope.outcome]:'周期已关闭（结果未报告）';
  if(scope.status==='waiting')return '等待用户';
  if(scope.budgetBlocked)return '额度待处理';
  if(scope.goalBlocked||scope.reviewDecision==='blocked')return '目标受阻';
  return scope.reviewDecision==='complete'?'完成申请待核验':scope.reviewDecision==='awaiting_user'?'等待请求待结算':'调度中';
}
export function runtimeScopeMatches(scope:RuntimeScope,filter:RuntimeFilter){return filter==='all'||(filter==='current'?scope.status!=='closed':scope.status==='waiting'||!!scope.budgetBlocked||!!scope.goalBlocked||scope.reviewDecision==='blocked'||scope.outcome==='failed'||scope.outcome==='interrupted')}
export function runtimeTaskMatches(task:RuntimeTask,filter:RuntimeFilter){return filter==='all'||(task.source==='loop'?(filter==='current'?task.activeRunIds.length>0:task.status==='failed'||task.status==='interrupted'):(filter==='current'?['planned','queued','running','waiting','blocked','checkpointed'].includes(task.status):['blocked','failed','interrupted','checkpointed','waiting'].includes(task.status)))}
export function runtimeMemberMatches(member:RuntimeMember,filter:RuntimeFilter){return filter==='all'||(member.lifecycle!=='released'&&(filter==='current'?member.availability==='ready':!member.activityCurrent||member.availability!=='ready'||member.activity==='waiting'))}
/** 旧 role-only 会话只能按其真实 taskId 定位；执行成员必须有已确认的根身份，不能拿成员任务号冒充主会话号。 */
export function runtimeTaskTarget(task:RuntimeTask):RuntimeNavigationTarget{return task.source==='dispatch'?{workspaceId:task.workspaceId,rootSessionId:task.rootSessionId,taskId:task.taskId,scopeId:task.scopeId}:{workspaceId:task.workspaceId,rootSessionId:task.binding==='instance'?task.rootSessionId:task.taskId}}
export function runtimeRunTarget(run:RuntimeRun):RuntimeNavigationTarget|undefined{
  if(run.memberBinding)return {workspaceId:run.workspaceId,rootSessionId:run.memberBinding.rootSessionId,taskId:run.memberBinding.taskId};
  if(run.conversationBinding)return {workspaceId:run.workspaceId,rootSessionId:run.conversationBinding.rootSessionId};
  return undefined;
}
