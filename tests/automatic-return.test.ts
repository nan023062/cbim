import {expect,it,vi} from 'vitest';
import {automaticReturnSchema,validateAutomaticReturns,type AutomaticReturn} from '../src/logic/tasks/rules/automatic-return';
import type {DispatchScope} from '../src/logic/tasks/rules/dispatch-scope';
import type {GraphSnapshot} from '../src/logic/tasks/rules/graph-types';
import {AutomaticReturnService} from '../src/backend/scheduler-engine/dispatch/automatic-return-service';
import {hash,json} from '../src/core/platform/node/serialization';
import {workspaceMemberModelHash} from '../src/logic/team/rules/workspace-member-rules';
import type {WorkspaceMemberModelSnapshot} from '../src/logic/team/rules/workspace-member';
import type {KnowledgeWorkspace} from '../src/logic/knowledge/rules/ports';
import type {DispatchStore} from '../src/logic/dispatch/rules/dispatch-storage';
import type {ScopeGoalService,ScopeGoalPorts} from '../src/backend/scheduler-engine/goals/scope-goal-service';
import type {OwnerExecutionModelPorts} from '../src/backend/scheduler-engine/dispatch/owner-execution-service';

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
it('第三次异常后尚未来得及保存blocked就退出，重启检查仍拒绝自动回传并给出限次原因',async()=>{
  const model:WorkspaceMemberModelSnapshot={id:'00000000-0000-4000-8000-000000000001',name:'fixture',api:'openai-completions',baseUrl:'http://127.0.0.1',auth:'none',model:'fixture',contextWindow:8192,maxTokens:1024,reasoning:false};
  const saved:DispatchScope={...scope,automaticReturns:[{...record,sourceLogHash:hash(json([])),modelHash:workspaceMemberModelHash(model)}]};
  const graph={tasks:Array.from({length:3},(_,i)=>({taskId:'replacement-'+i,scopeId:scope.scopeId,status:'interrupted',runIds:['run-'+i]}))} as GraphSnapshot;
  const readKnowledge=vi.fn(),validateCandidate=vi.fn();
  const service=new AutomaticReturnService(
    {assert:()=>{},read:readKnowledge} as unknown as KnowledgeWorkspace,
    {read:async()=>({})} as DispatchStore,
    {repairContext:async()=>({scope:saved,graph}),validateMemberCandidate:validateCandidate} as unknown as ScopeGoalService,
    {inspectMain:async()=>({events:[]})} as unknown as ScopeGoalPorts,
    {configuration:async()=>model,withConfigurations:async()=>{throw Error('自动回传核实不应进入模型写锁')}} satisfies OwnerExecutionModelPorts);
  await expect(service.inspect(saved)).rejects.toMatchObject({code:'GOAL_MEMBER_FAILURE_LIMIT',message:expect.stringContaining('累计 3 次')});
  expect(readKnowledge).not.toHaveBeenCalled();expect(validateCandidate).not.toHaveBeenCalled();
});
