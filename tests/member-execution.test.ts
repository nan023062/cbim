import {expect,it,vi} from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fixture,request} from './helpers';
import {seedTeam} from './team-fixture';
import {json} from '../src/backend/core/foundation/serialization';
import {FileDispatchStore} from '../src/backend/main/persistence/tasks/dispatch-store';
import {FileRunStorage} from '../src/backend/main/persistence/tasks/run-storage';
import {WorkspaceDispatchService} from '../src/backend/scheduler-engine/execution/dispatch-service';
import {MemberExecutionManager} from '../src/backend/scheduler-engine/execution/member-execution';
import {WorkspaceExecutionLease} from '../src/backend/scheduler-engine/execution/workspace-lease';
import {LoopRuntime} from '../src/backend/core/brain/runtime';
import type {AgentEngine,EngineContext} from '../src/backend/core/brain/types';
import type {MemberExecutionPorts} from '../src/backend/scheduler-engine/execution/member-execution';
import {GlobalRunAdmission} from '../src/backend/scheduler-engine/runtime/run-admission';
import {admissionRequestId,acquireExecutionLease} from '../src/backend/main/execution-admission';
import type {ExecutionAdmissionWait} from '../src/backend/scheduler-engine/execution/admission-wait';

const model={id:'test-provider',model:'test-model',name:'测试',api:'openai-completions' as const,auth:'api-key' as const,baseUrl:'https://example.test/v1',contextWindow:200000,maxTokens:1000,reasoning:false};
async function until<T>(get:()=>Promise<T>,ready:(value:T)=>boolean){for(let i=0;i<500;i++){const value=await get();if(ready(value))return value;await new Promise(r=>setTimeout(r,10))}throw Error('timed out')}
async function setup(){
  const f=await fixture();
  const entry=await f.app.dispatch('add',{path:f.a}),workspace=f.app.workspace(entry.id),team=await seedTeam(workspace),snapshot=await workspace.snapshot();
  const moduleId=team.input.moduleId,definition=JSON.parse(snapshot.files.find(x=>x.path===moduleId+'/module.json')!.text);
  definition.maintenance={bindingId:'maintain',maintainerPersonIds:['owner'],revision:1,state:'active',confirmation:{recordId:'review',source:'local_user',confirmedAt:'2026-11-06T00:00:00.000Z'}};
  await workspace.commit(request(snapshot,[{path:'.cbim/team/people.json',text:json({people:[{id:'owner',name:'维护人',team:'.cbim/team'}]})},{path:moduleId+'/module.json',text:json(definition)}]));
  const directory=path.join(f.temp,'controlled-dispatch'),store=new FileDispatchStore(directory,entry.id),storage=new FileRunStorage(),lease=new WorkspaceExecutionLease();
  const dispatch=new WorkspaceDispatchService(workspace,store),identity={workspaceId:entry.id,rootSessionId:'session-1'};
  await dispatch.openGraph({...identity,commandId:'open'});
  let behavior:'candidate'|'text'|'hold'|'rewrite'='candidate',release=()=>{},count=0;
  let beforeRuntimeLease:()=>Promise<void>=async()=>{};
  const contexts:EngineContext[]=[];
  const prepare=vi.fn<MemberExecutionPorts['prepare']>(async()=>({model,create:async(run,_task,hooks)=>{
    const engine:AgentEngine={kind:'controlled-test',start:async context=>{contexts.push(context);await context.emit({type:'session.bound',data:{sessionId:context.nativeSessionId,sessionFile:context.sessionFile??path.join(directory,'native-'+context.nativeSessionId+'.jsonl')}})},
      run:async()=>{
        const context=contexts.at(-1)!;
        expect((await store.read()).runs!.find(r=>r.binding.runId===run.binding.runId)?.status).toBe('running');
        if(behavior==='hold')return new Promise(resolve=>{release=()=>resolve({status:'cancelled'})});
        if(behavior==='text')return {status:'completed'};
        const invoke=async(name:string,input:Record<string,unknown>)=>{
          const id='tool-'+(++count),decision=await context.beforeTool({id,name,input});
          if(!decision.allow)throw Error('unexpected denial');
          const result=name==='read'?{content:[{type:'text',text:'verified artifact'}]}:await context.taskTools!.call(name,input);
          await context.emit({type:'tool.finished',data:{id,name,result,isError:false}});return id;
        };
        await invoke('cbim_task_plan',{expectedVersion:0,goal:behavior==='rewrite'?'different scope':context.task.goal,reason:'执行已派发任务',acceptance:context.task.acceptance,steps:[{id:'verify',title:'验证产物',owner:'当前成员'}]});
        const evidenceId=await invoke('read',{path:'src/file.ts'});
        await invoke('cbim_task_step',{expectedVersion:1,id:'verify',state:'reported_done',evidenceIds:[evidenceId]});
        await invoke('cbim_delivery_prepare',{expectedVersion:2,summary:'已核验产物',limitations:['仍需业务验收']});
        return {status:'completed'};
      },stop:async()=>release(),close:async()=>{}};
    return new LoopRuntime({storage,directory:path.join(directory,'runs','tasks'),acquireLease:async()=>{await beforeRuntimeLease();return ()=>{}},createEngine:()=>engine,onEngineReady:hooks.onEngineReady,onEvent:hooks.onEvent,toolPolicy:async call=>({allow:true,effects:[call.name==='read'?'read':'maintenance']})});
  }}));
  const ports:MemberExecutionPorts={acquire:(key,permission,agentInstanceId)=>lease.acquire(key,permission,agentInstanceId),prepare,inspect:run=>storage.read(path.join(directory,'runs','tasks',run.binding.taskId,run.binding.runId))};
  const members=new MemberExecutionManager(workspace,store,ports);await members.initialize();
  let command=0;
  const assign=(agentId=team.input.agentId,prerequisites:{taskId:string;expectedPlanRevision:number}[]=[],scopeId?:string)=>dispatch.dispatchTask({...identity,commandId:'dispatch-'+(++command),expectedParentRevision:1,task:{assigneeAgentId:agentId,moduleIds:[moduleId],goal:'核验已派发的产物',acceptance:[{id:'verified',text:'提供真实工具证据'}],prerequisites}},scopeId);
  const input=(taskId:string)=>({...identity,taskId});
  const start=(taskId:string,permission:'read'|'ask'|'execute'='read')=>members.start({...input(taskId),commandId:'start-'+taskId,expectedRevision:1,options:{permission}});
  const settled=(taskId:string)=>until(()=>members.inspect(input(taskId)),view=>!!view.runs.length&&!['starting','running'].includes(view.runs.at(-1)!.status));
  return {...f,workspace,entry,team,directory,store,storage,dispatch,members,ports,prepare,identity,assign,input,start,settled,contexts,lease,setRuntimeGate:(gate:()=>Promise<void>)=>{beforeRuntimeLease=gate},setBehavior:(value:typeof behavior)=>{behavior=value},cleanup:async()=>{release();await members.close();await dispatch.close();await f.cleanup()}};
}

