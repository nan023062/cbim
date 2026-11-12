import {expect,it} from 'vitest';
import {automaticReturnSchema,validateAutomaticReturns,type AutomaticReturn} from '../src/backend/core/tasks/automatic-return';
import type {DispatchScope} from '../src/backend/core/tasks/dispatch-scope';
import type {GraphSnapshot} from '../src/backend/core/tasks/graph-types';

const record:AutomaticReturn={mainRunId:'main',taskIds:['member'],sourceLogHash:'a'.repeat(64),modelHash:'b'.repeat(64),recordedAt:'2026-11-12T00:00:00.000Z',options:{engine:'pi',provider:'fixture',profileId:'profile',model:'fixture',permission:'read',allowNativeExecution:false}};
const scope:DispatchScope={scopeId:'scope',workspaceId:'workspace',rootSessionId:'root',status:'active',createdAt:'2026-11-12T00:00:00.000Z',runTracking:{version:1,mainRunIds:['main']}};
const graph={tasks:[{taskId:'member',scopeId:'scope'}]} as unknown as GraphSnapshot;

it('待回传批次只追加，旧批次权限、来源日志和成员集合都不能改写',()=>{
  const saved={...scope,automaticReturns:[record]};expect(()=>validateAutomaticReturns(scope,saved,graph)).not.toThrow();
  for(const patch of [{sourceLogHash:'c'.repeat(64)},{taskIds:['other']},{options:{...record.options,permission:'execute',allowNativeExecution:true}}]){
    expect(()=>validateAutomaticReturns(saved,{...saved,automaticReturns:[{...record,...patch} as AutomaticReturn]},graph)).toThrow();
  }
  expect(()=>validateAutomaticReturns(saved,scope,graph)).toThrow();
  expect(()=>validateAutomaticReturns({...scope,status:'closed'},saved,graph)).toThrow();
  expect(()=>validateAutomaticReturns(scope,{...saved,automaticReturns:[{...record,mainRunId:'missing'}]},graph)).toThrow();
  expect(()=>validateAutomaticReturns(scope,saved,{tasks:[]} as unknown as GraphSnapshot)).toThrow();
});
it('旧周期不补造自动恢复权，原生执行选项不允许隐式提权或加入密钥',()=>{
  expect(()=>validateAutomaticReturns(undefined,scope,graph)).not.toThrow();
  expect(()=>validateAutomaticReturns(undefined,{...scope,automaticReturns:[record]},graph)).toThrow();
  expect(()=>validateAutomaticReturns(scope,{...scope,automaticReturns:[{...record,options:{...record.options,allowNativeExecution:true}}]},graph)).toThrow();
  expect(automaticReturnSchema.safeParse({...record,options:{...record.options,apiKey:'not-allowed'}}).success).toBe(false);
});
