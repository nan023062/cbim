/**
 * executionPolicy 公开原模式及不含凭据的模型指纹，帮助工具和界面解释兜底，读取不更改规则。
 * 作用定位：提供周期详情与主工具共用的纯公开 Schema、类型和白名单投影。
 * 设计原因：两条读取链必须保留真实 recovery/replan 来源，同时剔除私有原生上下文；叶子不引入哈希或 Node API，供 Bridge 和浏览器共用。
 * 职责边界：只传输既有事实，不创建恢复许可；后端完整任务与事务不变量另行核验。
 */
import {collaborationPolicySchema} from '../../team/rules/automatic-execution';
import {z} from 'zod';
import type {DispatchScope} from './dispatch-scope';
import {dispatchScopeGoalSchema} from './scope-goal';
import {dispatchScopeWaitSchema} from './scope-continuation';
import {scopeContinuationRecordSchema} from './scope-continuation-record';
import {scopeRunTrackingSchema} from './scope-run-tracking';
import {scopeBudgetSchema} from '../../budget/rules/scope-budget';
import {scopeHumanDecisionsSchema} from './human-decisions';
import {scopeRecoverySchema} from './scope-recovery';
import {scopeReplanSchema} from './scope-replan';
import {scopeActiveInputSchema} from './scope-active-input';

const id=z.string().min(1).max(512).refine(value=>value.trim()===value&&!/[\x00-\x1f]/.test(value));
/** 公开来源保留精确事实、只读权限与处置关联；任何层都不能包含 context。 */
export const publicDispatchScopeSchema=z.object({
  scopeId:id,workspaceId:id,rootSessionId:id,status:z.enum(['active','waiting','closed']),createdAt:z.string().datetime(),
  goal:dispatchScopeGoalSchema.optional(),executionPolicy:collaborationPolicySchema.optional(),runTracking:scopeRunTrackingSchema.optional(),budget:scopeBudgetSchema.optional(),
  humanDecisions:scopeHumanDecisionsSchema.optional(),wait:dispatchScopeWaitSchema.optional(),
  continuations:z.array(scopeContinuationRecordSchema).max(31).optional(),activeInputs:z.array(scopeActiveInputSchema).min(1).max(64).optional(),
  recovery:scopeRecoverySchema.omit({context:true}).strict().optional(),replan:scopeReplanSchema.omit({context:true}).strict().optional(),
  closedAt:z.string().datetime().optional(),outcome:z.enum(['completed','failed','cancelled','interrupted']).optional(),
}).strict();
export type PublicDispatchScope=z.infer<typeof publicDispatchScopeSchema>;

/** 仅选取公开字段，不解析、默认化或修改领域值；调用方在其唯一传输边界校验。 */
export function projectMainScope(scope:DispatchScope):PublicDispatchScope {
  if(!scope||typeof scope!=='object'||Array.isArray(scope))return scope as unknown as PublicDispatchScope;
  const result:PublicDispatchScope={scopeId:scope.scopeId,workspaceId:scope.workspaceId,rootSessionId:scope.rootSessionId,status:scope.status,createdAt:scope.createdAt};
  for(const key of ['executionPolicy','goal','runTracking','budget','humanDecisions','wait','continuations','activeInputs','closedAt','outcome'] as const)if(scope[key]!==undefined)Object.assign(result,{[key]:scope[key]});
  if(scope.recovery!==undefined){
    if(!scope.recovery||typeof scope.recovery!=='object'||Array.isArray(scope.recovery))result.recovery=scope.recovery;
    else{const {recoveryId,acceptedAt,source,operation,observation,input,options,dispositionId}=scope.recovery;result.recovery={recoveryId,acceptedAt,source,operation,observation,input,options,...(dispositionId!==undefined?{dispositionId}:{})}}
  }
  if(scope.replan!==undefined){
    if(!scope.replan||typeof scope.replan!=='object'||Array.isArray(scope.replan))result.replan=scope.replan;
    else{const {replanId,acceptedAt,source,operation,input,options,dispositionId}=scope.replan;result.replan={replanId,acceptedAt,source,operation,input,options,...(dispositionId!==undefined?{dispositionId}:{})}}
  }
  return result;
}
