import {expect,it,vi} from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {WorkspaceExecutionManager} from '../src/logic/conversation/runtime/execution-manager';
import type {ExecutionCollaboration} from '../src/logic/conversation/runtime/execution-manager';
import type {DispatchScope} from '../src/logic/tasks/rules/dispatch-scope';
import type {GoalContinuationReceipt} from '../src/logic/tasks/rules/scope-continuation';
import {LoopRuntime} from '../src/logic/execution/rules/runtime/runtime';
import {PiEngine} from '../src/logic/execution/engines/pi/engine';
import type {AgentEngine,EngineEvent,InputImage} from '../src/logic/execution/rules/types';
import type {KnowledgeWorkspace} from '../src/logic/knowledge/rules/ports';
import type {MessageQueue} from '../src/logic/conversation/runtime/message-queue';
import {FileRunStorage} from '../src/logic/execution/storage/run-storage';

const gate=()=>{let resolve!:()=>void;const promise=new Promise<void>(done=>{resolve=done});return {promise,resolve}};
const options={provider:'test',model:'original',permission:'read' as const,allowNativeExecution:false};

async function fixture(hook?:(event:EngineEvent)=>Promise<void>,extensions:Partial<ExecutionCollaboration>={}){
  const directory=await fs.mkdtemp(path.join(os.tmpdir(),'cbim-insertion-fence-'));
  const workspace={entry:{id:'workspace',path:directory},paths:{project:()=>directory},assert:()=>{}} as unknown as KnowledgeWorkspace;
  const storage=new FileRunStorage(),create=storage.createJournal.bind(storage);
  storage.createJournal=(...args)=>{const journal=create(...args),append=journal.append.bind(journal);journal.append=async event=>{const result=await append(event);await hook?.(event);return result};return journal};
  const images=vi.fn<()=>Promise<InputImage[]>>(async()=>[]),settled=vi.fn(),runs:Array<{runtime:LoopRuntime;engine:AgentEngine;steer:ReturnType<typeof vi.fn<NonNullable<AgentEngine['steer']>>>;stop:ReturnType<typeof vi.fn>;close:ReturnType<typeof vi.fn>;finish:(status:'completed'|'cancelled')=>void}>=[];
  let busy=false;
  const manager=new WorkspaceExecutionManager(workspace,storage,async(config)=>{
    let finish!:(value:{status:'completed'|'cancelled'})=>void;const completion=new Promise<{status:'completed'|'cancelled'}>(resolve=>{finish=resolve});
    const steer=vi.fn<NonNullable<AgentEngine['steer']>>(async()=>{}),stop=vi.fn(async()=>{finish({status:'cancelled'})}),close=vi.fn(async()=>{});
    const engine:AgentEngine={kind:'controlled',start:async context=>{await context.emit({type:'session.bound',data:{sessionFile:path.join(directory,'native.jsonl'),sessionId:context.nativeSessionId}})},run:()=>completion,steer,stop,close};
    const runtime=new LoopRuntime({directory:path.join(directory,'loop-engine','tasks'),storage,createEngine:()=>engine,acquireLease:async()=>()=>{},toolPolicy:async()=>({allow:false}),onEvent:config.onEvent});
    runs.push({runtime,engine,steer,stop,close,finish:status=>finish({status})});return {runtime} as never;
  },images);
  const stop=vi.fn(async()=>{busy=false}),starting=vi.fn(async()=>{});manager.attachCollaboration({busy:()=>busy,settled,stop,starting,...extensions});
  const start=await manager.chat('原任务',options);
  const item=await manager.enqueue(start.taskId,'原队列消息',{...options,permission:'execute'});
  const queue=await (manager as unknown as {queue():Promise<MessageQueue>}).queue();
  return {directory,manager,runs,start,item,queue,images,stop,settled,starting,setBusy:(value:boolean)=>{busy=value},
    insert:()=>manager.insertQueued(start.taskId,item.id,start.runId),
    async finish(index=0){const count=settled.mock.calls.length;runs[index].finish('completed');await vi.waitFor(()=>expect(settled.mock.calls.length).toBeGreaterThan(count))},
    async cleanup(){for(const run of runs)run.finish('cancelled');await manager.close();const target=path.resolve(directory);if(path.dirname(target)!==path.resolve(os.tmpdir())||!path.basename(target).startsWith('cbim-insertion-fence-'))throw Error('Unexpected cleanup');await fs.rm(target,{recursive:true,force:true})},
  };
}

