import {expect,it} from 'vitest';
import type {RunSummary,EngineEvent} from '../src/backend/core/execution/types';
import type {ScopeUsageRun} from '../src/backend/core/budget/scope-usage';
import {scopeRunUsageSchema,scopeUsageReportSchema} from '../src/backend/core/budget/scope-usage';
import {measureScopeRunUsage,emptyScopeRunUsage,summarizeScopeUsage} from '../src/backend/core/execution/scope-usage';

const tokens={input:100,output:30,cacheRead:20,cacheWrite:5,reasoning:10};
const message=(usage:unknown={...tokens,cost:{total:0.2}},pricingKnown=true):EngineEvent=>({type:'message',data:{role:'assistant',usage,pricingKnown}});
const aggregate=(data:Record<string,unknown>={}):EngineEvent=>({type:'engine.status',data:{metric:'run-usage',tokens:{...tokens,input:120},cost:0.3,pricingKnown:true,...data}});
function run(events:EngineEvent[],status:RunSummary['status']='completed'):RunSummary {
  const task={taskId:'main',workspaceId:'workspace',root:'fixture',agentId:'cbim:main',moduleIds:[],acceptance:[],mode:'chat' as const,goal:'目标'};
  return {task,runId:'run',status,acceptance:'not_evaluated',unresolvedTools:[],logIntegrity:{partialTail:false},events:[{type:'run.started' as const,data:{task}},...events,...(status==='running'?[]:[{type:'run.settled' as const,data:{status}}])].map((event,index)=>({...event,version:1,workspaceId:task.workspaceId,taskId:task.taskId,runId:'run',seq:index+1,time:'2026-11-07T00:00:00.000Z'}))};
}
const entry=(usage=measureScopeRunUsage(run([message(),aggregate()]))):ScopeUsageRun=>({kind:'main',taskId:'main',runId:'run',status:'completed',logState:'verified',usage});

it('原生差额覆盖消息，含摘要新增用量，推理仅作为输出子集展示',()=>{
  const summary=run([message(),aggregate()]),before=structuredClone(summary),value=measureScopeRunUsage(summary);
  expect(value).toMatchObject({source:'run-summary',tokensState:'reported',costState:'priced',tokens:{input:120,output:30,cacheRead:20,cacheWrite:5,reasoning:10,total:175},estimatedCostUsd:0.3,issues:[]});
  expect(scopeRunUsageSchema.parse(value)).toEqual(value);expect(measureScopeRunUsage(summary)).toEqual(value);expect(summary).toEqual(before);
});

it('消息缺输入不能当作完整，消息本身也不能证明整个run的消耗完整',()=>{
  const partial=measureScopeRunUsage(run([message({output:30,cost:{total:0.1}})]));
  expect(partial).toMatchObject({source:'messages',tokensState:'partial',costState:'partial',tokens:{input:0,output:30,total:30},estimatedCostUsd:0.1});expect(partial.issues.some(i=>i.code==='USAGE_MESSAGE_PARTIAL')).toBe(true);
  expect(measureScopeRunUsage(run([message()])).tokensState).toBe('partial');
  const absent=measureScopeRunUsage(run([{type:'message',data:{role:'assistant',text:'没有计量'}}]));expect(absent).toMatchObject({source:'none',tokensState:'missing',costState:'unknown'});expect(absent.estimatedCostUsd).toBeUndefined();
});

it('未知价格、明确免费和仅部分计价分别保留；后改价格不参与纯计量',()=>{
  const unknown=measureScopeRunUsage(run([message({...tokens,cost:{total:0}},false),aggregate({cost:0,pricingKnown:false})]));expect(unknown).toMatchObject({tokensState:'reported',costState:'unknown'});expect(unknown.estimatedCostUsd).toBeUndefined();
  expect(measureScopeRunUsage(run([aggregate({cost:0,pricingKnown:true})]))).toMatchObject({costState:'priced',estimatedCostUsd:0});
  const partial=measureScopeRunUsage(run([message(),aggregate({cost:0,pricingKnown:false})]));expect(partial).toMatchObject({tokensState:'reported',costState:'partial',estimatedCostUsd:0.2});
  expect(measureScopeRunUsage(run([aggregate({cost:0.45,pricingKnown:false,totalFromProvider:true})]))).toMatchObject({costState:'priced',estimatedCostUsd:0.45});
});

