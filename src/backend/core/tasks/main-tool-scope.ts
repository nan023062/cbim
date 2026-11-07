/**
 * 作用定位：主调度工具读取周期的公开白名单投影，保留规划、审阅和显式接续实际需要的事实。
 * 设计原因：持久 DispatchScope 还包含原生会话及旧运行隔离清单；工具输出不能直接序列化整个存储对象。公开运行补充仍须绑定本周期主运行和连续输入版本，pending/unknown 不能被省略成可完成状态。
 * 职责边界：只投影既有字段，负责人绑定严格属于本周期工作区与分配模块，不补造旧目标、不签发恢复许可；完整完成门禁仍由调度服务核实。
 */
import {z} from 'zod';
import {hash,json} from '../foundation/serialization';
import type {DispatchScope} from './dispatch-scope';
import {dispatchScopeGoalSchema,goalNeedsReplan,sameGoalValue} from './scope-goal';
import {dispatchScopeWaitSchema} from './scope-continuation';
import {scopeContinuationRecordSchema} from './scope-continuation-record';
import {scopeRunTrackingSchema} from './scope-run-tracking';
import {scopeBudgetSchema} from './scope-budget';
import {scopeHumanDecisionsSchema} from './human-decisions';
import {scopeRecoverySchema} from './scope-recovery';
import {scopeReplanSchema} from './scope-replan';
import {scopeActiveInputSchema,scopeHasUnresolvedActiveInput,validateScopeInputHistory} from './scope-active-input';
import {ownerExecutionBindingMatches} from '../team/member-execution-binding';

