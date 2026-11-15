import {expect,test} from 'vitest';
import {requestBudgetModelFor} from '../../../../src/logic/budget/rules/model-request-configuration';
import {requestBudgetReservation,requestBudgetCost} from '../../../../src/logic/budget/rules/model-request-budget-rules';
import {requestBudgetIntentSchema} from '../../../../src/logic/budget/rules/model-request-budget';
import {projectModelRequestBudgetMutation} from '../../../../src/logic/budget/rules/model-request-budget-invariants';
import {requestBudgetCommand,requestBudgetReceipt} from '../../../../src/logic/budget/rules/model-request-budget-rules';
import type {ResolvedEngineModel} from '../../../../src/logic/engines';
import type {DispatchState} from '../../../../src/logic/dispatch/rules/dispatch-storage';

const primary={id:'provider',name:'Model',model:'chat',api:'openai-completions' as const,baseUrl:'http://127.0.0.1:9',auth:'none' as const,contextWindow:4096,maxTokens:100,reasoning:false};
const profile:ResolvedEngineModel['profile']={...primary,modelRoles:{version:2,roles:{memory:{kind:'embedding',profile:{kind:'embedding',id:'vector-provider',name:'Vectors',model:'vector',api:'openai-embeddings',baseUrl:'http://127.0.0.1:9',auth:'none',inputTokens:2048,dimensions:3,inputPrice:2}},review:{kind:'generation',profile:primary}}}};

test('向量只计输入容量与价格，未定价保持未知，生成仍须正输出上限',()=>{
  const vector=requestBudgetModelFor(profile,'memory'),generation=requestBudgetModelFor(profile,'review');
  expect(vector).not.toHaveProperty('maxTokens');expect(vector).not.toHaveProperty('contextWindow');
  expect(requestBudgetReservation(vector,0)).toEqual({tokens:2048,estimatedCostUsd:0.004096});
  expect(requestBudgetCost(vector,{input:10,output:0,cacheRead:0,cacheWrite:0,totalTokens:10})).toBe(0.00002);
  expect(()=>requestBudgetReservation(vector,1)).toThrow();expect(()=>requestBudgetReservation(generation,0)).toThrow();
  expect(()=>requestBudgetCost(vector,{input:9,output:1,cacheRead:0,cacheWrite:0,totalTokens:10})).toThrow();
  expect(requestBudgetReservation({...vector,inputPrice:undefined},0)).toEqual({tokens:2048});
  expect(()=>requestBudgetModelFor(profile,'unknown')).toThrow();
  const other=structuredClone(profile);other.maxTokens=99;
  expect(requestBudgetModelFor(other,'memory').configurationHash).toBe(vector.configurationHash);
  expect(requestBudgetModelFor(other,'memory').role!.bindingHash).not.toBe(vector.role!.bindingHash);
});

test('成员角色预算审计核实际角色、完整执行绑定和冻结计价，不接受同 hash 换价格',()=>{
  const binding={workspaceId:'w',rootSessionId:'root',scopeId:'scope',taskId:'task',runId:'run',kind:'member' as const,ownerInstanceId:'instance'};
  const model=requestBudgetModelFor(profile,'memory'),intent=requestBudgetIntentSchema.parse({version:1,requestId:'request',binding,policyRevision:1,model,requestHash:'a'.repeat(64),maxOutputTokens:0,...requestBudgetReservation(model,0),createdAt:'2026-11-14T00:00:00Z'});
  const state={workspaceId:'w',scopes:[{workspaceId:'w',rootSessionId:'root',scopeId:'scope',status:'active',budget:{policy:{revision:1,enabled:true,enforcement:'request',limits:{tokens:10000}}}}],graphs:[{identity:{rootSessionId:'root'},tasks:[{taskId:'task',scopeId:'scope',activeRunId:'run',status:'running'}]}],runs:[{binding,status:'running',model:profile}]} as unknown as DispatchState;
  const apply=(i:typeof intent)=>{const change={requestId:i.requestId,revision:1,recordedAt:i.createdAt,phase:'reserved' as const,intent:i};return projectModelRequestBudgetMutation(state,{modelRequestBudgetChanges:[change],receipt:requestBudgetReceipt(change)},requestBudgetCommand(change))};
  expect(apply(intent).modelRequestBudgetChanges).toHaveLength(1);
  for(const patch of [{inputPrice:0},{role:{slot:'memory',bindingHash:'b'.repeat(64)}},{role:{slot:'other',bindingHash:model.role!.bindingHash}}])expect(()=>apply({...intent,model:{...model,...patch}} as typeof intent)).toThrow();
  expect(requestBudgetIntentSchema.safeParse({...intent,maxOutputTokens:1}).success).toBe(false);
});