it('成员领取后执行、返回带证据的候选、原请求人确认收件；重复启动不重复调用模型',async()=>{
  const f=await setup();try{
    const assigned=await f.assign(),receipt=await f.start(assigned.taskId),view=await f.settled(assigned.taskId);
    expect(view.task.status).toBe('result_ready');expect(view.task.result).toMatchObject({runId:receipt.runId,acceptance:'not_evaluated',evidenceRefs:['tool-2']});
    expect(f.prepare).toHaveBeenCalledTimes(1);
    expect(await f.start(assigned.taskId)).toEqual(receipt);expect(f.prepare).toHaveBeenCalledTimes(1);
    const root=(await f.dispatch.snapshot(f.identity)).root.agent;
    const recipient={...f.identity,agentSessionId:root.agentSessionId};
    const messages=await f.members.messages(recipient);expect(messages).toHaveLength(1);expect(messages[0]).toMatchObject({kind:'result',taskId:assigned.taskId,delivery:'pending'});
    await f.members.acknowledge({...recipient,commandId:'ack',messageId:messages[0].messageId});expect(await f.members.messages(recipient)).toEqual([]);
    expect(JSON.stringify(view)).not.toMatch(/sessionFile|agentDefinition|apiKey/);
    const next=await f.assign();await f.start(next.taskId);expect((await f.settled(next.taskId)).task.status).toBe('result_ready');
    expect(f.contexts[1].nativeSessionId).toBe(f.contexts[0].nativeSessionId);expect(f.contexts[1].sessionFile).toContain(f.contexts[0].nativeSessionId!);
  }finally{await f.cleanup()}
});

