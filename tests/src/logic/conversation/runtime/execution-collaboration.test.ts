import {expect,test,vi} from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {WorkspaceExecutionManager} from '../../../../../src/logic/conversation/runtime/execution-manager';
import {Agent} from '../../../../../src/framework/cability/agent';
import type {ExecutionCollaboration} from '../../../../../src/logic/conversation/runtime/execution-manager';
import {LoopRuntime} from '../../../../../src/logic/execution/rules/runtime/runtime';
import type {AgentEngine,EngineContext,RunInputSource,TaskSpec} from '../../../../../src/logic/execution/rules/types';
import type {KnowledgeWorkspace} from '../../../../../src/logic/knowledge/rules/ports';
import {FileRunStorage} from '../../../../../src/logic/execution/storage/run-storage';
import {GlobalRunAdmission} from '../../../../../src/logic/execution/admission/run-admission';
import {WorkspaceExecutionLease} from '../../../../../src/logic/execution/admission/workspace-lease';
import type {ExecutionLaunchContext,ExecutionAdmissionWait} from '../../../../../src/logic/execution/admission/admission-wait';
import {admissionRequestId,acquireExecutionLease} from '../../../../../src/logic/application/assembly/execution-admission';

const options={provider:'test',model:'model-one',permission:'ask' as const,allowNativeExecution:true};

test('统一 Agent 根运行只使用独立生命周期，不触发旧协调器',async()=>{
  const f=await fixture();
  const lifecycle={BeforeRun:vi.fn(async()=>{}),Settled:vi.fn(async()=>{}),Failed:vi.fn(async()=>{})};
  const original=f.factory.getMockImplementation()!;
  f.factory.mockImplementation(async(...args)=>({...await original(...args),agent:new Agent({id:'cbim:main',name:'main',instructions:''},{workspaceId:args[1].workspaceId,taskId:args[1].taskId}),unifiedAgentTools:true,agentLifecycle:lifecycle}));
  try{
    const run=await f.manager.Chat('通过统一工具执行',options);
    expect(f.factory.mock.calls[0][2].executionModel).toBe('agent-tools-v1');
    expect(lifecycle.BeforeRun).toHaveBeenCalledWith(run.runId,{message:'通过统一工具执行',attachmentIds:undefined});
    expect(f.starting).not.toHaveBeenCalled();
    f.runs[0].finish('completed');
    await vi.waitFor(()=>expect(lifecycle.Settled).toHaveBeenCalledWith(expect.objectContaining({runId:run.runId,status:'completed'})));
    expect(f.settled).not.toHaveBeenCalled();expect(f.startFailed).not.toHaveBeenCalled();
  }finally{await f.cleanup()}
});

test('统一 Agent 受理失败归原生命周期，不能调用旧失败清理',async()=>{
  const f=await fixture();const refusal=new Error('budget denied');
  const lifecycle={BeforeRun:vi.fn(async()=>{throw refusal}),Settled:vi.fn(async()=>{}),Failed:vi.fn(async()=>{})};
  const original=f.factory.getMockImplementation()!;
  f.factory.mockImplementation(async(...args)=>({...await original(...args),agent:new Agent({id:'cbim:main',name:'main',instructions:''},{workspaceId:args[1].workspaceId,taskId:args[1].taskId}),unifiedAgentTools:true,agentLifecycle:lifecycle}));
  try{
    await expect(f.manager.Chat('拒绝前不得派发',options)).rejects.toThrow('budget denied');
    expect(lifecycle.Failed).toHaveBeenCalledWith(refusal);
    expect(f.starting).not.toHaveBeenCalled();expect(f.startFailed).not.toHaveBeenCalled();
    expect(f.runs[0].message).toBeUndefined();
  }finally{await f.cleanup()}
});
const source=(continuationId='continuation-one',messageIds=['result-one'],taskIds=['member-task-one']):RunInputSource=>({kind:'member-results',continuationId,messageIds,taskIds});

function occupied(admission:GlobalRunAdmission){
  const attempt=admission.Attempt({workspaceId:'other-workspace',ownerEpoch:1,rootSessionId:'other-root',requestId:'other-run',source:'direct',workspacePermission:'read'},{CanAcquire:()=>undefined,IsCurrent:()=>true,Acquire:()=>()=>{}});
  if(attempt.kind!=='granted')throw Error('fixture occupancy was denied');return attempt.release;
}

