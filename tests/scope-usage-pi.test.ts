import {expect,it,vi} from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fixture} from './helpers';
import {scopeUsageProvider,scopeUsageFixture as data} from './scope-usage-provider';
import {seedScopeUsage,usageScopes,assertScopeUsage,stableScopeUsage} from './scope-usage-fixture';
import {Application} from '../src/backend/main/assembly/application';
import {Paths} from '../src/backend/main/platform/paths';
import type {GraphSnapshot} from '../src/backend/core/tasks/graph-types';
import {scopeUsageReportSchema} from '../src/backend/core/budget/scope-usage';

it('counts real Pi main/member runs once per trusted scope, isolates later goals and preserves metering after a complete restart',async()=>{
  const f=await fixture(),provider=await scopeUsageProvider();let app=f.app,failed=false;
  try{
    const {entry,profileId}=await seedScopeUsage(app,f.a,provider),options={profileId,model:data.model,permission:'read',turnTimeoutMs:60000};
    const started=await app.dispatch('loop.chat',{id:entry.id,message:data.goal,options}) as {taskId:string;runId:string},identity={workspaceId:entry.id,rootSessionId:started.taskId};
    const scopes=()=>usageScopes(f.user,entry.id),graph=()=>app.dispatch('dispatch.graphSnapshot',{identity}) as Promise<GraphSnapshot>;
    await vi.waitFor(()=>expect(provider.member).toHaveLength(1),{timeout:25000});const first=(await scopes())[0];
    const read=(scopeId:string)=>app.dispatch('dispatch.scopeUsage',{...identity,scopeId});
    const requests=provider.sequence.length,inflight=scopeUsageReportSchema.parse(await read(first.scopeId));
    expect(inflight.coverage).toBe('tracked');expect(inflight.scopeStatus).toBe('active');expect(inflight.totals.registeredRuns).toBe(2);expect(inflight.totals.inFlightRuns).toBe(1);expect(inflight.totals.tokensComplete).toBe(false);expect(inflight.runs.filter(run=>run.kind==='main')).toHaveLength(1);expect(inflight.runs.filter(run=>run.kind==='member')).toHaveLength(1);
    await read(first.scopeId);expect(provider.sequence).toHaveLength(requests);provider.releaseMember();
    await vi.waitFor(async()=>{expect((await scopes())[0]).toMatchObject({status:'closed',outcome:'completed'});expect(app.runtime.snapshot().pressure.activeRuns).toBe(0)},{timeout:30000,interval:40});
    const firstReport=assertScopeUsage(await read(first.scopeId),'first'),thread=await app.execution(entry.id).thread(started.taskId),tasks=(await graph()).tasks;
    expect(thread).toHaveLength(2);expect((await scopes())[0].runTracking).toEqual({version:1,mainRunIds:thread.map(run=>run.runId)});expect(firstReport.runs.filter(run=>run.kind==='main').map(run=>run.runId)).toEqual(thread.map(run=>run.runId));expect(firstReport.runs.find(run=>run.kind==='member')?.runId).toBe(tasks[0].runIds[0]);expect(thread[1].source?.kind).toBe('member-results');
    expect(provider.main).toHaveLength(6);expect(provider.member).toHaveLength(5);const journal=path.join(f.user,entry.id,'dispatch','dispatch.jsonl'),beforeRead=await fs.readFile(journal,'utf8'),beforeRequests=[...provider.sequence];
    expect(stableScopeUsage(assertScopeUsage(await read(first.scopeId),'first'))).toEqual(stableScopeUsage(firstReport));expect(await fs.readFile(journal,'utf8')).toBe(beforeRead);expect(provider.sequence).toEqual(beforeRequests);
    await app.dispatch('loop.resume',{id:entry.id,taskId:started.taskId,runId:thread.at(-1)!.runId,message:data.nextGoal,options});
    await vi.waitFor(async()=>{const all=await scopes();expect(all).toHaveLength(2);expect(all[1]).toMatchObject({status:'closed',outcome:'completed'});expect(app.runtime.snapshot().pressure.activeRuns).toBe(0)},{timeout:20000,interval:40});
    const second=(await scopes())[1],secondReport=assertScopeUsage(await read(second.scopeId),'second');expect(second.scopeId).not.toBe(first.scopeId);expect(second.rootSessionId).toBe(first.rootSessionId);expect(secondReport.runs.every(run=>!firstReport.runs.some(old=>old.runId===run.runId))).toBe(true);expect(stableScopeUsage(assertScopeUsage(await read(first.scopeId),'first'))).toEqual(stableScopeUsage(firstReport));
    const savedScopes=await scopes(),savedGraph=await graph(),sequence=[...provider.sequence];await app.shutdown();app=new Application(new Paths(f.user,path.resolve('.')),path.resolve('design'));await app.init();
    expect(await scopes()).toEqual(savedScopes);expect(await graph()).toEqual(savedGraph);expect(stableScopeUsage(assertScopeUsage(await read(first.scopeId),'first'))).toEqual(stableScopeUsage(firstReport));expect(stableScopeUsage(assertScopeUsage(await read(second.scopeId),'second'))).toEqual(stableScopeUsage(secondReport));expect(provider.sequence).toEqual(sequence);expect(provider.main).toHaveLength(7);expect(provider.member).toHaveLength(5);expect(provider.errors).toEqual([]);expect(await fs.readFile(path.join(f.a,data.file),'utf8')).toBe(data.fact);
  }catch(error){failed=true;console.error(JSON.stringify({temp:f.temp,sequence:provider.sequence,transportErrors:provider.errors}));throw error}
  finally{provider.releaseMember();const errors:unknown[]=[];for(const clean of [()=>app.shutdown(),()=>f.cleanup(),()=>provider.close()])try{await clean()}catch(error){errors.push(error)}if(!failed&&errors.length)throw errors[0]}
},90000);
