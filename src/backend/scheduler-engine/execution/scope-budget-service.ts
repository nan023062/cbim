/**
 * 作用定位：在调度事务内核实周期软限额，并将许可证明或拒绝事实交给同一事务保存。
 * 设计原因：公开统计与启动授权分离；可信主启动占位覆盖登记后尚未落日志的窗口，退出后缺失记录仍是未知，不据此自动恢复。
 * 职责边界：只限制下一次运行，不中断已接收运行、不调用模型解释，不消费安全等待或改写目标验收。
 */
import {fail} from '../../core/foundation/errors';
import {hash,json} from '../../core/foundation/serialization';
import {summarizeScopeUsage} from '../../core/brain/scope-usage';
import {evaluateScopeBudget,scopeBudgetPolicySchema,type ScopeBudgetPolicy,type ScopeBudgetObservation} from '../../core/tasks/scope-budget';
import type {DispatchScope} from '../../core/tasks/dispatch-scope';
import type {DispatchState} from '../../core/tasks/dispatch-storage';
import type {ScopeUsageService} from './scope-usage-service';

export type BudgetCandidate={runId:string;kind:'main'|'member';taskId:string};
/** 私有事务回执只标记拒绝，绝不是已受理运行；事务完成后再抛错，避免丢失 blocked 记录。 */
export type ScopeBudgetRejected={budgetRejected:NonNullable<NonNullable<DispatchScope['budget']>['blocked']>};
export function rejectBudget(result:ScopeBudgetRejected):never{
    const reason=result.budgetRejected.reason;
    fail(reason==='usage_unverifiable'?'SCOPE_BUDGET_UNVERIFIABLE':'SCOPE_BUDGET_EXCEEDED',reason==='usage_unverifiable'?'当前周期所需用量无法可靠核实，未启动新的运行；请核实记录或结束后另建目标':'当前周期已达到冻结的软限额，未启动新的运行；现有结果和等待检查点保留');
}
export class ScopeBudgetService {
  private readonly liveMain=new Set<string>();
  constructor(private readonly usage:ScopeUsageService,private readonly policy:()=>ScopeBudgetPolicy=()=>({revision:1,enabled:false,limits:{}})){}
  /** 必须覆盖 beforeRun 到引擎关闭全过程；仅内存可信占位，重开不复原它，也不修改持久计量。 */
  holdMain(runId:string):()=>void{if(this.liveMain.has(runId))fail('SCOPE_BUDGET_RUN_CONFLICT','主运行启动身份已被占用');this.liveMain.add(runId);return ()=>{this.liveMain.delete(runId)}}
  /** 新周期空历史允许首轮；策略与第一条运行证明一起进入创建事务，之后设置变化不会修改它。 */
  initialize(scope:DispatchScope,candidate:BudgetCandidate):DispatchScope{
    const policy=scopeBudgetPolicySchema.parse(structuredClone(this.policy())),observation:ScopeBudgetObservation={basis:hash(json({scopeId:scope.scopeId,empty:true})),observedAt:new Date().toISOString(),registeredRuns:0,coverage:'tracked',consistency:'stable',liveRunIds:[],tokens:0,tokensComplete:true,estimatedCostUsd:0,costComplete:true,unknownRunIds:[]};
    return {...scope,budget:{version:1,policy,...(policy.enabled?{lastAdmission:{...candidate,policyRevision:policy.revision,observation}}:{})}};
  }
  /** 只能在既有串行事务中调用；等待不写入回执，拒绝返回 mutation 所需的 scope，不在事务中抛掉拒绝事实。 */
  async admit(state:DispatchState,scope:DispatchScope,candidate:BudgetCandidate):Promise<{scope:DispatchScope;rejected?:ScopeBudgetRejected}>{
    const budget=scope.budget;if(!budget?.policy.enabled)return {scope};
    if(budget.blocked)return {scope,rejected:{budgetRejected:budget.blocked}};
    const tasks=state.graphs.find(graph=>graph.identity.rootSessionId===scope.rootSessionId)?.tasks.filter(task=>task.scopeId===scope.scopeId)??[],taskIds=new Set(tasks.map(task=>task.taskId));
    const live=[...(scope.runTracking?.mainRunIds??[]).filter(id=>this.liveMain.has(id)),...(state.runs??[]).filter(run=>taskIds.has(run.binding.taskId)&&['starting','running'].includes(run.status)).map(run=>run.binding.runId)];
    if(live.length)fail('SCOPE_BUDGET_WAITING','本周期上一运行尚未可靠结算，等待释放后再核实软限额');
    const collected=await this.usage.collect(state,{workspaceId:scope.workspaceId,rootSessionId:scope.rootSessionId,scopeId:scope.scopeId}),coverage=scope.runTracking?'tracked':'legacy',totals=summarizeScopeUsage(collected.runs,coverage,'stable');
    const unknownRunIds=collected.runs.filter(run=>run.logState!=='verified'||['starting','running','unknown'].includes(run.status)||(budget.policy.limits.tokens!==undefined&&run.usage.tokensState!=='reported')||(budget.policy.limits.estimatedCostUsd!==undefined&&run.usage.costState!=='priced')).map(run=>run.runId);
    const observation:ScopeBudgetObservation={basis:hash(json(collected)),observedAt:new Date().toISOString(),registeredRuns:collected.runs.length,coverage,consistency:'stable',liveRunIds:[],tokens:totals.tokens.total,tokensComplete:totals.tokensComplete,estimatedCostUsd:totals.estimatedCostUsd,costComplete:totals.costComplete,unknownRunIds};
    const decision=evaluateScopeBudget(budget.policy,observation);
    if(decision.kind==='wait')fail('SCOPE_BUDGET_WAITING','本周期上一运行尚未可靠结算');
    if(decision.kind==='deny'){
      const blocked={decisionId:hash(json({scopeId:scope.scopeId,candidate,observation})),policyRevision:budget.policy.revision,reason:decision.reason,observation};
      return {scope:{...scope,budget:{...budget,blocked}},rejected:{budgetRejected:blocked}};
    }
    return {scope:{...scope,budget:{...budget,lastAdmission:{...candidate,policyRevision:budget.policy.revision,observation}}}};
  }
}
