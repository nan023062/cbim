import {expect,it,vi} from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fixture} from './helpers';
import {globalAdmissionProvider,globalAdmissionFixture as data} from './global-admission-provider';
import {seedGlobalAdmission,admissionScopes} from './global-admission-fixture';
import {Application} from '../src/backend/main/application';
import {Paths} from '../src/backend/main/platform/paths';
import type {GraphSnapshot} from '../src/backend/core/tasks/graph-types';
import {admissionReadSchema} from '../src/backend/core/runtime/admission';

it.each(['complete','stop','restart-waiting'] as const)('shares actual Pi admission across two workspaces, preserves FIFO and never starts a cancelled ticket (%s)',async mode=>{
  const f=await fixture(),provider=await globalAdmissionProvider();let app=f.app,failed=false;
  try{
    const seeded=await seedGlobalAdmission(app,{a:f.a,b:f.b},provider),ids={a:seeded.a.entry.id,b:seeded.b.entry.id};
    const read=async()=>{const result=admissionReadSchema.parse(await app.dispatch('admission.read',{}));if(result.kind!=='snapshot')throw Error('Expected explicit admission snapshot');return result.snapshot};
    expect(await app.dispatch('admission.settings')).toMatchObject({maxConcurrentRuns:4});
    const start=async(key:'a'|'b')=>app.dispatch('loop.chat',{id:ids[key],message:data.goal(key),options:{profileId:seeded.profileId,model:data.model(key),permission:'read',turnTimeoutMs:60000}}) as Promise<{taskId:string;runId:string}>;
    const a=await start('a');await vi.waitFor(()=>expect(provider.projects.a.main).toHaveLength(3),{timeout:20000});
    const b=await start('b');await vi.waitFor(()=>expect(provider.projects.b.main).toHaveLength(3),{timeout:20000});
    const graph=(key:'a'|'b')=>app.dispatch('dispatch.graphSnapshot',{identity:{workspaceId:ids[key],rootSessionId:(key==='a'?a:b).taskId}}) as Promise<GraphSnapshot>;
    const policy=await app.dispatch('admission.settings'),limited=await app.dispatch('admission.configure',{revision:policy.revision,maxConcurrentRuns:1});expect(limited).toMatchObject({revision:policy.revision+1,maxConcurrentRuns:1});
    const downgraded=await read();expect(downgraded.occupied).toHaveLength(2);expect(downgraded.waiting).toEqual([]);expect(provider.projects.a.member).toHaveLength(0);expect(provider.projects.b.member).toHaveLength(0);
    provider.releaseMain('a');await vi.waitFor(async()=>{const state=await read();expect(state.occupied).toHaveLength(1);expect(state.waiting).toEqual([expect.objectContaining({workspaceId:ids.a,source:'member'})])},{timeout:15000});
    const earliest=(await read()).waiting[0];expect((await graph('a')).tasks[0].runIds).toEqual([]);expect(provider.projects.b.main).toHaveLength(3);
    const beforeRejected=await admissionScopes(f.user,ids.b),requestCount=provider.sequence.length;
    await expect(app.dispatch('loop.chat',{id:ids.b,message:data.rejectedDraft,options:{profileId:seeded.profileId,model:data.model('b'),permission:'read',turnTimeoutMs:60000}})).rejects.toMatchObject({code:'CAPACITY_BUSY'});
    expect(await admissionScopes(f.user,ids.b)).toEqual(beforeRejected);expect(provider.sequence).toHaveLength(requestCount);
    provider.releaseMain('b');await vi.waitFor(async()=>{expect(provider.projects.a.member).toHaveLength(1);const state=await read();expect(state.occupied).toHaveLength(1);expect(state.occupied[0]).toMatchObject({workspaceId:ids.a,source:'member'});expect(state.waiting).toEqual([expect.objectContaining({workspaceId:ids.b,source:'member'})])},{timeout:15000});
    const waiting=await read(),bTicket=waiting.waiting[0],bTask=(await graph('b')).tasks[0];expect(bTicket.order).toBeGreaterThan(earliest.order);expect(bTask.runIds).toEqual([]);expect(bTask.activeRunId).toBeUndefined();expect(bTask.result).toBeUndefined();expect(provider.projects.b.member).toHaveLength(0);expect((await app.execution(ids.b).thread(b.taskId))).toHaveLength(1);
    expect(await app.dispatch('admission.read',{cursor:waiting.cursor})).toEqual({kind:'noop',cursor:waiting.cursor});
    if(mode==='restart-waiting'){
      const sequence=[...provider.sequence];await app.shutdown();provider.releaseAll();app=new Application(new Paths(f.user,path.resolve('.')),path.resolve('design'));await app.init();
      expect(await app.dispatch('admission.settings')).toEqual(limited);expect((await read()).occupied).toEqual([]);expect((await read()).waiting).toEqual([]);expect(provider.sequence).toEqual(sequence);expect(provider.projects.a.member).toHaveLength(1);expect(provider.projects.b.member).toHaveLength(0);expect((await graph('b')).tasks[0].runIds).toEqual([]);expect((await admissionScopes(f.user,ids.b))[0].status).toBe('closed');expect(provider.errors).toEqual([]);return;
    }
    if(mode==='stop'){
      await app.dispatch('loop.stop',{id:ids.b,taskId:b.taskId});await vi.waitFor(async()=>expect((await read()).waiting.some(item=>item.workspaceId===ids.b)).toBe(false),{timeout:15000});
      expect((await admissionScopes(f.user,ids.b))[0]).toMatchObject({status:'closed',outcome:'cancelled'});expect((await graph('b')).tasks[0].runIds).toEqual([]);
    }
    provider.releaseMember('a');
    if(mode==='complete'){
      await vi.waitFor(async()=>{expect(provider.projects.b.member).toHaveLength(1);const state=await read();expect(state.occupied).toHaveLength(1);expect(state.occupied[0]).toMatchObject({workspaceId:ids.b,source:'member'});expect(state.waiting.some(item=>item.workspaceId===ids.a&&item.source==='main-result')).toBe(true)},{timeout:20000});
      expect(provider.projects.a.main).toHaveLength(3);provider.releaseMember('b');
    }
    await vi.waitFor(async()=>{expect((await admissionScopes(f.user,ids.a))[0]).toMatchObject({status:'closed',outcome:'completed'});expect((await admissionScopes(f.user,ids.b))[0]).toMatchObject({status:'closed',outcome:mode==='complete'?'completed':'cancelled'});expect((await read()).occupied).toEqual([]);expect((await read()).waiting).toEqual([])},{timeout:35000,interval:40});
    expect(provider.projects.a.main).toHaveLength(6);expect(provider.projects.a.member).toHaveLength(5);expect(provider.projects.b.main).toHaveLength(mode==='complete'?6:3);expect(provider.projects.b.member).toHaveLength(mode==='complete'?5:0);
    if(mode==='complete'){expect(provider.sequence.indexOf('a:member:0')).toBeLessThan(provider.sequence.indexOf('b:member:0'));expect(provider.sequence.indexOf('b:member:0')).toBeLessThan(provider.sequence.indexOf('a:main:3'));expect(provider.sequence.indexOf('a:main:3')).toBeLessThan(provider.sequence.indexOf('b:main:3'))}
    const scopesA=await admissionScopes(f.user,ids.a),scopesB=await admissionScopes(f.user,ids.b),graphA=await graph('a'),graphB=await graph('b'),sequence=[...provider.sequence];
    await app.shutdown();app=new Application(new Paths(f.user,path.resolve('.')),path.resolve('design'));await app.init();
    expect(await app.dispatch('admission.settings')).toEqual(limited);expect((await read()).occupied).toEqual([]);expect((await read()).waiting).toEqual([]);expect(await graph('a')).toEqual(graphA);expect(await graph('b')).toEqual(graphB);expect(await admissionScopes(f.user,ids.a)).toEqual(scopesA);expect(await admissionScopes(f.user,ids.b)).toEqual(scopesB);expect(provider.sequence).toEqual(sequence);
    expect(await fs.readFile(path.join(f.a,data.file),'utf8')).toBe(data.fact('a'));expect(await fs.readFile(path.join(f.b,data.file),'utf8')).toBe(data.fact('b'));expect(provider.errors).toEqual([]);
  }catch(error){failed=true;console.error(JSON.stringify({mode,temp:f.temp,sequence:provider.sequence,providerErrors:provider.errors,admission:await app.dispatch('admission.read').catch(()=>undefined)}));throw error}
  finally{provider.releaseAll();const cleanupErrors:unknown[]=[];for(const cleanup of [()=>app.shutdown(),()=>f.cleanup(),()=>provider.close()])try{await cleanup()}catch(error){cleanupErrors.push(error)}if(!failed&&cleanupErrors.length)throw cleanupErrors[0]}
},120000);