it('模型只有正文或改写了派发目标时，完成回合保留 completed 但任务 blocked',async()=>{
  const f=await setup();try{
    for(const behavior of ['text','rewrite'] as const){f.setBehavior(behavior);const task=await f.assign();await f.start(task.taskId);const view=await f.settled(task.taskId);expect(view.runs[0].status).toBe('completed');expect(view.task.status).toBe('blocked');expect(view.task.result).toBeUndefined()}
    expect((await f.store.read()).outbox.filter(m=>m.kind==='result')).toEqual([]);
  }finally{await f.cleanup()}
});

it('同一成员只有一个运行槽，新增派发不覆盖 working；停止后异常通道不可盲目续接',async()=>{
  const f=await setup();try{
    f.setBehavior('hold');const first=await f.assign();await f.start(first.taskId);await until(()=>f.members.inspect(f.input(first.taskId)),v=>v.task.status==='running');
    const second=await f.assign();expect((await f.store.read()).members.find(m=>m.agentId===f.team.input.agentId)?.activity).toBe('working');
    await expect(f.start(second.taskId)).rejects.toMatchObject({code:'MEMBER_BUSY'});
    await f.members.stop(f.input(first.taskId));expect((await f.settled(first.taskId)).task.status).toBe('cancelled');
    await expect(f.start(second.taskId)).rejects.toMatchObject({code:'MEMBER_SESSION_REVIEW_REQUIRED'});
    expect(f.prepare).toHaveBeenCalledTimes(1);
  }finally{await f.cleanup()}
});

it('工作区写占用与主会话冲突，释放后只读派发可重试；默认不继承执行权限',async()=>{
  const f=await setup();try{
    const first=await f.assign(),release=f.lease.acquire('main-chat','execute');
    await expect(f.start(first.taskId)).rejects.toMatchObject({code:'WORKSPACE_EXECUTION_BUSY'});release();
    expect(f.prepare).not.toHaveBeenCalled();await f.start(first.taskId);await f.settled(first.taskId);
    expect((await f.store.read()).runs![0].permission).toBe('read');
  }finally{await f.cleanup()}
});

it.each([
  ['knowledge','batch'],['model','batch'],['knowledge','owner'],['model','owner'],
] as const)('准入后 %s 准备尚未完成时 %s 失效，不落领取或创建模型',async(stage,cause)=>{
  const f=await setup(),admission=new GlobalRunAdmission();let currentOwner=true,currentBatch=true,unblock=()=>{};
  try{
    await f.dispatch.openScope(f.identity,'pending-scope');const assigned=await f.assign('cbim:executor',[],'pending-scope');
    const wait:ExecutionAdmissionWait|undefined=cause==='batch'?{scopeId:'pending-scope',isCurrent:()=>currentBatch,onReady:()=>{},registerWithdraw:()=>{}}:undefined;
    f.ports.isCurrent=()=>currentOwner;
    f.ports.acquire=(key,permission,agentInstanceId,context)=>acquireExecutionLease(f.lease,key,{workspaceId:f.entry.id,rootSessionId:f.identity.rootSessionId,taskId:assigned.taskId,scopeId:'pending-scope',agentInstanceId,requestId:admissionRequestId('member',context!.commandId),source:wait?'member':'direct',workspacePermission:permission},{manager:admission,ownerEpoch:1,isCurrent:()=>currentOwner},wait);
    let entered!:()=>void;const began=new Promise<void>(resolve=>{entered=resolve}),gate=new Promise<void>(resolve=>{unblock=resolve});
    const create=vi.fn<Awaited<ReturnType<MemberExecutionPorts['prepare']>>['create']>();
    if(stage==='knowledge'){
      const snapshot=f.workspace.snapshot.bind(f.workspace);
      vi.spyOn(f.workspace,'snapshot').mockImplementationOnce(async()=>{const value=await snapshot();entered();await gate;return value});
    }else{
      f.prepare.mockImplementationOnce(async()=>{entered();await gate;return {model,create}});
    }
    const pending=f.members.start({...f.input(assigned.taskId),commandId:'start-pending',expectedRevision:1,options:{permission:'read'}},wait);void pending.catch(()=>{});
    await began;expect(admission.snapshot().occupied).toHaveLength(1);
    if(cause==='batch')currentBatch=false;else{currentOwner=false;admission.retireOwner(f.entry.id,1)}
    unblock();await expect(pending).rejects.toMatchObject({code:'COLLABORATION_STOPPED'});
    const state=await f.store.read(),node=state.graphs[0].tasks.find(task=>task.taskId===assigned.taskId)!;
    expect(node.runIds).toEqual([]);expect(node.activeRunId).toBeUndefined();expect(state.runs??[]).toEqual([]);
    expect(state.outbox.find(item=>item.taskId===assigned.taskId)).toMatchObject({delivery:'pending'});
    expect(create).not.toHaveBeenCalled();expect(f.contexts).toEqual([]);
    if(stage==='knowledge')expect(f.prepare).not.toHaveBeenCalled();
    expect(admission.snapshot().occupied).toEqual([]);expect(f.lease.canAcquire('new-task','execute')).toBeUndefined();
  }finally{unblock();await f.cleanup()}
});

