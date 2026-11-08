import {expect,it,vi} from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {fixture} from './helpers';
import {Application} from '../src/backend/main/application';
import {Paths} from '../src/backend/main/platform/paths';
import {modelRequestBudgetProvider,type RequestBudgetMode} from './model-request-budget-provider';
import {budgetScopes,seedScopeBudget} from './scope-budget-fixture';
import {scopeBudgetProvider,scopeBudgetFixture} from './scope-budget-provider';
import {requestBudgetReportSchema} from '../src/backend/core/tasks/model-request-budget';
import type {ResolvedLlm} from '../src/backend/core/brain/llm/ports';
import type {RunSummary} from '../src/backend/core/brain/types';

it.each(['openai-completions','openai-responses','anthropic-messages'] as ResolvedLlm['profile']['api'][])('实际Application/Pi的 %s 经过启动门禁并可靠结算缓存与推理用量，重开查询不发送',async api=>{
  const f=await fixture(),provider=await modelRequestBudgetProvider(api);let app=f.app;
  try{
    await app.models.save({profile:{name:'Request budget real Pi',api,baseUrl:provider.url,auth:'none',defaultModel:'request-budget-model',models:[{id:'request-budget-model',name:'Request budget real Pi',enabled:true,contextWindow:65536,maxTokens:4096,reasoning:false,pricing:{input:1,output:2,cacheRead:0.5,cacheWrite:1.5}}]}});
    const entry=await app.dispatch('add',{path:f.a}),profileId=(await app.models.list()).selectedId!;
    await app.dispatch('budget.configure',{revision:1,enabled:true,enforcement:'request',limits:{tokens:100000}});
    const start=await app.dispatch('loop.chat',{id:entry.id,message:'Verify this request budget.',options:{profileId,model:'request-budget-model',permission:'read',turnTimeoutMs:30000}});
    await vi.waitFor(async()=>expect((await budgetScopes(f.user,entry.id))[0]?.status).toBe('closed'),{timeout:30000});
    const scope=(await budgetScopes(f.user,entry.id))[0],query={workspaceId:entry.id,rootSessionId:start.taskId,scopeId:scope.scopeId};
    expect(scope.outcome).toBe('completed');expect(provider.errors).toEqual([]);expect(provider.requests).toHaveLength(1);
    const inspected:RunSummary=await app.dispatch('loop.inspect',{id:entry.id,...start});
    expect(inspected.events.find(event=>event.type==='engine.status'&&event.data.metric==='tool-catalog'&&event.data.stage==='active')?.data.missing).toEqual([]);
    const report=requestBudgetReportSchema.parse(await app.dispatch('dispatch.requestBudget',query));expect(report).toMatchObject({requests:1,reported:1,tokens:120,reservedTokens:0,unknown:0,estimatedCostUsd:0.000125});
    const journal=path.join(app.paths.project(entry.id),'dispatch','dispatch.jsonl'),bytes=await fs.readFile(journal);expect(bytes.toString()).not.toContain('Request budget verified.');
    await app.shutdown();app=new Application(new Paths(f.user,path.resolve('.')),path.resolve('design'));await app.init();await app.open(entry.id);expect(await app.dispatch('dispatch.requestBudget',query)).toEqual(report);expect(await fs.readFile(journal)).toEqual(bytes);expect(provider.requests).toHaveLength(1);
  }finally{await app.shutdown();await provider.close();await f.cleanup()}
},45000);

