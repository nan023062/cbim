import {it,expect} from 'vitest';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {ScopeBudgetPanel} from '../src/frontend/tasks/ScopeBudgetPanel';
import type {ScopeBudgetSummary,ScopeBudgetReason} from '../src/bridge/contracts/scope-budget';

const render=(budget?:ScopeBudgetSummary,waiting=false)=>renderToStaticMarkup(createElement(ScopeBudgetPanel,{budget,waiting}));
it('distinguishes legacy from explicitly disabled without borrowing current settings',()=>{
  expect(render()).toContain('旧周期');expect(render()).not.toContain('未启用');
  expect(render({policy:{revision:2,enabled:false,limits:{}}})).toContain('软限额未启用');
  const html=render({policy:{revision:7,enabled:true,limits:{tokens:1000,estimatedCostUsd:0.01}}});expect(html).toContain('1,000 token');expect(html).toContain('估算 $0.01');expect(html).toContain('修改设置不影响本目标');expect(html).not.toContain('未启动下一轮');
});
it('shows each durable denial independently of business completion and preserves waiting semantics',()=>{
  for(const [reason,text] of [['token_limit','已达到 Token 软限额'],['cost_limit','已达到估算费用软限额'],['usage_unverifiable','用量暂时无法完整核实']] as [ScopeBudgetReason,string][]){
    const budget:ScopeBudgetSummary={policy:{revision:2,enabled:true,limits:{tokens:100}},blocked:{decisionId:'block',policyRevision:2,reason,observation:{basis:'basis',observedAt:'2026-11-07T00:00:00.000Z',registeredRuns:1,coverage:'tracked',consistency:'stable',liveRunIds:[],tokens:100,tokensComplete:true,costComplete:false,unknownRunIds:[]}}};
    const waiting=render(budget,true);expect(waiting).toContain(text);expect(waiting).toContain('原等待检查点仍保留，补充尚未受理');expect(waiting).toContain('data-budget-state="blocked"');expect(waiting).not.toContain('已经验收');
    expect(render(budget)).toContain('已发生的执行与用量仍保留');
  }
});
