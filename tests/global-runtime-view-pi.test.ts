import {expect,it,vi} from 'vitest';
import path from 'node:path';
import {fixture} from './helpers';
import {Application} from '../src/bridge/server/application';
import {Paths} from '../src/logic/workspace/service/paths';
import type {GraphSnapshot} from '../src/logic/tasks/rules/graph-types';
import type {RuntimeSnapshot} from '../src/logic/runtime/rules/types';
import {runtimeSnapshotSchema,runtimeReadSchema} from '../src/logic/runtime/rules/runtime-validation';
import {admissionReadSchema} from '../src/logic/runtime/rules/admission';
import {globalRuntimeProviders,seedGlobalRuntime,globalRuntimeFixture as data,waitFixture,globalAdmissionFixture as admissionData,admissionScopes} from './global-runtime-fixture';

it('projects real waiting, active member and queued admission across two workspaces without reading models or replaying after restart',async()=>{
  const f=await fixture(),providers=await globalRuntimeProviders();let app=f.app;
  try{
    const seeded=await seedGlobalRuntime(app,{a:f.a,b:f.b},providers),ids={a:seeded.a.entry.id,b:seeded.b.entry.id};
    const readAdmission=async()=>{const result=admissionReadSchema.parse(await app.dispatch('admission.read',{}));if(result.kind!=='snapshot')throw Error('Explicit admission snapshot missing');return result.snapshot};
    const waiting=await app.dispatch('loop.chat',{id:ids.a,message:waitFixture.mainGoal,options:{profileId:seeded.waitingProfileId,model:data.waitingModel,permission:'read',turnTimeoutMs:120000}});
    await vi.waitFor(async()=>{expect(providers.errors()).toEqual([]);expect((await admissionScopes(f.user,ids.a))[0].status).toBe('waiting');expect(app.runtime.snapshot().pressure.activeRuns).toBe(0)},{timeout:30000,interval:40});
    const start=async(key:'a'|'b')=>app.dispatch('loop.chat',{id:ids[key],message:admissionData.goal(key),options:{profileId:seeded.profileId,model:admissionData.model(key),permission:'read',turnTimeoutMs:120000}}),a=await start('a');await vi.waitFor(()=>expect(providers.admission.projects.a.main).toHaveLength(3),{timeout:15000});const b=await start('b');await vi.waitFor(()=>expect(providers.admission.projects.b.main).toHaveLength(3),{timeout:15000});
    const policy=await app.dispatch('admission.settings');await app.dispatch('admission.configure',{revision:policy.revision,maxConcurrentRuns:1});providers.admission.releaseMain('a');await vi.waitFor(async()=>expect((await readAdmission()).waiting).toHaveLength(1),{timeout:15000});providers.admission.releaseMain('b');
    await vi.waitFor(async()=>{expect(providers.admission.projects.a.member).toHaveLength(1);expect((await readAdmission()).waiting).toEqual([expect.objectContaining({workspaceId:ids.b,rootSessionId:b.taskId,source:'member'})]);expect(app.runtime.snapshot().pressure.activeRuns).toBe(1)},{timeout:15000});
    const graphs=await Promise.all([app.dispatch('dispatch.graphSnapshot',{identity:{workspaceId:ids.a,rootSessionId:a.taskId}}),app.dispatch('dispatch.graphSnapshot',{identity:{workspaceId:ids.b,rootSessionId:b.taskId}})]) as GraphSnapshot[],counts=providers.counts();expect(counts).toEqual({waitingMain:6,waitingMember:5,aMain:3,aMember:1,bMain:3,bMember:0});
    const snapshot=runtimeSnapshotSchema.parse(JSON.parse(JSON.stringify(await app.dispatch('runtime.snapshot',{})))) as RuntimeSnapshot;
    expect(snapshot.scopes).toHaveLength(3);expect(snapshot.scopes.find(scope=>scope.rootSessionId===waiting.taskId)).toMatchObject({workspaceId:ids.a,status:'waiting',hasGoal:true,reviewDecision:'awaiting_user',wait:{reason:expect.any(String)}});expect(snapshot.scopes.filter(scope=>scope.status==='active')).toHaveLength(2);
    const main=snapshot.tasks.find(task=>task.source==='loop'&&task.taskId===waiting.taskId);expect(main).toMatchObject({source:'loop',workspaceId:ids.a,binding:'instance',status:'completed',activeRunIds:[]});expect(snapshot.members.filter(member=>member.agentId==='cbim:main')).toHaveLength(3);
    expect(graphs[0].tasks[0].runIds).toHaveLength(1);expect(graphs[1].tasks[0].runIds).toEqual([]);expect(snapshot.tasks.find(task=>task.taskId===graphs[1].tasks[0].taskId)).toMatchObject({source:'dispatch',workspaceId:ids.b,rootSessionId:b.taskId,scopeId:graphs[1].tasks[0].scopeId,runIds:[]});
    expect(snapshot.usage.unreportedRuns).toBeGreaterThan(0);expect(snapshot.usage.costPartial).toBe(true);expect(snapshot.usage.reportedRuns).toBeGreaterThan(0);
    expect(runtimeReadSchema.parse(await app.dispatch('runtime.read',{cursor:snapshot.cursor}))).toEqual({mode:'noop',cursor:snapshot.cursor});expect(runtimeReadSchema.parse(await app.dispatch('runtime.read',{cursor:snapshot.cursor}))).toEqual({mode:'noop',cursor:snapshot.cursor});expect(providers.counts()).toEqual(counts);
    // Stop queued B before active A so no FIFO member can be started during teardown.
    await app.dispatch('loop.stop',{id:ids.b,taskId:b.taskId});await app.dispatch('loop.stop',{id:ids.a,taskId:a.taskId});await app.dispatch('loop.stop',{id:ids.a,taskId:waiting.taskId});providers.admission.releaseAll();
    await vi.waitFor(async()=>{expect(app.runtime.snapshot().pressure.activeRuns).toBe(0);expect((await readAdmission()).waiting).toEqual([]);expect(app.runtime.snapshot().scopes.every(scope=>scope.status==='closed')).toBe(true)},{timeout:15000});
    const closed=app.runtime.snapshot(),savedScopes=closed.scopes,countsBeforeRestart=providers.counts();expect(countsBeforeRestart).toEqual(counts);expect(savedScopes.every(scope=>scope.outcome==='cancelled')).toBe(true);expect(closed.cursor.revision).toBeGreaterThan(snapshot.cursor.revision);await app.shutdown();app=new Application(new Paths(f.user,path.resolve('.')),path.resolve('design'));await app.init();
    const restored=app.runtime.snapshot();expect(restored.scopes).toEqual(savedScopes);expect(restored.pressure.activeRuns).toBe(0);expect(restored.cursor.streamId).not.toBe(closed.cursor.streamId);expect((await readAdmission()).occupied).toEqual([]);expect((await readAdmission()).waiting).toEqual([]);expect(providers.counts()).toEqual(countsBeforeRestart);expect(providers.errors()).toEqual([]);
  }finally{providers.admission.releaseAll();await app.shutdown();await f.cleanup();await providers.close()}
},120000);
