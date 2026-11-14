/**
 * 作用定位：在会话任务视图按需展示所选目标周期的主/成员已报告消耗与逐运行来源。
 * 设计原因：每次查询都有明确截至时间，历史缺口、在途和价格未知分别表达；默认不回扫日志，不将消耗统计当作账单或任务验收。
 */
import {useEffect,useMemo,useSyncExternalStore} from 'react';
import type {ScopeUsageInput,ScopeUsageReport,ScopeUsageRun} from '../../bridge/contracts/scope-usage';
import {tokenCount} from '../../bridge/contracts/usage';
import {ScopeUsageController,scopeUsageKey,scopeUsageGroup,type ScopeUsageState} from './scope-usage-state';
import './scope-usage.css';

const money=(value:number|undefined)=>value===undefined?'价格未知':`$${value.toFixed(6)}`;
const status:Record<ScopeUsageRun['status'],string>={starting:'准备中',running:'执行中',completed:'本轮结束',failed:'失败',cancelled:'已停止',interrupted:'中断',unknown:'待核实'};
const logState:Record<ScopeUsageRun['logState'],string>={verified:'已读取',missing:'日志缺失',invalid:'日志异常',incomplete:'日志未完整',identity_mismatch:'身份不符'};
const tokensState={reported:'原生汇总',partial:'部分已报告',missing:'用量缺失'};

/** 纯展示面板，便于核对未知费用与真实零价的区别；报告中无原始消息或路径。 */
export function ScopeUsageSummary({report}:{report:ScopeUsageReport}){
  const {totals}=report,main=scopeUsageGroup(report.runs.filter(run=>run.kind==='main')),member=scopeUsageGroup(report.runs.filter(run=>run.kind==='member'));
  return <div className="scope-usage-summary" data-testid="scope-usage-summary">
    <p className="scope-usage-muted">截至 {new Date(report.checkedAt).toLocaleString()} · 按需快照，运行变化后请刷新。</p>
    {report.coverage==='legacy'&&<p role="status">旧周期没有完整主运行归属，只显示可核实部分，不能视为完整统计。</p>}
    {report.consistency!=='stable'&&<p role="status">读取期间周期记录发生变化，本次统计不完整，请刷新。</p>}
    <div className="scope-usage-groups">
      <div><strong>已报告合计</strong><span data-testid="scope-usage-total-tokens">{tokenCount(totals.tokens.total)} token</span><span data-testid="scope-usage-total-cost">估算 {money(totals.estimatedCostUsd)}{!totals.costComplete&&totals.estimatedCostUsd!==undefined?'（已知部分）':''}</span></div>
      <div><strong>主 Agent · {main.runs} 轮</strong><span>{tokenCount(main.tokens)} token</span><span>已知估算 {money(main.cost)}</span></div>
      <div><strong>执行成员 · {member.runs} 轮</strong><span>{tokenCount(member.tokens)} token</span><span>已知估算 {money(member.cost)}</span></div>
    </div>
    <p>登记 {totals.registeredRuns} 轮 · 已读 {totals.readRuns} 轮 · 在途 {totals.inFlightRuns} 轮</p>
    <p className="scope-usage-muted">用量缺失 {totals.missingUsageRuns} 轮 · 部分用量 {totals.partialUsageRuns} 轮 · 价格未完整 {totals.unpricedRuns} 轮</p>
    {!totals.tokensComplete&&<p role="status">用量记录尚不完整，以上数字只包含已报告部分。</p>}
    {report.issues.length>0&&<ul>{report.issues.map((issue,index)=><li key={issue.code+':'+index}>{issue.message}</li>)}</ul>}
    <details><summary>查看逐运行来源（{report.runs.length}）</summary><div className="scope-usage-runs">{report.runs.map(run=><article key={run.runId}><strong>{run.kind==='main'?'主 Agent':'执行成员'} · {status[run.status]}</strong><p>{logState[run.logState]} · {tokensState[run.usage.tokensState]} · {tokenCount(run.usage.tokens.total)} token · {money(run.usage.estimatedCostUsd)}{run.usage.costState==='partial'?'（部分）':''}</p><p className="scope-usage-identity">任务 {run.taskId}<br/>运行 {run.runId}</p>{run.usage.issues.length>0&&<ul>{run.usage.issues.map((issue,index)=><li key={issue.code+':'+index}>{issue.message}</li>)}</ul>}</article>)}</div></details>
    <p className="scope-usage-muted">推理已包含在输出中，不重复计入总数；累计消耗不同于上下文占用。费用是已报告估算，不是供应商账单或预算限制，也不代表业务验收。</p>
  </div>;
}

/** 读取入口只操作本控制器；保持之前报告时明确提示过期，不把错误渲染成零。 */
export function ScopeUsageReadView({state,onRead}:{state:ScopeUsageState;onRead():void}){return <>
  <header><h3>本次目标用量</h3><button disabled={state.loading} onClick={onRead}>{state.loading?'正在读取用量…':state.report?'刷新周期用量':'读取周期用量'}</button></header>
  {state.error&&<p role="alert">{state.error}{state.report?'；保留上次快照，可能已过期。':''}</p>}
  {state.report?<ScopeUsageSummary report={state.report}/>:<p className="scope-usage-muted">按需核对本周期主 Agent 与执行成员的记录。未读取不表示没有消耗。</p>}
</>}

/** 实例与周期键绑定；挂载或切换不会读取，卸载后迟到响应不会显示在另一个周期。 */
export function ScopeUsagePanel({identity}:{identity:ScopeUsageInput}){
  const key=scopeUsageKey(identity),controller=useMemo(()=>new ScopeUsageController(identity,input=>window.cbim.call('dispatch.scopeUsage',input)),[key]);
  const state=useSyncExternalStore(controller.subscribe,()=>controller.snapshot,()=>controller.snapshot);
  useEffect(()=>()=>controller.cancel(),[controller]);
  return <section className="scope-usage-panel" aria-label="目标周期用量" data-testid="scope-usage-panel" data-scope-id={identity.scopeId}><ScopeUsageReadView state={state} onRead={()=>void controller.read()}/></section>;
}
