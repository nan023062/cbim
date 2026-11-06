/**
 * 作用定位：定义一次用户任务的调度周期，与长期主会话和单次模型运行区分。
 * 设计原因：一次目标可以经历多轮调度、执行和结果回注；冻结真实输入，并以无活动执行的 waiting 检查点等待用户。关闭和等待都保留输入、图和证据，不能在每次 LLM 回合结束时销毁成员。
 */
import {z} from 'zod';
import type {DispatchScopeGoal} from './scope-goal';
export {dispatchScopeGoalSchema,dispatchScopeInputSchema} from './scope-goal';
export type {DispatchScopeInput,DispatchScopeGoal} from './scope-goal';

export type DispatchScopeOutcome='completed'|'failed'|'cancelled'|'interrupted';
const id=z.string().min(1).max(512).refine(value=>value.trim()===value&&!/[\x00-\x1f]/.test(value));
/** 可信协调器在主轮与成员全部安全收尾后创建；主轮预算只冻结已观察 ID，不因等待或重启重置。 */
export const dispatchScopeWaitSchema=z.object({waitId:id,reason:z.string().trim().min(1).max(16000),createdAt:z.string().datetime(),runId:id,goalRevision:z.number().int().min(1).max(65),graphCursor:z.object({streamId:id,seq:z.number().int().min(1).max(Number.MAX_SAFE_INTEGER)}).strict(),knowledgeRevision:id,mainRunIds:z.array(id).min(1).max(32).refine(values=>new Set(values).size===values.length)}).strict().refine(value=>value.mainRunIds.includes(value.runId),'等待检查点必须包含当前主运行');
export type DispatchScopeWait=z.infer<typeof dispatchScopeWaitSchema>;
/** scopeId 由可信入口创建；waiting 占用未关闭周期槽但没有活动模型，closed 不代表业务已验收。 */
export interface DispatchScope {
  scopeId:string;
  workspaceId:string;
  rootSessionId:string;
  status:'active'|'waiting'|'closed';
  createdAt:string;
  /** 原始输入冻结，计划/审阅逐版追加；缺省仅表示旧记录，不从首轮任务或历史正文猜测补造。 */
  goal?:DispatchScopeGoal;
  /** waiting 必有；关闭后作为不可改写历史保留。本阶段没有 waiting→active 或修改补充目标的入口。 */
  wait?:DispatchScopeWait;
  closedAt?:string;
  outcome?:DispatchScopeOutcome;
}
