import {registerServiceOwner} from './owner-service-fixture';
import {it,expect,vi} from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {fixture} from './helpers';
import {request} from './data/knowledge';
import {seedTeam} from './team-fixture';
import {json} from '../src/backend/core/foundation/serialization';
import {recoveryRequestSchema,recoveryReceiptSchema,type RecoveryRequest} from '../src/backend/core/tasks/scope-recovery';
import {FileDispatchStore} from '../src/backend/main/dispatch-storage/dispatch-store';
import {FileRunStorage} from '../src/backend/main/run-storage/run-storage';
import {RunJournal} from '../src/backend/main/run-storage/run-journal';
import {WorkspaceDispatchService} from '../src/backend/scheduler-engine/dispatch/dispatch-service';
import {MemberExecutionManager,type MemberExecutionPorts} from '../src/backend/scheduler-engine/members/member-execution';
import {WorkspaceExecutionLease} from '../src/backend/scheduler-engine/admission/workspace-lease';
import {LoopRuntime} from '../src/backend/core/execution/runtime/runtime';
import type {EngineContext,TaskSpec} from '../src/backend/core/execution/types';

async function setup(withRun=true){
  const f=await fixture(),entry=await f.app.dispatch('add',{path:f.a}),workspace=f.app.workspace(entry.id),team=await seedTeam(workspace),snapshot=await workspace.snapshot();
  const moduleId=team.input.moduleId,definition=JSON.parse(snapshot.files.find(x=>x.path===moduleId+'/module.json')!.text);
  definition.maintenance={bindingId:'maintain',maintainerPersonIds:['owner'],revision:1,state:'active',confirmation:{recordId:'review',source:'local_user',confirmedAt:'2026-11-06T00:00:00.000Z'}};
  await workspace.commit(request(snapshot,[{path:'.cbim/team/people.json',text:json({people:[{id:'owner',name:'维护人',team:'.cbim/team'}]})},{path:moduleId+'/module.json',text:json(definition)}]));
  const {model}=await registerServiceOwner(f.app,workspace,'.cbim/team/dev',[moduleId]);
  const store=workspace.dispatchStore,directory=store.directory,storage=new FileRunStorage(),lease=new WorkspaceExecutionLease(),identity={workspaceId:entry.id,rootSessionId:'main-root'};
  const mainJournals=new Map<string,RunJournal>(),inspect=vi.fn(async(run:Parameters<MemberExecutionPorts['inspect']>[0])=>storage.read(path.join(directory,'runs',run.binding.taskId,run.binding.runId)));
  const service=new WorkspaceDispatchService(workspace,store,{inspectMain:async(_root,id)=>RunJournal.read(mainJournals.get(id)!.directory),inspectMember:inspect},undefined,undefined,f.app.models);
  await service.openGraph({...identity,commandId:'open'});await service.openScope(identity,'source',{message:'读取实际状态并报告'},'old-main-run');
  const ownerSelection=(await service.owners.discover([moduleId])).groups[0].selection!;
  const prepare=vi.fn<()=>Awaited<ReturnType<MemberExecutionPorts['prepare']>>>(()=>({model,create:async(_run,_task,hooks)=>{
    let context:EngineContext;
    return new LoopRuntime({storage,directory:path.join(directory,'runs'),acquireLease:async()=>()=>{},onEngineReady:hooks.onEngineReady,onEvent:hooks.onEvent,toolPolicy:async()=>({allow:true,effects:['read']}),createEngine:()=>({kind:'fixture',start:async value=>{context=value;await context.emit({type:'session.bound',data:{sessionId:context.nativeSessionId,sessionFile:path.join(directory,context.nativeSessionId+'.jsonl')}})},run:async()=>({status:'failed'}),stop:async()=>{},close:async()=>{}})});
  }}));
  const members=new MemberExecutionManager(workspace,store,{prepare:async()=>prepare(),owners:service.owners,withEngineConfiguration:(reference,_options,use)=>f.app.models.withRuntimeConfiguration(reference,configuration=>use({model:configuration.profile,prepare})),inspect,acquire:(key,permission,agent)=>lease.acquire(key,permission,agent)});await members.initialize();
  let count=0;
  const assign=(scopeId:string)=>service.dispatchTask({...identity,commandId:'dispatch-'+(++count),expectedParentRevision:1,task:{assigneeAgentId:'.cbim/team/dev',moduleIds:[moduleId],ownerSelection,goal:'读取实际状态并报告',acceptance:[{id:'fact',text:'核实当前状态'}],prerequisites:[]}},scopeId);
  await service.goals.plan(identity,'source','old-main-run','source-plan',{expectedRevision:1,objective:'读取实际状态并报告',constraints:[],criteria:[{id:'fact',text:'核实当前状态',kind:'evidence'}],assignments:[{agentId:'.cbim/team/dev',moduleIds:[moduleId],ownerSelection,criterionIds:['fact'],reason:'明确负责岗位'}],reason:'保存实际业务来源计划'});
  const assigned=await assign('source');let runId:string|undefined;
  const start=(taskId:string,permission:'read'|'ask'|'execute'='read')=>members.start({...identity,taskId,commandId:'start-'+randomUUID(),expectedRevision:1,options:{permission}});
  if(withRun){const run=await start(assigned.taskId);runId=run.runId;await members.waitForSettlement({...identity,taskId:assigned.taskId})}
  await service.closeScope(identity,'source','failed');
  const report=await members.report({...identity,taskId:assigned.taskId,runId});
  const input={...identity,commandId:randomUUID(),source:{scopeId:'source',taskId:assigned.taskId,...(runId?{runId}:{}),reportBasis:report.basis.key},operation:'inspect_effects',observation:{text:'  已看到文件可能被修改\n请核实'},input:{message:'只读取当前产物，核实是否存在改动'},options:{profileId:randomUUID(),provider:'fixture',model:'fixture',permission:'read'}} satisfies RecoveryRequest;
  const launch=()=>({runId:randomUUID(),nativeSessionId:randomUUID(),excludedRunIds:['old-main-run']});
  const plan=async(scopeId:string,runId:string)=>service.goals.plan(identity,scopeId,runId,'plan-'+randomUUID(),{expectedRevision:1,objective:'核实当前产物',constraints:['只读'],criteria:[{id:'fact',text:'核实当前状态',kind:'evidence'}],assignments:[{agentId:'.cbim/team/dev',moduleIds:[moduleId],ownerSelection,criterionIds:['fact'],reason:'读取产物'}],reason:'只读核实，不重放旧执行'});
  return {...f,entry,workspace,identity,directory,store,storage,service,members,inspect,prepare,input,launch,report,assign,start,plan,mainJournals,cleanup:async()=>{await members.close();await service.close();await f.cleanup()}};
}

