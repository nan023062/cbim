/**
 * 作用定位：在调度事务内核实周期额度，并将许可证明或拒绝事实交给同一事务保存；逐请求模式读取独立请求账本。
 * 设计原因：公开统计与启动授权分离；可信主启动占位覆盖登记后尚未落日志的窗口，退出后缺失记录仍是未知，不据此自动恢复。
 * 职责边界：只限制下一次运行；逐请求预检仅消费预算视图，不要求完整调度状态。不中断已接收运行、不消费安全等待或改写目标验收。
 */
import {fail} from '../../core/foundation/errors';
import {hash,json} from '../../core/foundation/serialization';
import {summarizeScopeUsage} from '../../core/brain/scope-usage';
import {evaluateScopeBudget,scopeBudgetPolicySchema,type ScopeBudgetPolicy,type ScopeBudgetObservation} from '../../core/tasks/scope-budget';
import type {DispatchScope} from '../../core/tasks/dispatch-scope';
import type {DispatchState} from '../../core/tasks/dispatch-storage';
import type {ScopeUsageService} from './scope-usage-service';
import {requestBudgetRecords,requestBudgetReport,requestBudgetReservation,requestBudgetDecision} from '../../core/tasks/model-request-budget-rules';
import type {RequestBudgetModel} from '../../core/tasks/model-request-budget';
import type {RequestBudgetState,RequestBudgetScope} from '../../core/tasks/model-request-budget-storage';

