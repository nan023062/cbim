/**
 * 作用定位：展示冻结目标的请求结算、预留和拒绝原因，与供应商账单及业务验收明确区分。
 * 设计原因：用户显式刷新；目标身份变化时更换控制器，旧响应不能串到新的目标，不提供解除未知或自动恢复按钮。
 * 金额展示保留六位有效数字，不改账本值；极小正金额保留科学记数，不能显示成明确零费用。
 */
import {useEffect,useMemo,useSyncExternalStore} from 'react';
import type {RequestBudgetDenial,ScopeBudgetSummary} from '../../bridge/contracts/scope-budget';
import {RequestBudgetController,type RequestBudgetQuery} from './request-budget-state';
const reasons:Record<RequestBudgetDenial,string>={token_reserve:'剩余 Token 不足本次保守预留',cost_reserve:'剩余本地估算费用不足本次预留',usage_unverifiable:'前序请求用量未核实或超过原预留',unpriced:'冻结模型价格不完整',capacity:'请求审计容量已满'};
/** 仅格式化已验证金额；压缩浮点尾数，但不把微小正值四舍五入为免费。 */
export const requestBudgetMoney=(value:number)=>'$'+Number(value.toPrecision(6)).toString();
/** 只读取本目标账本；未读取时保留提示，不以 0 替代未知。 */
export function RequestBudgetPanel({query,budget}:{query:RequestBudgetQuery;budget:ScopeBudgetSummary}){
  const controller=useMemo(()=>new RequestBudgetController(query,budget.policy.revision,q=>window.cbim.call('dispatch.requestBudget',q)),[query.workspaceId,query.rootSessionId,query.scopeId,budget.policy.revision]);
  const state=useSyncExternalStore(controller.subscribe,controller.snapshot,controller.snapshot);
  useEffect(()=>()=>controller.dispose(),[controller]);const report=state.report;
  return <div data-testid="request-budget-panel"><button disabled={state.busy} onClick={()=>void controller.load()}>刷新请求账本</button>
    {state.error&&<p role="alert">{state.error}</p>}
    {!report?<p className="scope-goal-muted">尚未读取逐请求账本。</p>:<>
      <p className="scope-goal-muted">以下为最近一次读取的记录。</p>
      <p data-testid="request-budget-counts">已结算 {report.reported} 次 · 在途 {report.inFlight} 次 · 未知 {report.unknown} 次 · 拒绝 {report.denied} 次 · 明确未发送 {report.notSent} 次</p>
      <p>已结算 {report.tokens.toLocaleString()} Token；预留 {report.reservedTokens.toLocaleString()} Token。{budget.policy.limits.tokens!==undefined&&`剩余可预留 ${Math.max(0,budget.policy.limits.tokens-report.tokens-report.reservedTokens).toLocaleString()} Token。`}</p>
      <p>本地估算 {requestBudgetMoney(report.estimatedCostUsd)}；预留约 {requestBudgetMoney(report.reservedCostUsd)}。{!report.costComplete&&'价格或用量不完整，不能把这些金额当总费用。'}</p>
      {(report.unknown>0||report.overrun>0)&&<p role="status" className="scope-goal-blocked">存在待核实请求或超出原预留的报告，后续请求保持停止；刷新和重开不会释放原预留。</p>}
      {report.lastDenial&&<p role="status" data-testid="request-budget-denial">最近拒绝：{reasons[report.lastDenial]}，未向供应商发送该请求。所需预留 {report.lastDeniedTokens} Token{report.lastDeniedCostUsd===undefined?'':` / 约 ${requestBudgetMoney(report.lastDeniedCostUsd)}`}。</p>}
      <p className="scope-goal-muted">仅为本机请求记录，不是供应商账单；显式全零价格与未知价格不同。</p>
    </>}
  </div>;
}