it('核实受理只创建新只读周期；同命令并发及重启仅返回原意图，旧图和历史不变',async()=>{
  const f=await setup();try{
    const before=await f.store.read(),slower=f.launch(),native=f.launch(),prepared=f.prepare.mock.calls.length;
    // 取证在短事务外，并发调用允许后发先提交；只有实际赢得原命令的上下文取得 fresh。
    let release!:()=>void,entered!:()=>void;
    const held=new Promise<void>(resolve=>{release=resolve}),started=new Promise<void>(resolve=>{entered=resolve}),inspect=f.inspect.getMockImplementation()!;
    f.inspect.mockImplementationOnce(async run=>{entered();await held;return inspect(run)});
    const first=f.service.recoveries.accept(f.input,slower);await started;
    let second:Awaited<typeof first>;
    try{second=await f.service.recoveries.accept(f.input,native)}finally{release()}
    const accepted=[await first,second];
    expect(accepted.map(item=>item.fresh)).toEqual([false,true]);expect(accepted[0].scope).toEqual(accepted[1].scope);
    const state=await f.store.read();expect(state.graphs).toEqual(before.graphs);expect(state.scopes![0]).toEqual(before.scopes![0]);expect(state.runs).toEqual(before.runs);expect(state.members).toEqual(before.members);
    expect(accepted[0].scope).toMatchObject({scopeId:f.input.commandId,status:'active',goal:{revision:1,input:{message:f.input.input.message,attachmentIds:[]}},recovery:{observation:f.input.observation,context:{initialRunId:native.runId}}});
    const publicView=await f.service.sessionRead({identity:f.identity,selectedScopeId:f.input.commandId});expect(publicView.scopes.mode).toBe('reset');if(publicView.scopes.mode==='reset')expect(publicView.scopes.snapshot.scopes.at(-1)?.readOnly).toBe(true);expect(JSON.stringify(publicView)).not.toMatch(/excludedRunIds|nativeSessionId/);
    const looked=await f.service.recoveries.inspect({...f.identity,commandId:f.input.commandId});expect(recoveryReceiptSchema.safeParse(looked).success).toBe(true);expect(looked?.recovery.runId).toBe(native.runId);expect(JSON.stringify(looked)).not.toMatch(/nativeSessionId|excludedRunIds/);expect(f.prepare).toHaveBeenCalledTimes(prepared);
    const file=path.join(f.directory,'dispatch.jsonl'),bytes=await fs.readFile(file),reader=new FileDispatchStore(f.directory,f.entry.id);
    try{const next=new WorkspaceDispatchService(f.workspace,reader);expect(await next.recoveries.latestContext(f.identity)).toEqual(accepted[0].recovery.context);expect(await next.recoveries.priorRunIds(f.identity)).toEqual([native.runId,'old-main-run'].sort());expect(await next.recoveries.inspect({...f.identity,commandId:f.input.commandId})).toEqual(looked);expect((await next.recoveries.accept(f.input,f.launch())).fresh).toBe(false)}finally{await reader.close()}
    expect(await fs.readFile(file)).toEqual(bytes);await expect(f.service.recoveries.accept({...f.input,input:{message:'改参'}},f.launch())).rejects.toMatchObject({code:'COMMAND_ID_CONFLICT'});
  }finally{await f.cleanup()}
});

