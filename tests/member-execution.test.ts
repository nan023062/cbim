import {runtimeToolGroup} from './runtime-tool-group';
import {expect,it,vi} from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fixture} from './helpers';
import {request} from './data/knowledge';
import {seedTeam} from './team-fixture';
import {json} from '../src/core/platform/node/serialization';
import {FileDispatchStore} from '../src/logic/dispatch/storage/dispatch-store';
import {FileRunStorage} from '../src/logic/execution/storage/run-storage';
import {RunJournal} from '../src/logic/execution/storage/run-journal';
import {WorkspaceDispatchService} from '../src/logic/dispatch/runtime/dispatch-service';
import {MemberExecutionManager} from '../src/logic/team/runtime/member-execution';
import {WorkspaceExecutionLease} from '../src/logic/execution/admission/workspace-lease';
import {LoopRuntime} from '../src/logic/execution/rules/runtime/runtime';
import type {AgentEngine,EngineContext} from '../src/logic/execution/rules/types';
import type {MemberExecutionPorts} from '../src/logic/team/runtime/member-execution';
import {GlobalRunAdmission} from '../src/logic/execution/admission/run-admission';
import {admissionRequestId,acquireExecutionLease} from '../src/logic/application/assembly/execution-admission';
import type {ExecutionAdmissionWait} from '../src/logic/execution/admission/admission-wait';
import {registerServiceOwner} from './owner-service-fixture';
import {memberFailureStopReason} from '../src/logic/dispatch/runtime/member-failure-limit';

