/**
 * 作用定位：在主对话和任务根的目标卡片展示本周期冻结额度与真实预算拒绝原因。
 * 设计原因：设置变更只影响新周期，展示必须来自周期投影；额度拒绝独立于目标审阅和人工验收，不把安全 waiting 的拒绝解释为检查点已消费。
 */
import type {ScopeBudgetSummary,ScopeBudgetReason} from '../../bridge/contracts/scope-budget';

const reasons:Record<ScopeBudgetReason,string>={token_limit:'已达到 Token 软限额',cost_limit:'已达到估算费用软限额',usage_unverifiable:'本目标的用量暂时无法完整核实'};
/** 缺省表示旧周期没有冻结策略，不读取全局设置来补造当前限额。 */
export function ScopeBudgetPanel({budget,waiting=false}:{budget?:ScopeBudgetSummary;waiting?:boolean}){
  if(!budget)return <p className="scope-goal-muted" data-testid="scope-budget-panel">本目标未应用软限额（旧周期）。</p>;
  if(!budget.policy.enabled)return <p className="scope-goal-muted" data-testid="scope-budget-panel">本目标软限额未启用。</p>;
  const {limits}=budget.policy;
  return <div className="scope-goal-section" data-testid="scope-budget-panel" data-budget-state={budget.blocked?'blocked':'enabled'}>
    <p><strong>本目标软限额</strong> · {[limits.tokens===undefined?'':`${limits.tokens.toLocaleString()} token`,limits.estimatedCostUsd===undefined?'':`估算 $${limits.estimatedCostUsd}`].filter(Boolean).join(' / ')}</p>
    {budget.blocked&&<p role="status" className="scope-goal-blocked" data-testid="scope-budget-blocked">{reasons[budget.blocked.reason]}，未启动下一轮。{waiting?'原等待检查点仍保留，补充尚未受理。':'已发生的执行与用量仍保留。'}</p>}
    <p className="scope-goal-muted">冻结于设置第 {budget.policy.revision} 版，修改设置不影响本目标。运行间检查，单轮可能超额；不代表硬账单或业务验收。</p>
  </div>;
}
