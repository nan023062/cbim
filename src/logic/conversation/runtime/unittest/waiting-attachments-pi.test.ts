import {expect,it} from 'vitest';
import fs from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {fixture} from '../../../application/unittest/support/helpers';
import {waitingAttachmentsProvider,attachmentFixture as data} from './support/waiting-attachments-provider';
import {attachmentWait,seedWaitingAttachments} from './support/waiting-attachments-fixture';
import {ChatInputs} from '../../../materials/service/chat-inputs';
import {exerciseRecursiveMaterialInput} from './support/recursive-material-input-fixture';

it.each(['snapshot','response-lost','budget-stop'] as const)('keeps recursive materials on the original run (%s)',async mode=>{
 const f=await fixture(),provider=await waitingAttachmentsProvider(true);
 try{
  const seed=await seedWaitingAttachments(f.app,f.a,provider);
  await exerciseRecursiveMaterialInput(f.app,f.user,seed,provider,mode,()=>seed.importFiles(f.app),async()=>{await fs.writeFile(seed.sources.text,'CHANGED_SOURCE_MUST_NOT_APPEAR');await fs.unlink(seed.sources.image)});
 }catch(error){await fs.mkdir('test-results',{recursive:true});await fs.writeFile('test-results/recursive-attachments-'+mode+'.json',JSON.stringify({error:String(error),main:provider.mainRequests,member:provider.memberRequests,errors:provider.errors},null,2));throw error}
 finally{await f.app.Shutdown();await provider.close();await f.cleanup()}
},120000);

it('rejects invalid attachments before inserting into a recursive pending question',async()=>{
 const f=await fixture(),provider=await waitingAttachmentsProvider(true);let app=f.app;
 try{
  const seed=await seedWaitingAttachments(app,f.a,provider);
  const started=await app.Dispatch('loop.chat',{id:seed.entry.id,message:data.mainGoal,options:seed.options});
  const questions=()=>app.Dispatch('loop.questions',{id:seed.entry.id,taskId:started.taskId});
  await attachmentWait(async()=>{if(provider.errors.length)throw Error(provider.errors.join('\n'));return (await questions()).length===1},'recursive attachment question');
  const scope=(await seed.scopes())[0],thread=await app.Execution(seed.entry.id).Thread(started.taskId),pending=await questions();
  expect(scope.status).toBe('active');expect(scope.wait).toBeUndefined();expect(scope.goal?.plan).toBeUndefined();
  const attachments=await seed.importFiles(app),ids=attachments.map(item=>item.id);
  const other=await app.Dispatch('add',{path:f.b}),foreign=await new ChatInputs(app.Workspace(other.id)).Path('file',seed.sources.text),bad=await new ChatInputs(app.Workspace(seed.entry.id)).Path('file',seed.sources.text);
  await fs.writeFile(seed.snapshotPath(bad.id),'{broken snapshot');
  const state=await app.Workspace(seed.entry.id).dispatchStore.Read(),native=await fs.readFile(thread[0].sessionFile!);
  const attempts=[
   {attachments:ids,options:{...seed.options,model:'attachment-plain'}},
   {attachments:[randomUUID()],options:seed.options},
   {attachments:[foreign.id],options:seed.options},
   {attachments:[bad.id],options:seed.options},
  ];
  for(const attempt of attempts){
   await expect(app.Dispatch('loop.enqueue',{id:seed.entry.id,taskId:started.taskId,message:data.supplement,...attempt})).rejects.toThrow();
   expect(await app.Dispatch('loop.queue',{id:seed.entry.id,taskId:started.taskId})).toEqual([]);
   expect(await seed.scopes()).toEqual([scope]);expect(await questions()).toEqual(pending);
   expect(await app.Workspace(seed.entry.id).dispatchStore.Read()).toEqual(state);
   expect(await app.Execution(seed.entry.id).Thread(started.taskId)).toEqual(thread);expect(await fs.readFile(thread[0].sessionFile!)).toEqual(native);
   expect(provider.mainRequests).toHaveLength(2);expect(provider.memberRequests).toHaveLength(5);
  }
  expect(state.graphs[0].tasks).toEqual([]);expect(state.agentBusinessRuns).toHaveLength(1);
  await app.Dispatch('loop.stop',{id:seed.entry.id,taskId:started.taskId});
  await attachmentWait(async()=>(await seed.scopes())[0].status==='closed'&&app.runtime.Snapshot().pressure.activeRuns===0,'stop after rejected materials');
  const closed=(await seed.scopes())[0],stopped=await app.Execution(seed.entry.id).Thread(started.taskId),bytes=await fs.readFile(thread[0].sessionFile!);
  expect(closed.outcome).toBe('cancelled');
  await app.Shutdown();app=seed.reopen(f.user);await app.Init();
  expect(await seed.scopes()).toEqual([closed]);expect(await app.Execution(seed.entry.id).Thread(started.taskId)).toEqual(stopped);expect(await fs.readFile(thread[0].sessionFile!)).toEqual(bytes);
  expect(provider.mainRequests).toHaveLength(2);expect(provider.memberRequests).toHaveLength(5);expect(provider.errors).toEqual([]);
 }finally{await app.Shutdown();await provider.close();await f.cleanup()}
},120000);