it('手动成员停止在模型解析期间建立屏障，不等待领取事务结束才停止',async()=>{
  const f=await setup();let unblock=()=>{};try{
    const assigned=await f.assign();let entered!:()=>void;
    const began=new Promise<void>(resolve=>{entered=resolve}),gate=new Promise<void>(resolve=>{unblock=resolve});
    const create=vi.fn<Awaited<ReturnType<MemberExecutionPorts['prepare']>>['create']>();
    f.prepare.mockImplementationOnce(async()=>{entered();await gate;return {model,create}});
    const pending=f.start(assigned.taskId);void pending.catch(()=>{});await began;
    await expect(f.members.stop({...f.input(assigned.taskId),rootSessionId:'other-root'})).rejects.toMatchObject({code:'TASK_NOT_FOUND'});
    expect(await f.members.stop(f.input(assigned.taskId))).toEqual({requested:true});
    unblock();await expect(pending).rejects.toMatchObject({code:'COLLABORATION_STOPPED'});
    const view=await f.members.inspect(f.input(assigned.taskId));expect(view.task.runIds).toEqual([]);expect(view.runs).toEqual([]);
    expect(create).not.toHaveBeenCalled();expect(f.contexts).toEqual([]);expect(f.lease.canAcquire('next','execute')).toBeUndefined();
  }finally{unblock();await f.cleanup()}
});

it.each(['stop','owner'] as const)('已领取但原生尚未登记active时%s中断仍阻止新模型请求',async(cause)=>{
  const f=await setup(),ownerController=new AbortController();let unblock=()=>{};try{
    f.ports.signal=ownerController.signal;
    let entered!:()=>void;const began=new Promise<void>(resolve=>{entered=resolve}),gate=new Promise<void>(resolve=>{unblock=resolve});
    f.setRuntimeGate(async()=>{entered();await gate});
    const assigned=await f.assign(),receipt=await f.start(assigned.taskId);await began;
    // 此时 startMember 仍在 await acquireLease，Runtime.active 中尚无句柄。
    if(cause==='stop')await f.members.stop(f.input(assigned.taskId));else ownerController.abort(Error('workspace retired'));
    unblock();await f.members.waitForSettlement(f.input(assigned.taskId));
    const view=await f.members.inspect(f.input(assigned.taskId));expect(view.task.runIds).toEqual([receipt.runId]);
    expect(['cancelled','interrupted']).toContain(view.runs[0].status);expect(view.task.activeRunId).toBeUndefined();
    expect(f.contexts).toEqual([]);expect(f.lease.canAcquire('next','execute')).toBeUndefined();
  }finally{unblock();await f.cleanup()}
});

