import {expect,test,vi} from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {WorkspaceExecutionManager} from '../src/backend/scheduler-engine/execution/execution-manager';
import type {ExecutionCollaboration} from '../src/backend/scheduler-engine/execution/execution-manager';
import {LoopRuntime} from '../src/backend/core/brain/runtime';
import type {AgentEngine,EngineContext,RunInputSource,TaskSpec} from '../src/backend/core/brain/types';
import type {KnowledgeWorkspace} from '../src/backend/core/knowledge/ports';
import {FileRunStorage} from '../src/backend/main/persistence/tasks/run-storage';

const options={provider:'test',model:'model-one',permission:'ask' as const,allowNativeExecution:true};
const source=(continuationId='continuation-one',messageIds=['result-one'],taskIds=['member-task-one']):RunInputSource=>({kind:'member-results',continuationId,messageIds,taskIds});

async function fixture(){
  const directory=await fs.mkdtemp(path.join(os.tmpdir(),'cbim-conversation-collaboration-'));
  const workspace={entry:{id:'workspace-one',path:directory},paths:{project:()=>directory},assert:()=>{}} as unknown as KnowledgeWorkspace;
  const storage=new FileRunStorage();
  let leased=false,busy=false,waiting=false;
  const runs:Array<{task:TaskSpec;message?:string;context?:EngineContext;finish:(status:'completed'|'failed'|'cancelled')=>void;closed:boolean}>=[];
  const factory=vi.fn(async(config:any,task:TaskSpec)=>{
    let resolve!:(value:{status:'completed'|'failed'|'cancelled'})=>void;
    const completion=new Promise<{status:'completed'|'failed'|'cancelled'}>(accept=>{resolve=accept});
    const record={task,finish:(status:'completed'|'failed'|'cancelled')=>resolve({status}),closed:false} as typeof runs[number];
    runs.push(record);
    const engine:AgentEngine={
      kind:'controlled',
      async start(context){record.context=context;await context.emit({type:'session.bound',data:{sessionFile:path.join(directory,'native-session.jsonl')}})},
      async run(message){record.message=message;return completion},
      async stop(){resolve({status:'cancelled'})},
      async close(){record.closed=true},
    };
    const runtime=new LoopRuntime({storage,directory:path.join(directory,'loop-engine','tasks'),
      acquireLease:async()=>{if(leased)throw Error('lease overlaps');leased=true;return ()=>{leased=false}},
      createEngine:()=>engine,toolPolicy:async()=>({allow:false}),onEvent:config.onEvent,
    });
    return {runtime} as any;
  });
  let manager=new WorkspaceExecutionManager(workspace,storage,factory);
  const settled=vi.fn<ExecutionCollaboration['settled']>(()=>{expect(leased).toBe(false);expect(runs.at(-1)?.closed).toBe(true)});
  const stop=vi.fn<ExecutionCollaboration['stop']>(async()=>{busy=false});
  const starting=vi.fn<NonNullable<ExecutionCollaboration['starting']>>(async()=>{}),startFailed=vi.fn<NonNullable<ExecutionCollaboration['startFailed']>>(async()=>{});
  const attach=()=>manager.attachCollaboration({busy:()=>busy||waiting,waiting:()=>waiting,starting,startFailed,settled,stop});attach();
  return {
    workspace,storage,factory,runs,settled,stop,starting,startFailed,
    get manager(){return manager},setBusy:(value:boolean)=>{busy=value},setWaiting:(value:boolean)=>{waiting=value},
    async finish(index=0,status:'completed'|'failed'|'cancelled'='completed'){
      const count=settled.mock.calls.length;runs[index].finish(status);await vi.waitFor(()=>expect(settled.mock.calls.length).toBeGreaterThan(count));
    },
    async reopen(){await manager.close();manager=new WorkspaceExecutionManager(workspace,storage,factory);attach()},
    async cleanup(){await manager.close();await fs.rm(directory,{recursive:true,force:true})},
  };
}