async function fixture(admission?:GlobalRunAdmission,allowTools=false){
  const directory=await fs.mkdtemp(path.join(os.tmpdir(),'cbim-conversation-collaboration-'));
  const workspace={entry:{id:'workspace-one',path:directory},paths:{Project:()=>directory},Assert:()=>{}} as unknown as KnowledgeWorkspace;
  const storage=new FileRunStorage();
  const lease=new WorkspaceExecutionLease();
  let leased=false,busy=false,waiting=false;
  const runs:Array<{task:TaskSpec;message?:string;context?:EngineContext;finish:(status:'completed'|'failed'|'cancelled')=>void;closed:boolean}>=[];
  const factory=vi.fn(async(config:any,task:TaskSpec,launch:ExecutionLaunchContext)=>{
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
      AcquireLease:async()=>{
        const release=acquireExecutionLease(lease,task.taskId,{workspaceId:task.workspaceId,rootSessionId:task.taskId,taskId:task.taskId,requestId:admissionRequestId('main',launch.requestId),scopeId:launch.scopeId,source:launch.wait?'main-result':'direct',workspacePermission:'read'},admission?{manager:admission,ownerEpoch:1,IsCurrent:()=>true}:undefined,launch.wait);
        if(leased)throw Error('lease overlaps');leased=true;return ()=>{leased=false;release()};
      },
      CreateEngine:()=>engine,ToolPolicy:async()=>({allow:allowTools,effects:['business-write']}),OnEvent:config.onEvent,
    });
    return {runtime} as any;
  });
  let manager=new WorkspaceExecutionManager(workspace,storage,factory);
  const settled=vi.fn<ExecutionCollaboration['Settled']>(()=>{expect(leased).toBe(false);expect(runs.at(-1)?.closed).toBe(true)});
  const stop=vi.fn<ExecutionCollaboration['Stop']>(async()=>{busy=false});
  const starting=vi.fn<NonNullable<ExecutionCollaboration['Starting']>>(async()=>{}),startFailed=vi.fn<NonNullable<ExecutionCollaboration['StartFailed']>>(async()=>{});
  const attach=()=>manager.AttachCollaboration({Busy:()=>busy||waiting,Waiting:()=>waiting,Starting: starting,StartFailed: startFailed,Settled: settled,Stop: stop});attach();
  return {
    workspace,storage,factory,runs,settled,stop,starting,startFailed,
    get manager(){return manager},setBusy:(value:boolean)=>{busy=value},setWaiting:(value:boolean)=>{waiting=value},
    async finish(index=0,status:'completed'|'failed'|'cancelled'='completed'){
      const count=settled.mock.calls.length;runs[index].finish(status);await vi.waitFor(()=>expect(settled.mock.calls.length).toBeGreaterThan(count));
    },
    async reopen(){await manager.Close();manager=new WorkspaceExecutionManager(workspace,storage,factory);attach()},
    async cleanup(){await manager.Close();await fs.rm(directory,{recursive:true,force:true})},
  };
}

test('初始输入与显式续聊传入本轮原文，原会话 TaskSpec 保持稳定',async()=>{
  const f=await fixture();try{
    const first='  第一项任务\n保留上下文原文  ',second='\n第二项任务，与首项不同\n';
    const chat=await f.manager.Chat(first,options);
    expect(f.starting).toHaveBeenLastCalledWith(expect.objectContaining({taskId:chat.taskId,goal:first.trim()}),expect.anything(),undefined,first,chat.runId,undefined,undefined);
    await f.finish();
    await f.manager.Resume(chat.taskId,chat.runId,second,options);
    expect(f.starting).toHaveBeenLastCalledWith(expect.objectContaining({taskId:chat.taskId,goal:first.trim()}),expect.anything(),undefined,second,expect.any(String),undefined,undefined);
  }finally{await f.cleanup()}
});

