/**
 * 作用定位：调度层最终验收返工的分类、限次与系统反馈，复用原目标及主运行入口。
 * 设计原因：只有明确可修复的业务拒绝才重新唤醒主调度；权限、未知副作用、身份和日志异常保持停放。
 */
import {hash,json} from '../../../core/platform/node/serialization';
import type {GoalRepairSource} from '../../../logic/execution/rules/input-source';
import type {DispatchScope} from '../../../logic/tasks/rules/dispatch-scope';
import type {GraphSnapshot} from '../../../logic/tasks/rules/graph-types';

const repairable=new Set(['GOAL_REVIEW_REQUIRED','GOAL_PLAN_REQUIRED','GOAL_REPLAN_REQUIRED','GOAL_GRAPH_CHANGED','GOAL_EFFECT_CHANGED','GOAL_KNOWLEDGE_CHANGED','GOAL_EVIDENCE_STALE','GOAL_WORKFLOW_UNMET','GOAL_CRITERIA_UNMET','GOAL_WORK_FAILED']);
/** 最多三次返工；同一验收问题且任务成果未变化最多尝试两次，目标版本递增本身不算进展。 */
export function goalRepairFeedback(scope:DispatchScope,graph:GraphSnapshot,runId:string,error:{code?:string;message?:string},history:readonly GoalRepairSource[]):{source:GoalRepairSource;message:string}|undefined{
  if(!repairable.has(error.code??'')||history.length>=3||scope.status!=='active'||!scope.goal||scope.goal.blocked||scope.recovery||scope.goal.review?.decision==='awaiting_user'||scope.goal.review?.decision==='blocked')return;
  const tasks=graph.tasks.filter(task=>task.scopeId===scope.scopeId);
  if(tasks.some(task=>task.activeRunId||['planned','queued','running','waiting','checkpointed'].includes(task.status)))return;
  const fingerprint=hash(json({code:error.code,criteria:scope.goal.plan?.criteria,tasks:tasks.map(task=>({taskId:task.taskId,status:task.status,result:task.result,runIds:task.runIds}))}));
  if(history.filter(item=>item.fingerprint===fingerprint).length>=2)return;
  const source:GoalRepairSource={kind:'goal-repair',scopeId:scope.scopeId,sourceRunId:runId,attempt:history.length+1,failureCode:error.code!,fingerprint,continuationId:'goal-repair-'+hash(json({scopeId:scope.scopeId,runId,fingerprint}))};
  const message='CBIM 最终验收未通过。这是系统反馈，不是用户新指令、授权或成功结论。请在原目标和原权限内修复，然后重新审阅；不能降低验收标准或覆盖旧证据。先读取 cbim_goal_inspect；需要补做时重新规划并创建新任务，旧任务不能重跑。业务不合格或当前文件已变化的有效旧候选可在 superseded 中用 rejectedCandidate 精确引用 runId/resultId/planRevision，后续替代任务必须重新通过验证。人工项仍须实际人工接受；权限或未知副作用不能重试。连续没有进展或额度耗尽会停止。\n'+JSON.stringify({attempt:source.attempt,maxAttempts:3,failure:{code:error.code,reason:error.message},scopeId:scope.scopeId,goal:scope.goal,tasks:tasks.map(task=>({taskId:task.taskId,status:task.status,goal:task.goal,modules:task.modules.map(m=>m.moduleId),result:task.result,waitReason:task.waitReason}))});
  return {source,message};
}
