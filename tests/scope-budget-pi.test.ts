import {expect,it,vi} from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fixture} from './helpers';
import {scopeBudgetProvider,scopeBudgetFixture as data,type BudgetFixtureMode} from './scope-budget-provider';
import {seedScopeBudget,budgetScopes,budgetUnpriced} from './scope-budget-fixture';
import {Application} from '../src/bridge/server/application';
import {Paths} from '../src/logic/workspace/service/paths';

it.each(['main-limit','member-limit','cost-limit','unknown-price','tokens-unpriced','complete','waiting'] as BudgetFixtureMode[])('recursive requests share the frozen root budget and retain settled facts after restart (%s)',async mode=>{
 const f=await fixture(),provider=await scopeBudgetProvider(mode==='waiting'?'waiting':'complete',true);let app=f.app;
 try{
  const {entry,profileId}=await seedScopeBudget(app,f.a,provider,mode),options={profileId,model:data.model,permission:'read',turnTimeoutMs:60000};
  const limits=mode==='cost-limit'?{estimatedCostUsd:0.0739}:mode==='unknown-price'?{estimatedCostUsd:1}:{tokens:mode==='main-limit'?69800:mode==='member-limit'?70000:mode==='waiting'?71191:80000};
  const policy=await app.dispatch('budget.configure',{revision:1,enabled:true,enforcement:'request',limits});
  const started=await app.dispatch('loop.chat',{id:entry.id,message:data.goal,options}),identity={workspaceId:entry.id,rootSessionId:started.taskId};
  const scopes=()=>budgetScopes(f.user,entry.id),until=(check:()=>void|Promise<void>)=>vi.waitFor(async()=>{expect(provider.errors).toEqual([]);await check()},{timeout:45000,interval:30});
  if(mode!=='unknown-price')await until(()=>expect(provider.main).toHaveLength(2));
  else await until(async()=>expect((await scopes())[0]?.status).toBe('closed'));
  const original=(await scopes())[0];expect(original.budget?.policy).toEqual(policy);
  const raised=await app.dispatch('budget.configure',{revision:policy.revision,enabled:true,enforcement:'request',limits:{tokens:300000,estimatedCostUsd:100}});
  expect((await scopes())[0].budget?.policy).toEqual(policy);
  if(!['unknown-price','complete','tokens-unpriced'].includes(mode))await app.dispatch('loop.enqueue',{id:entry.id,taskId:started.taskId,message:data.queued,options});
  provider.releaseAll();
  if(mode==='waiting'){
   await until(async()=>expect((await app.dispatch('loop.questions',{id:entry.id,taskId:started.taskId}))).toHaveLength(1));
   const question=(await app.dispatch('loop.questions',{id:entry.id,taskId:started.taskId}))[0];
   const before=await app.dispatch('dispatch.requestBudget',{...identity,scopeId:original.scopeId});
   expect(before).toMatchObject({reported:8,tokens:1560,denied:0});
   await app.dispatch('loop.answerQuestion',{id:entry.id,taskId:started.taskId,questionId:question.id,answers:[{option:0,other:''}]});
  }
  await until(async()=>{expect((await scopes())[0].status).toBe('closed');expect(app.runtime.snapshot().pressure.activeRuns).toBe(0)});
  const scope=(await scopes())[0],query={...identity,scopeId:scope.scopeId},report=await app.dispatch('dispatch.requestBudget',query);
  const complete=mode==='complete'||mode==='tokens-unpriced';
  expect(scope.outcome).toBe(complete?'completed':'failed');expect(scope.budget?.policy).toEqual(policy);
  expect(scope.runTracking?.mainRunIds).toEqual([started.runId]);expect(scope.goal?.plan).toBeUndefined();
  expect(report.reported).toBe(provider.main.length+provider.member.length);expect(report.reservedTokens).toBe(0);expect(report.unknown).toBe(0);
  if(complete){expect(provider.main).toHaveLength(4);expect(provider.member).toHaveLength(5);expect(report).toMatchObject({tokens:1680,denied:0})}
  else if(mode==='unknown-price'){expect(provider.main).toEqual([]);expect(provider.member).toEqual([]);expect(report.denied).toBe(1)}
  else if(mode==='waiting'){expect(provider.main).toHaveLength(3);expect(provider.member).toHaveLength(5);expect(report).toMatchObject({tokens:1560,denied:1,lastDenial:'token_reserve'})}
  else if(mode==='member-limit'){expect(provider.main).toHaveLength(2);expect(provider.member).toHaveLength(1);expect(report).toMatchObject({tokens:480,denied:2,lastDenial:'token_reserve'})}
  else{expect(provider.main).toHaveLength(2);expect(provider.member).toHaveLength(0);expect(report.denied).toBeGreaterThan(0)}
  const usage=await app.dispatch('dispatch.scopeUsage',query);expect(usage.totals.costComplete).toBe(!budgetUnpriced(mode));
  const saved=await app.workspace(entry.id).dispatchStore.read();expect(saved.graphs[0].tasks).toEqual([]);
  const queue=await app.dispatch('loop.queue',{id:entry.id,taskId:started.taskId});
  if(!complete&&mode!=='unknown-price')expect(queue[0]).toMatchObject({message:data.queued,status:'paused'});
  const journal=path.join(f.user,entry.id,'dispatch/dispatch.jsonl'),bytes=await fs.readFile(journal),sequence=[...provider.sequence];
  await app.shutdown();app=new Application(new Paths(f.user,path.resolve('.')),path.resolve('assets'));await app.init();
  expect(await app.dispatch('budget.settings')).toEqual(raised);expect(await app.workspace(entry.id).dispatchStore.read()).toEqual(saved);
  expect(await app.dispatch('dispatch.requestBudget',query)).toEqual(report);expect(await fs.readFile(journal)).toEqual(bytes);expect(provider.sequence).toEqual(sequence);
  expect(await fs.readFile(path.join(f.a,data.file),'utf8')).toBe(data.fact);
 }finally{provider.releaseAll();await app.shutdown();await provider.close();await f.cleanup()}
},90000);