test('直接 Manager resume 不能用裸调用 ID 解除真实未知，既不入队也不创建新引擎',async()=>{
  const f=await fixture(undefined,true);try{
    const chat=await f.manager.Chat('原未知操作',options),call={id:'unknown-native-call',name:'write',input:{path:'result.txt',content:'original'}};
    expect((await f.runs[0].context!.beforeTool(call)).allow).toBe(true);await f.finish(0,'failed');
    const summary=await f.manager.Inspect(chat.taskId,chat.runId);expect(summary.unresolvedTools).toEqual([call.id]);
    for(const ids of [[],[call.id]])await expect(f.manager.Resume(chat.taskId,chat.runId,'我已检查',options,ids)).rejects.toMatchObject({code:'RECOVERY_INSPECTION_REQUIRED'});
    expect(f.factory).toHaveBeenCalledTimes(1);expect(await f.manager.Queued(chat.taskId)).toEqual([]);expect(await f.manager.Inspect(chat.taskId,chat.runId)).toEqual(summary);
  }finally{await f.cleanup()}
});

test('持久等待期间普通同意消息只排队，继续队列不能解除等待或启动模型',async()=>{
  const f=await fixture();try{
    const chat=await f.manager.Chat('需要用户补充的目标',options);f.setWaiting(true);await f.finish();
    await f.manager.Enqueue(chat.taskId,'同意',options);
    const result=await f.manager.Resume(chat.taskId,chat.runId,'补充但来自普通输入',options);
    expect(result).toMatchObject({queued:true});
    await expect(f.manager.ContinueQueue(chat.taskId)).rejects.toMatchObject({code:'GOAL_WAITING'});
    expect(f.runs).toHaveLength(1);
    const pending=await f.manager.Queued(chat.taskId);expect(pending).toHaveLength(2);expect(pending.every(item=>item.status==='pending')).toBe(true);
    await f.manager.CollaborationReady(chat.taskId);expect(f.runs).toHaveLength(1);
    await f.reopen();expect(await f.manager.Queued(chat.taskId)).toMatchObject(pending.map(item=>({id:item.id,message:item.message,status:'paused'})));await expect(f.manager.ContinueQueue(chat.taskId)).rejects.toMatchObject({code:'GOAL_WAITING'});expect(f.runs).toHaveLength(1);
  }finally{await f.cleanup()}
});

test('collaboration notification follows lease release and starts the queued topic only when the batch is ready',async()=>{
  const f=await fixture();try{
    const chat=await f.manager.Chat('coordinate work',options);
    expect(f.starting).toHaveBeenLastCalledWith(expect.objectContaining({taskId:chat.taskId}),expect.anything(),undefined,'coordinate work',chat.runId,undefined,undefined);
    expect(f.factory.mock.calls[0][1]).toMatchObject({taskId:chat.taskId,mode:'chat'});
    const queued=await f.manager.Enqueue(chat.taskId,'user followup',{...options,model:'model-two'});
    f.setBusy(true);await f.finish();
    expect(f.settled).toHaveBeenCalledWith(expect.objectContaining({taskId:chat.taskId}),expect.objectContaining({model:'model-one'}),expect.objectContaining({status:'completed'}));
    expect(f.runs).toHaveLength(1);expect(await f.manager.Queued(chat.taskId)).toHaveLength(1);
    f.setBusy(false);await f.manager.CollaborationReady(chat.taskId);
    expect(f.runs).toHaveLength(2);await vi.waitFor(()=>expect(f.runs[1].message).toBe('user followup'));
    expect(f.starting).toHaveBeenLastCalledWith(expect.objectContaining({goal:'coordinate work'}),expect.anything(),undefined,'user followup',expect.any(String),queued.id,undefined);
    expect(f.factory.mock.calls[1][0].model).toBe('model-two');expect(await f.manager.Queued(chat.taskId)).toEqual([]);
  }finally{await f.cleanup()}
});