it('整话题补充等待原主轮退出，安全取消可续接；并发同命令只启动一次',async()=>{
  const drained=gate(),entered=gate();let scope:DispatchScope,receipt:GoalContinuationReceipt|undefined;
  const interrupt=vi.fn<NonNullable<ExecutionCollaboration['interruptTopic']>>(async(request,stopMain)=>{
    const summary=await stopMain();expect(summary.status).toBe('cancelled');entered.resolve();await drained.promise;
    scope={...request,status:'waiting',createdAt:new Date().toISOString(),goal:{revision:1,input:{message:'原任务',attachmentIds:[]}},wait:{waitId:request.commandId,interruptionId:request.commandId,reason:'已排空',createdAt:new Date().toISOString(),runId:summary.runId,goalRevision:1,graphCursor:{streamId:'s',seq:1},knowledgeRevision:'k',mainRunIds:[summary.runId]}};
    return scope;
  });
  const f=await fixture(undefined,{busy:()=>true,interruptTopic:interrupt,continuationReceipt:async()=>receipt,continuationCheckpoint:async()=>scope.wait!,acceptContinuation:async(request,_task,runId)=>{receipt={workspaceId:request.workspaceId,rootSessionId:request.rootSessionId,scopeId:request.scopeId,scopeStatus:'active',continuation:{continuationId:request.commandId,acceptedAt:new Date().toISOString(),wait:scope.wait!,inputRevision:2,input:request.input,options:request.options,runId}}}});
  try{
    const request={workspaceId:f.start.workspaceId,rootSessionId:f.start.taskId,scopeId:'topic',expectedInputRevision:1,commandId:crypto.randomUUID(),input:{message:'明确补充'},options:{...options,profileId:crypto.randomUUID()}};
    const {allowNativeExecution:_,...selected}=request.options;const input={...request,options:selected};
    const first=f.manager.interruptTopic(input),duplicate=f.manager.interruptTopic(input);expect(duplicate).toBe(first);
    await entered.promise;expect(f.runs).toHaveLength(1);expect(f.runs[0].close).toHaveBeenCalled();
    expect(()=>f.manager.interruptTopic({...input,commandId:crypto.randomUUID()})).toThrow();
    drained.resolve();const accepted=await first;expect(accepted.continuation.input.message).toBe('明确补充');expect(f.runs).toHaveLength(2);expect(interrupt).toHaveBeenCalledTimes(1);
    const thread=await f.manager.thread(f.start.taskId);expect(thread.at(-1)?.source).toMatchObject({kind:'user-continuation',interruptionId:input.commandId,scopeId:'topic',inputRevision:2});
    expect((await f.manager.interruptTopic(input)).continuation).toEqual(accepted.continuation);expect(interrupt).toHaveBeenCalledTimes(1);expect(f.runs[1].stop).not.toHaveBeenCalled();
    expect(f.runs[0].steer).not.toHaveBeenCalled();expect((await f.manager.queued(f.start.taskId))).toHaveLength(1);
  }finally{drained.resolve();await f.cleanup()}
});

it('整话题排空期间收到用户取消，不再自动启动新主轮',async()=>{
  const entered=gate(),released=gate();
  const f=await fixture(undefined,{busy:()=>true,interruptTopic:async(_request,stopMain)=>{await stopMain();entered.resolve();await released.promise;return {} as DispatchScope}});
  try{
    const pending=f.manager.interruptTopic({workspaceId:f.start.workspaceId,rootSessionId:f.start.taskId,scopeId:'topic',expectedInputRevision:1,commandId:crypto.randomUUID(),input:{message:'补充'},options:{provider:'test',model:'test',profileId:crypto.randomUUID(),permission:'read'}});
    const result=pending.then(()=>undefined,error=>error);await entered.promise;await f.manager.stop(f.start.taskId);released.resolve();
    expect(await result).toMatchObject({code:'COLLABORATION_STOPPED'});expect(f.runs).toHaveLength(1);expect((await f.manager.queued(f.start.taskId))[0].status).toBe('paused');
  }finally{released.resolve();await f.cleanup()}
});

