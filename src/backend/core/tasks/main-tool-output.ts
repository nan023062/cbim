/**
 * 自动派发回执须与当前 scope 及原 agentId/moduleIds 对应，不能借可解析的兜底字段更换请求。
 * 等待审阅的可选 memberPause 也必须与原请求逐项一致，不能省略清单后把已保存等待解释为另一种结果。
 * 作用定位：主调度工具的公开业务输出契约与可信调用归属校验，前置修订严格对应原增删请求。
 * 设计原因：JSON 可解析不代表目标、图或回执属于本次调用；唯一 wire 核对身份、Workflow 与负责人原始选择，不将解析后补值当作原请求事实。
 * 职责边界：排队、追加/替换前置及续执行预约均不是执行完成；检查点放弃只取消原待办，输出失败不撤销已提交事务，也不授权自动重试。
 */
import {automaticExecutionBindingSchema,automaticExecutionBindingMatches} from '../team/automatic-execution';
import {z} from 'zod';
import {graphCursorSchema,graphSnapshotSchema,taskNodeSchema,validateGraph} from './graph-rules';
import type {GraphSnapshot,TaskNode} from './graph-types';
import {mainToolScopeSchema,type MainToolScope} from './main-tool-scope';
import {goalInputRevision,sameGoalValue,type GoalPlanInput,type GoalReviewInput} from './scope-goal';
import {dependencyReplacementSchema,type ReplaceQueuedDependencyInput} from './queued-dependency-replacement';
import {dependencyAdditionSchema,type AddQueuedDependencyInput} from './queued-dependency-addition';
import {reviseQueuedDependenciesReceiptSchema,type ReviseQueuedDependenciesInput} from './queued-dependency-revision';
import type {CancelQueuedTasksInput} from './queued-task-cancel';
import type {ResumeMemberInput} from './queued-member-resume';
import {abandonCheckpointReceiptSchema,type AbandonCheckpointInput} from './checkpoint-handoff';
export {projectMainScope,mainToolScopeSchema} from './main-tool-scope';
export type {MainToolScope} from './main-tool-scope';

const id=z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/);
const seq=z.number().int().nonnegative().safe();
const shortCursor=z.object({streamId:id,seq}).strict();
const ids=z.array(id).min(1).max(500).refine(values=>new Set(values).size===values.length,'任务身份不能重复');
const receiptIdentity={workspaceId:id,rootSessionId:id,scopeId:id,mainRunId:id,commandId:id};
const graphOutputSchema=graphSnapshotSchema.superRefine((value,context)=>{try{validateGraph(value as GraphSnapshot)}catch{context.addIssue({code:'custom',message:'任务图领域关系无效'})}});

/** 派发回执只证明待办信封提交，没有 scope/run 字段，不能凭空声称这些身份已写入回执。 */
export const dispatchTaskOutputSchema=z.object({commandId:id,taskId:id,messageId:id,cursor:graphCursorSchema,disposition:z.enum(['queued','waiting']),fallbackBinding:automaticExecutionBindingSchema.optional()}).strict();
export const cancelQueuedTasksOutputSchema=z.object({...receiptIdentity,cancelledTaskIds:z.array(id).min(1).max(100).refine(values=>new Set(values).size===values.length),graphCursor:shortCursor}).strict();
export const replaceQueuedDependencyOutputSchema=z.object({...receiptIdentity,taskId:id,status:z.enum(['queued','waiting']),trackedTaskIds:ids,replacement:dependencyReplacementSchema,graphCursor:shortCursor}).strict();
export const addQueuedDependencyOutputSchema=z.object({...receiptIdentity,taskId:id,status:z.literal('waiting'),trackedTaskIds:ids.refine(values=>values.length>=2),addition:dependencyAdditionSchema,graphCursor:shortCursor}).strict();
/** requestId 是预约信封，原任务和原检查点保留；没有新 runId，不能把预约称为已续执行。 */
export const resumeMemberOutputSchema=z.object({taskId:id,checkpointId:id,requestId:id,trackedTaskIds:ids,cursor:graphCursorSchema}).strict();
export const mainToolOutputSchemas={
  cbim_goal_inspect:z.object({scope:mainToolScopeSchema,graph:graphOutputSchema}).strict(),
  cbim_goal_plan:mainToolScopeSchema,
  cbim_goal_review:mainToolScopeSchema,
  cbim_dispatch_task:dispatchTaskOutputSchema,
  cbim_dispatch_inspect:z.union([taskNodeSchema,graphOutputSchema]),
  cbim_dispatch_cancel:cancelQueuedTasksOutputSchema,
  cbim_dispatch_replace_dependency:replaceQueuedDependencyOutputSchema,
  cbim_dispatch_add_dependency:addQueuedDependencyOutputSchema,
  cbim_dispatch_revise_dependencies:reviseQueuedDependenciesReceiptSchema,
  cbim_dispatch_resume:resumeMemberOutputSchema,
  cbim_dispatch_abandon_checkpoint:abandonCheckpointReceiptSchema,
} as const;
export type MainToolName=keyof typeof mainToolOutputSchemas;
export type MainToolOutput<N extends MainToolName>=z.infer<(typeof mainToolOutputSchemas)[N]>;
/** 由实际主运行闭包提供，模型参数不能修改这些身份。 */
export interface MainToolOutputBinding {workspaceId:string;rootSessionId:string;scopeId:string;runId:string}
/** input 已经通过该工具的严格输入校验；命令算法在装配层，Core 仅比较可信预期值。 */
export interface MainToolOutputExpectation {binding:MainToolOutputBinding;input:unknown;expectedCommandId?:string}