it.each(['two-requests','unknown','retry','compaction'] as RequestBudgetMode[])('实际Pi同轮请求、未知、重试和自动摘要不绕过账本：%s',async mode=>{
  const f=await fixture(),provider=await modelRequestBudgetProvider('openai-completions',mode);
  try{
    await f.app.models.save({profile:{name:'Request behavior',api:'openai-completions',baseUrl:provider.url,auth:'none',defaultModel:'request-budget-model',models:[{id:'request-budget-model',name:'Request behavior',enabled:true,contextWindow:65536,maxTokens:mode==='compaction'?32768:4096,reasoning:false,...(mode==='compaction'?{workingContextWindow:32768,compactionPercent:70}:{}),pricing:{input:1,output:2,cacheRead:0.5,cacheWrite:1.5}}]}});
    const entry=await f.app.dispatch('add',{path:f.a}),profileId=(await f.app.models.list()).selectedId!;
    await f.app.dispatch('budget.configure',{revision:1,enabled:true,enforcement:'request',limits:{tokens:mode==='two-requests'?69700:300000}});
    const start=await f.app.dispatch('loop.chat',{id:entry.id,message:'Check the workspace identity, then reply.',options:{profileId,model:'request-budget-model',permission:'read',turnTimeoutMs:45000}});
    await vi.waitFor(async()=>expect((await budgetScopes(f.user,entry.id))[0]?.status).toBe('closed'),{timeout:40000});let inspected=start;
    if(mode==='compaction'){await vi.waitFor(()=>expect(f.app.runtime.snapshot().pressure.activeRuns).toBe(0));inspected=await f.app.dispatch('loop.resume',{id:entry.id,taskId:start.taskId,runId:start.runId,message:'Continue with a short final answer.',options:{profileId,model:'request-budget-model',permission:'read',turnTimeoutMs:45000}});await vi.waitFor(async()=>{const scopes=await budgetScopes(f.user,entry.id);expect(scopes).toHaveLength(2);expect(scopes[1].status).toBe('closed')},{timeout:40000})}
    const scope=(await budgetScopes(f.user,entry.id)).at(-1)!;
    const report=requestBudgetReportSchema.parse(await f.app.dispatch('dispatch.requestBudget',{workspaceId:entry.id,rootSessionId:start.taskId,scopeId:scope.scopeId}));
    const summary=await f.app.dispatch('loop.inspect',{id:entry.id,taskId:start.taskId,runId:inspected.runId});expect(provider.errors).toEqual([]);
    if(mode==='two-requests'){expect(provider.requests).toHaveLength(1);expect(report).toMatchObject({requests:2,reported:1,denied:1,lastDenial:'token_reserve',tokens:120});expect(scope.outcome).toBe('failed')}
    else if(mode==='compaction'){expect(provider.requests.some(r=>r.compaction),JSON.stringify({outcome:scope.outcome,report,events:summary.events.filter((e:any)=>e.type==='engine.status'||e.type==='run.finished'),requests:provider.requests.map(r=>({compaction:r.compaction,limit:r.body.max_tokens??r.body.max_completion_tokens,tools:r.body.tools?.length,messages:r.body.messages?.map((m:any)=>({role:m.role,chars:JSON.stringify(m.content).length,start:JSON.stringify(m.content).slice(0,130)}))}))})).toBe(true);expect(scope.outcome).toBe('completed');expect(provider.requests).toHaveLength(4);const all=await budgetScopes(f.user,entry.id),reports=await Promise.all(all.map(scope=>f.app.dispatch('dispatch.requestBudget',{workspaceId:entry.id,rootSessionId:start.taskId,scopeId:scope.scopeId})));expect(reports[0].reported).toBe(3);expect(reports.reduce((n,r)=>n+r.reported,0)).toBe(4);expect(reports.reduce((n,r)=>n+r.tokens,0)).toBe(50360);expect(report.unknown).toBe(0)}
    else{expect(scope.outcome).toBe('failed');expect(provider.requests).toHaveLength(1);expect(report).toMatchObject({unknown:1,reservedTokens:69632,reported:0});if(mode==='retry')expect(summary.events.some((e:any)=>e.type==='engine.status'&&e.data.label==='模型连接重试中')).toBe(true)}
  }finally{await provider.close();await f.cleanup()}
},60000);