it('严格输入、跨身份、来源运行选择和活动槽在提交前拒绝，不能修改旧周期',async()=>{
  const f=await setup();try{
    const cases:[unknown,string][]=[
      [{...f.input,runId:'untrusted'},'RECOVERY_INPUT_INVALID'],[{...f.input,options:{...f.input.options,permission:'execute'}},'RECOVERY_INPUT_INVALID'],
      [{...f.input,rootSessionId:'other'},'RECOVERY_IDENTITY'],[{...f.input,source:{...f.input.source,runId:undefined}},'RECOVERY_RUN_REQUIRED'],
      [{...f.input,source:{...f.input.source,runId:'foreign'}},'RECOVERY_RUN_REQUIRED'],[{...f.input,source:{...f.input.source,taskId:'foreign'}},'RECOVERY_SOURCE_INVALID'],
      [{...f.input,source:{...f.input.source,scopeId:'foreign'}},'RECOVERY_SOURCE_NOT_CLOSED'],[{...f.input,source:{...f.input.source,reportBasis:'f'.repeat(64)}},'RECOVERY_REPORT_STALE'],
    ];
    const before=await f.store.read();for(const [input,code]of cases)await expect(f.service.recoveries.accept(input as RecoveryRequest,f.launch())).rejects.toMatchObject({code});expect(await f.store.read()).toEqual(before);
    await f.service.openScope(f.identity,'busy');await expect(f.service.recoveries.accept(f.input,f.launch())).rejects.toMatchObject({code:'RECOVERY_BUSY'});
    expect(recoveryRequestSchema.safeParse({...f.input,observation:{text:' '}}).success).toBe(false);
  }finally{await f.cleanup()}
});

it('日志丢失后的新报告保持unknown并能新建核实；旧报告变更拒绝，未登记运行可省略runId',async()=>{
  const f=await setup();try{
    f.inspect.mockRejectedValue(Object.assign(Error('private damaged log'),{code:'RUN_LOG_INVALID'}));
    await expect(f.service.recoveries.accept(f.input,f.launch())).rejects.toMatchObject({code:'RECOVERY_REPORT_STALE'});
    const next=await f.members.report({...f.identity,taskId:f.report.identity.taskId,runId:f.input.source.runId});expect(next.execution).toBe('unknown');
    const accepted=await f.service.recoveries.accept({...f.input,source:{...f.input.source,reportBasis:next.basis.key}},f.launch());expect(accepted.recovery.source).toMatchObject({reportExecution:'unknown',logState:'invalid'});
  }finally{await f.cleanup()}
  const noRun=await setup(false);try{expect(noRun.input.source.runId).toBeUndefined();expect((await noRun.service.recoveries.accept(noRun.input,noRun.launch())).fresh).toBe(true)}finally{await noRun.cleanup()}
});

it('新成员保持read，直接启动与持久运行篡改都不能提权；主实例仍保持原身份',async()=>{
  const f=await setup();try{
    const before=await f.service.snapshot(f.identity),accepted=await f.service.recoveries.accept(f.input,f.launch());await f.plan(accepted.scope.scopeId,accepted.recovery.context.initialRunId);
    const assigned=await f.assign(accepted.scope.scopeId),prepares=f.prepare.mock.calls.length;
    for(const permission of ['ask','execute'] as const)await expect(f.start(assigned.taskId,permission)).rejects.toMatchObject({code:'RECOVERY_READONLY'});expect(f.prepare).toHaveBeenCalledTimes(prepares);
    const started=await f.start(assigned.taskId);await f.members.waitForSettlement({...f.identity,taskId:assigned.taskId});
    const state=await f.store.read(),run=state.runs!.find(item=>item.binding.runId===started.runId)!;expect(run.permission).toBe('read');expect((await f.service.snapshot(f.identity)).root.agent).toEqual(before.root.agent);expect(run.binding.agentInstanceId).not.toBe(state.runs![0].binding.agentInstanceId);
    await expect(f.store.transact({commandId:'tamper-permission',fingerprint:'tamper-permission'},async()=>({runs:[{...run,permission:'execute'}],receipt:{ok:true}}))).rejects.toMatchObject({code:'GRAPH_INPUT_INVALID'});
    await expect(f.store.transact({commandId:'tamper-recovery',fingerprint:'tamper-recovery'},async()=>({scopes:[{...accepted.scope,recovery:{...accepted.recovery,observation:{text:'伪造观察'}}}],receipt:{ok:true}}))).rejects.toMatchObject({code:'GRAPH_INPUT_INVALID'});
  }finally{await f.cleanup()}
});