it('取消和失败仍保留消耗，在途、尾损坏、错序不能声明完整',()=>{
  for(const status of ['cancelled','failed'] as const)expect(measureScopeRunUsage(run([message(),aggregate()],status))).toMatchObject({tokensState:'reported',estimatedCostUsd:0.3});
  expect(measureScopeRunUsage(run([message(),aggregate()],'running'))).toMatchObject({tokensState:'partial',costState:'partial'});
  const partial=run([message(),aggregate()]);partial.logIntegrity={partialTail:true};expect(measureScopeRunUsage(partial).tokensState).toBe('partial');
  const unverified=run([message(),aggregate()]);delete unverified.logIntegrity;expect(measureScopeRunUsage(unverified)).toMatchObject({tokensState:'partial',issues:expect.arrayContaining([expect.objectContaining({code:'USAGE_LOG_UNVERIFIED'})])});
  const wrong=run([message(),aggregate()]);wrong.events[1].runId='foreign';expect(measureScopeRunUsage(wrong)).toMatchObject({tokensState:'missing',costState:'unknown',issues:[{code:'USAGE_SEQUENCE_INVALID'}]});
  const gap=run([message(),aggregate()]);gap.events[1].seq=4;expect(measureScopeRunUsage(gap).tokensState).toBe('missing');
});

it('损坏或过期原生汇总不能覆盖已知消耗，也不能用旧有效汇总掩盖后续异常',()=>{
  const value=measureScopeRunUsage(run([message(),aggregate({tokens:{input:0,output:0,cacheRead:0,cacheWrite:0}})]));expect(value).toMatchObject({source:'messages',tokensState:'partial',tokens:{total:155},estimatedCostUsd:0.2});expect(value.issues.some(i=>i.code==='USAGE_SUMMARY_INVALID')).toBe(true);
  const bad=measureScopeRunUsage(run([message(),aggregate(),aggregate({tokens:{output:40}})]));expect(bad).toMatchObject({source:'run-summary',tokensState:'partial',tokens:{total:175}});
  const later=measureScopeRunUsage(run([message(),aggregate(),message()]));expect(later).toMatchObject({source:'messages',tokensState:'partial',tokens:{total:310}});
  const complete=measureScopeRunUsage(run([message({output:10}),aggregate()]));expect(complete.tokensState).toBe('reported');
});

it('周期汇总分别标记归属、缺日志、未知用量、价格和活动运行，不把未知当免费',()=>{
  const known=entry(),missing={...entry(emptyScopeRunUsage()),kind:'member' as const,taskId:'member',runId:'missing',status:'unknown' as const,logState:'missing' as const};
  const value=summarizeScopeUsage([known,missing],'tracked','stable');expect(value).toMatchObject({registeredRuns:2,readRuns:1,missingUsageRuns:1,unpricedRuns:1,tokens:{total:175},estimatedCostUsd:0.3,tokensComplete:false,costComplete:false});
  expect(summarizeScopeUsage([known],'tracked','stable')).toMatchObject({tokensComplete:true,costComplete:true});
  expect(summarizeScopeUsage([known],'legacy','stable')).toMatchObject({tokensComplete:false,costComplete:false});
  expect(summarizeScopeUsage([known],'tracked','changed_during_read')).toMatchObject({tokensComplete:false,costComplete:false});
  expect(summarizeScopeUsage([{...known,status:'running'}],'tracked','stable')).toMatchObject({inFlightRuns:1,tokensComplete:false,costComplete:false});
  expect(summarizeScopeUsage([missing],'tracked','stable').estimatedCostUsd).toBeUndefined();
  expect(summarizeScopeUsage([],'tracked','stable')).toMatchObject({tokensComplete:false,costComplete:false});
});

it('重复轮次及超出安全整数的累计明确拒绝，不重复计数或清零冒充无消耗',()=>{
  expect(()=>summarizeScopeUsage([entry(),entry()],'tracked','stable')).toThrowError(expect.objectContaining({code:'SCOPE_USAGE_DUPLICATE'}));
  const huge=entry();huge.usage.tokens={input:Number.MAX_SAFE_INTEGER,output:0,cacheRead:0,cacheWrite:0,reasoning:0,total:Number.MAX_SAFE_INTEGER};
  expect(()=>summarizeScopeUsage([huge,{...entry(),runId:'other'}],'tracked','stable')).toThrowError(expect.objectContaining({code:'SCOPE_USAGE_LIMIT'}));
});

it('公开报告schema拒绝未知字段、坏身份及非法状态，含可信免费零值',()=>{
  const runs=[entry()],report={identity:{workspaceId:'workspace',rootSessionId:'root',scopeId:'scope'},checkedAt:'2026-11-07T00:00:00.000Z',basis:'basis',coverage:'tracked' as const,consistency:'stable' as const,scopeStatus:'closed' as const,scopeOutcome:'completed' as const,runs,totals:summarizeScopeUsage(runs,'tracked','stable'),issues:[]};
  expect(scopeUsageReportSchema.parse(report)).toEqual(report);expect(scopeUsageReportSchema.safeParse({...report,secret:'bad'}).success).toBe(false);expect(scopeUsageReportSchema.safeParse({...report,identity:{...report.identity,scopeId:'../other'}}).success).toBe(false);expect(scopeUsageReportSchema.safeParse({...report,runs:[{...runs[0],status:'success'}]}).success).toBe(false);
});
