/**
 * 公开自动分配须与 auto 周期、工作区和模块对应，团队模式不可携带兜底分配。
 * 作用定位：主调度工具读取周期的公开白名单投影，保留规划、审阅和显式接续实际需要的事实。
 * 设计原因：持久 DispatchScope 还包含原生会话及旧运行隔离清单；工具输出不能直接序列化整个存储对象。公开运行补充仍须绑定本周期主运行和连续输入版本，pending/unknown 不能被省略成可完成状态。
 * 职责边界：只投影既有字段，负责人绑定严格属于本周期工作区与分配模块，不补造旧目标、不签发恢复许可；完整完成门禁仍由调度服务核实。
 */
import {automaticExecutionBindingMatches} from '../../team/rules/automatic-execution';
import {z} from 'zod';
import {hash,json} from '../../../core/platform/node/serialization';
import {goalNeedsReplan,sameGoalValue} from './scope-goal';
import {scopeHasUnresolvedActiveInput,validateScopeInputHistory} from './scope-active-input';
import {ownerExecutionBindingMatches} from '../../team/rules/member-execution-binding';
import {pendingTopicInterruption} from './topic-interruption';
import {publicDispatchScopeSchema} from './scope-public';
export {projectMainScope} from './scope-public';

/** 仅剔除私有 context；来源未知事实、只读权限、已核实模块和继承人工项不可随展示裁剪。 */
export const mainToolScopeSchema=publicDispatchScopeSchema.superRefine((scope,context)=>{
  const issue=(message:string)=>context.addIssue({code:'custom',message});
  for(const assignment of scope.goal?.plan?.assignments??[])if(assignment.ownerBinding&&!ownerExecutionBindingMatches(assignment.ownerBinding,scope.workspaceId,assignment.agentId,assignment.moduleIds))issue('目标负责岗位不属于返回周期的工作区、角色或模块');
  for(const a of scope.goal?.plan?.assignments??[])if(a.fallbackBinding&&(!automaticExecutionBindingMatches(a.fallbackBinding,scope.workspaceId,scope.scopeId,a.agentId,a.moduleIds)||scope.executionPolicy?.mode!=='auto'))issue('自动兜底不属于本周期或模式');
  if(scope.status==='closed'?(!scope.closedAt||!scope.outcome):(scope.closedAt!==undefined||scope.outcome!==undefined))issue('周期状态与关闭事实不一致');
  if(scope.wait?.interruptionId){const intent=pendingTopicInterruption(scope);if(!intent||scope.wait.waitId!==intent.request.commandId||scope.wait.interruptionId!==intent.request.commandId||scope.wait.goalRevision!==scope.goal?.revision||(scope.goal?.inputRevision??1)!==intent.request.expectedInputRevision)issue('整话题暂停必须保留原补充及输入版本')}
  if(scope.status==='waiting'&&!scope.wait?.interruptionId&&(!scope.wait||!scope.goal||scope.goal.blocked||scope.goal.review?.decision!=='awaiting_user'||scope.wait.goalRevision!==scope.goal.revision||scope.wait.runId!==scope.goal.review.runId||scope.wait.knowledgeRevision!==scope.goal.review.knowledgeRevision||!sameGoalValue(scope.wait.graphCursor,scope.goal.review.graphCursor)))issue('等待必须有当前审阅的真实检查点');
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