it('无日志受理意图仍冻结在下一上下文；按持久插入顺序选择最后核实，不复活旧closed',async()=>{
  const f=await setup(false);try{
    const original=await f.service.snapshot(f.identity),first=await f.service.recoveries.accept(f.input,f.launch());
    await f.plan(first.scope.scopeId,first.recovery.context.initialRunId);await f.assign(first.scope.scopeId);await f.service.closeScope(f.identity,first.scope.scopeId,'interrupted');
    const frozen=await f.service.recoveries.accept(f.input,f.launch());expect(frozen.fresh).toBe(false);expect(frozen.scope.outcome).toBe('interrupted');expect(f.prepare).not.toHaveBeenCalled();
    await expect(f.service.recoveries.accept({...f.input,commandId:randomUUID()},{...f.launch(),excludedRunIds:await f.service.recoveries.priorRunIds(f.identity)})).rejects.toMatchObject({code:'RECOVERY_REPORT_STALE'});
    const report=await f.members.report({...f.identity,taskId:f.input.source.taskId}),input={...f.input,commandId:randomUUID(),source:{...f.input.source,reportBasis:report.basis.key}};
    await expect(f.service.recoveries.accept(input,f.launch())).rejects.toMatchObject({code:'RECOVERY_CONTEXT_CONFLICT'});
    const launch={...f.launch(),excludedRunIds:await f.service.recoveries.priorRunIds(f.identity)},second=await f.service.recoveries.accept(input,launch);
    expect(await f.service.recoveries.latestContext(f.identity)).toEqual(second.recovery.context);expect((await f.store.read()).scopes![1].outcome).toBe('interrupted');
    expect(second.scope.scopeId).not.toBe(first.scope.scopeId);expect(second.recovery.context.nativeSessionId).not.toBe(first.recovery.context.nativeSessionId);expect(second.recovery.context.excludedRunIds).toContain(first.recovery.context.initialRunId);
    const graph=await f.service.snapshot(f.identity);expect(graph.root.agent).toEqual(original.root.agent);expect(graph.tasks.find(task=>task.taskId===f.report.identity.taskId)).toEqual(original.tasks.find(task=>task.taskId===f.report.identity.taskId));
    expect((await f.service.recoveries.accept(f.input,f.launch())).scope.outcome).toBe('interrupted');
    // Recovery may append, so replay an exact committed-byte copy instead of opening a second writer beside the live workspace Store.
    const restoredDirectory=path.join(f.temp,'recovery-journal-copy');await fs.mkdir(restoredDirectory);await fs.copyFile(path.join(f.directory,'dispatch.jsonl'),path.join(restoredDirectory,'dispatch.jsonl'));
    const reader=new FileDispatchStore(restoredDirectory,f.entry.id);try{const recovered=new WorkspaceDispatchService(f.workspace,reader);await recovered.recoverScopes();expect((await recovered.recoveries.inspect({...f.identity,commandId:input.commandId}))?.scopeStatus).toBe('closed');expect(await recovered.recoveries.latestContext(f.identity)).toEqual(second.recovery.context)}finally{await reader.close()}
    expect(await f.service.recoveries.latestContext({...f.identity,rootSessionId:'legacy-without-graph'})).toBeUndefined();expect(await f.service.recoveries.priorRunIds({...f.identity,rootSessionId:'legacy-without-graph'})).toEqual([]);
  }finally{await f.cleanup()}
});

