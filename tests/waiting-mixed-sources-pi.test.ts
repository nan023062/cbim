import {expect,it} from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {fixture} from './helpers';
import {ChatInputs} from '../src/logic/materials/service/chat-inputs';
import {waitingMixedSourcesProvider,mixedSourceGoal as goal,mixedSourceData as data,mixedResourceKinds,mixedResourceText} from './waiting-mixed-sources-provider';
import {seedMixedSources,attachmentHash,attachmentWait} from './waiting-mixed-sources-fixture';
import {exerciseRecursiveMaterialInput} from './recursive-material-input-fixture';

it.each(['snapshot','response-lost'] as const)('keeps mixed material proofs on the recursive original call (%s)',async mode=>{
 const f=await fixture(),provider=await waitingMixedSourcesProvider(true);let close=()=>{};
 try{
  const seed=await seedMixedSources(f.app,f.a,f.temp,provider);close=seed.trace.close;
  const result=await exerciseRecursiveMaterialInput(f.app,f.user,seed,provider,mode,async()=>(await seed.importSources(f.app)).items,()=>seed.changeSources(f.app));
  expect(result.manifest.version).toBe(2);expect(result.manifest.items).toHaveLength(12);
  const resources=result.manifest.items.filter(item=>item.kind==='repository_resource');
  expect(resources.map(item=>item.kind==='repository_resource'&&item.proof.kind==='repository_resource'?item.proof.resourceKind:undefined)).toEqual(mixedResourceKinds);
  for(const item of resources)if(item.kind==='repository_resource'&&item.proof.kind==='repository_resource'){
   expect(item.proof).toMatchObject({provider:'resource_repository_v1',connectorId:data.connectorId,repositoryId:seed.library.repositoryId,revision:seed.library.revision,readOnly:true,transport:'http',truncated:false});
   expect(item.proof.fullContentHash).toBe(attachmentHash(mixedResourceText(item.proof.resourceKind)));
  }
  for(const text of [data.pageText,data.listingName,...mixedResourceKinds.map(mixedResourceText)])expect(result.message).toContain(JSON.stringify(text).slice(1,-1));
  expect(result.message).not.toContain('_AFTER_IMPORT_MUST_NOT_APPEAR');expect(result.message).not.toContain(data.pageScript);expect(result.message).not.toContain(data.nestedFact);
  expect(seed.trace.requests).toHaveLength(8);expect(provider.httpRequests).toEqual([{method:'GET',url:'/page'}]);
 }catch(error){await fs.mkdir('test-results',{recursive:true});await fs.writeFile('test-results/recursive-mixed-'+mode+'.json',JSON.stringify({error:String(error),main:provider.mainRequests,member:provider.memberRequests,errors:provider.errors},null,2));throw error}
 finally{close();await f.app.shutdown();await provider.close();await f.cleanup()}
},120000);

it('rejects unproven or revoked mixed materials without consuming the recursive question',async()=>{
 const f=await fixture(),provider=await waitingMixedSourcesProvider(true);let app=f.app,close=()=>{};
 try{
  const seed=await seedMixedSources(app,f.a,f.temp,provider);close=seed.trace.close;
  const start=await app.dispatch('loop.chat',{id:seed.entry.id,message:goal.mainGoal,options:seed.options});
  const questions=()=>app.dispatch('loop.questions',{id:seed.entry.id,taskId:start.taskId});
  await attachmentWait(async()=>{if(provider.errors.length)throw Error(provider.errors.join('\n'));return (await questions()).length===1},'mixed recursive question');
  const scope=(await seed.scopes())[0],state=await app.workspace(seed.entry.id).dispatchStore.read(),pending=await questions(),thread=await app.execution(seed.entry.id).thread(start.taskId),native=await fs.readFile(thread[0].sessionFile!);
  const reference=await app.dispatch('chat.attach',{id:seed.entry.id,attachment:{kind:'connector',value:data.connectorId}});
  const other=await app.dispatch('add',{path:f.b}),foreign=await new ChatInputs(app.workspace(other.id)).path('folder',seed.folder),damaged=await new ChatInputs(app.workspace(seed.entry.id)).path('folder',seed.folder);
  const raw=JSON.parse(await fs.readFile(seed.snapshotPath(damaged.id),'utf8'));delete raw.version;delete raw.proof;await fs.writeFile(seed.snapshotPath(damaged.id),JSON.stringify(raw));
  for(const item of [reference,foreign,damaged]){
   await expect(app.dispatch('loop.enqueue',{id:seed.entry.id,taskId:start.taskId,message:goal.supplement,attachments:[item.id],options:seed.options})).rejects.toMatchObject({code:expect.stringMatching(/^GOAL_ATTACHMENT_/)});
   expect(await app.dispatch('loop.queue',{id:seed.entry.id,taskId:start.taskId})).toEqual([]);expect(await seed.scopes()).toEqual([scope]);expect(await questions()).toEqual(pending);
   expect(await app.workspace(seed.entry.id).dispatchStore.read()).toEqual(state);expect(await fs.readFile(thread[0].sessionFile!)).toEqual(native);
  }
  const target=(await seed.targets(app)).targets[0],source={kind:'repository_resource',connectorId:target.connectorId,connectionId:target.connectionId,expectedRevision:seed.library.revision,resourceId:seed.library.items[0].id};
  await app.dispatch('resources.connection.revoke',{...seed.identity,connectorId:data.connectorId,expectedGrantRevision:seed.grant.grant.revision,commandId:randomUUID()});
  expect((await seed.targets(app)).targets).toEqual([]);
  const directory=path.dirname(seed.snapshotPath('unused')),before=await fs.readdir(directory);
  await expect(app.dispatch('chat.import',{id:seed.entry.id,importId:randomUUID(),attachment:source})).rejects.toMatchObject({code:expect.stringMatching(/^REPOSITORY_CONNECTION_(NOT_GRANTED|STALE)$/)});
  expect(await fs.readdir(directory)).toEqual(before);expect(seed.trace.requests).toEqual([]);expect(provider.httpRequests).toEqual([]);
  await app.dispatch('loop.stop',{id:seed.entry.id,taskId:start.taskId});await attachmentWait(async()=>(await seed.scopes())[0].status==='closed'&&app.runtime.snapshot().pressure.activeRuns===0,'mixed rejection stop');
  const closed=(await seed.scopes())[0],final=await app.execution(seed.entry.id).thread(start.taskId),bytes=await fs.readFile(thread[0].sessionFile!);
  await app.shutdown();app=seed.reopen(f.user);await app.init();
  expect(await seed.scopes()).toEqual([closed]);expect(await app.execution(seed.entry.id).thread(start.taskId)).toEqual(final);expect(await fs.readFile(thread[0].sessionFile!)).toEqual(bytes);
  expect(provider.mainRequests).toHaveLength(2);expect(provider.memberRequests).toHaveLength(5);expect(provider.errors).toEqual([]);
 }finally{close();await app.shutdown();await provider.close();await f.cleanup()}
},120000);

