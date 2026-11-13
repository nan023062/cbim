import {it,expect,vi} from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fixture} from './helpers';
import {Application} from '../src/backend/main/assembly/application';
import {Paths} from '../src/backend/main/platform/paths';
import {outputManifestResultSchema,outputManifestReportSchema} from '../src/logic/evidence/rules/output-manifest';
import {outputManifestProvider,outputManifestData as d} from './output-manifest-provider';
import {seedOutputManifest,manifestRecords,manifestLogFiles,assertManifestReport} from './output-manifest-pi-fixture';

it.each(['complete','stop'] as const)('真实Pi冻结完整范围、显式核实增删移动及重开无重放（%s）',async mode=>{
  const f=await fixture(),provider=await outputManifestProvider();let reopened:Application|undefined;
  try{
    const {entry,contract}=await seedOutputManifest(f.app,f.a,provider),start=await f.app.dispatch('loop.chat',{id:entry.id,message:d.goal,options:{permission:'read',turnTimeoutMs:30000}}) as {taskId:string},identity={workspaceId:entry.id,rootSessionId:start.taskId},records=()=>manifestRecords(f.user,entry.id),graph=()=>f.app.dispatch('dispatch.graphSnapshot',{identity});
    await vi.waitFor(()=>{expect(provider.errors).toEqual([]);expect(provider.member).toHaveLength(4);expect(provider.state.captured).toBeTruthy()},{timeout:30000,interval:40});
    const captured=outputManifestResultSchema.parse(provider.state.captured),task=(await graph()).tasks[0],query={...identity,taskId:task.taskId,runId:task.activeRunId!},selected={...query,manifestId:captured.manifest.manifestId};expect(captured.binding).toMatchObject(query);
    const list=outputManifestReportSchema.parse(await f.app.dispatch('dispatch.manifestReport',query));expect(list.manifests.map(m=>m.manifestId)).toEqual([captured.manifest.manifestId]);expect(list.verification).toBeUndefined();expect((await records()).runs[0].prepared.modules[0].workflowContract).toEqual(contract);
    expect((await f.app.dispatch('dispatch.manifestReport',selected)).verification?.state).toBe('unverifiable');
    if(mode==='stop')await f.app.dispatch('loop.stop',{id:entry.id,taskId:identity.rootSessionId});provider.releaseMember();await vi.waitFor(async()=>expect((await records()).scopes[0].status).toBe('closed'),{timeout:30000,interval:40});
    const saved=await records(),savedGraph=await graph(),files=await manifestLogFiles(f.user,entry.id,query.taskId,query.runId),bytes=await files.read(),sequence=[...provider.sequence];expect(saved.scopes[0].outcome).toBe(mode==='complete'?'completed':'cancelled');expect(provider.main).toHaveLength(mode==='complete'?6:3);expect(provider.member).toHaveLength(mode==='complete'?6:4);expect(savedGraph.tasks[0].result?.evidenceRefs??[]).not.toContain('manifest-capture');
    const matched=assertManifestReport(await f.app.dispatch('dispatch.manifestReport',selected),'matches',[d.root,d.root+'/empty',d.file]);
    await fs.writeFile(path.join(f.a,d.root,'new.txt'),'new');const added=assertManifestReport(await f.app.dispatch('dispatch.manifestReport',selected),'changed',[d.root,d.root+'/empty',d.root+'/new.txt',d.file]);expect(added.verification!.expected!.entries.find(e=>e.relativePath===d.file)).toEqual(added.verification!.observed!.entries.find(e=>e.relativePath===d.file));
    await fs.rename(path.join(f.a,d.root,'new.txt'),path.join(f.a,d.root,'moved.txt'));assertManifestReport(await f.app.dispatch('dispatch.manifestReport',selected),'changed',[d.root,d.root+'/empty',d.root+'/moved.txt',d.file]);
    await fs.unlink(path.join(f.a,d.file));const missing=assertManifestReport(await f.app.dispatch('dispatch.manifestReport',selected),'changed',[d.root,d.root+'/empty',d.root+'/moved.txt']);
    expect(await files.read()).toEqual(bytes);expect(await graph()).toEqual(savedGraph);expect(await records()).toEqual(saved);expect(provider.sequence).toEqual(sequence);expect(JSON.stringify(matched)).not.toContain(f.a);expect(JSON.stringify(matched)).not.toContain(d.content);
    await f.app.shutdown();reopened=new Application(new Paths(f.user,path.resolve('.')),path.resolve('design'));await reopened.init();const restored=assertManifestReport(await reopened.dispatch('dispatch.manifestReport',selected),'changed',[d.root,d.root+'/empty',d.root+'/moved.txt']);expect(restored.verification).toEqual(missing.verification);expect(restored.manifests).toEqual(matched.manifests);expect(await files.read()).toEqual(bytes);expect(await records()).toEqual(saved);expect(await reopened.dispatch('dispatch.graphSnapshot',{identity})).toEqual(savedGraph);expect(provider.sequence).toEqual(sequence);expect(provider.errors).toEqual([]);
  }finally{provider.releaseMember();await reopened?.shutdown();await f.cleanup();await provider.close()}
},120000);