it('队列启动把已保存的队列身份交给话题建立，编辑消息不改变归属',async()=>{
  const f=await fixture();try{
    f.setBusy(true);await f.finish();await f.manager.editQueued(f.start.taskId,f.item.id,'更新后的新任务','原队列消息');
    f.setBusy(false);await f.manager.continueQueue(f.start.taskId);
    expect(f.starting.mock.calls).toHaveLength(2);
    expect((f.starting.mock.calls[0] as unknown[])[5]).toBeUndefined();
    expect((f.starting.mock.calls[1] as unknown[])[5]).toBe(f.item.id);
    expect((f.starting.mock.calls[1] as unknown[])[3]).toBe('更新后的新任务');
    expect(await f.manager.queued(f.start.taskId)).toEqual([]);
  }finally{await f.cleanup()}
});

it.each([undefined,'','../escape','other-run'])('缺失或不匹配的原 run %s 在领取前拒绝，不选择当前轮代收',async expected=>{
  const f=await fixture();try{
    const claim=vi.spyOn(f.queue,'claim');
    await expect(f.manager.insertQueued(f.start.taskId,f.item.id,expected as string)).rejects.toMatchObject({code:'QUEUE_INSERT_STALE'});
    expect(claim).not.toHaveBeenCalled();expect(f.images).not.toHaveBeenCalled();expect(f.runs[0].steer).not.toHaveBeenCalled();expect(f.queue.list(f.start.taskId)).toEqual([f.item]);
  }finally{await f.cleanup()}
});

it('已切换到新主轮时，旧主轮插入不能消费新轮队列',async()=>{
  const f=await fixture();try{
    f.setBusy(true);await f.finish();f.setBusy(false);
    const next=await f.manager.resume(f.start.taskId,f.start.runId,'新的明确用户轮次',options);
    expect(next.runId).not.toBe(f.start.runId);
    await expect(f.insert()).rejects.toMatchObject({code:'QUEUE_INSERT_STALE'});
    expect(f.runs[1].steer).not.toHaveBeenCalled();expect(f.queue.list(f.start.taskId)).toHaveLength(1);
  }finally{await f.cleanup()}
});

it('claim 落盘尚未返回时停止，实际引擎先收到停止且原队列暂停',async()=>{
  const f=await fixture(),entered=gate(),release=gate();try{
    const claim=f.queue.claim.bind(f.queue);vi.spyOn(f.queue,'claim').mockImplementationOnce(async(...args)=>{const value=await claim(...args);entered.resolve();await release.promise;return value});
    const inserting=expect(f.insert()).rejects.toMatchObject({code:'QUEUE_INSERT_STOPPED'});await entered.promise;
    const stopping=f.manager.stop(f.start.taskId);await vi.waitFor(()=>expect(f.runs[0].stop).toHaveBeenCalledTimes(1));
    release.resolve();await Promise.all([inserting,stopping]);expect(f.images).not.toHaveBeenCalled();expect(f.runs[0].steer).not.toHaveBeenCalled();expect(f.queue.list(f.start.taskId)).toMatchObject([{id:f.item.id,status:'paused'}]);
  }finally{release.resolve();await f.cleanup()}
});

it.each(['stop','close','pause','owner-close'] as const)('附件读取期间的 %s 阻止迟到插入，保留原消息',async action=>{
  const f=await fixture(),entered=gate(),release=gate();try{
    f.images.mockImplementationOnce(async()=>{entered.resolve();await release.promise;return []});
    const inserting=expect(f.insert()).rejects.toMatchObject({code:'QUEUE_INSERT_STOPPED'});await entered.promise;
    const ending=action==='stop'?f.manager.stop(f.start.taskId):action==='close'?f.manager.close():action==='pause'?f.manager.pauseCollaboration(f.start.taskId,'可信等待/异常屏障'):Promise.resolve(f.manager.cancelPendingLaunches());
    if(action==='stop'||action==='close')await vi.waitFor(()=>expect(f.runs[0].stop).toHaveBeenCalledTimes(1));
    release.resolve();await Promise.all([inserting,ending]);expect(f.runs[0].steer).not.toHaveBeenCalled();expect(f.queue.list(f.start.taskId)).toMatchObject([{id:f.item.id,status:'paused'}]);
  }finally{release.resolve();await f.cleanup()}
});