it('主实例禁止执行业务，默认执行者按任务独立创建并在周期结束后释放',async()=>{
  const f=await setup();try{
    await expect(f.assign('cbim:main')).rejects.toMatchObject({code:'AGENT_NOT_EXECUTABLE'});
    await f.dispatch.openScope(f.identity,'cycle-one');
    const root=(await f.dispatch.snapshot(f.identity)).root.agent,first=await f.assign('cbim:executor',[],'cycle-one'),second=await f.assign('cbim:executor',[],'cycle-one');
    const firstTask=(await f.members.inspect(f.input(first.taskId))).task,secondTask=(await f.members.inspect(f.input(second.taskId))).task;
    expect(firstTask.assignee.agentInstanceId).not.toBe(root.agentInstanceId);expect(secondTask.assignee.agentInstanceId).not.toBe(firstTask.assignee.agentInstanceId);
    f.setBehavior('hold');await f.start(first.taskId);await until(()=>f.members.inspect(f.input(first.taskId)),view=>view.task.status==='running');
    await expect(f.dispatch.closeScope(f.identity,'cycle-one','completed')).rejects.toMatchObject({code:'DISPATCH_SCOPE_BUSY'});
    await f.members.stop(f.input(first.taskId));await f.settled(first.taskId);await f.members.waitForSettlement(f.input(first.taskId));
    await f.dispatch.closeScope(f.identity,'cycle-one','cancelled');
    const state=await f.store.read();expect(state.members.find(m=>m.agentInstanceId===firstTask.assignee.agentInstanceId)?.lifecycle).toBe('released');
    expect(state.members.find(m=>m.agentInstanceId===root.agentInstanceId)?.lifecycle).not.toBe('released');
    await expect(f.start(second.taskId)).rejects.toMatchObject({code:'MEMBER_RELEASED'});expect(f.prepare).toHaveBeenCalledTimes(1);
  }finally{await f.cleanup()}
});

it('依赖任务等待候选而非回合结束，启动时固定实际消费的 resultId',async()=>{
  const f=await setup();try{
    const first=await f.assign(),second=await f.assign('cbim:executor',[{taskId:first.taskId,expectedPlanRevision:1}]);
    await expect(f.start(second.taskId)).rejects.toMatchObject({code:'TASK_DEPENDENCY_PENDING'});
    await f.start(first.taskId);const done=await f.settled(first.taskId);
    await f.start(second.taskId);await f.settled(second.taskId);
    const graph=await f.dispatch.snapshot(f.identity),edge=graph.edges.find(e=>e.kind==='dependency');
    expect(edge).toMatchObject({condition:{resultId:done.task.result!.resultId}});
  }finally{await f.cleanup()}
});

it('领取前知识变化拒绝启动且没有半次占用，恢复 starting/running 不调用模型并防止旧回调覆盖',async()=>{
  const f=await setup();try{
    f.setBehavior('hold');const first=await f.assign();await f.start(first.taskId);await until(()=>f.members.inspect(f.input(first.taskId)),v=>v.task.status==='running');
    const backup=path.join(f.temp,'crash-snapshot');await fs.mkdir(backup);await fs.copyFile(path.join(f.directory,'dispatch.jsonl'),path.join(backup,'dispatch.jsonl'));
    await f.members.stop(f.input(first.taskId));await f.settled(first.taskId);
    const restoredStore=new FileDispatchStore(backup,f.entry.id),restored=new MemberExecutionManager(f.workspace,restoredStore,f.ports),calls=f.prepare.mock.calls.length;
    try{
      await restored.initialize();const recovered=await restored.inspect(f.input(first.taskId));expect(recovered.task.status).toBe('interrupted');expect(f.prepare).toHaveBeenCalledTimes(calls);
      const state=await restoredStore.read();expect(state.members.find(m=>m.agentId===f.team.input.agentId)?.leaseEpoch).toBe(2);expect(state.outbox[0]).toMatchObject({delivery:'processed',claim:{runId:recovered.runs[0].binding.runId}});
    }finally{await restored.close();await restoredStore.close()}
    const second=await f.assign('cbim:executor'),snapshot=await f.workspace.snapshot(),file=snapshot.files.find(x=>x.path.endsWith('/module.md'))!;
    await f.workspace.commit(request(snapshot,[{path:file.path,text:file.text+'\n知识已变化\n'}]));
    await expect(f.start(second.taskId)).rejects.toMatchObject({code:'KNOWLEDGE_CHANGED'});
    expect((await f.members.inspect(f.input(second.taskId))).runs).toEqual([]);
  }finally{await f.cleanup()}
});
