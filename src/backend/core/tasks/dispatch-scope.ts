/**
 * 作用定位：定义一次用户任务的调度周期，与长期主会话和单次模型运行区分。
 * 设计原因：一次目标可以经历多轮调度、执行和结果回注；冻结原始输入与软限额。保存人工决定不消费 waiting，独立显式继续才追加新输入版；异常核实和重规划另建周期，旧损坏链不复活。
 */
import type {DispatchScopeGoal} from './scope-goal';
import type {DispatchScopeWait} from './scope-continuation';
import type {ScopeContinuationRecord} from './scope-continuation-record';
import type {ScopeRecovery} from './scope-recovery';
import type {ScopeReplan} from './scope-replan';
import type {ScopeRunTracking} from './scope-run-tracking';
import type {ScopeBudget} from './scope-budget';
import type {ScopeHumanDecisions} from './human-decisions';
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
  /** 新周期自创建起登记的主运行启动意图；旧周期缺省，不以日志时间或计划内容补造归属。 */
  runTracking?:ScopeRunTracking;
  /** 创建时冻结运行间软限额；legacy 缺省不补造，拒绝记录不替代目标阻塞或人工验收。 */
  budget?:ScopeBudget;
  /** 本机显式选择的有界追加历史；不改变 goal/review，不消费等待，不代表整个目标已验收。 */
  humanDecisions?:ScopeHumanDecisions;
  /** waiting 必有；显式补充原样移入 continuations，取消关闭仍原样保留；不等于模型可自动恢复。 */
  wait?:DispatchScopeWait;
  /** 文本补充与人工决定接续共用有序输入版本；人工分支无自由正文，原始 input 与旧等待永久保留。 */
  continuations?:ScopeContinuationRecord[];
  /** 仅新只读核实周期有值；来源、用户观察和全新原生上下文边界创建后永不改写，旧周期不复活。 */
  recovery?:ScopeRecovery;
  /** 独立的业务重规划意图，须有已完成只读核实证明；与 recovery 互斥且永不改写。 */
  replan?:ScopeReplan;
  closedAt?:string;
  outcome?:DispatchScopeOutcome;
}