it('逐请求剩余容量不足时，安全等待补充在受理前拒绝，修改未来设置及重开均不消费原等待',async()=>{
  const f=await fixture(),provider=await scopeBudgetProvider('waiting');let app=f.app;try{
    const {entry,profileId}=await seedScopeBudget(app,f.a,provider,'waiting');await app.dispatch('budget.configure',{revision:1,enabled:true,enforcement:'request',limits:{tokens:71551}});provider.releaseAll();
    const start=await app.dispatch('loop.chat',{id:entry.id,message:scopeBudgetFixture.goal,options:{profileId,model:scopeBudgetFixture.model,permission:'read',turnTimeoutMs:60000}});
    await vi.waitFor(async()=>expect((await budgetScopes(f.user,entry.id))[0]?.status).toBe('waiting'),{timeout:45000});await vi.waitFor(()=>expect(app.runtime.snapshot().pressure.activeRuns).toBe(0));const before=(await budgetScopes(f.user,entry.id))[0],identity={workspaceId:entry.id,rootSessionId:start.taskId},query={...identity,scopeId:before.scopeId},report=await app.dispatch('dispatch.requestBudget',query),sequence=[...provider.sequence];expect(report.tokens).toBe(1920);
    const request={...query,waitId:before.wait!.waitId,expectedGoalRevision:before.goal!.revision,expectedInputRevision:before.goal!.inputRevision??1,commandId:randomUUID(),input:{message:scopeBudgetFixture.supplement},options:{provider:'cbim-'+profileId,profileId,model:scopeBudgetFixture.model,permission:'read',turnTimeoutMs:30000}};
    await app.dispatch('budget.configure',{revision:2,enabled:true,enforcement:'request',limits:{tokens:300000}});
    await expect(app.dispatch('loop.goalContinue',request)).rejects.toMatchObject({code:'MODEL_REQUEST_PREFLIGHT'});expect((await budgetScopes(f.user,entry.id))[0]).toEqual(before);expect(await app.dispatch('dispatch.requestBudget',query)).toEqual(report);expect(provider.sequence).toEqual(sequence);expect(await app.dispatch('loop.goalContinuation',{...query,commandId:request.commandId})).toBeUndefined();
    await app.shutdown();app=new Application(new Paths(f.user,path.resolve('.')),path.resolve('design'));await app.init();expect((await budgetScopes(f.user,entry.id))[0]).toEqual(before);expect(provider.sequence).toEqual(sequence);await app.dispatch('loop.stop',{id:entry.id,taskId:start.taskId});expect((await budgetScopes(f.user,entry.id))[0].outcome).toBe('cancelled');
  }finally{provider.releaseAll();await app.shutdown();await provider.close();await f.cleanup()}
},60000);

it.each(['main-block','member-block','complete'] as const)('实际主轮与正式岗位成员共用冻结请求额度：%s',async mode=>{
  const f=await fixture(),provider=await scopeBudgetProvider('complete');try{
    const {entry,profileId}=await seedScopeBudget(f.app,f.a,provider,'complete');await f.app.dispatch('budget.configure',{revision:1,enabled:true,enforcement:'request',limits:{tokens:mode==='main-block'?69700:mode==='member-block'?70000:80000}});
    provider.releaseAll();const start=await f.app.dispatch('loop.chat',{id:entry.id,message:scopeBudgetFixture.goal,options:{profileId,model:scopeBudgetFixture.model,permission:'read',turnTimeoutMs:60000}});
    await vi.waitFor(async()=>expect((await budgetScopes(f.user,entry.id))[0]?.status).toBe('closed'),{timeout:45000});const scope=(await budgetScopes(f.user,entry.id))[0];const report=requestBudgetReportSchema.parse(await f.app.dispatch('dispatch.requestBudget',{workspaceId:entry.id,rootSessionId:start.taskId,scopeId:scope.scopeId}));
    expect(provider.errors).toEqual([]);expect(report.reported).toBe(provider.main.length+provider.member.length);expect(report.unknown).toBe(0);expect(report.reservedTokens).toBe(0);
    if(mode==='main-block'){expect(provider.main).toHaveLength(1);expect(provider.member).toHaveLength(0);expect(report.denied).toBe(1)}else if(mode==='member-block'){expect(provider.main).toHaveLength(3);expect(provider.member).toHaveLength(1);expect(report.denied).toBe(1)}else{expect(provider.main,JSON.stringify({outcome:scope.outcome,report,sequence:provider.sequence})).toHaveLength(6);expect(provider.member).toHaveLength(5);expect(report.tokens).toBe(1920);expect(report.denied).toBe(0)}
    expect(scope.outcome).toBe(mode==='complete'?'completed':'failed');
  }finally{provider.releaseAll();await provider.close();await f.cleanup()}
},60000);