test('result continuation has durable source and duplicate receipts never start another run, including after reopening',async()=>{
  const f=await fixture();try{
    const chat=await f.manager.Chat('coordinate work',options);await f.finish();f.setBusy(true);
    const receipt=await f.manager.ContinueFromResults(chat.taskId,'member candidate is ready',options,source());
    expect(f.starting).toHaveBeenLastCalledWith(expect.objectContaining({goal:'coordinate work'}),expect.anything(),source(),'member candidate is ready',receipt.runId,undefined,undefined);
    const summary=await f.manager.Inspect(chat.taskId,receipt.runId);
    expect(summary.source).toEqual(source());expect(summary.events[0].data.source).toEqual(source());
    expect(await f.manager.ContinueFromResults(chat.taskId,'member candidate is ready',options,source())).toEqual(receipt);
    expect(f.runs).toHaveLength(2);
    await expect(f.manager.ContinueFromResults(chat.taskId,'changed candidate',options,source())).rejects.toMatchObject({code:'CONTINUATION_CONFLICT'});
    await expect(f.manager.ContinueFromResults(chat.taskId,'different input',options,source('continuation-one',['result-one'],['another-task']))).rejects.toMatchObject({code:'CONTINUATION_CONFLICT'});
    await expect(f.manager.ContinueFromResults(chat.taskId,'partial replay',options,source('continuation-two',['result-one','result-two']))).rejects.toMatchObject({code:'RESULT_ALREADY_CONSUMED'});
    await f.finish(1);await f.reopen();
    expect(await f.manager.ContinueFromResults(chat.taskId,'member candidate is ready',options,source())).toEqual(receipt);
    expect(f.runs).toHaveLength(2);expect(await f.manager.Queued(chat.taskId)).toEqual([]);
  }finally{await f.cleanup()}
});

test('failed or blocked member reports can continue without result messages but still deduplicate their continuation identity',async()=>{
  const f=await fixture();try{
    const chat=await f.manager.Chat('coordinate work',options);await f.finish();
    const failedSource=source('failure-report',[],['failed-member-task']);
    const receipt=await f.manager.ContinueFromResults(chat.taskId,'member failed; report limitations',options,failedSource);
    expect((await f.manager.Inspect(chat.taskId,receipt.runId)).source).toEqual(failedSource);
    expect(await f.manager.ContinueFromResults(chat.taskId,'member failed; report limitations',options,failedSource)).toEqual(receipt);
    expect(f.runs).toHaveLength(2);
  }finally{await f.cleanup()}
});

test('a new continuation requires a completed, verified main thread and cannot recover a failed run automatically',async()=>{
  const f=await fixture();try{
    const chat=await f.manager.Chat('coordinate work',options);
    await expect(f.manager.ContinueFromResults(chat.taskId,'too early',options,source())).rejects.toMatchObject({code:'CONTINUATION_NOT_READY'});
    await f.finish(0,'failed');
    await expect(f.manager.ContinueFromResults(chat.taskId,'must not replay',options,source())).rejects.toMatchObject({code:'CONTINUATION_NOT_READY'});
    const foreign={...f.workspace,entry:{...f.workspace.entry,id:'other-workspace'}} as KnowledgeWorkspace;
    const manager=new WorkspaceExecutionManager(foreign,f.storage,f.factory);
    try{await expect(manager.ContinueFromResults(chat.taskId,'foreign',options,source())).rejects.toMatchObject({code:'IDENTITY'})}finally{await manager.Close()}
    expect(f.runs).toHaveLength(1);
  }finally{await f.cleanup()}
});

test('user resume while members are busy queues the original message; reconciliation is not silently discarded',async()=>{
  const f=await fixture();try{
    const chat=await f.manager.Chat('coordinate work',options);await f.finish();f.setBusy(true);
    const message='please also verify keyboard controls';
    const queued=await f.manager.Resume(chat.taskId,chat.runId,message,{...options,model:'next-model'});
    expect(queued).toMatchObject({...chat,queued:true});expect(f.runs).toHaveLength(1);
    expect(await f.manager.Queued(chat.taskId)).toMatchObject([{message,options:{model:'next-model'}}]);
    await expect(f.manager.Resume(chat.taskId,chat.runId,'reconcile',options,['unknown-tool'])).rejects.toMatchObject({code:'COLLABORATION_BUSY'});
    expect(await f.manager.Queued(chat.taskId)).toHaveLength(1);
  }finally{await f.cleanup()}
});

