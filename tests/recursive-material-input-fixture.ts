import {expect,vi} from 'vitest';
import fs from 'node:fs/promises';
import type {Application} from '../src/bridge/server/application';
import {attachmentHash,attachmentWait,seedWaitingAttachments} from './waiting-attachments-fixture';
import {waitingAttachmentsProvider,attachmentFixture as data,requestImages} from './waiting-attachments-provider';
import {PiRpc} from '../src/logic/execution/engines/pi/rpc';
import type {ChatAttachment} from '../src/logic/materials/contracts';

/** Runs actual queue/native ACK, material snapshots and Agent tools; only responses and the chosen fault window are controlled. */
export async function exerciseRecursiveMaterialInput(app:Application,user:string,seed:Awaited<ReturnType<typeof seedWaitingAttachments>>,provider:Awaited<ReturnType<typeof waitingAttachmentsProvider>>,mode:'snapshot'|'response-lost'|'budget-stop',prepare:()=>Promise<ChatAttachment[]>,changeSources:()=>Promise<void>){
 let release=()=>{},restore=()=>{};
 try{
  if(mode==='budget-stop'){const policy=await app.dispatch('budget.settings');await app.dispatch('budget.configure',{revision:policy.revision,enabled:true,enforcement:'request',limits:{tokens:1000000}})}
  const start=await app.dispatch('loop.chat',{id:seed.entry.id,message:data.mainGoal,options:seed.options});
  const questions=()=>app.dispatch('loop.questions',{id:seed.entry.id,taskId:start.taskId});
  await attachmentWait(async()=>{if(provider.errors.length)throw Error(provider.errors.join('\n'));return (await questions()).length===1},'pending recursive material question');
  const original=(await seed.scopes())[0],question=(await questions())[0],thread=await app.execution(seed.entry.id).thread(start.taskId);
  expect(thread).toHaveLength(1);expect(original.wait).toBeUndefined();expect(original.goal?.plan).toBeUndefined();
  const items=await prepare(),ids=items.map(item=>item.id),snapshots=await Promise.all(ids.map(id=>fs.readFile(seed.snapshotPath(id))));
  await changeSources();
  const queue=await app.dispatch('loop.enqueue',{id:seed.entry.id,taskId:start.taskId,message:data.supplement,attachments:ids,options:seed.options});
  const manifest=queue.attachmentManifest!;expect(manifest).toBeDefined();
  expect(manifest.items.map(item=>item.snapshotHash)).toEqual(snapshots.map(attachmentHash));
  expect(manifest.items.map(item=>item.attachmentId)).toEqual(ids);
  for(const [index,item] of manifest.items.entries()){
   const saved=JSON.parse(snapshots[index].toString('utf8'));
   expect(item.contentHash).toBe(attachmentHash(item.contentKind==='image'?seed.png:String(saved.text)));
   if(item.kind!=='file')expect(item.proof).toEqual(saved.proof);
  }
  expect(manifest.expandedMessageHash).toBe(attachmentHash(queue.message));expect(manifest.expandedMessageBytes).toBe(Buffer.byteLength(queue.message));
  expect(queue.message).not.toContain(seed.png.toString('base64'));
  const request={id:seed.entry.id,taskId:start.taskId,queueId:queue.id,expectedRunId:start.runId};
  const identity={workspaceId:seed.entry.id,rootSessionId:start.taskId};
  const receipt=()=>app.memberDispatch(seed.entry.id).activeInputs.inspect(identity,start.runId,queue.id);
  if(mode==='budget-stop'){
   expect(original.budget?.policy.enabled).toBe(true);
   let entered=false,steers=0;const gate=new Promise<void>(resolve=>release=resolve),originalRequest=PiRpc.prototype.request;
   const spy=vi.spyOn(PiRpc.prototype,'request').mockImplementation(async function(this:PiRpc,type,payload,timeout){
    const result=await originalRequest.call(this,type,payload,timeout);
    if(type==='get_state'&&!entered){entered=true;await gate}if(type==='steer')steers++;return result;
   });restore=()=>spy.mockRestore();
   const pending=app.dispatch('loop.queueInsert',request),settled=Promise.allSettled([pending]);
   await attachmentWait(async()=>entered,'budget enabled native pre-send window');
   const stopping=app.dispatch('loop.stop',{id:seed.entry.id,taskId:start.taskId});release();
   expect((await settled)[0].status).toBe('rejected');await stopping;
   expect(steers).toBe(0);expect((await receipt())?.status).toBe('rejected');
   expect((await seed.scopes())[0].goal).toEqual(original.goal);
  }else{
   if(mode==='response-lost')await expect((async()=>{await app.dispatch('loop.queueInsert',request);throw Error('TEST_RESPONSE_LOST_AFTER_REAL_ACCEPT')})()).rejects.toThrow('TEST_RESPONSE_LOST_AFTER_REAL_ACCEPT');
   else await Promise.all([app.dispatch('loop.queueInsert',request),app.dispatch('loop.queueInsert',request)]);
   const accepted=await receipt();expect(accepted).toMatchObject({status:'accepted',runId:start.runId,attachmentManifest:manifest,input:{message:queue.message,attachmentIds:ids,attachmentManifest:manifest}});
   await fs.unlink(seed.snapshotPath(ids.at(-1)!));await app.dispatch('loop.queueInsert',request);expect(await receipt()).toEqual(accepted);
   await app.dispatch('loop.answerQuestion',{id:seed.entry.id,taskId:start.taskId,questionId:question.id,answers:[{option:0,other:''}]});
  }
  restore();restore=()=>{};
  await attachmentWait(async()=>{if(provider.errors.length)throw Error(provider.errors.join('\n'));return (await seed.scopes())[0].status==='closed'&&app.runtime.snapshot().pressure.activeRuns===0},'recursive material completion');
  const closed=(await seed.scopes())[0],finalThread=await app.execution(seed.entry.id).thread(start.taskId),savedReceipt=await receipt();
  expect(closed.outcome).toBe(mode==='budget-stop'?'cancelled':'completed');expect(finalThread).toHaveLength(1);expect(finalThread[0].runId).toBe(start.runId);
  expect(provider.mainRequests).toHaveLength(mode==='budget-stop'?2:4);expect(provider.memberRequests).toHaveLength(mode==='budget-stop'?5:10);
  const state=await app.workspace(seed.entry.id).dispatchStore.read();expect(state.graphs[0].tasks).toEqual([]);expect(state.agentBusinessRuns).toHaveLength(mode==='budget-stop'?1:2);
  const native=await fs.readFile(finalThread[0].sessionFile!),records=native.toString('utf8').trim().split('\n').map(line=>JSON.parse(line));
  const imageUsers=records.filter(item=>item.type==='message'&&item.message?.role==='user'&&Array.isArray(item.message.content)&&item.message.content.some((part:{type:string})=>part.type==='image'));
  expect(imageUsers).toHaveLength(mode==='budget-stop'?0:1);
  if(mode!=='budget-stop')for(const body of provider.mainRequests.slice(2))expect(requestImages(body)).toHaveLength(1);
  const counts=[provider.mainRequests.length,provider.memberRequests.length];
  await app.shutdown();app=seed.reopen(user);await app.init();
  expect(await seed.scopes()).toEqual([closed]);expect(await app.execution(seed.entry.id).thread(start.taskId)).toEqual(finalThread);expect(await fs.readFile(finalThread[0].sessionFile!)).toEqual(native);
  expect(await app.memberDispatch(seed.entry.id).activeInputs.inspect(identity,start.runId,queue.id)).toEqual(savedReceipt);
  if(mode!=='budget-stop')await app.dispatch('loop.queueInsert',request);
  expect([provider.mainRequests.length,provider.memberRequests.length]).toEqual(counts);expect(provider.errors).toEqual([]);
  return {manifest,message:queue.message};
 }finally{release();restore();await app.shutdown()}
}
