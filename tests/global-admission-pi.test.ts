import {expect,it,vi} from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fixture} from './helpers';
import {recursiveAdmissionProvider,globalAdmissionFixture as data} from './global-admission-provider';
import {seedGlobalAdmission,admissionScopes} from './global-admission-fixture';
import {Application} from '../src/bridge/server/application';
import {Paths} from '../src/logic/workspace/service/paths';
import {admissionReadSchema} from '../src/logic/runtime/rules/admission';
import {globalRuntimeLogBytes} from './global-runtime-fixture';

it.each(['complete','stop','restart-inflight'] as const)('counts parent and child processes across workspaces without deferred replay (%s)',async mode=>{
 const f=await fixture(),provider=await recursiveAdmissionProvider();let app=f.app;
 try{
  const seeded=await seedGlobalAdmission(app,{a:f.a,b:f.b},provider),ids={a:seeded.a.entry.id,b:seeded.b.entry.id};
  const read=async()=>{const result=admissionReadSchema.parse(await app.Dispatch('admission.read',{}));if(result.kind!=='snapshot')throw Error('snapshot required');return result.snapshot};
  const options=(key:'a'|'b')=>({profileId:seeded.profileId,model:data.model(key),permission:'read' as const,turnTimeoutMs:60000});
  const until=async(check:()=>Promise<void>|void)=>vi.waitFor(async()=>{expect(provider.errors).toEqual([]);await check()},{timeout:30000,interval:40});
  const a=await app.Dispatch('loop.chat',{id:ids.a,message:data.goal('a'),options:options('a')});
  const b=await app.Dispatch('loop.chat',{id:ids.b,message:data.goal('b'),options:options('b')});
  await until(()=>{expect(provider.projects.a.main).toHaveLength(1);expect(provider.projects.b.main).toHaveLength(1)});
  const policy=await app.Dispatch('admission.settings');
  await app.Dispatch('admission.configure',{revision:policy.revision,maxConcurrentRuns:1});
  expect((await read()).occupied).toHaveLength(2);expect((await read()).waiting).toEqual([]);
  const before=await admissionScopes(f.user,ids.b),count=provider.sequence.length;
  await expect(app.Dispatch('loop.chat',{id:ids.b,message:data.rejectedDraft,options:options('b')})).rejects.toMatchObject({code:'CAPACITY_BUSY'});
  expect(await admissionScopes(f.user,ids.b)).toEqual(before);expect(provider.sequence).toHaveLength(count);
  provider.releaseMain('a');
  await until(async()=>{expect((await admissionScopes(f.user,ids.a))[0].status).toBe('closed');expect((await read()).occupied).toHaveLength(1)});
  const denied=await app.Execution(ids.a).Inspect(a.taskId,a.runId);
  const rejection=denied.events.find(e=>e.type==='tool.finished'&&e.data.id==='limited-call');
  expect(JSON.stringify(rejection)).toContain('AGENT_CONCURRENCY_LIMIT');
  expect(provider.projects.a.member).toEqual([]);expect((await read()).waiting).toEqual([]);
  if(mode==='complete'){
   provider.releaseMain('b');
   await until(async()=>expect((await admissionScopes(f.user,ids.b))[0].status).toBe('closed'));
   const bRun=await app.Execution(ids.b).Inspect(b.taskId,b.runId);
   expect(JSON.stringify(bRun.events.find(e=>e.type==='tool.finished'&&e.data.id==='limited-call'))).toContain('AGENT_CONCURRENCY_LIMIT');
  }else await app.Dispatch('loop.stop',{id:ids.b,taskId:b.taskId});
  await until(async()=>expect((await read()).occupied).toEqual([]));
  expect(provider.projects.b.member).toEqual([]);
  const limited=await app.Dispatch('admission.settings'),requests=[...provider.sequence];
  await app.Dispatch('admission.configure',{revision:limited.revision,maxConcurrentRuns:2});
  expect(provider.sequence).toEqual(requests);expect((await read()).waiting).toEqual([]);
  // Raising capacity does not revive denied tools. A new user turn explicitly starts fresh work.
  const fresh=await app.Dispatch('loop.resume',{id:ids.a,taskId:a.taskId,runId:a.runId,message:'GLOBAL_RETRY: now read the original project file',options:options('a')});
  await until(()=>expect(provider.projects.a.member).toHaveLength(1));
  expect((await read()).occupied).toHaveLength(2);expect((await read()).waiting).toEqual([]);
  expect((await read()).occupied.every(item=>item.workspaceId===ids.a)).toBe(true);
  const cursor=(await read()).cursor;expect(await app.Dispatch('admission.read',{cursor})).toEqual({kind:'noop',cursor});
  await expect(app.Dispatch('loop.chat',{id:ids.b,message:data.rejectedDraft,options:options('b')})).rejects.toMatchObject({code:'CAPACITY_BUSY'});
  if(mode==='complete')provider.releaseMember('a');
  else if(mode==='stop')await app.Dispatch('loop.stop',{id:ids.a,taskId:a.taskId});
  else await app.Shutdown();
  if(mode==='restart-inflight'){app=new Application(new Paths(f.user,path.resolve('.')));await app.Init()}
  await until(async()=>expect((await read()).occupied).toEqual([]));
  expect((await read()).waiting).toEqual([]);
  const summary=await app.Execution(ids.a).Inspect(a.taskId,fresh.runId);
  expect(summary.status).toBe(mode==='complete'?'completed':'cancelled');
  const scopes=await admissionScopes(f.user,ids.a);expect(scopes).toHaveLength(2);
  expect(scopes[0].status).toBe('closed');expect(scopes[1].status).toBe('closed');
  expect(await app.Execution(ids.a).Inspect(a.taskId,a.runId)).toEqual(denied);
  const sequence=[...provider.sequence],bytes=await globalRuntimeLogBytes(f.user,ids.a);
  await app.Shutdown();app=new Application(new Paths(f.user,path.resolve('.')));await app.Init();
  expect((await read()).occupied).toEqual([]);expect((await read()).waiting).toEqual([]);expect(provider.sequence).toEqual(sequence);
  expect(await globalRuntimeLogBytes(f.user,ids.a)).toEqual(bytes);expect(await admissionScopes(f.user,ids.a)).toEqual(scopes);
  for(const key of ['a','b'] as const)expect(await fs.readFile(path.join(key==='a'?f.a:f.b,data.file),'utf8')).toBe(data.fact(key));
 }finally{for(const key of ['a','b'] as const){provider.releaseMain(key);provider.releaseMember(key)}await app.Shutdown();await provider.close();await f.cleanup()}
},120000);
