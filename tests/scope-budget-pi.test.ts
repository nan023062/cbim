import {expect,it,vi} from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {fixture} from './helpers';
import {scopeBudgetProvider,scopeBudgetFixture as data,type BudgetFixtureMode} from './scope-budget-provider';
import {seedScopeBudget,budgetScopes,budgetLimits,budgetDenies,budgetUnpriced} from './scope-budget-fixture';
import {Application} from '../src/backend/main/application';
import {Paths} from '../src/backend/main/platform/paths';
import type {GraphSnapshot} from '../src/backend/core/tasks/graph-types';
import type {GoalContinuationRequest} from '../src/backend/core/tasks/scope-continuation';
import {scopeUsageReportSchema} from '../src/backend/core/tasks/scope-usage';

it.each(['main-limit','member-limit','cost-limit','unknown-price','tokens-unpriced','complete','waiting'] as BudgetFixtureMode[])('enforces frozen soft budget only between actual Pi runs and never replays after restart (%s)',async mode=>{
  const f=await fixture(),provider=await scopeBudgetProvider(mode);let app=f.app,failed=false;
  try{
    const {entry,profileId}=await seedScopeBudget(app,f.a,provider,mode),options={profileId,model:data.model,permission:'read',turnTimeoutMs:60000};
    const defaults=await app.dispatch('budget.settings');expect(defaults).toMatchObject({revision:1,enabled:false,limits:{}});
    const policy=await app.dispatch('budget.configure',{revision:defaults.revision,enabled:true,limits:budgetLimits(mode)});
    const started=await app.dispatch('loop.chat',{id:entry.id,message:data.goal,options}) as {taskId:string;runId:string},identity={workspaceId:entry.id,rootSessionId:started.taskId},scopes=()=>budgetScopes(f.user,entry.id),graph=()=>app.dispatch('dispatch.graphSnapshot',{identity}) as Promise<GraphSnapshot>,queue=()=>app.dispatch('loop.queue',{id:entry.id,taskId:started.taskId});
    await vi.waitFor(()=>expect(provider.main).toHaveLength(3),{timeout:20000});const original=(await scopes())[0];expect(original.budget?.policy).toEqual(policy);expect(original.runTracking?.mainRunIds).toEqual([started.runId]);expect(provider.member).toHaveLength(0);
    // A later global edit is deliberately made while the actual main engine is still active.
    const raised=await app.dispatch('budget.configure',{revision:policy.revision,enabled:true,limits:{tokens:100000,estimatedCostUsd:100}});expect((await scopes())[0].budget?.policy).toEqual(policy);
    if(budgetDenies(mode)||mode==='waiting')await app.dispatch('loop.enqueue',{id:entry.id,taskId:started.taskId,message:data.queued,options});
    provider.releaseMain();provider.releaseMember();
    await vi.waitFor(async()=>{expect((await scopes())[0].status).toBe(mode==='waiting'?'waiting':'closed');expect(app.runtime.snapshot().pressure.activeRuns).toBe(0)},{timeout:35000,interval:40});
    const settled=(await scopes())[0],task=(await graph()).tasks[0],usage=scopeUsageReportSchema.parse(await app.dispatch('dispatch.scopeUsage',{...identity,scopeId:settled.scopeId}));expect(settled.budget?.policy).toEqual(policy);expect(provider.errors).toEqual([]);
    if(budgetDenies(mode)){
      expect(settled.outcome).toBe('failed');expect(settled.budget?.blocked?.reason).toBe(mode==='unknown-price'?'usage_unverifiable':mode==='cost-limit'?'cost_limit':'token_limit');expect(settled.budget?.blocked?.policyRevision).toBe(policy.revision);expect(provider.main).toHaveLength(3);expect(provider.member).toHaveLength(mode==='member-limit'?5:0);expect(settled.runTracking?.mainRunIds).toEqual([started.runId]);expect(usage.totals.tokens.total).toBe(mode==='member-limit'?1560:360);
      // The actual Pi sum is 0.00041999999999999996; floating tail error must not grant another run.
      if(mode==='cost-limit'){expect(usage.totals.estimatedCostUsd).toBeLessThan(policy.limits.estimatedCostUsd!);expect(usage.totals.estimatedCostUsd).toBeCloseTo(policy.limits.estimatedCostUsd!,14)}
      if(mode==='member-limit'){expect(task.runIds).toHaveLength(1);expect(task.result).toBeDefined()}else{expect(task.runIds).toEqual([]);expect(task.result).toBeUndefined()}
      expect((await queue())[0]).toMatchObject({message:data.queued,status:'paused'});
    }else{
      expect(provider.main).toHaveLength(6);expect(provider.member).toHaveLength(5);expect(usage.totals.tokens.total).toBe(1920);expect(usage.totals.registeredRuns).toBe(3);expect(usage.totals.tokensComplete).toBe(true);expect(settled.budget?.blocked).toBeUndefined();expect(settled.runTracking?.mainRunIds).toHaveLength(2);
      if(mode!=='waiting')expect(settled).toMatchObject({status:'closed',outcome:'completed'});
    }
    expect(usage.totals.costComplete).toBe(!budgetUnpriced(mode));
    const sequence=[...provider.sequence],beforeRestart=await scopes(),beforeGraph=await graph();await app.shutdown();app=new Application(new Paths(f.user,path.resolve('.')),path.resolve('design'));await app.init();
    expect(await app.dispatch('budget.settings')).toEqual(raised);expect(await scopes()).toEqual(beforeRestart);expect(await graph()).toEqual(beforeGraph);expect(provider.sequence).toEqual(sequence);
    if(mode==='waiting'){
      const before=(await scopes())[0],wait=before.wait!,req:GoalContinuationRequest={...identity,scopeId:before.scopeId,waitId:wait.waitId,expectedGoalRevision:before.goal!.revision,expectedInputRevision:before.goal!.inputRevision??1,commandId:randomUUID(),input:{message:data.supplement},options:{provider:'cbim-'+profileId,model:data.model,profileId,permission:'read',turnTimeoutMs:30000}};
      const lookup={...identity,scopeId:req.scopeId,commandId:req.commandId};expect(await app.dispatch('loop.goalContinuation',lookup)).toBeUndefined();
      await expect(app.dispatch('loop.goalContinue',req)).rejects.toMatchObject({code:'SCOPE_BUDGET_EXCEEDED'});
      const denied=(await scopes())[0];expect(denied.status).toBe('waiting');expect(denied.wait).toEqual(before.wait);expect(denied.goal).toEqual(before.goal);expect(denied.continuations).toEqual(before.continuations);expect(denied.runTracking).toEqual(before.runTracking);expect(denied.budget?.blocked?.reason).toBe('token_limit');expect(await app.dispatch('loop.goalContinuation',lookup)).toBeUndefined();expect((await queue())[0]).toMatchObject({message:data.queued,status:'paused'});expect(provider.sequence).toEqual(sequence);
      await app.shutdown();app=new Application(new Paths(f.user,path.resolve('.')),path.resolve('design'));await app.init();expect((await scopes())[0]).toEqual(denied);expect(provider.sequence).toEqual(sequence);await app.dispatch('loop.stop',{id:entry.id,taskId:started.taskId});expect((await scopes())[0]).toMatchObject({status:'closed',outcome:'cancelled'});expect(provider.sequence).toEqual(sequence);
    }
    expect(await fs.readFile(path.join(f.a,data.file),'utf8')).toBe(data.fact);expect(provider.errors).toEqual([]);
  }catch(error){failed=true;console.error(JSON.stringify({mode,temp:f.temp,sequence:provider.sequence,transportErrors:provider.errors}));throw error}
  finally{provider.releaseAll();const errors:unknown[]=[];for(const clean of [()=>app.shutdown(),()=>f.cleanup(),()=>provider.close()])try{await clean()}catch(error){errors.push(error)}if(!failed&&errors.length)throw errors[0]}
},90000);
