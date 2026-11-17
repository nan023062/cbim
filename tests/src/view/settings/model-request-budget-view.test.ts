// view/settings: module-owned contract coverage; keep the original scenario and cleanup semantics.
import {expect,it,vi} from 'vitest';
import {renderToStaticMarkup} from 'react-dom/server';
import {createElement} from 'react';
import {RequestBudgetController} from '../../../../src/view/tasks/request-budget-state';
import {ScopeBudgetPanel} from '../../../../src/view/tasks/ScopeBudgetPanel';
import {requestBudgetMoney} from '../../../../src/view/tasks/RequestBudgetPanel';
import {BudgetSettingsController,budgetSettingsInput} from '../../../../src/view/settings/budget-settings-state';
import {BudgetSettings} from '../../../../src/logic/budget/settings/budget-settings';
const query={workspaceId:'workspace',rootSessionId:'root',scopeId:'scope'},report={...query,policyRevision:3,requests:2,reported:1,inFlight:0,unknown:1,denied:0,notSent:0,tokens:120,reservedTokens:69632,estimatedCostUsd:0.00014,reservedCostUsd:0.1,costComplete:true,overrun:0};
it('切换模式也保存新设置版本；草稿刷新回旧模式不会残留request字段',async()=>{
  let stored:string|undefined,writes=0;const settings=new BudgetSettings('unused',{Read:async()=>{if(!stored)throw Object.assign(Error(),{code:'ENOENT'});return stored},Write:async(_p,value)=>{stored=value;writes++}});await settings.Init();
  const old=await settings.Configure({revision:1,enabled:true,limits:{tokens:100000}}),next=await settings.Configure({...old,enforcement:'request'});expect(next.revision).toBe(3);expect(writes).toBe(2);await settings.Configure(next);expect(writes).toBe(2);
  let policy=next;const controller=new BudgetSettingsController(async()=>policy);await controller.Load();expect(controller.snapshot().enforcement).toBe('request');policy=old;await controller.Load();expect(controller.snapshot().enforcement).toBeUndefined();expect(budgetSettingsInput(controller.snapshot(),old.revision)).not.toHaveProperty('enforcement');
});
