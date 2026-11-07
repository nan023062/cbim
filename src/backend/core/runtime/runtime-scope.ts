/**
 * 作用定位：从已提交 DispatchScope 生成应用级监管的最小周期事实，供运行索引恢复和增量提交共用。
 * 设计原因：目标等待、阻塞和最终结算独立于模型运行状态；显式白名单避免把目标正文、原生检查点或人工证明传播到全局界面。
 * 职责边界：只投影调用方的可信提交，不访问存储，不消费等待，也不补造旧周期或把完成申请当成完成。
 */
import type {DispatchScope} from '../tasks/dispatch-scope';
import type {RuntimeScope} from './types';
import {runtimeScopeSchema} from './runtime-validation';

const preview=(value:string)=>value.length>240?value.slice(0,239)+'…':value;
/** 仅保留真实存在的字段；原因有界，私有检查点和预算观察不会进入结果。 */
export function projectRuntimeScope(scope:DispatchScope):RuntimeScope {
  const result:RuntimeScope={workspaceId:scope.workspaceId,rootSessionId:scope.rootSessionId,scopeId:scope.scopeId,status:scope.status,createdAt:scope.createdAt,hasGoal:scope.goal!==undefined,
    ...(scope.closedAt!==undefined?{closedAt:scope.closedAt}:{}),...(scope.outcome!==undefined?{outcome:scope.outcome}:{}),
    ...(scope.goal?{goalRevision:scope.goal.revision}:{}),...(scope.goal?.review?{reviewDecision:scope.goal.review.decision}:{}),
    ...(scope.goal?.blocked?{goalBlocked:{reason:preview(scope.goal.blocked.reason)}}:{}),
    ...(scope.wait?{wait:{createdAt:scope.wait.createdAt,reason:preview(scope.wait.reason)}}:{}),
    ...(scope.budget?.blocked?{budgetBlocked:{reason:scope.budget.blocked.reason}}:{})};
  return runtimeScopeSchema.parse(result);
}
