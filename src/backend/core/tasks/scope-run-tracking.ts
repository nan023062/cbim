/**
 * 作用定位：定义新调度周期从创建起登记的主运行清单及纯追加规则。
 * 设计原因：主会话跨多个目标，不能按时间猜测归属；登记先于日志和模型，因此缺日志仍是待核实意图。旧周期不补造完整性，成员继续使用既有任务/运行绑定。
 */
import {z} from 'zod';
import {fail} from '../foundation/errors';

const runId=z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/);
export const scopeRunTrackingSchema=z.object({version:z.literal(1),mainRunIds:z.array(runId).min(1).max(32).refine(ids=>new Set(ids).size===ids.length)}).strict();
/** version 表示从创建起完整登记，不表示全部运行已启动或全部消耗已报告。 */
export type ScopeRunTracking=z.infer<typeof scopeRunTrackingSchema>;
type TrackingScope={status:'active'|'waiting'|'closed';runTracking?:ScopeRunTracking};
/** 只在新周期的可信首轮启动事务中创建；不能用于升级已存在的 legacy 周期。 */
export function createScopeRunTracking(id:string):ScopeRunTracking{return scopeRunTrackingSchema.parse({version:1,mainRunIds:[id]})}
/** 同身份重复为只读返回；新主轮只追加 active 周期。合法补充须先在同事务构造 active 的新周期。 */
export function appendScopeMainRun<T extends TrackingScope>(scope:T,id:string):T {
  const parsed=runId.safeParse(id);if(!parsed.success)fail('GOAL_RUN_CONFLICT','主运行身份无效');
  if(!scope.runTracking)return scope;
  const tracking=scopeRunTrackingSchema.safeParse(scope.runTracking);if(!tracking.success)fail('GOAL_RUN_CONFLICT','周期主运行清单无效');
  if(tracking.data.mainRunIds.includes(id))return scope;
  if(scope.status!=='active')fail('DISPATCH_SCOPE_CLOSED','只有活动周期可以登记新主运行');
  if(tracking.data.mainRunIds.length>=32)fail('GOAL_CYCLE_LIMIT','本次目标已达到 32 次主调度运行');
  return {...scope,runTracking:{version:1,mainRunIds:[...tracking.data.mainRunIds,id]}};
}