it('requested 事件落盘等待期间停止，Runtime 在进入适配器前复核并把拒绝写在终态前',async()=>{
  const entered=gate(),release=gate(),f=await fixture(async event=>{if(event.data.metric==='insertion'&&event.data.state==='requested'){entered.resolve();await release.promise}});
  try{
    const inserting=expect(f.insert()).rejects.toMatchObject({code:'QUEUE_INSERT_STOPPED'});await entered.promise;const stopping=f.manager.stop(f.start.taskId);
    release.resolve();await Promise.all([inserting,stopping]);await vi.waitFor(()=>expect(f.runs[0].close).toHaveBeenCalled());
    const log=await f.manager.inspect(f.start.taskId,f.start.runId);expect(f.runs[0].steer).not.toHaveBeenCalled();
    expect(log.events.findIndex(event=>event.data.metric==='insertion'&&event.data.state==='failed')).toBeLessThan(log.events.findIndex(event=>event.type==='run.settled'));
  }finally{release.resolve();await f.cleanup()}
});

it('已进入原生发送后停止，迟到 queued 确认仍消费一次并在终态前保存接受事实',async()=>{
  const f=await fixture(),entered=gate(),release=gate();try{
    f.runs[0].steer.mockImplementationOnce(async(_message,_images,signal)=>{entered.resolve();await release.promise;expect(signal.aborted).toBe(true)});
    const inserting=f.insert();await entered.promise;const stopping=f.manager.stop(f.start.taskId);await vi.waitFor(()=>expect(f.runs[0].stop).toHaveBeenCalled());
    release.resolve();await Promise.all([inserting,stopping]);expect(f.queue.list(f.start.taskId)).toEqual([]);expect(f.runs[0].steer).toHaveBeenCalledTimes(1);
    await vi.waitFor(async()=>expect((await f.manager.inspect(f.start.taskId,f.start.runId)).status).toBe('cancelled'));
    const log=await f.manager.inspect(f.start.taskId,f.start.runId);expect(log.events.findIndex(event=>event.data.metric==='insertion'&&event.data.state==='accepted')).toBeLessThan(log.events.findIndex(event=>event.type==='run.settled'));
  }finally{release.resolve();await f.cleanup()}
});

it.each(['prepare','unknown','complete-failed','pause-failed'] as const)('插入 %s 后旧队列不自动重放，真实成员结果回注仍可进入新主轮',async mode=>{
  const f=await fixture();try{
    f.setBusy(true);
    if(mode==='prepare')f.images.mockRejectedValueOnce(Error('snapshot unavailable'));
    else if(mode==='complete-failed')vi.spyOn(f.queue,'complete').mockRejectedValueOnce(Error('disk unavailable'));
    else f.runs[0].steer.mockRejectedValueOnce(Error('lost native reply'));
    if(mode==='pause-failed')vi.spyOn(f.queue,'pause').mockRejectedValueOnce(Error('disk unavailable'));
    const result=f.insert();if(mode==='prepare')await expect(result).rejects.toThrow('snapshot unavailable');else await expect(result).rejects.toMatchObject({code:'QUEUE_INSERT_UNKNOWN'});
    await f.finish();
    const source={kind:'member-results' as const,continuationId:'results-once',messageIds:['message-one'],taskIds:['member-one']};
    const receipt=await f.manager.continueFromResults(f.start.taskId,'真实成员结果',options,source);expect(receipt.runId).not.toBe(f.start.runId);expect(f.runs).toHaveLength(2);
    expect((await f.manager.inspect(f.start.taskId,receipt.runId)).source).toEqual(source);f.setBusy(false);await f.finish(1);await f.manager.collaborationReady(f.start.taskId);
    expect(f.runs).toHaveLength(2);expect(f.queue.list(f.start.taskId)).toHaveLength(1);expect(f.runs[0].steer).toHaveBeenCalledTimes(mode==='prepare'?0:1);
  }finally{await f.cleanup()}
});

it('关闭逐项清理其它活动运行，并显式报告实际关闭失败',async()=>{
  const f=await fixture();try{
    await f.manager.chat('另一个主会话',options);f.runs[0].close.mockRejectedValueOnce(Error('actual close failure'));
    // Runtime 会把引擎关闭失败记录为 interrupted，管理器 close 的错误仍须传播而非 allSettled 吞掉。
    const original=f.runs[0].runtime.close.bind(f.runs[0].runtime);vi.spyOn(f.runs[0].runtime,'close').mockImplementationOnce(async()=>{await original();throw Error('runtime close failure')});
    await expect(f.manager.close()).rejects.toThrow('runtime close failure');expect(f.runs[1].stop).toHaveBeenCalled();expect(f.runs[1].close).toHaveBeenCalled();
  }finally{await f.cleanup()}
});