test('stop marks collaboration before waiting, late results cannot restart, and ready does not unpause user messages',async()=>{
  const f=await fixture();try{
    const chat=await f.manager.Chat('coordinate work',options);await f.finish();f.setBusy(true);
    await f.manager.Enqueue(chat.taskId,'waiting user input',options);
    // This read would deadlock if the collaboration stop hook ran inside the manager serial boundary.
    let releaseStop!:()=>void;
    const stopped=new Promise<void>(resolve=>{releaseStop=resolve});
    f.stop.mockImplementation(async taskId=>{await f.manager.Queued(taskId);f.setBusy(false);await stopped});
    const stop=f.manager.Stop(chat.taskId);
    await vi.waitFor(()=>expect(f.stop).toHaveBeenCalledWith(chat.taskId));
    // The coordinator has already cleared busy, but its member shutdown is still pending.
    await f.manager.Enqueue(chat.taskId,'new input while stopping',options);
    await f.manager.CollaborationReady(chat.taskId);expect(f.runs).toHaveLength(1);
    releaseStop();await stop;
    expect(await f.manager.Queued(chat.taskId)).toMatchObject([{status:'paused'},{status:'paused'}]);
    await f.manager.CollaborationReady(chat.taskId);expect(f.runs).toHaveLength(1);
    await expect(f.manager.ContinueFromResults(chat.taskId,'late result',options,source())).rejects.toMatchObject({code:'COLLABORATION_STOPPED'});
    await f.manager.ContinueQueue(chat.taskId);expect(f.runs).toHaveLength(2);
  }finally{await f.cleanup()}
});

test('stop during an automatic queue factory prevents the pending loop from starting',async()=>{
  const f=await fixture();try{
    const chat=await f.manager.Chat('coordinate work',options);await f.finish();
    const originalFactory=f.factory.getMockImplementation()!;
    let releaseFactory!:()=>void,created!:()=>void;
    const waitFactory=new Promise<void>(resolve=>{releaseFactory=resolve});
    const factoryEntered=new Promise<void>(resolve=>{created=resolve});
    f.factory.mockImplementationOnce(async(config,task,launch)=>{const loop=await originalFactory(config,task,launch);created();await waitFactory;return loop});
    const enqueue=f.manager.Enqueue(chat.taskId,'automatic queued message',options);
    await factoryEntered;
    const stopping=f.manager.Stop(chat.taskId);
    releaseFactory();await Promise.all([enqueue,stopping]);
    expect(f.runs).toHaveLength(2);expect(f.runs[1].context).toBeUndefined();expect(f.runs[1].closed).toBe(false);
    expect(await f.manager.Queued(chat.taskId)).toMatchObject([{message:'automatic queued message',status:'paused'}]);
    expect((await f.manager.Thread(chat.taskId)).length).toBe(1);
  }finally{await f.cleanup()}
});

test('stop while a new dispatch cycle is opening rejects the pending model run and cleans the cycle',async()=>{
  const f=await fixture();let release=()=>{};try{
    let entered!:()=>void;
    const began=new Promise<void>(resolve=>{entered=resolve}),opening=new Promise<void>(resolve=>{release=resolve});
    f.starting.mockImplementationOnce(async()=>{entered();await opening});
    const chat=f.manager.Chat('new cycle with slow persistence',options);void chat.catch(()=>{});
    await began;const taskId=f.runs[0].task.taskId,stopped=f.manager.Stop(taskId);
    release();await expect(chat).rejects.toMatchObject({code:'COLLABORATION_STOPPED'});await stopped;
    expect(f.startFailed).toHaveBeenCalledWith(expect.objectContaining({taskId}),undefined,expect.any(Error));
    expect(f.runs[0].context).toBeUndefined();expect(await f.manager.Thread(taskId)).toEqual([]);
  }finally{release();await f.cleanup()}
});

test('collaboration failure synchronously blocks an enqueue that is already reading history before its queued pause runs',async()=>{
  const f=await fixture();let releaseHistory=()=>{};try{
    const chat=await f.manager.Chat('coordinate work',options);await f.finish();f.setBusy(true);
    const originalList=f.storage.List.bind(f.storage);
    let entered!:()=>void;
    const historyEntered=new Promise<void>(resolve=>{entered=resolve});
    const historyGate=new Promise<void>(resolve=>{releaseHistory=resolve});
    vi.spyOn(f.storage,'List').mockImplementationOnce(async directory=>{entered();await historyGate;return originalList(directory)});
    const enqueue=f.manager.Enqueue(chat.taskId,'already pending user message',options);
    await historyEntered;
    // The coordinator drops busy before scheduling its persistence work behind this enqueue.
    f.setBusy(false);
    const pause=f.manager.PauseCollaboration(chat.taskId,'成员结算未能确认');
    releaseHistory();await Promise.all([enqueue,pause]);
    expect(f.runs).toHaveLength(1);
    expect(await f.manager.Queued(chat.taskId)).toMatchObject([{message:'already pending user message',status:'paused'}]);
    await f.manager.CollaborationReady(chat.taskId);expect(f.runs).toHaveLength(1);
    await expect(f.manager.ContinueFromResults(chat.taskId,'late member report',options,source())).rejects.toMatchObject({code:'COLLABORATION_STOPPED'});
    await f.manager.ContinueQueue(chat.taskId);expect(f.runs).toHaveLength(2);
  }finally{releaseHistory();await f.cleanup()}
});

