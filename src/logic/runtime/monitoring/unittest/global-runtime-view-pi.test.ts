import {expect,it,vi} from 'vitest';
import path from 'node:path';
import {fixture} from '../../../application/unittest/support/helpers';
import {Application} from '../../../../bridge/server/application';
import {Paths} from '../../../workspace/service/paths';
import {runtimeSnapshotSchema,runtimeReadSchema} from '../../rules/runtime-validation';
import {recursiveAdmissionProvider,globalAdmissionFixture as data} from '../../../application/assembly/unittest/support/global-admission-provider';
import {seedGlobalAdmission} from '../../../application/assembly/unittest/support/global-admission-fixture';
import {globalRuntimeLogBytes} from './support/global-runtime-fixture';

it('projects real parent and child runs across workspaces without replay on observation or restart',async()=>{
 const f=await fixture(),provider=await recursiveAdmissionProvider();let app=f.app;
 try{
  const seeded=await seedGlobalAdmission(app,{a:f.a,b:f.b},provider),ids={a:seeded.a.entry.id,b:seeded.b.entry.id};
  const options=(key:'a'|'b')=>({profileId:seeded.profileId,model:data.model(key),permission:'read' as const,turnTimeoutMs:60000});
  const until=async(check:()=>Promise<void>|void)=>vi.waitFor(async()=>{expect(provider.errors).toEqual([]);await check()},{timeout:30000,interval:40});
  const a=await app.Dispatch('loop.chat',{id:ids.a,message:'GLOBAL_RETRY: inspect project A',options:options('a')});
  const b=await app.Dispatch('loop.chat',{id:ids.b,message:data.goal('b'),options:options('b')});
  await until(()=>{expect(provider.projects.a.member).toHaveLength(1);expect(provider.projects.b.main).toHaveLength(1);expect(app.runtime.Snapshot().pressure.activeRuns).toBe(3)});
  const snapshot=runtimeSnapshotSchema.parse(await app.Dispatch('runtime.snapshot',{}));
  expect(snapshot.scopes).toHaveLength(2);expect(snapshot.scopes.every(scope=>scope.status==='active')).toBe(true);
  expect(snapshot.tasks.filter(task=>task.source==='dispatch')).toEqual([]);
  expect(snapshot.tasks.filter(task=>task.source==='loop')).toHaveLength(3);
  expect(snapshot.usage.unreportedRuns).toBeGreaterThan(0);expect(snapshot.usage.costPartial).toBe(true);
  const root=await app.Execution(ids.a).Inspect(a.taskId,a.runId);
  const ref=root.events.find(event=>event.type==='tool.updated'&&event.data.agentCall)?.data.agentCall as {taskId:string;runId:string};
  expect(ref).toBeDefined();
  expect(snapshot.tasks.find(task=>task.taskId===ref.taskId)).toMatchObject({source:'loop',workspaceId:ids.a,status:'running',activeRunIds:[ref.runId]});
  const sequence=[...provider.sequence];
  expect(runtimeReadSchema.parse(await app.Dispatch('runtime.read',{cursor:snapshot.cursor}))).toEqual({mode:'noop',cursor:snapshot.cursor});
  expect(runtimeReadSchema.parse(await app.Dispatch('runtime.read',{cursor:snapshot.cursor}))).toEqual({mode:'noop',cursor:snapshot.cursor});
  expect(provider.sequence).toEqual(sequence);
  await app.Dispatch('loop.stop',{id:ids.b,taskId:b.taskId});
  await app.Dispatch('loop.stop',{id:ids.a,taskId:a.taskId});
  await until(()=>{expect(app.runtime.Snapshot().pressure.activeRuns).toBe(0);expect(app.runtime.Snapshot().scopes.every(scope=>scope.status==='closed')).toBe(true)});
  const closed=app.runtime.Snapshot(),bytesA=await globalRuntimeLogBytes(f.user,ids.a),bytesB=await globalRuntimeLogBytes(f.user,ids.b);
  expect(closed.scopes.every(scope=>scope.outcome==='cancelled')).toBe(true);
  expect(closed.cursor.revision).toBeGreaterThan(snapshot.cursor.revision);expect(provider.sequence).toEqual(sequence);
  await app.Shutdown();app=new Application(new Paths(f.user,path.resolve('.')));await app.Init();
  const restored=app.runtime.Snapshot();expect(restored.pressure.activeRuns).toBe(0);expect(restored.scopes).toEqual(closed.scopes);
  expect(restored.cursor.streamId).not.toBe(closed.cursor.streamId);
  expect(restored.tasks.find(task=>task.taskId===ref.taskId)).toMatchObject({source:'loop',status:'cancelled',activeRunIds:[]});
  expect(await globalRuntimeLogBytes(f.user,ids.a)).toEqual(bytesA);expect(await globalRuntimeLogBytes(f.user,ids.b)).toEqual(bytesB);
  expect(provider.sequence).toEqual(sequence);expect(provider.errors).toEqual([]);
 }finally{for(const key of ['a','b'] as const){provider.releaseMain(key);provider.releaseMember(key)}await app.Shutdown();await provider.close();await f.cleanup()}
},120000);