it('cancels a real material import while the recursive call is waiting for user input',async()=>{
 const f=await fixture(),provider=await waitingMixedSourcesProvider(true);let app=f.app,traceClose=()=>{};
 try{
  const seed=await seedMixedSources(app,f.a,f.temp,provider);traceClose=seed.trace.close;
  const started=await app.dispatch('loop.chat',{id:seed.entry.id,message:goal.mainGoal,options:seed.options});
  const questions=()=>app.dispatch('loop.questions',{id:seed.entry.id,taskId:started.taskId});
  await attachmentWait(async()=>{if(provider.errors.length)throw Error(JSON.stringify({errors:provider.errors,main:provider.mainRequests.at(-1),member:provider.memberRequests.at(-1)}));return (await questions()).length===1},'recursive question pending');
  expect(provider.errors).toEqual([]);expect(provider.mainRequests).toHaveLength(2);expect(provider.memberRequests).toHaveLength(5);
  const scope=(await seed.scopes())[0],state=await app.workspace(seed.entry.id).dispatchStore.read();
  expect(scope.status).toBe('active');expect(scope.wait).toBeUndefined();expect(scope.goal?.plan).toBeUndefined();
  expect(state.graphs[0].tasks).toEqual([]);expect(state.agentBusinessRuns).toHaveLength(1);
  const thread=await app.execution(seed.entry.id).thread(started.taskId);
  expect(thread).toHaveLength(1);const native=await fs.readFile(thread[0].sessionFile!);
  const snapshots=()=>fs.readdir(path.dirname(seed.snapshotPath('unused'))).catch((error:NodeJS.ErrnoException)=>{if(error.code==='ENOENT')return [];throw error});
  const before=await snapshots(),pendingQuestions=await questions(),importId=randomUUID();
  const pending=app.dispatch('chat.import',{id:seed.entry.id,importId,attachment:{kind:'web',value:provider.webUrl+'/held'}}),settled=Promise.allSettled([pending]);
  await attachmentWait(async()=>provider.webHeld,'material HTTP received');
  expect(await app.dispatch('chat.importCancel',{id:seed.entry.id,importId})).toEqual({cancelled:true});
  provider.releaseWeb();expect((await settled)[0].status).toBe('rejected');
  expect(await snapshots()).toEqual(before);expect(await seed.scopes()).toEqual([scope]);expect(await questions()).toEqual(pendingQuestions);
  expect(await app.workspace(seed.entry.id).dispatchStore.read()).toEqual(state);
  expect(await app.execution(seed.entry.id).thread(started.taskId)).toEqual(thread);expect(await fs.readFile(thread[0].sessionFile!)).toEqual(native);
  expect(provider.httpRequests).toEqual([{method:'GET',url:'/held'}]);expect(seed.trace.requests).toEqual([]);
  await app.dispatch('loop.stop',{id:seed.entry.id,taskId:started.taskId});
  await attachmentWait(async()=>(await seed.scopes())[0].status==='closed'&&app.runtime.snapshot().pressure.activeRuns===0,'recursive stop');
  const closed=(await seed.scopes())[0],finalThread=await app.execution(seed.entry.id).thread(started.taskId),finalNative=await fs.readFile(thread[0].sessionFile!);
  expect(closed.outcome).toBe('cancelled');
  await app.shutdown();app=seed.reopen(f.user);await app.init();
  expect(await seed.scopes()).toEqual([closed]);expect(await app.execution(seed.entry.id).thread(started.taskId)).toEqual(finalThread);
  expect(await fs.readFile(thread[0].sessionFile!)).toEqual(finalNative);
  expect(provider.mainRequests).toHaveLength(2);expect(provider.memberRequests).toHaveLength(5);expect(provider.errors).toEqual([]);
 }catch(error){await fs.mkdir('test-results',{recursive:true});await fs.writeFile('test-results/recursive-material-cancel-failure.json',JSON.stringify({error:String(error),main:provider.mainRequests,member:provider.memberRequests,errors:provider.errors},null,2));throw error}
 finally{provider.releaseWeb();traceClose();await app.shutdown();await provider.close();await f.cleanup()}
},120000);