test('并发已满时首轮尚未受理：不开目标、不创建运行或引擎，准备失败仍释放名额',async()=>{
  const admission=new GlobalRunAdmission();admission.Configure({revision:1,maxConcurrentRuns:1});
  const release=occupied(admission),f=await fixture(admission);try{
    await expect(f.manager.Chat('保留原草稿',options)).rejects.toMatchObject({code:'CAPACITY_BUSY'});
    expect(f.starting).not.toHaveBeenCalled();expect(f.startFailed).not.toHaveBeenCalled();
    expect(f.runs.every(run=>!run.context)).toBe(true);expect(await f.manager.List()).toEqual([]);
    expect(admission.Snapshot().waiting).toEqual([]);expect(admission.Snapshot().occupied).toHaveLength(1);
    release();f.starting.mockRejectedValueOnce(Error('scope storage failed'));
    await expect(f.manager.Chat('磁盘失败不能漏名额',options)).rejects.toThrow('scope storage failed');
    expect(admission.Snapshot().occupied).toEqual([]);expect(await f.manager.List()).toEqual([]);
    await f.manager.Chat('再次明确启动',options);expect(admission.Snapshot().occupied).toHaveLength(1);
    await f.finish(f.runs.length-1);expect(admission.Snapshot().occupied).toEqual([]);
  }finally{release();await f.cleanup()}
});

test('已受理结果回注等待保留稳定票，不开失败周期；释放只通知原协调器重新核实',async()=>{
  const admission=new GlobalRunAdmission();admission.Configure({revision:1,maxConcurrentRuns:1});
  const f=await fixture(admission);let release=()=>{};try{
    const chat=await f.manager.Chat('已有目标',options);await f.finish();f.setBusy(true);
    release=occupied(admission);const callbacks=new Map<string,()=>void>(),onReady=vi.fn();
    const wait:ExecutionAdmissionWait={scopeId:'scope-one',IsCurrent:()=>true,OnReady: onReady,RegisterWithdraw:(key,withdraw)=>{callbacks.set(key,withdraw)}};
    const report=source('auto:return:'+('x'.repeat(200)));
    // Admission uses a bounded hash; the source journal itself still enforces its own input schema.
    const validSource=source('auto-return-one');
    expect(admissionRequestId('main',(report as {continuationId:string}).continuationId)).toMatch(/^main-[a-f0-9]{64}$/);
    await expect(f.manager.ContinueFromResults(chat.taskId,'真实结果',options,validSource,wait)).rejects.toMatchObject({code:'CAPACITY_WAITING'});
    const first=admission.Snapshot().waiting[0];expect(first).toMatchObject({source:'main-result',scopeId:'scope-one'});
    expect(f.starting).toHaveBeenCalledTimes(1);expect(f.startFailed).not.toHaveBeenCalled();expect(await f.manager.Thread(chat.taskId)).toHaveLength(1);
    await expect(f.manager.ContinueFromResults(chat.taskId,'真实结果',options,validSource,wait)).rejects.toMatchObject({code:'CAPACITY_WAITING'});
    expect(admission.Snapshot().waiting[0].ticketId).toBe(first.ticketId);expect(callbacks.size).toBe(1);
    // Withdrawal uses only identity, not Request's source/permission, and is safe to repeat.
    callbacks.values().next().value!();expect(admission.Snapshot().waiting).toEqual([]);
    await expect(f.manager.ContinueFromResults(chat.taskId,'真实结果',options,validSource,wait)).rejects.toMatchObject({code:'CAPACITY_WAITING'});
    release();await vi.waitFor(()=>expect(onReady).toHaveBeenCalled());
    expect(await f.manager.Thread(chat.taskId)).toHaveLength(1);
    await f.manager.ContinueFromResults(chat.taskId,'真实结果',options,validSource,wait);
    expect(admission.Snapshot().waiting).toEqual([]);expect(admission.Snapshot().occupied).toHaveLength(1);
    await f.finish(f.runs.length-1);expect(admission.Snapshot().occupied).toEqual([]);
  }finally{release();await f.cleanup()}
});