test('初始输入与显式续聊传入本轮原文，原会话 TaskSpec 保持稳定',async()=>{
  const f=await fixture();try{
    const first='  第一项任务\n保留上下文原文  ',second='\n第二项任务，与首项不同\n';
    const chat=await f.manager.chat(first,options);
    expect(f.starting).toHaveBeenLastCalledWith(expect.objectContaining({taskId:chat.taskId,goal:first.trim()}),expect.anything(),undefined,first);
    await f.finish();
    await f.manager.resume(chat.taskId,chat.runId,second,options);
    expect(f.starting).toHaveBeenLastCalledWith(expect.objectContaining({taskId:chat.taskId,goal:first.trim()}),expect.anything(),undefined,second);
  }finally{await f.cleanup()}
});

test('持久等待期间普通同意消息只排队，继续队列不能解除等待或启动模型',async()=>{
  const f=await fixture();try{
    const chat=await f.manager.chat('需要用户补充的目标',options);f.setWaiting(true);await f.finish();
    await f.manager.enqueue(chat.taskId,'同意',options);
    const result=await f.manager.resume(chat.taskId,chat.runId,'补充但来自普通输入',options);
    expect(result).toMatchObject({queued:true});
    await expect(f.manager.continueQueue(chat.taskId)).rejects.toMatchObject({code:'GOAL_WAITING'});
    expect(f.runs).toHaveLength(1);
    const pending=await f.manager.queued(chat.taskId);expect(pending).toHaveLength(2);expect(pending.every(item=>item.status==='paused')).toBe(true);
    await f.manager.collaborationReady(chat.taskId);expect(f.runs).toHaveLength(1);
    await f.reopen();await expect(f.manager.continueQueue(chat.taskId)).rejects.toMatchObject({code:'GOAL_WAITING'});expect(f.runs).toHaveLength(1);
  }finally{await f.cleanup()}
});

test('collaboration notification follows lease release and keeps user queue paused until the batch is ready',async()=>{
  const f=await fixture();try{
    const chat=await f.manager.chat('coordinate work',options);
    expect(f.starting).toHaveBeenLastCalledWith(expect.objectContaining({taskId:chat.taskId}),expect.anything(),undefined,'coordinate work');
    expect(f.factory.mock.calls[0][1]).toMatchObject({taskId:chat.taskId,mode:'chat'});
    await f.manager.enqueue(chat.taskId,'user followup',{...options,model:'model-two'});
    f.setBusy(true);await f.finish();
    expect(f.settled).toHaveBeenCalledWith(expect.objectContaining({taskId:chat.taskId}),expect.objectContaining({model:'model-one'}),expect.objectContaining({status:'completed'}));
    expect(f.runs).toHaveLength(1);expect(await f.manager.queued(chat.taskId)).toHaveLength(1);
    f.setBusy(false);await f.manager.collaborationReady(chat.taskId);
    expect(f.runs).toHaveLength(2);await vi.waitFor(()=>expect(f.runs[1].message).toBe('user followup'));
    expect(f.starting).toHaveBeenLastCalledWith(expect.objectContaining({goal:'coordinate work'}),expect.anything(),undefined,'user followup');
    expect(f.factory.mock.calls[1][0].model).toBe('model-two');expect(await f.manager.queued(chat.taskId)).toEqual([]);
  }finally{await f.cleanup()}
});

test('result continuation has durable source and duplicate receipts never start another run, including after reopening',async()=>{
  const f=await fixture();try{
    const chat=await f.manager.chat('coordinate work',options);await f.finish();f.setBusy(true);
    const receipt=await f.manager.continueFromResults(chat.taskId,'member candidate is ready',options,source());
    expect(f.starting).toHaveBeenLastCalledWith(expect.objectContaining({goal:'coordinate work'}),expect.anything(),source(),'member candidate is ready');
    const summary=await f.manager.inspect(chat.taskId,receipt.runId);
    expect(summary.source).toEqual(source());expect(summary.events[0].data.source).toEqual(source());
    expect(await f.manager.continueFromResults(chat.taskId,'member candidate is ready',options,source())).toEqual(receipt);
    expect(f.runs).toHaveLength(2);
    await expect(f.manager.continueFromResults(chat.taskId,'changed candidate',options,source())).rejects.toMatchObject({code:'CONTINUATION_CONFLICT'});
    await expect(f.manager.continueFromResults(chat.taskId,'different input',options,source('continuation-one',['result-one'],['another-task']))).rejects.toMatchObject({code:'CONTINUATION_CONFLICT'});
    await expect(f.manager.continueFromResults(chat.taskId,'partial replay',options,source('continuation-two',['result-one','result-two']))).rejects.toMatchObject({code:'RESULT_ALREADY_CONSUMED'});
    await f.finish(1);await f.reopen();
    expect(await f.manager.continueFromResults(chat.taskId,'member candidate is ready',options,source())).toEqual(receipt);
    expect(f.runs).toHaveLength(2);expect(await f.manager.queued(chat.taskId)).toEqual([]);
  }finally{await f.cleanup()}
});