export type BudgetCandidate={runId:string;kind:'main'|'member';taskId:string;model?:Pick<RequestBudgetModel,'contextWindow'|'maxTokens'|'pricing'>};
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
  /** 仅可信请求账本核实当前主进程占位；历史登记不能替代这份运行生命周期。 */
  isMainLive(runId:string):boolean{return this.liveMain.has(runId)}
  /** 新周期空历史允许首轮；策略与第一条运行证明一起进入创建事务，之后设置变化不会修改它。 */
  initialize(scope:DispatchScope,candidate:BudgetCandidate):DispatchScope{
    const policy=scopeBudgetPolicySchema.parse(structuredClone(this.policy())),observation:ScopeBudgetObservation={basis:hash(json({scopeId:scope.scopeId,empty:true})),observedAt:new Date().toISOString(),registeredRuns:0,coverage:'tracked',consistency:'stable',liveRunIds:[],tokens:0,tokensComplete:true,estimatedCostUsd:0,costComplete:true,unknownRunIds:[]};
    const {model:_model,...identity}=candidate;return {...scope,budget:{version:1,policy,...(policy.enabled?{lastAdmission:{...identity,policyRevision:policy.revision,observation}}:{})}};
  }
  /** 只能在既有串行事务中调用；等待不写入回执，拒绝返回 mutation 所需的 scope，不在事务中抛掉拒绝事实。 */
  async admit(state:DispatchState,scope:DispatchScope,candidate:BudgetCandidate):Promise<{scope:DispatchScope;rejected?:ScopeBudgetRejected}>{
    const budget=scope.budget;if(!budget?.policy.enabled)return {scope};
    if(budget.blocked)return {scope,rejected:{budgetRejected:budget.blocked}};
    const tasks=state.graphs.find(graph=>graph.identity.rootSessionId===scope.rootSessionId)?.tasks.filter(task=>task.scopeId===scope.scopeId)??[],taskIds=new Set(tasks.map(task=>task.taskId));
    const live=[...(scope.runTracking?.mainRunIds??[]).filter(id=>this.liveMain.has(id)),...(state.runs??[]).filter(run=>taskIds.has(run.binding.taskId)&&['starting','running'].includes(run.status)).map(run=>run.binding.runId)];
    if(live.length)fail('SCOPE_BUDGET_WAITING','本周期上一运行尚未可靠结算，等待释放后再核实软限额');
    const observation=budget.policy.enforcement==='request'?this.requestObservation(state,scope):await this.legacyObservation(state,scope);
    const decision=evaluateScopeBudget(budget.policy,observation);
    if(decision.kind==='wait')fail('SCOPE_BUDGET_WAITING','本周期上一运行尚未可靠结算');
    if(decision.kind==='deny'){
      const blocked={decisionId:hash(json({scopeId:scope.scopeId,candidate,observation})),policyRevision:budget.policy.revision,reason:decision.reason,observation};
      return {scope:{...scope,budget:{...budget,blocked}},rejected:{budgetRejected:blocked}};
    }
    if(candidate.model)this.preflightRequest(state,scope,candidate.model);
    const {model:_model,...identity}=candidate;
    return {scope:{...scope,budget:{...budget,lastAdmission:{...identity,policyRevision:budget.policy.revision,observation}}}};
  }
  /** 等待补充或成员领取前先核保守容量，拒绝时不消费检查点；这是预检，不代替发送前的原子预留。 */
  preflightRequest(state:RequestBudgetState,scope:RequestBudgetScope,model:Pick<RequestBudgetModel,'contextWindow'|'maxTokens'|'pricing'>):void{
    const policy=scope.budget?.policy;if(!policy?.enabled||policy.enforcement!=='request')return;
    const records=requestBudgetRecords(state.modelRequestBudgetChanges??[]),report=requestBudgetReport(records,{workspaceId:scope.workspaceId,rootSessionId:scope.rootSessionId,scopeId:scope.scopeId,policyRevision:policy.revision},'no_live_run'),reservation=requestBudgetReservation(model,model.maxTokens),reason=requestBudgetDecision(policy,report,reservation,records);
    if(reason)fail('MODEL_REQUEST_PREFLIGHT',reason==='token_reserve'?`下一请求需预留 ${reservation.tokens} Token，剩余 ${Math.max(0,(policy.limits.tokens??0)-report.tokens-report.reservedTokens)} Token；原等待或待领取任务保留`:reason==='cost_reserve'?`下一请求需预留约 $${reservation.estimatedCostUsd}，剩余约 $${Math.max(0,(policy.limits.estimatedCostUsd??0)-report.estimatedCostUsd-report.reservedCostUsd)}；原等待或待领取任务保留`:'下一请求预算无法可靠核实；原等待或待领取任务保留');
  }
  /** 已无真实在途运行时，所有未决请求均阻止下一轮；没有请求事实的旧运行也不凭空当零。 */
  private requestObservation(state:DispatchState,scope:DispatchScope):ScopeBudgetObservation{
    const tasks=new Set(state.graphs.find(g=>g.identity.rootSessionId===scope.rootSessionId)?.tasks.filter(t=>t.scopeId===scope.scopeId).map(t=>t.taskId)??[]);
    const ids=[...scope.runTracking?.mainRunIds??[],...(state.runs??[]).filter(r=>tasks.has(r.binding.taskId)).map(r=>r.binding.runId)];
    const records=requestBudgetRecords(state.modelRequestBudgetChanges??[]).filter(r=>r.intent.binding.scopeId===scope.scopeId),identity={workspaceId:scope.workspaceId,rootSessionId:scope.rootSessionId,scopeId:scope.scopeId,policyRevision:scope.budget!.policy.revision};
    const report=requestBudgetReport(records,identity,'no_live_run'),unknownRunIds=ids.filter(id=>{const own=records.filter(r=>r.intent.binding.runId===id),part=requestBudgetReport(own,identity,'no_live_run');return !own.length||!!part.unknown||!!part.overrun});
    return {basis:hash(json({ids,records})),observedAt:new Date().toISOString(),registeredRuns:ids.length,coverage:scope.runTracking?'tracked':'legacy',consistency:'stable',liveRunIds:[],tokens:report.tokens,tokensComplete:!unknownRunIds.length,estimatedCostUsd:report.estimatedCostUsd,costComplete:report.costComplete&&!unknownRunIds.length,unknownRunIds};
  }
  private async legacyObservation(state:DispatchState,scope:DispatchScope):Promise<ScopeBudgetObservation>{
    const budget=scope.budget!,collected=await this.usage.collect(state,{workspaceId:scope.workspaceId,rootSessionId:scope.rootSessionId,scopeId:scope.scopeId}),coverage=scope.runTracking?'tracked':'legacy',totals=summarizeScopeUsage(collected.runs,coverage,'stable');
    const unknownRunIds=collected.runs.filter(run=>run.logState!=='verified'||['starting','running','unknown'].includes(run.status)||(budget.policy.limits.tokens!==undefined&&run.usage.tokensState!=='reported')||(budget.policy.limits.estimatedCostUsd!==undefined&&run.usage.costState!=='priced')).map(run=>run.runId);
    return {basis:hash(json(collected)),observedAt:new Date().toISOString(),registeredRuns:collected.runs.length,coverage,consistency:'stable',liveRunIds:[],tokens:totals.tokens.total,tokensComplete:totals.tokensComplete,estimatedCostUsd:totals.estimatedCostUsd,costComplete:totals.costComplete,unknownRunIds};
  }
}