/** 返回 Schema 供 checkedJsonToolResult 使用；所有判断都针对一次序列化后的同一份 wire。 */
export function mainToolOutputSchema(name:MainToolName,expected:MainToolOutputExpectation):z.ZodTypeAny {
  const schema:z.ZodTypeAny=mainToolOutputSchemas[name];
  return schema.superRefine((value:unknown,context:z.RefinementCtx)=>validateMainToolOutput(name,value,expected,(message)=>context.addIssue({code:'custom',message})));
}

/** 只验证公开可证事实；无回执字段的 command/run 不伪造，历史任务允许属于同主会话的旧周期。 */
function validateMainToolOutput(name:MainToolName,value:unknown,expected:MainToolOutputExpectation,issue:(message:string)=>void):void {
  const {binding,input,expectedCommandId}=expected;
  const sameIdentity=(v:{workspaceId:string;rootSessionId:string})=>v.workspaceId===binding.workspaceId&&v.rootSessionId===binding.rootSessionId;
  const scopeCheck=(scope:MainToolScope)=>{if(!sameIdentity(scope)||scope.scopeId!==binding.scopeId||scope.runTracking&&!scope.runTracking.mainRunIds.includes(binding.runId))issue('目标输出不属于当前周期或主运行')};
  const graphCheck=(graph:GraphSnapshot)=>{if(!sameIdentity(graph.identity)||!sameIdentity(graph.cursor)||!sameIdentity(graph.root.identity))issue('任务图不属于当前主会话')};
  const commandCheck=(commandId:string)=>{if(!expectedCommandId||commandId!==expectedCommandId)issue('回执命令不属于本次真实调用')};
  const cursorCheck=(actual:{streamId:string;seq:number},prior:{streamId:string;seq:number})=>{if(actual.streamId!==prior.streamId||actual.seq!==prior.seq+1)issue('回执不是请求图基线的原子后继')};
  if(name==='cbim_goal_inspect'){
    const result=value as MainToolOutput<'cbim_goal_inspect'>;scopeCheck(result.scope);graphCheck(result.graph);
    for(const stamp of [result.scope.goal?.plan?.graphCursor,result.scope.goal?.review?.graphCursor,result.scope.wait?.graphCursor])if(stamp&&(stamp.streamId!==result.graph.cursor.streamId||stamp.seq>result.graph.cursor.seq))issue('目标引用的图基线不属于返回快照');
    return;
  }
  if(name==='cbim_goal_plan'||name==='cbim_goal_review'){
    const scope=value as MainToolScope;scopeCheck(scope);
    const draft=input as GoalPlanInput|GoalReviewInput,goal=scope.goal;
    if(scope.status!=='active'||!goal||goal.blocked||goal.revision!==draft.expectedRevision+1){issue('目标决策没有对应本次活动版本');return}
    if(name==='cbim_goal_plan'){
      const proposed=draft as GoalPlanInput,plan=goal.plan;
      if(!plan||goal.review||plan.runId!==binding.runId||plan.revision!==goal.revision||goalInputRevision(plan)!==goalInputRevision(goal)){issue('计划未绑定本次主运行');return}
      const actual={objective:plan.objective,constraints:plan.constraints,criteria:plan.criteria,assignments:plan.assignments.map(({agentId,moduleIds,criterionIds,reason,workflowSelections,ownerSelection})=>({agentId,moduleIds,criterionIds,reason,...(workflowSelections===undefined?{}:{workflowSelections}),...(ownerSelection===undefined?{}:{ownerSelection})})),reason:plan.reason};
      const {expectedRevision:_,...requested}=proposed;if(!sameGoalValue(actual,requested))issue('保存计划与请求正文不一致');
    }else{
      const review=goal.review;if(!review||review.runId!==binding.runId||review.revision!==goal.revision||goalInputRevision(review)!==goalInputRevision(goal)){issue('审阅未绑定本次主运行');return}
      const actual={decision:review.decision,checks:review.checks,superseded:review.superseded,gaps:review.gaps,reason:review.reason,...(review.memberPause===undefined?{}:{memberPause:review.memberPause})};
      const {expectedRevision:_,...requested}=draft as GoalReviewInput;if(!sameGoalValue(actual,requested))issue('保存审阅与请求事实不一致');
    }return;
  }
  if(name==='cbim_dispatch_inspect'){
    const requested=input as {taskId?:string};
    if(!requested.taskId){if(!('version' in (value as object))){issue('未指定任务的查询必须返回整图');return}graphCheck(value as GraphSnapshot);return}
    const task=value as TaskNode;if(task.kind!=='task'||task.taskId!==requested.taskId||task.nodeId!==`task:${task.taskId}`||!sameIdentity(task.identity)){issue('查询任务身份不一致');return}
    return;
  }
  if(name==='cbim_dispatch_task'){
    const result=value as MainToolOutput<'cbim_dispatch_task'>;commandCheck(result.commandId);if(!sameIdentity(result.cursor)||result.cursor.seq<1)issue('派发回执不属于当前主会话');const request=input as {agentId:string;moduleIds:string[];ownerSelection?:unknown};if(result.fallbackBinding&&(request.ownerSelection||!automaticExecutionBindingMatches(result.fallbackBinding,binding.workspaceId,binding.scopeId,request.agentId,request.moduleIds)))issue('自动兜底回执与原派发范围或周期不一致');return;
  }
  if(name==='cbim_dispatch_resume'){
    const result=value as MainToolOutput<'cbim_dispatch_resume'>,request=input as ResumeMemberInput;
    if(!sameIdentity(result.cursor)||result.taskId!==request.taskId||result.checkpointId!==request.checkpointId||result.trackedTaskIds[0]!==result.taskId)issue('预约回执与原任务或检查点不一致');
    cursorCheck(result.cursor,request.expectedGraphCursor);return;
  }
  if(name==='cbim_dispatch_abandon_checkpoint'){
    const receipt=value as MainToolOutput<'cbim_dispatch_abandon_checkpoint'>,request=input as AbandonCheckpointInput,record=receipt.abandonment;
    if(!sameIdentity(receipt)||receipt.scopeId!==binding.scopeId||receipt.mainRunId!==binding.runId)issue('检查点放弃回执不属于当前主运行');
    commandCheck(receipt.commandId);cursorCheck(receipt.graphCursor,request.expectedGraphCursor);
    if(receipt.taskId!==request.taskId||record.commandId!==receipt.commandId||record.scopeId!==binding.scopeId||record.mainRunId!==binding.runId||record.checkpointId!==request.checkpointId||record.resumeRequestId!==request.expectedResumeRequestId||record.previousTaskRevision!==request.expectedRevision||record.planRevision!==request.expectedPlanRevision||record.goalRevision!==request.expectedGoalRevision||record.reason!==request.reason||!sameGoalValue(record.graphCursor,request.expectedGraphCursor))issue('检查点放弃审计与原请求及任务基线不一致');
    return;
  }
  const result=value as MainToolOutput<'cbim_dispatch_cancel'>|MainToolOutput<'cbim_dispatch_replace_dependency'>|MainToolOutput<'cbim_dispatch_add_dependency'>|MainToolOutput<'cbim_dispatch_revise_dependencies'>;
  if(!sameIdentity(result)||result.scopeId!==binding.scopeId||result.mainRunId!==binding.runId)issue('调度变更回执不属于当前主运行');commandCheck(result.commandId);
  if(name==='cbim_dispatch_revise_dependencies'){
    const receipt=result as MainToolOutput<'cbim_dispatch_revise_dependencies'>,request=input as ReviseQueuedDependenciesInput,record=receipt.revision;
    cursorCheck(receipt.graphCursor,request.expectedGraphCursor);
    if(receipt.taskId!==request.target.taskId||record.commandId!==receipt.commandId||record.scopeId!==binding.scopeId||record.mainRunId!==binding.runId||record.goalPlanRevision!==request.expectedGoalRevision||!sameGoalValue(record.request,request)||!sameGoalValue(record.trackedTaskIds,receipt.trackedTaskIds)||!receipt.trackedTaskIds.includes(receipt.taskId)||[...record.removed,...record.added].some(e=>!receipt.trackedTaskIds.includes(e.sourceTaskId))||record.removed.length!==request.remove.length||record.removed.some((e,i)=>e.edgeId!==request.remove[i].edgeId||e.edgeRevision!==request.remove[i].expectedRevision)||record.added.length!==request.add.length||record.added.some((e,i)=>e.sourceTaskId!==request.add[i].taskId||e.sourceTaskRevision!==request.add[i].expectedRevision||e.sourcePlanRevision!==request.add[i].expectedPlanRevision)||record.added.length>0&&receipt.status!=='waiting')issue('修订回执与原请求、增删来源或闭包不一致');
    return;
  }
  if(name==='cbim_dispatch_cancel'){
    const receipt=result as MainToolOutput<'cbim_dispatch_cancel'>,request=input as CancelQueuedTasksInput;
    cursorCheck(receipt.graphCursor,request.expectedGraphCursor);
    if(!sameGoalValue([...receipt.cancelledTaskIds].sort(),request.targets.map(item=>item.taskId).sort()))issue('撤销回执不是精确请求的任务集合');return;
  }
  if(name==='cbim_dispatch_add_dependency'){
    const receipt=result as MainToolOutput<'cbim_dispatch_add_dependency'>,request=input as AddQueuedDependencyInput,record=receipt.addition;
    cursorCheck(receipt.graphCursor,request.expectedGraphCursor);
    if(request.source.taskId===request.target.taskId||receipt.taskId!==request.target.taskId||!receipt.trackedTaskIds.includes(receipt.taskId)||!receipt.trackedTaskIds.includes(request.source.taskId)||!sameGoalValue(receipt.trackedTaskIds,record.trackedTaskIds)||record.commandId!==receipt.commandId||record.scopeId!==binding.scopeId||record.mainRunId!==binding.runId||record.reason!==request.reason||!sameGoalValue(record.graphCursor,request.expectedGraphCursor)||record.goalRevision!==request.expectedGoalRevision||record.goalPlanRevision!==request.expectedGoalRevision||record.previousTaskRevision!==request.target.expectedRevision||record.targetPlanRevision!==request.target.expectedPlanRevision||record.dependency.sourceTaskId!==request.source.taskId||record.dependency.sourceTaskRevision!==request.source.expectedRevision||record.dependency.sourcePlanRevision!==request.source.expectedPlanRevision)issue('追加审计与本次精确前置或任务基线不一致');
    return;
  }
  const receipt=result as MainToolOutput<'cbim_dispatch_replace_dependency'>,request=input as ReplaceQueuedDependencyInput,record=receipt.replacement;
  cursorCheck(receipt.graphCursor,request.expectedGraphCursor);
  if(receipt.taskId!==request.target.taskId||receipt.trackedTaskIds[0]!==receipt.taskId||!sameGoalValue(receipt.trackedTaskIds,record.trackedTaskIds)||record.commandId!==receipt.commandId||record.scopeId!==binding.scopeId||record.mainRunId!==binding.runId||record.reason!==request.reason||!sameGoalValue(record.graphCursor,request.expectedGraphCursor)||record.goalRevision!==request.expectedGoalRevision||record.previousTaskRevision!==request.target.expectedRevision||record.targetPlanRevision!==request.target.expectedPlanRevision||record.retired.edgeId!==request.replace.edgeId||record.retired.revision!==request.replace.expectedRevision||record.replacement.sourceTaskId!==request.with.taskId||record.replacement.sourceTaskRevision!==request.with.expectedRevision||record.replacement.sourcePlanRevision!==request.with.expectedPlanRevision||record.replacement.runId!==request.with.runId||record.replacement.resultId!==request.with.resultId)issue('替换审计与本次精确边或候选不一致');
}