test('failed or blocked member reports can continue without result messages but still deduplicate their continuation identity',async()=>{
  const f=await fixture();try{
    const chat=await f.manager.chat('coordinate work',options);await f.finish();
    const failedSource=source('failure-report',[],['failed-member-task']);
    const receipt=await f.manager.continueFromResults(chat.taskId,'member failed; report limitations',options,failedSource);
    expect((await f.manager.inspect(chat.taskId,receipt.runId)).source).toEqual(failedSource);
    expect(await f.manager.continueFromResults(chat.taskId,'member failed; report limitations',options,failedSource)).toEqual(receipt);
    expect(f.runs).toHaveLength(2);
  }finally{await f.cleanup()}
});

test('a new continuation requires a completed, verified main thread and cannot recover a failed run automatically',async()=>{
  const f=await fixture();try{
    const chat=await f.manager.chat('coordinate work',options);
    await expect(f.manager.continueFromResults(chat.taskId,'too early',options,source())).rejects.toMatchObject({code:'CONTINUATION_NOT_READY'});
    await f.finish(0,'failed');
    await expect(f.manager.continueFromResults(chat.taskId,'must not replay',options,source())).rejects.toMatchObject({code:'CONTINUATION_NOT_READY'});
    const foreign={...f.workspace,entry:{...f.workspace.entry,id:'other-workspace'}} as KnowledgeWorkspace;
    const manager=new WorkspaceExecutionManager(foreign,f.storage,f.factory);
    try{await expect(manager.continueFromResults(chat.taskId,'foreign',options,source())).rejects.toMatchObject({code:'IDENTITY'})}finally{await manager.close()}
    expect(f.runs).toHaveLength(1);
  }finally{await f.cleanup()}
});

test('user resume while members are busy queues the original message; reconciliation is not silently discarded',async()=>{
  const f=await fixture();try{
    const chat=await f.manager.chat('coordinate work',options);await f.finish();f.setBusy(true);
    const message='please also verify keyboard controls';
    const queued=await f.manager.resume(chat.taskId,chat.runId,message,{...options,model:'next-model'});
    expect(queued).toMatchObject({...chat,queued:true});expect(f.runs).toHaveLength(1);
    expect(await f.manager.queued(chat.taskId)).toMatchObject([{message,options:{model:'next-model'}}]);
    await expect(f.manager.resume(chat.taskId,chat.runId,'reconcile',options,['unknown-tool'])).rejects.toMatchObject({code:'COLLABORATION_BUSY'});
    expect(await f.manager.queued(chat.taskId)).toHaveLength(1);
  }finally{await f.cleanup()}
});

test('stop marks collaboration before waiting, late results cannot restart, and ready does not unpause user messages',async()=>{
  const f=await fixture();try{
    const chat=await f.manager.chat('coordinate work',options);await f.finish();f.setBusy(true);
    await f.manager.enqueue(chat.taskId,'waiting user input',options);
    // This read would deadlock if the collaboration stop hook ran inside the manager serial boundary.
    let releaseStop!:()=>void;
    const stopped=new Promise<void>(resolve=>{releaseStop=resolve});
    f.stop.mockImplementation(async taskId=>{await f.manager.queued(taskId);f.setBusy(false);await stopped});
    const stop=f.manager.stop(chat.taskId);
    await vi.waitFor(()=>expect(f.stop).toHaveBeenCalledWith(chat.taskId));
    // The coordinator has already cleared busy, but its member shutdown is still pending.
    await f.manager.enqueue(chat.taskId,'new input while stopping',options);
    await f.manager.collaborationReady(chat.taskId);expect(f.runs).toHaveLength(1);
    releaseStop();await stop;
    expect(await f.manager.queued(chat.taskId)).toMatchObject([{status:'paused'},{status:'paused'}]);
    await f.manager.collaborationReady(chat.taskId);expect(f.runs).toHaveLength(1);
    await expect(f.manager.continueFromResults(chat.taskId,'late result',options,source())).rejects.toMatchObject({code:'COLLABORATION_STOPPED'});
    await f.manager.continueQueue(chat.taskId);expect(f.runs).toHaveLength(2);
  }finally{await f.cleanup()}
});

