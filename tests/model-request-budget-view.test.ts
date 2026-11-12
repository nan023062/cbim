import {expect,it,vi} from 'vitest';
import {renderToStaticMarkup} from 'react-dom/server';
import {createElement} from 'react';
import {RequestBudgetController} from '../src/frontend/tasks/request-budget-state';
import {ScopeBudgetPanel} from '../src/frontend/tasks/ScopeBudgetPanel';
import {requestBudgetMoney} from '../src/frontend/tasks/RequestBudgetPanel';
import {BudgetSettingsController,budgetSettingsInput} from '../src/frontend/settings/budget-settings-state';
import {BudgetSettings} from '../src/backend/main/settings/budget-settings';
const query={workspaceId:'workspace',rootSessionId:'root',scopeId:'scope'},report={...query,policyRevision:3,requests:2,reported:1,inFlight:0,unknown:1,denied:0,notSent:0,tokens:120,reservedTokens:69632,estimatedCostUsd:0.00014,reservedCostUsd:0.1,costComplete:true,overrun:0};
it('金额展示去除浮点尾数，极小正值不显示为零',()=>{expect(requestBudgetMoney(0.0022399999999999994)).toBe('$0.00224');expect(requestBudgetMoney(0)).toBe('$0');expect(requestBudgetMoney(1e-20)).toBe('$1e-20');expect(requestBudgetMoney(Number.MIN_VALUE)).not.toBe('$0')});

it('请求摘要不自动读取，完整身份和版本不同不显示，读取失败保留旧值而非零',async()=>{
  let response:unknown=report;const call=vi.fn(async()=>response),controller=new RequestBudgetController(query,3,call);controller.subscribe(()=>{});expect(call).not.toHaveBeenCalled();await controller.load();expect(controller.snapshot().report).toEqual(report);
  response={...report,rootSessionId:'foreign'};await controller.load();expect(controller.snapshot().error).toContain('其它目标');expect(controller.snapshot().report).toEqual(report);
  response={...report,policyRevision:4};await controller.load();expect(controller.snapshot().error).toContain('未将读取失败计为零');
});
it('换目标/卸载使晚到请求失效，同一读请求不会重复提交',async()=>{
  let resolve!:(v:unknown)=>void;const pending=new Promise(r=>{resolve=r}),call=vi.fn(()=>pending),controller=new RequestBudgetController(query,3,call);
  const load=controller.load();await controller.load();controller.dispose();resolve(report);await load;expect(call).toHaveBeenCalledTimes(1);expect(controller.snapshot().report).toBeUndefined();expect(controller.snapshot().busy).toBe(false);
});
it('新旧模式分别说明，不给缺省周期补逐请求保证，初始摘要不显示零',()=>{
  const policy={revision:3,enabled:true,enforcement:'request' as const,limits:{tokens:100000}},html=renderToStaticMarkup(createElement(ScopeBudgetPanel,{budget:{policy},query}));
  expect(html).toContain('本目标逐请求预算');expect(html).toContain('刷新请求账本');expect(html).toContain('尚未读取逐请求账本');
  const legacy=renderToStaticMarkup(createElement(ScopeBudgetPanel,{budget:{policy:{revision:3,enabled:true,limits:{tokens:100000}}},query}));expect(legacy).not.toContain('刷新请求账本');expect(legacy).toContain('运行间检查');
});
it('切换模式也保存新设置版本；草稿刷新回旧模式不会残留request字段',async()=>{
  let stored:string|undefined,writes=0;const settings=new BudgetSettings('unused',{read:async()=>{if(!stored)throw Object.assign(Error(),{code:'ENOENT'});return stored},write:async(_p,value)=>{stored=value;writes++}});await settings.init();
  const old=await settings.configure({revision:1,enabled:true,limits:{tokens:100000}}),next=await settings.configure({...old,enforcement:'request'});expect(next.revision).toBe(3);expect(writes).toBe(2);await settings.configure(next);expect(writes).toBe(2);
  let policy=next;const controller=new BudgetSettingsController(async()=>policy);await controller.load();expect(controller.snapshot().enforcement).toBe('request');policy=old;await controller.load();expect(controller.snapshot().enforcement).toBeUndefined();expect(budgetSettingsInput(controller.snapshot(),old.revision)).not.toHaveProperty('enforcement');
});
