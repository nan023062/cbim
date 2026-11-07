/**
 * 作用定位：展示用户显式配置的新目标 Token/费用软限额，与全局并发设置相邻但独立保存。
 * 设计原因：默认关闭，提示只约束后续运行及新周期；不会承诺单次 Pi 多请求的硬费用上限，读取失败不显示成已关闭。
 */
import {useEffect,useMemo,useSyncExternalStore} from 'react';
import {BudgetSettingsController,budgetSettingsInput} from './budget-settings-state';
import './budget-settings.css';

/** 无自动保存；复用单一控制器隔离读取/保存与草稿，页面卸载后不发布旧响应。 */
export function BudgetSettings(){
  const controller=useMemo(()=>new BudgetSettingsController((action,input)=>window.cbim.call(action,input)),[]);
  const state=useSyncExternalStore(controller.subscribe,controller.snapshot,controller.snapshot);
  useEffect(()=>{void controller.load();return()=>controller.cancel()},[controller]);
  let valid=false;try{budgetSettingsInput(state,state.policy?.revision??1);valid=true}catch{}
  return <section className="repository-settings" aria-label="目标软限额设置" data-testid="budget-settings"><h2>目标软限额</h2>
    <p>主 Agent 与执行成员共用本目标的额度。默认关闭；保存后仅对新目标生效，已开始的目标和等待中的目标保留原设置。</p>
    <label className="budget-settings-toggle"><input type="checkbox" aria-label="启用新目标软限额" checked={state.enabled} disabled={!state.policy||state.busy} onChange={event=>controller.edit({enabled:event.target.checked})}/>启用新目标软限额</label>
    <div className="budget-settings-fields"><label>Token 软限额<input aria-label="Token 软限额" type="text" inputMode="numeric" placeholder="留空表示不限制这一项" value={state.tokens} disabled={!state.policy||state.busy||!state.enabled} onChange={event=>controller.edit({tokens:event.target.value})}/></label><label>估算费用软限额（美元）<input aria-label="估算费用软限额（美元）" type="text" inputMode="decimal" placeholder="留空表示不限制这一项" value={state.estimatedCostUsd} disabled={!state.policy||state.busy||!state.enabled} onChange={event=>controller.edit({estimatedCostUsd:event.target.value})}/></label></div>
    <div className="budget-settings-actions"><button className="solid-button" disabled={!state.policy||state.busy||!valid} onClick={()=>void controller.save()}>保存软限额</button><button disabled={state.busy} onClick={()=>void controller.load()}>刷新软限额</button></div>
    <p>达到任一额度后不再启动下一轮。已开始的一轮继续结算，可能因多个模型请求、重试或自动摘要超过额度；这不是硬账单上限。用量无法核实时不会按零放行。</p>
    <p>启用后，同一目标的主轮与成员轮按用量结算顺序执行；其它目标仍受全局并发上限控制。修改设置不会重启或解除旧目标的限制。</p>
    {!state.policy&&!state.error&&<p role="status">正在读取软限额设置…</p>}{state.notice&&<p role="status">{state.notice}</p>}{state.error&&<p role="alert">{state.error}</p>}
  </section>;
}