it('旧停止的协作收尾迟到时不再扫描停止后来明确启动的新主轮',async()=>{
  const f=await fixture(),entered=gate(),release=gate();try{
    f.setBusy(true);f.stop.mockImplementationOnce(async()=>{f.setBusy(false);entered.resolve();await release.promise});
    const stopping=f.manager.stop(f.start.taskId);await entered.promise;await vi.waitFor(()=>expect(f.settled).toHaveBeenCalledTimes(1));
    const next=await f.manager.resume(f.start.taskId,f.start.runId,'停止之后明确创建的新轮',options);
    expect(next.runId).not.toBe(f.start.runId);release.resolve();await stopping;
    expect(f.runs[1].stop).not.toHaveBeenCalled();expect((await f.manager.inspect(f.start.taskId,next.runId)).status).toBe('running');
    expect(f.queue.list(f.start.taskId)).toMatchObject([{id:f.item.id,message:'原队列消息',status:'paused'}]);
  }finally{release.resolve();await f.cleanup()}
});

function piFixture(request:(type:string)=>Promise<unknown>){
  const engine=new PiEngine({} as never),rpc={request:vi.fn(request)};
  Object.assign(engine,{rpc,settlement:{resolve:()=>{},reject:()=>{}}});return {engine,rpc};
}

it.each(['signal','engine-stop'] as const)('Pi get_state 等待后的 %s 在真正 steer 发送前拒绝',async action=>{
  const entered=gate(),release=gate(),controller=new AbortController();
  const {engine,rpc}=piFixture(async type=>{if(type==='get_state'){entered.resolve();await release.promise;return {isStreaming:true}}return {}});
  const insertion=expect(engine.steer('原输入',[],controller.signal)).rejects.toMatchObject({code:'QUEUE_INSERT_STOPPED'});await entered.promise;
  if(action==='signal')controller.abort();else await engine.stop();release.resolve();await insertion;expect(rpc.request.mock.calls.some(([type])=>type==='steer')).toBe(false);
});

it.each(['queued','lost-reply'] as const)('Pi 发出 steer 后的 %s 不按迟到 abort 伪造未受理',async outcome=>{
  const entered=gate(),release=gate(),controller=new AbortController();
  const {engine,rpc}=piFixture(async type=>{if(type==='get_state')return {isStreaming:true};entered.resolve();await release.promise;if(outcome==='lost-reply')throw Object.assign(Error('private raw reply'),{code:'QUEUE_INSERT_STOPPED'});return {disposition:'queued'}});
  const insertion=engine.steer('原输入',[],controller.signal),assertion=outcome==='queued'?expect(insertion).resolves.toBeUndefined():expect(insertion).rejects.toMatchObject({code:'QUEUE_INSERT_UNKNOWN'});
  await entered.promise;controller.abort();release.resolve();await assertion;expect(rpc.request.mock.calls.filter(([type])=>type==='steer')).toHaveLength(1);
});

it('历史后续先核对来源再入队，启动沿队列固定身份传递来源，不改原正文',async()=>{
 const validate=vi.fn(async(_root:string,scope:string)=>{if(scope!=='closed-topic')throw Error('无效来源')});
 const f=await fixture(undefined,{validateFollowup:validate});try{
  await expect(f.manager.enqueue(f.start.taskId,'不允许',options,'foreign-topic')).rejects.toThrow('无效来源');
  const item=await f.manager.enqueue(f.start.taskId,'新要求',options,'closed-topic');expect(validate).toHaveBeenLastCalledWith(f.start.taskId,'closed-topic');
  expect((await f.manager.queued(f.start.taskId)).find(value=>value.id===item.id)?.followupOf).toBe('closed-topic');
  await expect(f.manager.insertQueued(f.start.taskId,item.id,f.start.runId)).rejects.toMatchObject({code:'TOPIC_FOLLOWUP_SEPARATE'});
  await f.manager.changeQueued(f.start.taskId,f.item.id,'remove');await f.finish();
  await vi.waitFor(()=>expect(f.starting).toHaveBeenCalledTimes(2));expect(f.starting.mock.calls[1]).toMatchObject({3:'新要求',5:item.id,6:'closed-topic'});
 }finally{await f.cleanup()}
});