test('stop during an automatic queue factory prevents the pending loop from starting',async()=>{
  const f=await fixture();try{
    const chat=await f.manager.chat('coordinate work',options);await f.finish();
    const originalFactory=f.factory.getMockImplementation()!;
    let releaseFactory!:()=>void,created!:()=>void;
    const waitFactory=new Promise<void>(resolve=>{releaseFactory=resolve});
    const factoryEntered=new Promise<void>(resolve=>{created=resolve});
    f.factory.mockImplementationOnce(async(config,task)=>{const loop=await originalFactory(config,task);created();await waitFactory;return loop});
    const enqueue=f.manager.enqueue(chat.taskId,'automatic queued message',options);
    await factoryEntered;
    const stopping=f.manager.stop(chat.taskId);
    releaseFactory();await Promise.all([enqueue,stopping]);
    expect(f.runs).toHaveLength(2);expect(f.runs[1].context).toBeUndefined();expect(f.runs[1].closed).toBe(false);
    expect(await f.manager.queued(chat.taskId)).toMatchObject([{message:'automatic queued message',status:'paused'}]);
    expect((await f.manager.thread(chat.taskId)).length).toBe(1);
  }finally{await f.cleanup()}
});

test('stop while a new dispatch cycle is opening rejects the pending model run and cleans the cycle',async()=>{
  const f=await fixture();let release=()=>{};try{
    let entered!:()=>void;
    const began=new Promise<void>(resolve=>{entered=resolve}),opening=new Promise<void>(resolve=>{release=resolve});
    f.starting.mockImplementationOnce(async()=>{entered();await opening});
    const chat=f.manager.chat('new cycle with slow persistence',options);void chat.catch(()=>{});
    await began;const taskId=f.runs[0].task.taskId,stopped=f.manager.stop(taskId);
    release();await expect(chat).rejects.toMatchObject({code:'COLLABORATION_STOPPED'});await stopped;
    expect(f.startFailed).toHaveBeenCalledWith(expect.objectContaining({taskId}),undefined,expect.any(Error));
    expect(f.runs[0].context).toBeUndefined();await expect(f.manager.thread(taskId)).rejects.toMatchObject({code:'ENOENT'});
  }finally{release();await f.cleanup()}
});

test('collaboration failure synchronously blocks an enqueue that is already reading history before its queued pause runs',async()=>{
  const f=await fixture();let releaseHistory=()=>{};try{
    const chat=await f.manager.chat('coordinate work',options);await f.finish();f.setBusy(true);
    const originalList=f.storage.list.bind(f.storage);
    let entered!:()=>void;
    const historyEntered=new Promise<void>(resolve=>{entered=resolve});
    const historyGate=new Promise<void>(resolve=>{releaseHistory=resolve});
    vi.spyOn(f.storage,'list').mockImplementationOnce(async directory=>{entered();await historyGate;return originalList(directory)});
    const enqueue=f.manager.enqueue(chat.taskId,'already pending user message',options);
    await historyEntered;
    // The coordinator drops busy before scheduling its persistence work behind this enqueue.
    f.setBusy(false);
    const pause=f.manager.pauseCollaboration(chat.taskId,'成员结算未能确认');
    releaseHistory();await Promise.all([enqueue,pause]);
    expect(f.runs).toHaveLength(1);
    expect(await f.manager.queued(chat.taskId)).toMatchObject([{message:'already pending user message',status:'paused'}]);
    await f.manager.collaborationReady(chat.taskId);expect(f.runs).toHaveLength(1);
    await expect(f.manager.continueFromResults(chat.taskId,'late member report',options,source())).rejects.toMatchObject({code:'COLLABORATION_STOPPED'});
    await f.manager.continueQueue(chat.taskId);expect(f.runs).toHaveLength(2);
  }finally{releaseHistory();await f.cleanup()}
});