it('只读核实等待后补充仍不能升权，同意正文不能签发人工验收',async()=>{
  const f=await setup(false);try{
    const accepted=await f.service.recoveries.accept(f.input,f.launch()),scopeId=accepted.scope.scopeId,runId=randomUUID();
    await f.service.registerMainRun(f.identity,scopeId,runId);
    const task:TaskSpec={mode:'chat',taskId:f.identity.rootSessionId,workspaceId:f.entry.id,root:f.a,goal:f.input.input.message,agentId:'cbim:main',moduleIds:[],acceptance:[]},binding=await f.service.conversationBinding(task),journal=new RunJournal(path.join(f.directory,'main',runId),task,runId);await journal.init();await journal.append({type:'run.started',data:{task,message:f.input.input.message,conversationBinding:binding}});f.mainJournals.set(runId,journal);
    await f.service.goals.plan(f.identity,scopeId,runId,'human-plan',{expectedRevision:1,objective:'核实需要人工提供的现状',constraints:[],criteria:[{id:'human',text:'人工核实实际现状',kind:'human'}],assignments:[{agentId:'cbim:main',moduleIds:[],criterionIds:['human'],reason:'等待观察'}],reason:'等待人工信息'});
    await f.service.goals.review(f.identity,scopeId,runId,'wait-review',{expectedRevision:2,decision:'awaiting_user',checks:[{criterionId:'human',outcome:'needs_human',reason:'需补充',evidence:[]}],superseded:[],gaps:['需补充'],reason:'需真实信息'});await journal.append({type:'run.settled',data:{status:'completed'}});
    const summary=await RunJournal.read(journal.directory);await expect(f.service.parkScope(f.identity,scopeId,summary,[runId])).rejects.toMatchObject({code:'GRAPH_INPUT_INVALID'});
    const wait=await f.service.parkScope(f.identity,scopeId,summary,[accepted.recovery.context.initialRunId,runId]),input={...f.identity,scopeId,waitId:wait.wait!.waitId,expectedGoalRevision:wait.goal!.revision,expectedInputRevision:1,commandId:randomUUID(),input:{message:'同意，仍要核实'},options:{...f.input.options,permission:'execute' as const}};
    expect(wait.wait!.mainRunIds).toContain(accepted.recovery.context.initialRunId);
    await expect(f.service.continuations.accept(input,randomUUID())).rejects.toMatchObject({code:'RECOVERY_READONLY'});
    const continued=await f.service.continuations.accept({...input,options:{...input.options,permission:'read'}},randomUUID());expect(continued.scope.goal!.review).toBeUndefined();expect(continued.scope.goal!.plan!.criteria[0].kind).toBe('human');expect(continued.continuation.options.permission).toBe('read');
  }finally{await f.cleanup()}
});

it('受理落盘后读取失败仍能按原命令查询，不签发第二次fresh或抹掉启动意图',async()=>{
  const f=await setup(false);try{
    const launch=f.launch(),read=vi.spyOn(f.store,'read'),transact=f.store.transact.bind(f.store);
    vi.spyOn(f.store,'transact').mockImplementationOnce(async(...args)=>{const receipt=await transact(...args);read.mockRejectedValueOnce(Error('read failure after commit'));return receipt});
    await expect(f.service.recoveries.accept(f.input,launch)).rejects.toThrow('read failure after commit');
    const looked=await f.service.recoveries.inspect({...f.identity,commandId:f.input.commandId});expect(looked?.recovery.runId).toBe(launch.runId);
    const repeated=await f.service.recoveries.accept(f.input,f.launch());expect(repeated.fresh).toBe(false);expect(repeated.recovery.context).toEqual({initialRunId:launch.runId,nativeSessionId:launch.nativeSessionId,excludedRunIds:launch.excludedRunIds});
    expect((await f.store.read()).scopes).toHaveLength(2);expect(f.prepare).not.toHaveBeenCalled();
  }finally{await f.cleanup()}
});

it('canonical 核实不占 Store 事务，停止或取证后新的周期让 CAS 拒绝',async()=>{
  for(const change of ['stop','scope'] as const){const f=await setup();try{
    const controller=new AbortController(),inspect=f.inspect.getMockImplementation()!;
    f.inspect.mockImplementationOnce(async run=>{await f.store.read();const result=await inspect(run);if(change==='stop')controller.abort(Error('stopped before acceptance'));else await f.service.openScope(f.identity,'concurrent-cycle');return result});
    const launch={...f.launch(),signal:controller.signal};
    if(change==='stop')await expect(f.service.recoveries.accept(f.input,launch)).rejects.toThrow('stopped before acceptance');
    else await expect(f.service.recoveries.accept(f.input,launch)).rejects.toMatchObject({code:'RECOVERY_REPORT_STALE'});
    expect(await f.service.recoveries.inspect({...f.identity,commandId:f.input.commandId})).toBeUndefined();
  }finally{await f.cleanup()}}
});