test('用户队列容量不足保留并暂停原消息，释放额度不会把它变成自动恢复任务',async()=>{
  const admission=new GlobalRunAdmission();admission.Configure({revision:1,maxConcurrentRuns:1});
  const f=await fixture(admission);let release=()=>{};try{
    const chat=await f.manager.Chat('首轮',options);await f.finish();release=occupied(admission);
    await f.manager.Enqueue(chat.taskId,'不能丢失的排队正文',options);
    expect(await f.manager.Queued(chat.taskId)).toMatchObject([{message:'不能丢失的排队正文',status:'paused'}]);
    expect(await f.manager.Thread(chat.taskId)).toHaveLength(1);expect(admission.Snapshot().waiting).toEqual([]);
    release();await f.manager.CollaborationReady(chat.taskId);
    expect(await f.manager.Thread(chat.taskId)).toHaveLength(1);
    await f.manager.ContinueQueue(chat.taskId);expect(await f.manager.Queued(chat.taskId)).toEqual([]);
    await f.finish(f.runs.length-1);
  }finally{release();await f.cleanup()}
});

test('活动原运行的未决工具只允许补充排队，不启动新模型或接受核实 ID',async()=>{
  const f=await fixture(undefined,true);
  try{
    const run=await f.manager.Chat('原运行',options);
    const call={id:'active-agent-call',name:'write',input:{path:'result.txt',content:'pending'}};
    expect((await f.runs[0].context!.beforeTool(call)).allow).toBe(true);
    await expect(f.manager.Resume(run.taskId,run.runId,'不能用 ID 绕过',options,[call.id])).rejects.toMatchObject({code:'COLLABORATION_BUSY'});
    const queued=await f.manager.Resume(run.taskId,run.runId,'保留新的用户要求',{...options,model:'model-two'});
    expect(queued).toMatchObject({taskId:run.taskId,runId:run.runId,queued:true});
    expect(f.factory).toHaveBeenCalledTimes(1);
    expect(await f.manager.Queued(run.taskId)).toMatchObject([{message:'保留新的用户要求',status:'pending',options:{model:'model-two'}}]);
    await f.manager.Stop(run.taskId);
    expect(await f.manager.Queued(run.taskId)).toMatchObject([{message:'保留新的用户要求',status:'paused'}]);
    await expect(f.manager.Resume(run.taskId,run.runId,'历史未知操作不能排队恢复',options)).rejects.toMatchObject({code:'RECOVERY_INSPECTION_REQUIRED'});
    expect(f.factory).toHaveBeenCalledTimes(1);
  }finally{await f.cleanup()}
});

test.each([false,true])('closing waits for unified Agent durable settlement and reports its failure (%s)',async reject=>{
 const f=await fixture();let release!:()=>void;const gate=new Promise<void>(resolve=>release=resolve);
 const lifecycle={BeforeRun:vi.fn(async()=>{}),Settled:vi.fn(async()=>{await gate;if(reject)throw Error('durable settlement failed')}),Failed:vi.fn(async()=>{})};
 const original=f.factory.getMockImplementation()!;
 f.factory.mockImplementation(async(...args)=>({...await original(...args),agent:new Agent({id:'cbim:main',name:'main',instructions:''},{workspaceId:args[1].workspaceId,taskId:args[1].taskId}),unifiedAgentTools:true,agentLifecycle:lifecycle}));
 try{
  const run=await f.manager.Chat('关闭仍需保存原运行事实',options);
  await f.manager.Enqueue(run.taskId,'关闭后不得自动执行',options);
  let done=false;const closing=f.manager.Close();const observed=closing.then(()=>{done=true;return undefined},error=>{done=true;return error});
  await vi.waitFor(()=>expect(lifecycle.Settled).toHaveBeenCalledTimes(1));
  expect(done).toBe(false);expect(f.runs).toHaveLength(1);
  expect(lifecycle.Settled).toHaveBeenCalledWith(expect.objectContaining({runId:run.runId,status:'cancelled'}));
  release();const failure=await observed;
  if(reject)expect(failure?.message).toBe('durable settlement failed');else expect(failure).toBeUndefined();
  expect(f.settled).not.toHaveBeenCalled();expect(f.runs).toHaveLength(1);
 }finally{release();await f.cleanup()}
});
