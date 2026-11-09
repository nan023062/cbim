import {expect,it,vi} from 'vitest';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {ScopeUsageController,checkedScopeUsage,scopeUsageGroup} from '../src/frontend/tasks/scope-usage-state';
import {ScopeUsageSummary,ScopeUsageReadView} from '../src/frontend/tasks/ScopeUsagePanel';
import type {ScopeUsageInput,ScopeUsageReport,ScopeUsageRun} from '../src/bridge/contracts/scope-usage';

const identity:ScopeUsageInput={workspaceId:'workspace',rootSessionId:'root',scopeId:'scope'};
const time='2026-11-07T01:00:00.000Z';
function run(kind:'main'|'member',id:string,input=100,output=20):ScopeUsageRun{return {kind,taskId:kind==='main'?'root':'task-'+id,runId:id,status:'completed',logState:'verified',usage:{source:'run-summary',tokensState:'reported',costState:'priced',tokens:{input,output,cacheRead:0,cacheWrite:0,reasoning:5,total:input+output},estimatedCostUsd:0.00014,issues:[]}}}
function report():ScopeUsageReport{return {identity:{...identity},checkedAt:time,basis:'a'.repeat(64),consistency:'stable',coverage:'tracked',scopeStatus:'closed',scopeOutcome:'completed',totals:{tokens:{input:150,output:30,cacheRead:0,cacheWrite:0,reasoning:10,total:180},estimatedCostUsd:0.00028,registeredRuns:2,readRuns:2,inFlightRuns:0,missingUsageRuns:0,partialUsageRuns:0,unpricedRuns:0,tokensComplete:true,costComplete:true},runs:[run('main','main'),run('member','member',50,10)],issues:[]}}

it('周期用量只有显式读取，重复点击合并；卸载和切换隔离迟到响应',async()=>{
  let resolve!:(value:unknown)=>void;const request=vi.fn((_id:ScopeUsageInput)=>new Promise(done=>{resolve=done})),controller=new ScopeUsageController(identity,request),notify=vi.fn(),unsubscribe=controller.subscribe(notify);
  expect(request).not.toHaveBeenCalled();expect(controller.snapshot.report).toBeUndefined();const first=controller.read();await controller.read();expect(request).toHaveBeenCalledTimes(1);expect(request).toHaveBeenCalledWith(identity);
  unsubscribe();controller.cancel();resolve(report());await first;expect(controller.snapshot.report).toBeUndefined();expect(controller.snapshot.loading).toBe(false);
  const other=new ScopeUsageController({...identity,scopeId:'other'},async()=>report());await other.read();expect(other.snapshot.report).toBeUndefined();expect(other.snapshot.error).toContain('不属于');
});

it('刷新失败保留旧快照并显示问题，不将缺失数据清成零或自动重读',async()=>{
  const request=vi.fn().mockResolvedValueOnce(report()).mockRejectedValueOnce(Error('日志读取失败')),controller=new ScopeUsageController(identity,request);
  await controller.read();const saved=controller.snapshot.report;expect(saved?.totals.tokens.total).toBe(180);await controller.read();expect(controller.snapshot.report).toBe(saved);expect(request).toHaveBeenCalledTimes(2);
  const html=renderToStaticMarkup(createElement(ScopeUsageReadView,{state:controller.snapshot,onRead:()=>{throw Error('渲染不得读取')}}));expect(html).toContain('保留上次快照');expect(html).toContain('可能已过期');expect(html).toContain('180 token');
});

it('总数必须和来源一致，不重复计算推理或跨主会话/周期合并',()=>{
  expect(checkedScopeUsage(report(),identity).totals.tokens.total).toBe(180);expect(scopeUsageGroup(report().runs.filter(r=>r.kind==='main'))).toMatchObject({runs:1,tokens:120,cost:0.00014});
  const duplicate=report();duplicate.runs[1].runId='main';expect(()=>checkedScopeUsage(duplicate,identity)).toThrow('重复');
  const other=report();other.runs[0].taskId='other-root';expect(()=>checkedScopeUsage(other,identity)).toThrow('跨会话');
  const wrong=report();wrong.totals.tokens.total+=10;expect(()=>checkedScopeUsage(wrong,identity)).toThrow('合计');
  const reasoning=report();reasoning.runs[0].usage.tokens.total+=5;expect(()=>checkedScopeUsage(reasoning,identity)).toThrow('口径');
  const mismatchedCost=report();mismatchedCost.totals.estimatedCostUsd=9;expect(()=>checkedScopeUsage(mismatchedCost,identity)).toThrow('费用');
});

it('缺失、部分、旧归属或读取中变化不能冒充完整用量；未知价格不同于明确零价',()=>{
  for(const mode of ['missing','partial','legacy','changed'] as const){const value=report();if(mode==='missing')value.runs[1].logState='missing';if(mode==='partial')value.runs[1].usage.tokensState='partial';if(mode==='legacy')value.coverage='legacy';if(mode==='changed')value.consistency='changed_during_read';expect(()=>checkedScopeUsage(value,identity)).toThrow('未核实');value.totals.tokensComplete=false;value.totals.costComplete=false;expect(checkedScopeUsage(value,identity)).toEqual(value)}
  const unknown=report();unknown.totals.costComplete=false;unknown.totals.unpricedRuns=2;delete unknown.totals.estimatedCostUsd;for(const row of unknown.runs){row.usage.costState='unknown';delete row.usage.estimatedCostUsd}
  const html=renderToStaticMarkup(createElement(ScopeUsageSummary,{report:checkedScopeUsage(unknown,identity)}));expect(html).toContain('价格未知');expect(html).not.toContain('$0.000000');expect(html).toContain('不是供应商账单');
  const zero=report();zero.totals.estimatedCostUsd=0;for(const row of zero.runs)row.usage.estimatedCostUsd=0;
  expect(renderToStaticMarkup(createElement(ScopeUsageSummary,{report:checkedScopeUsage(zero,identity)}))).toContain('$0.000000');
});
