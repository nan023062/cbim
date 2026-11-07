/**
 * 作用定位：定义周期冻结的运行间软限额、可信计量观察和启动证明，并提供无副作用的准入判定。
 * 设计原因：额度只约束下一次运行；在途等待、未知消耗和达到额度分别表达，不能把统计界面的零或缓存当成执行许可。
 * 职责边界：本模块不读取日志、不启动或停止模型；观察须由调度层在提交屏障内核实，单轮内部仍可能超过额度。
 */
import {z} from 'zod';

const id=z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/);
const integer=z.number().int().nonnegative().safe();
const ids=z.array(id).max(532).refine(values=>new Set(values).size===values.length,'运行身份不能重复');
/** 美元额度是估算费用阈值；关闭时可保留用户填写值，但不应用限制。 */
export const scopeBudgetPolicySchema=z.object({revision:integer.min(1),enabled:z.boolean(),limits:z.object({tokens:integer.min(1).optional(),estimatedCostUsd:z.number().finite().positive().max(Number.MAX_SAFE_INTEGER).optional()}).strict()}).strict().refine(policy=>!policy.enabled||policy.limits.tokens!==undefined||policy.limits.estimatedCostUsd!==undefined,'启用时至少明确一个正数额度');
export type ScopeBudgetPolicy=z.infer<typeof scopeBudgetPolicySchema>;
export const defaultScopeBudgetPolicy:ScopeBudgetPolicy={revision:1,enabled:false,limits:{}};

/** 仅包含候选运行之前的已登记集合；live 来自当前可信生命周期，unknown 只列配置维度不可核实的来源，不从旧进程推断。 */
export const scopeBudgetObservationSchema=z.object({basis:id,observedAt:z.string().datetime(),registeredRuns:integer.max(532),coverage:z.enum(['tracked','legacy']),consistency:z.enum(['stable','changed_during_read']),liveRunIds:ids,tokens:integer,tokensComplete:z.boolean(),estimatedCostUsd:z.number().finite().nonnegative().optional(),costComplete:z.boolean(),unknownRunIds:ids}).strict().refine(value=>value.liveRunIds.length<=value.registeredRuns&&value.unknownRunIds.length<=value.registeredRuns,'观察的运行数量矛盾');
export type ScopeBudgetObservation=z.infer<typeof scopeBudgetObservationSchema>;
/** taskId 在主轮为 rootSessionId，在成员轮为业务 taskId；证明只随真实新运行提交，不能单独签发。 */
export const scopeBudgetAdmissionSchema=z.object({runId:id,kind:z.enum(['main','member']),taskId:id,policyRevision:integer.min(1),observation:scopeBudgetObservationSchema}).strict();
export type ScopeBudgetAdmission=z.infer<typeof scopeBudgetAdmissionSchema>;
export const scopeBudgetReasonSchema=z.enum(['token_limit','cost_limit','usage_unverifiable']);
export type ScopeBudgetReason=z.infer<typeof scopeBudgetReasonSchema>;
/** 拒绝不等于运行受理；独立于 goal.blocked 保存，不能消费安全等待或改变原目标。 */
export const scopeBudgetBlockedSchema=z.object({decisionId:id,policyRevision:integer.min(1),reason:scopeBudgetReasonSchema,observation:scopeBudgetObservationSchema}).strict();
export type ScopeBudgetBlocked=z.infer<typeof scopeBudgetBlockedSchema>;
export const scopeBudgetSchema=z.object({version:z.literal(1),policy:scopeBudgetPolicySchema,lastAdmission:scopeBudgetAdmissionSchema.optional(),blocked:scopeBudgetBlockedSchema.optional()}).strict();
export type ScopeBudget=z.infer<typeof scopeBudgetSchema>;
/** 摘要只公开冻结策略和拒绝事实；上一次通过证明保留在周期详情与原事务日志。 */
export const scopeBudgetSummarySchema=scopeBudgetSchema.pick({policy:true,blocked:true}).strict();
export type ScopeBudgetSummary=z.infer<typeof scopeBudgetSummarySchema>;
export type ScopeBudgetDecision={kind:'disabled'|'allow'}|{kind:'wait';runIds:string[]}|{kind:'deny';reason:ScopeBudgetReason;unknownRunIds:string[]};

/** 默认策略由可信设置入口提供；复制避免外部更改对象污染已经准备提交的周期。 */
export function createScopeBudget(policy:ScopeBudgetPolicy=defaultScopeBudgetPolicy):ScopeBudget{return {version:1,policy:scopeBudgetPolicySchema.parse(structuredClone(policy))}}

/** 金额只容忍同量级约四个浮点尾差；不以 1 作下限，避免把极小正额度误判为已被零费用消耗。 */
function costReached(value:number,limit:number):boolean{return value>=limit||limit-value<=4*Number.EPSILON*Math.max(Math.abs(value),Math.abs(limit))}

/** 先等待现有运行，不因额度已到而停止已受理工作；只对实际配置的维度要求完整用量。 */
export function evaluateScopeBudget(rawPolicy:ScopeBudgetPolicy,rawObservation:ScopeBudgetObservation):ScopeBudgetDecision {
  const policy=scopeBudgetPolicySchema.parse(rawPolicy);
  if(!policy.enabled)return {kind:'disabled'};
  const value=scopeBudgetObservationSchema.parse(rawObservation);
  if(value.liveRunIds.length)return {kind:'wait',runIds:[...value.liveRunIds]};
  const deny=(reason:ScopeBudgetReason):ScopeBudgetDecision=>({kind:'deny',reason,unknownRunIds:[...value.unknownRunIds]});
  if(value.coverage!=='tracked'||value.consistency!=='stable'||value.unknownRunIds.length)return deny('usage_unverifiable');
  // 首轮没有既有消耗；空集合与“旧记录缺失”不同，后者由归属计数和 coverage 保留。
  if(value.registeredRuns===0)return value.tokens===0&&(value.estimatedCostUsd===undefined||value.estimatedCostUsd===0)?{kind:'allow'}:deny('usage_unverifiable');
  if(policy.limits.tokens!==undefined&&!value.tokensComplete||policy.limits.estimatedCostUsd!==undefined&&(!value.costComplete||value.estimatedCostUsd===undefined))return deny('usage_unverifiable');
  if(policy.limits.tokens!==undefined&&value.tokens>=policy.limits.tokens)return deny('token_limit');
  if(policy.limits.estimatedCostUsd!==undefined&&costReached(value.estimatedCostUsd!,policy.limits.estimatedCostUsd))return deny('cost_limit');
  return {kind:'allow'};
}
