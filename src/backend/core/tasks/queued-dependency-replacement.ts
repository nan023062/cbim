/**
 * 作用定位：定义主调度替换未启动任务单条前置的严格输入、不可变审计和可靠提交回执。
 * 设计原因：换边不等于原任务成功或改变目标；模型只能指定待办与真实候选，周期/主运行/命令身份由可信工具注入。
 * 职责边界：纯序列化契约不依赖图实现，避免 TaskNode 引用审计时形成类型循环；不启动、恢复或批准成员执行。
 */
import {z} from 'zod';
const id=z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/);
const revision=z.number().int().positive().safe();
const cursor=z.object({streamId:id,seq:z.number().int().nonnegative().safe()}).strict();
const reason=z.string().trim().min(1).max(4000);
/** 一次只改一条边；其余前置仍须满足，旧来源从当前边推导，不能由模型另填身份。 */
export const replaceQueuedDependencyInputSchema=z.object({
  expectedGraphCursor:cursor,expectedGoalRevision:revision,
  target:z.object({taskId:id,expectedRevision:revision,expectedPlanRevision:revision}).strict(),
  replace:z.object({edgeId:id,expectedRevision:revision}).strict(),
  with:z.object({taskId:id,expectedRevision:revision,expectedPlanRevision:revision,runId:id,resultId:id}).strict(),reason,
}).strict();
export type ReplaceQueuedDependencyInput=z.infer<typeof replaceQueuedDependencyInputSchema>;
/** 每次替换都保留完整前后身份；后续执行只能追加节点版本，不能删除/覆盖旧审计。 */
export const dependencyReplacementSchema=z.object({
  commandId:id,scopeId:id,mainRunId:id,replacedAt:z.string().datetime(),reason,graphCursor:cursor,
  goalRevision:revision,goalPlanRevision:revision,knowledgeRevision:id,previousTaskRevision:revision,targetPlanRevision:revision,
  retired:z.object({edgeId:id,revision,sourceTaskId:id,sourcePlanRevision:revision,resultId:id.optional()}).strict(),
  replacement:z.object({edgeId:id,sourceTaskId:id,sourceTaskRevision:revision,sourcePlanRevision:revision,runId:id,resultId:id}).strict(),
  trackedTaskIds:z.array(id).min(1).max(500).refine(ids=>new Set(ids).size===ids.length,'后继任务不能重复'),
}).strict();
export type DependencyReplacement=z.infer<typeof dependencyReplacementSchema>;
/** 已提交换边与待办跟踪集合；不是立即可执行许可，不改变已有权限/预算/全局准入。 */
export type ReplaceQueuedDependencyReceipt={workspaceId:string;rootSessionId:string;scopeId:string;mainRunId:string;commandId:string;taskId:string;status:'queued'|'waiting';trackedTaskIds:string[];replacement:DependencyReplacement;graphCursor:{streamId:string;seq:number}};