const id=z.string().min(1).max(512).refine(value=>value.trim()===value&&!/[\x00-\x1f]/.test(value));
/** 仅剔除私有 context；来源未知事实、只读权限、已核实模块和继承人工项不可随展示裁剪。 */
export const mainToolScopeSchema=z.object({
  scopeId:id,workspaceId:id,rootSessionId:id,status:z.enum(['active','waiting','closed']),createdAt:z.string().datetime(),
  goal:dispatchScopeGoalSchema.optional(),runTracking:scopeRunTrackingSchema.optional(),budget:scopeBudgetSchema.optional(),
  humanDecisions:scopeHumanDecisionsSchema.optional(),wait:dispatchScopeWaitSchema.optional(),
  continuations:z.array(scopeContinuationRecordSchema).max(31).optional(),
  activeInputs:z.array(scopeActiveInputSchema).min(1).max(64).optional(),
  recovery:scopeRecoverySchema.omit({context:true}).strict().optional(),
  replan:scopeReplanSchema.omit({context:true}).strict().optional(),
  closedAt:z.string().datetime().optional(),outcome:z.enum(['completed','failed','cancelled','interrupted']).optional(),
}).strict().superRefine((scope,context)=>{
  const issue=(message:string)=>context.addIssue({code:'custom',message});
  for(const assignment of scope.goal?.plan?.assignments??[])if(assignment.ownerBinding&&!ownerExecutionBindingMatches(assignment.ownerBinding,scope.workspaceId,assignment.agentId,assignment.moduleIds))issue('目标负责岗位不属于返回周期的工作区、角色或模块');
  if(scope.status==='closed'?(!scope.closedAt||!scope.outcome):(scope.closedAt!==undefined||scope.outcome!==undefined))issue('周期状态与关闭事实不一致');
  if(scope.status==='waiting'&&(!scope.wait||!scope.goal||scope.goal.blocked||scope.goal.review?.decision!=='awaiting_user'||scope.wait.goalRevision!==scope.goal.revision||scope.wait.runId!==scope.goal.review.runId||scope.wait.knowledgeRevision!==scope.goal.review.knowledgeRevision||!sameGoalValue(scope.wait.graphCursor,scope.goal.review.graphCursor)))issue('等待必须有当前审阅的真实检查点');
  if(scope.status==='active'&&scope.wait)issue('活动周期不能仍持有未消费等待');
  if(scope.status==='closed'&&scope.wait&&scope.outcome==='completed')issue('等待周期不能绕过审阅直接成为已完成');
  if(scope.recovery&&scope.replan)issue('只读核实与业务重规划不能共用一个周期');
  const intent=scope.recovery??scope.replan;
  if(intent&&(scope.scopeId!==('recoveryId' in intent?intent.recoveryId:intent.replanId)||scope.createdAt!==intent.acceptedAt||scope.goal?.input.message!==intent.input.message))issue('新周期来源与原始目标不一致');
  try{validateScopeInputHistory(scope)}catch{issue('输入版本与真实接收历史不一致')}
  const insertionIds=new Set<string>(),queueRuns=new Set<string>(),acceptedSeqs=new Map<string,number>();
  for(const item of scope.activeInputs??[]){
    const queueRun=JSON.stringify([item.runId,item.queueId]);
    if(!scope.goal||!scope.runTracking?.mainRunIds.includes(item.runId)||insertionIds.has(item.insertionId)||queueRuns.has(queueRun)||item.baseGoalRevision>scope.goal.revision||item.baseInputRevision>(scope.goal.inputRevision??1)||Date.parse(item.preparedAt)<Date.parse(scope.createdAt))issue('运行补充的身份、版本或时间不属于该周期');
    if(item.insertionId!==hash(json({scopeId:scope.scopeId,runId:item.runId,queueId:item.queueId})))issue('插入身份与原运行队列不一致');
    insertionIds.add(item.insertionId);queueRuns.add(queueRun);
    if(item.status==='accepted'){
      if(item.goalRevision>(scope.goal?.revision??0)||item.requestedSeq<=(acceptedSeqs.get(item.runId)??0))issue('接受版本或运行日志序号无效');acceptedSeqs.set(item.runId,item.acceptedSeq);
      if(item.inputHash!==hash(json({message:item.input.message,attachmentIds:item.input.attachmentIds??[]})))issue('接受正文与准备指纹不一致');
    }
  }
  if(scopeHasUnresolvedActiveInput(scope)&&(scope.status==='waiting'||scope.status==='closed'&&scope.outcome==='completed'))issue('未核实插入不能等待或完成');
  if(scope.goal&&goalNeedsReplan(scope.goal)&&scope.status==='closed'&&scope.outcome==='completed')issue('新输入尚未重新规划，不能沿旧计划完成');
  for(const item of scope.continuations??[]){
    if(scope.recovery&&item.options.permission!=='read')issue('接续只读范围不一致');
  }
  for(const record of scope.humanDecisions?.records??[])if(record.proof.identity.workspaceId!==scope.workspaceId||record.proof.identity.rootSessionId!==scope.rootSessionId||record.proof.identity.scopeId!==scope.scopeId)issue('人工决定不属于该周期');
});
export type MainToolScope=z.infer<typeof mainToolScopeSchema>;

/** 只选取公开字段，不解析、默认化或修改领域值；真正输出校验在唯一 JSON wire 形成后进行。 */
export function projectMainScope(scope:DispatchScope):MainToolScope {
  // 坏端口返回值仍交给唯一 wire 边界拒绝；不在投影阶段抛出含内部对象的 TypeError。
  if(!scope||typeof scope!=='object'||Array.isArray(scope))return scope as unknown as MainToolScope;
  const result:MainToolScope={scopeId:scope.scopeId,workspaceId:scope.workspaceId,rootSessionId:scope.rootSessionId,status:scope.status,createdAt:scope.createdAt};
  for(const key of ['goal','runTracking','budget','humanDecisions','wait','continuations','activeInputs','closedAt','outcome'] as const){
    if(scope[key]!==undefined)Object.assign(result,{[key]:scope[key]});
  }
  if(scope.recovery!==undefined){
    if(!scope.recovery||typeof scope.recovery!=='object'||Array.isArray(scope.recovery))result.recovery=scope.recovery;
    else {const {recoveryId,acceptedAt,source,operation,observation,input,options}=scope.recovery;result.recovery={recoveryId,acceptedAt,source,operation,observation,input,options}}
  }
  if(scope.replan!==undefined){
    if(!scope.replan||typeof scope.replan!=='object'||Array.isArray(scope.replan))result.replan=scope.replan;
    else {const {replanId,acceptedAt,source,operation,input,options}=scope.replan;result.replan={replanId,acceptedAt,source,operation,input,options}}
  }
  return result;
}