async function until<T>(get:()=>Promise<T>,ready:(value:T)=>boolean){for(let i=0;i<500;i++){const value=await get();if(ready(value))return value;await new Promise(r=>setTimeout(r,10))}throw Error('timed out')}
async function setup(useBuiltin=false){
  const f=await fixture();
  const entry=await f.app.dispatch('add',{path:f.a}),workspace=f.app.workspace(entry.id),team=await seedTeam(workspace),snapshot=await workspace.snapshot();
  const moduleId=team.input.moduleId,definition=JSON.parse(snapshot.files.find(x=>x.path===moduleId+'/module.json')!.text);
  definition.maintenance={bindingId:'maintain',maintainerPersonIds:['owner'],revision:1,state:'active',confirmation:{recordId:'review',source:'local_user',confirmedAt:'2026-11-06T00:00:00.000Z'}};
  await workspace.commit(request(snapshot,[{path:'.cbim/team/people.json',text:json({people:[{id:'owner',name:'维护人',team:'.cbim/team'}]})},{path:moduleId+'/module.json',text:json(definition)}]));
  // 登记、责任、派发与领取共用真实工作区账本；受控引擎只隔离执行，不补造岗位许可。
  const agentId=team.input.agentId,{model}=await registerServiceOwner(f.app,workspace,agentId,[moduleId]);
  const store=workspace.dispatchStore,directory=store.directory,storage=new FileRunStorage(),lease=new WorkspaceExecutionLease();
  let mainJournal:RunJournal;
  const dispatch=new WorkspaceDispatchService(workspace,store,{inspectMain:()=>RunJournal.read(mainJournal.directory),inspectMember:run=>storage.read(path.join(directory,'runs','tasks',run.binding.taskId,run.binding.runId))},undefined,undefined,f.app.engineModels),identity={workspaceId:entry.id,rootSessionId:'session-1'},scopeId='member-scope';
  await dispatch.openScope(identity,scopeId,{message:'核实派发产物'},'main-one');
  const mainTask={mode:'chat' as const,taskId:identity.rootSessionId,workspaceId:entry.id,root:f.a,goal:'核实派发产物',moduleIds:[],agentId:'cbim:main',acceptance:[]};
  mainJournal=new RunJournal(path.join(f.user,'review-main'),mainTask,'main-one');await mainJournal.init();
  await mainJournal.append({type:'run.started',data:{task:mainTask,conversationBinding:await dispatch.conversationBinding(mainTask)}});
  const ownerSelection=(await dispatch.owners.discover([moduleId])).groups[0].selection!;
  await dispatch.goals.plan(identity,scopeId,'main-one','goal-plan',{expectedRevision:1,objective:'核实派发产物',constraints:[],criteria:[{id:'verified',text:'提供真实工具证据',kind:'evidence'}],assignments:[{agentId,moduleIds:[moduleId],ownerSelection,criterionIds:['verified'],reason:'负责岗位'}],reason:'明确业务分配'});
  let behavior:'candidate'|'text'|'hold'|'rewrite'|'interrupted'|'failed'='candidate',release=()=>{},count=0;
  let beforeRuntimeLease:()=>Promise<void>=async()=>{};
  const contexts:EngineContext[]=[];
  const prepare=vi.fn<()=>Awaited<ReturnType<MemberExecutionPorts['prepare']>>>(()=>({model,create:async(run,_task,hooks)=>{
    let context!:EngineContext;
    const engine:AgentEngine={kind:'controlled-test',start:async value=>{context=value;contexts.push(context);await context.emit({type:'session.bound',data:{sessionId:context.nativeSessionId,sessionFile:context.sessionFile??path.join(directory,'native-'+context.nativeSessionId+'.jsonl')}})},
      run:async()=>{
        expect((await store.read()).runs!.find(r=>r.binding.runId===run.binding.runId)?.status).toBe('running');
        if(behavior==='hold')return new Promise(resolve=>{release=()=>resolve({status:'cancelled'})});
        if(behavior==='text')return {status:'completed'};
        if(behavior==='interrupted')throw Error('Pi 连续 30 分钟无执行进展，已中断；请核实未确认的操作与产物。');
        if(behavior==='failed')return {status:'failed',error:'Pi 事件超过大小限制'};
        const invoke=async(name:string,input:Record<string,unknown>)=>{
          const id='tool-'+(++count),decision=await context.beforeTool({id,name,input});
          if(!decision.allow)throw Error('unexpected denial');
          const result=name==='read'?{content:[{type:'text',text:'verified artifact'}]}:await runtimeToolGroup(context,'task-progress')!.call(name,input);
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
  const ports:MemberExecutionPorts={acquire:(key,permission,agentInstanceId)=>lease.acquire(key,permission,agentInstanceId),prepare:async()=>prepare(),owners:dispatch.owners,withEngineConfiguration:(reference,_options,use)=>f.app.engineModels.withRuntimeConfiguration(reference,configuration=>use({model:configuration.profile,prepare})),inspect:run=>storage.read(path.join(directory,'runs','tasks',run.binding.taskId,run.binding.runId))};
  const members=new MemberExecutionManager(workspace,store,ports);await members.initialize();
  let command=0;
  const assign=(assigneeAgentId=agentId,prerequisites:{taskId:string;expectedPlanRevision:number}[]=[])=>dispatch.dispatchTask({...identity,commandId:'dispatch-'+(++command),expectedParentRevision:1,task:{assigneeAgentId,moduleIds:[moduleId],ownerSelection,goal:'核验已派发的产物',acceptance:[{id:'verified',text:'提供真实工具证据'}],prerequisites}},scopeId);
  const input=(taskId:string)=>({...identity,taskId});
  const start=(taskId:string,permission:'read'|'ask'|'execute'='read')=>members.start({...input(taskId),commandId:'start-'+taskId,expectedRevision:1,options:{permission}});
  const settled=(taskId:string)=>until(()=>members.inspect(input(taskId)),view=>!!view.runs.length&&!['starting','running'].includes(view.runs.at(-1)!.status));
  return {...f,workspace,entry,team,agentId,scopeId,directory,store,storage,dispatch,members,ports,prepare,identity,assign,input,start,settled,contexts,lease,setRuntimeGate:(gate:()=>Promise<void>)=>{beforeRuntimeLease=gate},setBehavior:(value:typeof behavior)=>{behavior=value},cleanup:async()=>{release();await members.close();await dispatch.close();await f.cleanup()}};
}

it('整话题补充保存后拒绝新领取和派发，原成员任务不被删除',async()=>{
  const f=await setup();try{
    const assigned=await f.assign();
    await f.dispatch.interruptions.prepare({...f.identity,scopeId:f.scopeId,expectedInputRevision:1,commandId:crypto.randomUUID(),input:{message:'等待重新分析'},options:{provider:'fixture',model:'fixture',profileId:crypto.randomUUID(),permission:'read'}});
    await expect(f.start(assigned.taskId)).rejects.toMatchObject({code:'TOPIC_PAUSING'});
    await expect(f.assign()).rejects.toMatchObject({code:'TOPIC_PAUSING'});
    expect(f.prepare).not.toHaveBeenCalled();expect((await f.store.read()).runs??[]).toEqual([]);
    expect((await f.dispatch.snapshot(f.identity)).tasks).toHaveLength(1);
  }finally{await f.cleanup()}
});

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
    expect(f.contexts[1].nativeSessionId).not.toBe(f.contexts[0].nativeSessionId);expect(f.contexts[1].task.ownerBinding).toEqual(f.contexts[0].task.ownerBinding);
    const state=await f.store.read(),second=state.runs!.find(run=>run.binding.taskId===next.taskId)!;
    expect(second.topicContext).toMatchObject({scopeId:f.scopeId,rootSessionId:f.identity.rootSessionId,agentId:f.agentId,priorTasks:[{taskId:assigned.taskId,resultId:view.task.result!.resultId}]});
    expect(JSON.stringify(view)).not.toContain('topicContext');
  }finally{await f.cleanup()}
});

it('同办公室同角色的两个任务串行，等待不创建运行，前项可靠结算后可继续',async()=>{
  const f=await setup();try{
    f.setBehavior('hold');const first=await f.assign(),second=await f.assign();
    await f.start(first.taskId);
    await until(()=>f.members.inspect(f.input(first.taskId)),view=>view.runs[0]?.status==='running');
    const before=(await f.store.read()).runs!.length;
    await expect(f.start(second.taskId)).rejects.toMatchObject({code:'TEAM_SESSION_BUSY'});
    expect((await f.store.read()).runs).toHaveLength(before);expect(f.prepare).toHaveBeenCalledTimes(1);
    await f.members.stop(f.input(first.taskId));await f.members.waitForSettlement(f.input(first.taskId));
    f.setBehavior('candidate');await f.start(second.taskId);expect((await f.settled(second.taskId)).task.status).toBe('result_ready');
    expect((await f.store.read()).teamSessions!.filter(session=>session.agentId===f.agentId)).toHaveLength(1);
  }finally{await f.cleanup()}
});

it('模型只有正文或改写了派发目标时，完成回合保留 completed 但任务 blocked',async()=>{
  const f=await setup();try{
    for(const behavior of ['text','rewrite'] as const){f.setBehavior(behavior);const task=await f.assign();await f.start(task.taskId);const view=await f.settled(task.taskId);expect(view.runs[0].status).toBe('completed');expect(view.task.status).toBe('blocked');expect(view.task.result).toBeUndefined()}
    expect((await f.store.read()).outbox.filter(m=>m.kind==='result')).toEqual([]);
  }finally{await f.cleanup()}
});
it.each(['interrupted','failed'] as const)('成员%s从真实运行终态保存具体原因，任务图和详情一致且不生成交付',async status=>{
  const f=await setup();try{
    f.setBehavior(status);const assigned=await f.assign();await f.start(assigned.taskId);const view=await f.settled(assigned.taskId);
    expect(view.task.status).toBe(status);expect(view.task.result).toBeUndefined();
    expect(view.task.waitReason).toContain(status==='interrupted'?'30 分钟无执行进展':'Pi 事件超过大小限制');
    expect(view.runs[0].error).toBe(view.task.waitReason);
    const graph=await f.dispatch.snapshot(f.identity);expect(graph.tasks.find(task=>task.taskId===assigned.taskId)?.waitReason).toBe(view.task.waitReason);
    expect((await f.store.read()).outbox.filter(message=>message.kind==='result')).toEqual([]);
  }finally{await f.cleanup()}
});
it('三次真实成员异常落盘后额度与目标阻塞在重开存储中保留，恢复不再次执行',async()=>{
  const f=await setup();let restoredStore:FileDispatchStore|undefined,restored:WorkspaceDispatchService|undefined;
  try{
    for(const behavior of ['interrupted','failed','interrupted'] as const){
      f.setBehavior(behavior);const assigned=await f.assign();await f.start(assigned.taskId);await f.members.waitForSettlement(f.input(assigned.taskId));
    }
    const reason=memberFailureStopReason(await f.dispatch.snapshot(f.identity),f.scopeId)!;
    expect(reason).toContain('累计 3 次');
    await f.dispatch.goals.block(f.identity,f.scopeId,reason);
    const backup=path.join(f.user,'failure-limit-reopen');await fs.cp(f.directory,backup,{recursive:true});
    restoredStore=new FileDispatchStore(backup,f.entry.id);restored=new WorkspaceDispatchService(f.workspace,restoredStore);
    expect(memberFailureStopReason(await restored.snapshot(f.identity),f.scopeId)).toBe(reason);
    await restored.recoverScopes();await restored.recoverScopes();
    const view=await restoredStore.sessionRead({identity:f.identity,selectedScopeId:f.scopeId});
    expect(view.detail).toMatchObject({mode:'updated',scope:{status:'closed',goal:{blocked:{reason}}}});
    expect(f.prepare).toHaveBeenCalledTimes(3);
    expect((await restored.snapshot(f.identity)).tasks.every(task=>['failed','interrupted'].includes(task.status))).toBe(true);
  }finally{await restored?.close();await restoredStore?.close();await f.cleanup()}
});
it('隔离资源未确认收尾时成员保留工作区占用，再次close只封存原运行',async()=>{
 const f=await setup();let blocked=true;const close=LoopRuntime.prototype.close,mock=vi.spyOn(LoopRuntime.prototype,'close').mockImplementation(async function(this:LoopRuntime){if(blocked)throw Object.assign(Error('original isolation pending'),{code:'EXECUTION_SCOPE_DRAIN_PENDING'});return close.call(this)});
 try{f.setBehavior('text');const task=await f.assign();await f.start(task.taskId,'execute');await until(()=>f.members.inspect(f.input(task.taskId)),v=>v.task.status==='running');await expect(f.members.close()).rejects.toMatchObject({code:'EXECUTION_SCOPE_DRAIN_PENDING'});expect(f.lease.canAcquire('other','execute')).toBe('workspace_conflict');expect((await f.store.read()).graphs[0].tasks.find(t=>t.taskId===task.taskId)?.result).toBeUndefined();blocked=false;await f.members.close();expect(f.lease.canAcquire('other','execute')).toBeUndefined();expect((await f.store.read()).runs!.find(r=>r.binding.taskId===task.taskId)?.status).toBe('interrupted');expect(f.prepare).toHaveBeenCalledTimes(1)}finally{blocked=false;mock.mockRestore();await f.cleanup()}
});

it('同任务不能重复领取；同岗位新任务独立实例，不借停止后的异常原生通道',async()=>{
  const f=await setup();try{
    f.setBehavior('hold');const first=await f.assign();await f.start(first.taskId);await until(()=>f.members.inspect(f.input(first.taskId)),v=>v.task.status==='running');
    const original=(await f.members.inspect(f.input(first.taskId))).task,second=await f.assign(),next=(await f.members.inspect(f.input(second.taskId))).task;
    expect(next.assignee.agentInstanceId).not.toBe(original.assignee.agentInstanceId);
    expect((await f.store.read()).members.find(m=>m.agentInstanceId===original.assignee.agentInstanceId)?.activity).toBe('working');
    await expect(f.members.start({...f.input(first.taskId),commandId:'duplicate-active',expectedRevision:original.revision,options:{permission:'read'}})).rejects.toMatchObject({code:'TASK_NOT_STARTABLE'});
    await f.members.stop(f.input(first.taskId));expect((await f.settled(first.taskId)).task.status).toBe('cancelled');
    f.setBehavior('candidate');await f.start(second.taskId);expect((await f.settled(second.taskId)).task.status).toBe('result_ready');
    expect(f.contexts[1].nativeSessionId).not.toBe(f.contexts[0].nativeSessionId);expect(f.prepare).toHaveBeenCalledTimes(2);
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
] as const)('%s 知识或配置短锁尚未放行时 %s 失效，不占准入或创建模型',async(stage,cause)=>{
  const f=await setup(),admission=new GlobalRunAdmission();let currentOwner=true,currentBatch=true,unblock=()=>{};
  try{
    const assigned=await f.assign();
    const wait:ExecutionAdmissionWait|undefined=cause==='batch'?{scopeId:f.scopeId,isCurrent:()=>currentBatch,onReady:()=>{},registerWithdraw:()=>{}}:undefined;
    f.ports.isCurrent=()=>currentOwner;
    f.ports.acquire=(key,permission,agentInstanceId,context)=>acquireExecutionLease(f.lease,key,{workspaceId:f.entry.id,rootSessionId:f.identity.rootSessionId,taskId:assigned.taskId,scopeId:f.scopeId,agentInstanceId,requestId:admissionRequestId('member',context!.commandId),source:wait?'member':'direct',workspacePermission:permission},{manager:admission,ownerEpoch:1,isCurrent:()=>currentOwner},wait);
    let entered!:()=>void;const began=new Promise<void>(resolve=>{entered=resolve}),gate=new Promise<void>(resolve=>{unblock=resolve});
    if(stage==='knowledge'){
      const source=f.workspace.withSourceSnapshot.bind(f.workspace);
      vi.spyOn(f.workspace,'withSourceSnapshot').mockImplementation(operation=>source(async snapshot=>{entered();await gate;return operation(snapshot)}));
    }else{
      const configuration=f.ports.withEngineConfiguration!;
      f.ports.withEngineConfiguration=(reference,options,use)=>configuration(reference,options,async locked=>{entered();await gate;return use(locked)});
    }
    const pending=f.members.start({...f.input(assigned.taskId),commandId:'start-pending',expectedRevision:1,options:{permission:'read'}},wait);void pending.catch(()=>{});
    await began;expect(admission.snapshot().occupied).toHaveLength(0);
    if(cause==='batch')currentBatch=false;else{currentOwner=false;admission.retireOwner(f.entry.id,1)}
    unblock();await expect(pending).rejects.toMatchObject({code:'COLLABORATION_STOPPED'});
    const state=await f.store.read(),node=state.graphs[0].tasks.find(task=>task.taskId===assigned.taskId)!;
    expect(node.runIds).toEqual([]);expect(node.activeRunId).toBeUndefined();expect(state.runs??[]).toEqual([]);
    expect(state.outbox.find(item=>item.taskId===assigned.taskId)).toMatchObject({delivery:'pending'});
    expect(f.prepare).not.toHaveBeenCalled();expect(f.contexts).toEqual([]);
    expect(admission.snapshot().occupied).toEqual([]);expect(f.lease.canAcquire('new-task','execute')).toBeUndefined();
  }finally{unblock();await f.cleanup()}
});

it('手动成员停止在模型解析期间建立屏障，不等待领取事务结束才停止',async()=>{
  const f=await setup();let unblock=()=>{};try{
    const assigned=await f.assign();let entered!:()=>void;
    const began=new Promise<void>(resolve=>{entered=resolve}),gate=new Promise<void>(resolve=>{unblock=resolve});
    const configuration=f.ports.withEngineConfiguration!;
    f.ports.withEngineConfiguration=(reference,options,use)=>configuration(reference,options,async locked=>{entered();await gate;return use(locked)});
    const pending=f.start(assigned.taskId);void pending.catch(()=>{});await began;
    await expect(f.members.stop({...f.input(assigned.taskId),rootSessionId:'other-root'})).rejects.toMatchObject({code:'TASK_NOT_FOUND'});
    expect(await f.members.stop(f.input(assigned.taskId))).toEqual({requested:true});
    unblock();await expect(pending).rejects.toMatchObject({code:'COLLABORATION_STOPPED'});
    const view=await f.members.inspect(f.input(assigned.taskId));expect(view.task.runIds).toEqual([]);expect(view.runs).toEqual([]);
    expect(f.prepare).not.toHaveBeenCalled();expect(f.contexts).toEqual([]);expect(f.lease.canAcquire('next','execute')).toBeUndefined();
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

it('主实例不创建独立成员，已登记自定义执行岗位按任务独立创建并在周期结束后释放',async()=>{
  const f=await setup(true);try{
    await expect(f.assign('cbim:main')).rejects.toMatchObject({code:'AGENT_NOT_EXECUTABLE'});
    const root=(await f.dispatch.snapshot(f.identity)).root.agent,first=await f.assign(),second=await f.assign();
    const firstTask=(await f.members.inspect(f.input(first.taskId))).task,secondTask=(await f.members.inspect(f.input(second.taskId))).task;
    expect(firstTask.assignee.agentInstanceId).not.toBe(root.agentInstanceId);expect(secondTask.assignee.agentInstanceId).not.toBe(firstTask.assignee.agentInstanceId);
    f.setBehavior('hold');await f.start(first.taskId);await until(()=>f.members.inspect(f.input(first.taskId)),view=>view.task.status==='running');
    await expect(f.dispatch.closeScope(f.identity,f.scopeId,'completed')).rejects.toMatchObject({code:'GOAL_REVIEW_REQUIRED'});
    await expect(f.dispatch.closeScope(f.identity,f.scopeId,'cancelled')).rejects.toMatchObject({code:'DISPATCH_SCOPE_BUSY'});
    await f.members.stop(f.input(first.taskId));await f.settled(first.taskId);await f.members.waitForSettlement(f.input(first.taskId));
    await f.dispatch.closeScope(f.identity,f.scopeId,'cancelled');
    const state=await f.store.read();expect(state.members.find(m=>m.agentInstanceId===firstTask.assignee.agentInstanceId)?.lifecycle).toBe('released');
    expect(state.members.find(m=>m.agentInstanceId===root.agentInstanceId)?.lifecycle).not.toBe('released');
    await expect(f.start(second.taskId)).rejects.toMatchObject({code:'MEMBER_RELEASED'});expect(f.prepare).toHaveBeenCalledTimes(1);
  }finally{await f.cleanup()}
});

it.each(['accept','reject'] as const)('依赖任务等待精确候选审阅通过：%s，并固定实际消费的 resultId',async decision=>{
  const f=await setup();try{
    const first=await f.assign(),second=await f.assign(f.agentId,[{taskId:first.taskId,expectedPlanRevision:1}]);
    await expect(f.start(second.taskId)).rejects.toMatchObject({code:'TASK_DEPENDENCY_PENDING'});
    await f.start(first.taskId);const done=await f.settled(first.taskId);
    await expect(f.start(second.taskId)).rejects.toMatchObject({code:'TASK_DEPENDENCY_PENDING'});
    const input={taskId:first.taskId,expectedRevision:done.task.revision,resultId:done.task.result!.resultId,decision,reason:'已核对原运行工具证据与限制'};
    await expect(f.dispatch.goals.reviewCandidate(f.identity,f.scopeId,'main-one','candidate-review-wrong',{...input,resultId:'wrong'},()=>{})).rejects.toMatchObject({code:'CANDIDATE_REVIEW_STALE'});
    await expect(f.dispatch.goals.reviewCandidate(f.identity,f.scopeId,'other-main','candidate-review-other',input,()=>{})).rejects.toMatchObject({code:'GOAL_EVIDENCE_IDENTITY'});
    const reviewed=await f.dispatch.goals.reviewCandidate(f.identity,f.scopeId,'main-one','candidate-review-accept',input,()=>{});
    expect(reviewed.candidateReview).toMatchObject({decision,resultId:input.resultId,mainRunId:'main-one'});
    expect(await f.dispatch.goals.reviewCandidate(f.identity,f.scopeId,'main-one','candidate-review-accept',input,()=>{})).toEqual(reviewed);
    await expect(f.dispatch.goals.reviewCandidate(f.identity,f.scopeId,'main-one','candidate-review-rewrite',{...input,expectedRevision:reviewed.revision,decision:'reject'},()=>{})).rejects.toMatchObject({code:'CANDIDATE_REVIEW_STALE'});
    const backup=path.join(f.temp,'review-snapshot');await fs.mkdir(backup);await fs.copyFile(path.join(f.directory,'dispatch.jsonl'),path.join(backup,'dispatch.jsonl'));
    const reopened=new FileDispatchStore(backup,f.entry.id);
    try{expect((await reopened.read()).graphs[0].tasks.find(t=>t.taskId===first.taskId)?.candidateReview).toEqual(reviewed.candidateReview)}finally{await reopened.close()}
    if(decision==='reject'){
      await expect(f.start(second.taskId)).rejects.toMatchObject({code:'TASK_DEPENDENCY_PENDING'});
      await expect(f.dispatch.goals.review(f.identity,f.scopeId,'main-one','reject-final',{expectedRevision:2,decision:'complete',checks:[{criterionId:'verified',outcome:'satisfied',reason:'企图引用被拒候选',evidence:[{kind:'member-result',taskId:first.taskId,runId:done.task.result!.runId,resultId:input.resultId,planRevision:1,toolCallIds:done.task.result!.evidenceRefs}]}],superseded:[],gaps:[],reason:'不得成功'})).rejects.toMatchObject({code:'GOAL_EVIDENCE_INVALID'});
      const saved=(await f.store.read()).graphs[0].tasks.find(t=>t.taskId===first.taskId)!;
      expect(saved.candidateReview).toEqual(reviewed.candidateReview);expect(f.prepare).toHaveBeenCalledTimes(1);return;
    }
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
      const state=await restoredStore.read();expect(state.members.find(m=>m.agentInstanceId===recovered.task.assignee.agentInstanceId)?.leaseEpoch).toBe(2);expect(state.outbox.find(message=>message.kind==='assignment'&&message.taskId===first.taskId)).toMatchObject({delivery:'processed',claim:{runId:recovered.runs[0].binding.runId}});
    }finally{await restored.close();await restoredStore.close()}
    const second=await f.assign(),snapshot=await f.workspace.snapshot(),file=snapshot.files.find(x=>x.path.endsWith('/module.md'))!;
    await f.workspace.commit(request(snapshot,[{path:file.path,text:file.text+'\n知识已变化\n'}]));
    await expect(f.start(second.taskId)).rejects.toMatchObject({code:'KNOWLEDGE_CHANGED'});
    expect((await f.members.inspect(f.input(second.taskId))).runs).toEqual([]);
  }finally{await f.cleanup()}
});
