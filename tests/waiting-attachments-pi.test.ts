import {required} from './support/assertions';
import {expect,it,vi} from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {fixture} from './helpers';
import {attachmentFixture as data,waitingAttachmentsProvider,requestImages} from './waiting-attachments-provider';
import {attachmentHash,attachmentWait,seedWaitingAttachments} from './waiting-attachments-fixture';
import {ChatInputs} from '../src/backend/main/materials/chat-inputs';
import {hash,json} from '../src/backend/core/foundation/serialization';
import type {GraphSnapshot} from '../src/backend/core/tasks/graph-types';
import type {GoalContinuationReceipt} from '../src/backend/core/tasks/scope-continuation';

for(const mode of ['snapshot','preaccept','response-lost','budget-stop'] as const)it('keeps explicit waiting attachments bound to one accepted native user message with real Pi ('+mode+')',async()=>{
  const f=await fixture(),provider=await waitingAttachmentsProvider();let app=f.app,releaseBudget=()=>{};
  try{
    const seed=await seedWaitingAttachments(app,f.a,provider);
    if(mode==='budget-stop'){const policy=await app.dispatch('budget.settings');await app.dispatch('budget.configure',{revision:policy.revision,enabled:true,limits:{tokens:1000000}})}
    const started=await app.dispatch('loop.chat',{id:seed.entry.id,message:data.mainGoal,options:seed.options}) as {taskId:string;runId:string};
    const identity={workspaceId:seed.entry.id,rootSessionId:started.taskId},graph=()=>app.dispatch('dispatch.graphSnapshot',{identity}) as Promise<GraphSnapshot>;
    await attachmentWait(async()=>(await seed.scopes())[0].status==='waiting'&&app.runtime.snapshot().pressure.activeRuns===0,'真实安全等待');
    const original=(await seed.scopes())[0],originalGraph=await graph(),originalThread=await app.execution(seed.entry.id).thread(started.taskId);
    expect(provider.mainRequests).toHaveLength(6);expect(provider.memberRequests).toHaveLength(5);expect(originalThread).toHaveLength(2);
    const attachments=await seed.importFiles(app),ids=attachments.map(item=>item.id),snapshotBytes=await Promise.all(ids.map(id=>fs.readFile(seed.snapshotPath(id)))),request=seed.continuation(original,ids),lookup={...identity,scopeId:original.scopeId,commandId:request.commandId};
    await fs.writeFile(seed.sources.text,'原文已经改变，不应进入已登记快照');await fs.unlink(seed.sources.image);
    if(mode==='preaccept'){
      const other=await app.dispatch('add',{path:f.b}),foreign=await new ChatInputs(app.workspace(other.id)).path('file',seed.sources.text),bad=await new ChatInputs(app.workspace(seed.entry.id)).path('file',seed.sources.text);
      await fs.writeFile(seed.snapshotPath(bad.id),'{broken snapshot');
      const attempts=[
        {...request,commandId:randomUUID(),options:{...request.options,model:'attachment-plain'}},
        {...request,commandId:randomUUID(),input:{...request.input,attachmentIds:[randomUUID()]}},
        {...request,commandId:randomUUID(),input:{...request.input,attachmentIds:[foreign.id]}},
        {...request,commandId:randomUUID(),input:{...request.input,attachmentIds:[bad.id]}},
      ];
      for(const attempt of attempts){
        await expect(app.dispatch('loop.goalContinue',attempt)).rejects.toMatchObject({code:expect.stringMatching(/^GOAL_ATTACHMENT_/)});
        expect(await app.dispatch('loop.goalContinuation',{...lookup,commandId:attempt.commandId})).toBeUndefined();expect(await seed.scopes()).toEqual([original]);expect(await graph()).toEqual(originalGraph);expect(await app.execution(seed.entry.id).thread(started.taskId)).toEqual(originalThread);
        expect(provider.mainRequests).toHaveLength(6);expect(provider.memberRequests).toHaveLength(5);expect(app.runtime.snapshot().pressure.activeRuns).toBe(0);
      }
      await app.shutdown();app=seed.reopen(f.user);await app.init();expect(await seed.scopes()).toEqual([original]);expect(provider.mainRequests).toHaveLength(6);
      await app.dispatch('loop.stop',{id:seed.entry.id,taskId:started.taskId});return;
    }
    if(mode==='budget-stop'){
      const budgets=app.memberDispatch(seed.entry.id).budgets,admit=budgets.admit.bind(budgets);let entered=false;
      const gate=new Promise<void>(resolve=>{releaseBudget=resolve});
      expect(original.budget?.policy.enabled).toBe(true);
      const spy=vi.spyOn(budgets,'admit').mockImplementation(async(...args)=>{const result=await admit(...args);expect(result.rejected).toBeUndefined();expect(result.scope.budget?.lastAdmission?.observation.tokensComplete).toBe(true);entered=true;await gate;return result});
      const pending=app.dispatch('loop.goalContinue',request),settled=Promise.allSettled([pending]);
      await attachmentWait(async()=>entered,'可信预算 await 窗口');
      const stopping=app.dispatch('loop.stop',{id:seed.entry.id,taskId:started.taskId});releaseBudget();
      const result=(await settled)[0];await stopping;spy.mockRestore();expect(result.status).toBe('rejected');
      expect(await app.dispatch('loop.goalContinuation',lookup)).toBeUndefined();const closed=(await seed.scopes())[0];expect(closed).toMatchObject({status:'closed',outcome:'cancelled'});expect(closed.goal).toEqual(original.goal);expect(closed.wait).toEqual(original.wait);expect(closed.continuations).toEqual(original.continuations);expect(closed.runTracking).toEqual(original.runTracking);
      expect(provider.mainRequests).toHaveLength(6);expect(provider.memberRequests).toHaveLength(5);expect(await app.execution(seed.entry.id).thread(started.taskId)).toEqual(originalThread);expect(app.runtime.snapshot().pressure.activeRuns).toBe(0);
      await app.shutdown();app=seed.reopen(f.user);await app.init();expect(await seed.scopes()).toEqual([closed]);expect(provider.mainRequests).toHaveLength(6);return;
    }
    let receipt:GoalContinuationReceipt;
    if(mode==='response-lost'){
      // 只在真实服务完成后丢弃回包；不伪造受理、receipt 或历史。原请求查询是唯一恢复来源。
      await expect((async()=>{await app.dispatch('loop.goalContinue',request);throw Error('TEST_RESPONSE_LOST_AFTER_REAL_ACCEPT')})()).rejects.toThrow('TEST_RESPONSE_LOST_AFTER_REAL_ACCEPT');
      receipt=required(await app.dispatch('loop.goalContinuation',lookup));
    }else{
      const results=await Promise.all([app.dispatch('loop.goalContinue',request),app.dispatch('loop.goalContinue',request)]) as GoalContinuationReceipt[];
      receipt=results[0];expect(results[1].continuation).toEqual(receipt.continuation);
    }
    await attachmentWait(async()=>provider.mainRequests.length===7,'补充真实进入 Pi');
    expect(receipt).toMatchObject({...identity,scopeId:original.scopeId,continuation:{input:request.input,inputRevision:2,wait:original.wait}});
    const manifest=receipt.continuation.attachmentManifest!;expect(manifest.items.map(item=>item.attachmentId)).toEqual(ids);expect(manifest.items.map(item=>item.snapshotHash)).toEqual(snapshotBytes.map(attachmentHash));
    expect(manifest.items[0]).toMatchObject({kind:'file',contentKind:'text',contentHash:attachmentHash(data.text),byteLength:Buffer.byteLength(data.text)});
    expect(manifest.items[1]).toMatchObject({kind:'file',contentKind:'image',mimeType:'image/png',contentHash:attachmentHash(seed.png),byteLength:seed.png.length});
    expect(requestImages(provider.mainRequests[6])[0].image_url.url).toBe('data:image/png;base64,'+seed.png.toString('base64'));
    const accepted=(await seed.scopes())[0];expect(accepted.goal?.input).toEqual(original.goal?.input);expect(accepted.goal?.inputRevision).toBe(2);expect((await graph()).root.agent).toEqual(originalGraph.root.agent);
    // 已受理后失去快照不妨碍查原回执；也不得重读后再发送第二轮。
    await fs.unlink(seed.snapshotPath(ids[1]));expect((await app.dispatch('loop.goalContinue',request)).continuation).toEqual(receipt.continuation);
    await expect(app.dispatch('loop.goalContinue',{...request,input:{...request.input,attachmentIds:[ids[0]]}})).rejects.toThrow();expect(provider.mainRequests).toHaveLength(7);
    provider.release();await attachmentWait(async()=>(await seed.scopes())[0].status==='closed'&&app.runtime.snapshot().pressure.activeRuns===0,'补充后新成员与回注完成');
    const completed=(await seed.scopes())[0],thread=await app.execution(seed.entry.id).thread(started.taskId),finalGraph=await graph();
    expect(completed).toMatchObject({outcome:'completed'});expect(provider.mainRequests).toHaveLength(13);expect(provider.memberRequests).toHaveLength(10);expect(thread).toHaveLength(4);
    expect(thread[2].source).toMatchObject({kind:'user-continuation',continuationId:request.commandId,attachmentManifestHash:hash(json(manifest))});expect(thread[3].source?.kind).toBe('member-results');
    expect(new Set(thread.map(run=>run.sessionFile)).size).toBe(1);expect(new Set(thread.map(run=>run.conversationBinding?.agentInstanceId)).size).toBe(1);expect(thread[2].runId).toBe(receipt.continuation.runId);expect(thread[2].runId).not.toBe(original.wait!.runId);
    const message=String(thread[2].events[0].data.message);expect(manifest.expandedMessageHash).toBe(attachmentHash(message));expect(manifest.expandedMessageBytes).toBe(Buffer.byteLength(message));expect(message).toContain(data.text);expect(message).not.toContain(seed.png.toString('base64'));
    const native=await fs.readFile(thread[2].sessionFile!,'utf8'),nativeRecords=native.trim().split('\n').map(line=>JSON.parse(line));
    const imageUsers=nativeRecords.filter(record=>record.type==='message'&&record.message?.role==='user'&&Array.isArray(record.message.content)&&record.message.content.some((part:{type:string})=>part.type==='image'));
    expect(imageUsers).toHaveLength(1);expect(imageUsers[0].message.content.filter((part:{type:string})=>part.type==='image')).toHaveLength(1);expect(JSON.stringify(imageUsers[0])).toContain(data.supplement);
    for(const body of provider.mainRequests.slice(6))expect(requestImages(body)).toHaveLength(1);
    expect(finalGraph.tasks).toHaveLength(2);expect(finalGraph.tasks[0].assignee.agentInstanceId).not.toBe(finalGraph.tasks[1].assignee.agentInstanceId);expect(finalGraph.tasks.every(task=>task.status==='result_ready')).toBe(true);
    const before=JSON.stringify(thread),nativeHash=attachmentHash(native);await app.shutdown();app=seed.reopen(f.user);await app.init();
    expect(await seed.scopes()).toEqual([completed]);expect(await graph()).toEqual(finalGraph);expect(JSON.stringify(await app.execution(seed.entry.id).thread(started.taskId))).toBe(before);expect(attachmentHash(await fs.readFile(thread[2].sessionFile!))).toBe(nativeHash);
    expect(required((await app.dispatch('loop.goalContinuation',lookup))).continuation).toEqual(receipt.continuation);expect((await app.dispatch('loop.goalContinue',request)).continuation).toEqual(receipt.continuation);expect(provider.mainRequests).toHaveLength(13);expect(provider.memberRequests).toHaveLength(10);expect(provider.errors).toEqual([]);
  }catch(error){await fs.mkdir('test-results',{recursive:true});await fs.writeFile(`test-results/waiting-attachments-${mode}-pi-failure.json`,JSON.stringify({error:String(error),mainRequests:provider.mainRequests,memberRequests:provider.memberRequests,transportErrors:provider.errors},null,2));throw error}
  finally{releaseBudget();provider.release();await app.shutdown();await provider.close();await f.cleanup()}
},120000);
