/**
 * 作用定位：提供人工接续的最新记录选择、当前输入版本定位和业务主体比较。
 * 设计原因：普通补充、另一等待或被新意见覆盖的接受都不能继承批准；选择规则供服务与持久不变量共用。
 * 职责边界：只核对领域事实，不读取 canonical 或文件，不将匹配结果当作最终完成许可。
 */
import type {DispatchScope} from './dispatch-scope';
import type {HumanDecisionRecord} from './human-decisions';
import {humanContinuationSubject,type ScopeHumanContinuation} from './human-continue';
import {isHumanContinuation} from './scope-continuation-record';
import {goalInputRevision,sameGoalValue} from './scope-goal';

/** 先跨 basis 取每项最新意见，再限制当前等待，禁止从旧 basis 或旧 wait 补回已失效的接受。 */
export function waitingHumanDecisions(scope:DispatchScope,waitId=scope.wait?.waitId,decisionRevision=scope.humanDecisions?.revision??0):HumanDecisionRecord[]{
  const latest=new Map<string,HumanDecisionRecord>();
  for(const record of scope.humanDecisions?.records??[])if(record.revision<=decisionRevision)latest.set(record.criterionId,record);
  return [...latest.values()].filter(record=>record.proof.source.waitId===waitId).sort((a,b)=>a.criterionId<b.criterionId?-1:a.criterionId>b.criterionId?1:0);
}
/** 只有当前输入版本的最近接续可用；文本补充与之后的等待不自动借用更早的人工意图。 */
export function currentHumanContinuation(scope:DispatchScope):ScopeHumanContinuation|undefined{
  const latest=scope.continuations?.at(-1);
  return latest&&isHumanContinuation(latest)&&scope.goal&&latest.inputRevision===goalInputRevision(scope.goal)?latest:undefined;
}
/** 证据与返工引用共用身份门禁；返回意见本身，接受或拒绝用途由调用方进一步限制。 */
export function referencedHumanDecision(scope:DispatchScope,reference:{decisionId:string;continuationId:string}):HumanDecisionRecord|undefined{
  const intent=currentHumanContinuation(scope);
  if(!intent||intent.continuationId!==reference.continuationId||!intent.decisionIds.includes(reference.decisionId))return;
  const record=scope.humanDecisions?.records.find(item=>item.decisionId===reference.decisionId);
  if(!record||record.revision>intent.decisionRevision||record.proof.source.waitId!==intent.wait.waitId||scope.humanDecisions?.records.filter(item=>item.criterionId===record.criterionId).at(-1)?.decisionId!==record.decisionId)return;
  return record;
}
/** 接受不能跨业务主体变更；拒绝/补证可触发新分工，但不据此满足人工项。 */
export function humanContinuationSubjectMatches(scope:DispatchScope):boolean{
  const intent=currentHumanContinuation(scope),plan=scope.goal?.plan;
  return !!intent&&!!plan&&sameGoalValue(humanContinuationSubject(plan),intent.subject);
}
