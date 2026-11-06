/**
 * 作用定位：定义一次用户任务的调度周期，与长期主会话和单次模型运行区分。
 * 设计原因：一次目标可以经历多轮调度、执行和结果回注；冻结原始输入，以 waiting 安全等待，显式补充通过一次性意图继续同一目标。关闭和等待都保留输入、图和证据，不随单次 LLM 结束销毁成员。
 */
import type {DispatchScopeGoal} from './scope-goal';
import type {DispatchScopeWait,ScopeContinuation} from './scope-continuation';
export {dispatchScopeWaitSchema} from './scope-continuation';
export type {DispatchScopeWait} from './scope-continuation';
export {dispatchScopeGoalSchema,dispatchScopeInputSchema} from './scope-goal';
export type {DispatchScopeInput,DispatchScopeGoal} from './scope-goal';

export type DispatchScopeOutcome='completed'|'failed'|'cancelled'|'interrupted';
/** scopeId 由可信入口创建；waiting 占用未关闭周期槽但没有活动模型，closed 不代表业务已验收。 */
export interface DispatchScope {
  scopeId:string;
  workspaceId:string;
  rootSessionId:string;
  status:'active'|'waiting'|'closed';
  createdAt:string;
  /** 原始输入冻结，计划/审阅逐版追加；缺省仅表示旧记录，不从首轮任务或历史正文猜测补造。 */
  goal?:DispatchScopeGoal;
  /** waiting 必有；显式补充原样移入 continuations，取消关闭仍原样保留；不等于模型可自动恢复。 */
  wait?:DispatchScopeWait;
  /** 仅可信用户继续入口追加，含已消费旧 wait 和真实启动 ID；原始 input 永不覆盖，旧历史缺省。 */
  continuations?:ScopeContinuation[];
  closedAt?:string;
  outcome?:DispatchScopeOutcome;
}
