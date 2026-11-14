import {it,expect,vi} from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fixture} from './helpers';
import {request} from './data/knowledge';
import {seedTeam} from './team-fixture';
import {json} from '../src/core/platform/node/serialization';
import {cancelQueuedTasksInputSchema} from '../src/logic/tasks/rules/queued-task-cancel';
import {queuedCancellationSelection} from '../src/logic/tasks/rules/queued-task-cancel-rules';
import {FileDispatchStore} from '../src/logic/dispatch/storage/dispatch-store';
import {FileRunStorage} from '../src/logic/execution/storage/run-storage';
import {RunJournal} from '../src/logic/execution/storage/run-journal';
import {WorkspaceDispatchService} from '../src/logic/dispatch/runtime/dispatch-service';
import {MemberExecutionManager,type PreparedEngine} from '../src/logic/team/runtime/member-execution';
import {registerFixtureOwner} from './owner-execution-fixture';
import {LoopRuntime} from '../src/logic/execution/rules/runtime/runtime';
import type {TaskSpec} from '../src/logic/execution/rules/types';
import type {DispatchMutation} from '../src/logic/dispatch/rules/dispatch-storage';

async function setup(){
  const f=await fixture(),entry=await f.app.dispatch('add',{path:f.a}),owner=f.app.workspace(entry.id),team=await seedTeam(owner),snapshot=await owner.snapshot(),moduleId=team.input.moduleId;
  const definition=JSON.parse(snapshot.files.find(item=>item.path===moduleId+'/module.json')!.text);definition.maintenance={bindingId:'maintain',maintainerPersonIds:['owner'],revision:1,state:'active',confirmation:{recordId:'review',source:'local_user',confirmedAt:'2026-11-06T00:00:00.000Z'}};
  await owner.commit(request(snapshot,[{path:'.cbim/team/people.json',text:json({people:[{id:'owner',name:'维护人',team:'.cbim/team'}]})},{path:moduleId+'/module.json',text:json(definition)}]));
  const saved=await f.app.models.save({profile:{name:'撤销竞争执行岗位',api:'openai-completions',baseUrl:'https://example.test/v1',auth:'none',defaultModel:'fixture',models:[{id:'fixture',name:'fixture',enabled:true,contextWindow:200000,maxTokens:1000,reasoning:false,vision:false}]}}),profileId=saved.profiles.find(item=>item.name==='撤销竞争执行岗位')!.id;
  await registerFixtureOwner(f.app,entry.id,{agentId:'.cbim/team/dev',moduleIds:[moduleId],profileId,modelId:'fixture',name:'撤销竞争岗位',adaptation:{instructions:'只处理分配模块的明确任务。',references:[]}});
  const store=owner.dispatchStore,directory=store.directory,model=await f.app.engineModels.configuration(profileId,'fixture'),storage=new FileRunStorage(),identity={workspaceId:entry.id,rootSessionId:'main-root'},scopeId='cycle',runId='main-run';
  let journal:RunJournal;const service=new WorkspaceDispatchService(owner,store,{inspectMain:()=>RunJournal.read(journal.directory),inspectMember:run=>storage.read(path.join(directory,'runs',run.binding.taskId,run.binding.runId))},undefined,undefined,f.app.engineModels);
  const task:TaskSpec={mode:'chat',taskId:identity.rootSessionId,workspaceId:entry.id,root:f.a,goal:'完成目标',agentId:'cbim:main',moduleIds:[],acceptance:[]},binding=await service.conversationBinding(task);
  await service.openScope(identity,scopeId,{message:'完成明确业务目标'});journal=new RunJournal(path.join(directory,'main'),task,runId);await journal.init();await journal.append({type:'run.started',data:{task,conversationBinding:binding}});
  const ownerSelection=(await service.owners.discover([moduleId])).groups[0].selection!;
  const plan={expectedRevision:1,objective:'完成明确业务目标',constraints:[],criteria:[{id:'artifact',text:'真实产物',kind:'evidence' as const}],assignments:[{agentId:'.cbim/team/dev',moduleIds:[moduleId],ownerSelection,criterionIds:['artifact'],reason:'按模块执行'}],reason:'按图派发'};
  await service.goals.plan(identity,scopeId,runId,'goal-plan',plan);let count=0;
  const assign=(prerequisites:string[]=[])=>service.dispatchTask({...identity,commandId:'assign-'+(++count),expectedParentRevision:1,task:{assigneeAgentId:'.cbim/team/dev',moduleIds:[moduleId],ownerSelection,goal:'工作'+count,acceptance:[{id:'artifact',text:'真实产物'}],prerequisites:prerequisites.map(taskId=>({taskId,expectedPlanRevision:1}))}},scopeId);
  const a=await assign(),b=await assign([a.taskId]),c=await assign([b.taskId]);
  const input=async(ids=[b.taskId,c.taskId])=>{const graph=await service.snapshot(identity);return {expectedGraphCursor:{streamId:graph.cursor.streamId,seq:graph.cursor.seq},targets:ids.map(taskId=>({taskId,expectedRevision:graph.tasks.find(task=>task.taskId===taskId)!.revision})),reason:'缺少上游输入，撤销未启动依赖并等待补充'}};
  const cancel=(draft:Awaited<ReturnType<typeof input>>,commandId='cancel-one')=>service.cancelQueued(identity,scopeId,runId,commandId,draft);
  return {...f,entry,owner,directory,store,storage,model,identity,scopeId,runId,service,journal,plan,a,b,c,assign,input,cancel,cleanup:async()=>{await service.close();await f.cleanup()}};
}

it('B→C必须显式完整撤销，节点/信封/待办原子提交，幂等与重放不启动或改写历史',async()=>{
  const f=await setup();try{
    const before=await f.store.read(),bytes=await fs.readFile(path.join(f.directory,'dispatch.jsonl')),partial=await f.input([f.b.taskId]);
    const preview=await f.service.goals.previewClosure(f.identity,f.scopeId,partial);
    expect(preview).toMatchObject({readOnly:true,requiresConfirmation:true,issues:[],affectedTaskIds:[f.b.taskId,f.c.taskId],retainedTaskIds:[f.a.taskId]});
    expect(preview.cancel).toEqual(await f.input());expect(await f.store.read()).toEqual(before);
    const stale=await f.service.goals.previewClosure(f.identity,f.scopeId,{...partial,expectedGraphCursor:{...partial.expectedGraphCursor,seq:0}});
    expect(stale.cancel).toBeUndefined();expect(stale.issues[0].code).toBe('CANCEL_GRAPH_STALE');
    await expect(f.cancel(partial)).rejects.toMatchObject({code:'CANCEL_DEPENDENTS_REQUIRED',message:expect.stringContaining(f.c.taskId)});expect(await fs.readFile(path.join(f.directory,'dispatch.jsonl'))).toEqual(bytes);
    const draft=await f.input(),receipt=await f.cancel(draft);expect(receipt.cancelledTaskIds).toEqual([f.b.taskId,f.c.taskId]);expect(receipt.graphCursor.seq).toBe(draft.expectedGraphCursor.seq+1);
    const state=await f.store.read(),tasks=state.graphs[0].tasks.filter(task=>receipt.cancelledTaskIds.includes(task.taskId));
    for(const task of tasks){expect(task).toMatchObject({status:'cancelled',revision:2,planRevision:1,runIds:[],cancelledBeforeStart:{commandId:'cancel-one',scopeId:f.scopeId,mainRunId:f.runId,reason:draft.reason,previousRevision:1,graphCursor:draft.expectedGraphCursor}});expect(task.updatedAt).toBe(task.cancelledBeforeStart!.cancelledAt);expect(state.outbox.find(item=>item.taskId===task.taskId)).toMatchObject({delivery:'processed'});expect(state.members.find(item=>item.agentInstanceId===task.assignee.agentInstanceId)).toMatchObject({activity:'idle',lifecycle:'active',waitingTaskIds:[],communicatingMessageIds:[]})}
    expect(state.graphs[0].tasks[0]).toEqual(before.graphs[0].tasks[0]);expect(state.graphs[0].edges).toEqual(before.graphs[0].edges);expect(state.runs).toEqual([]);expect(state.scopes).toEqual(before.scopes);
    const saved=await fs.readFile(path.join(f.directory,'dispatch.jsonl'));expect(await f.cancel(draft)).toEqual(receipt);expect(await fs.readFile(path.join(f.directory,'dispatch.jsonl'))).toEqual(saved);
    await expect(f.cancel({...draft,reason:'改参'})).rejects.toMatchObject({code:'COMMAND_ID_CONFLICT'});
    await f.service.closeScope(f.identity,f.scopeId,'cancelled');expect(await f.cancel(draft)).toEqual(receipt);expect((await f.store.read()).graphs[0].tasks.filter(task=>receipt.cancelledTaskIds.includes(task.taskId))).toEqual(tasks);
    const restored=new FileDispatchStore(f.directory,f.entry.id);try{expect(await restored.read()).toEqual(await f.store.read())}finally{await restored.close()}
  }finally{await f.cleanup()}
});

it('严格输入、图版本、任务版本、跨身份和历史终态整体拒绝且不产生取消记录',async()=>{
  const f=await setup();try{
    const draft=await f.input(),before=await fs.readFile(path.join(f.directory,'dispatch.jsonl'));
    for(const invalid of [{...draft,runId:'forged'},{...draft,targets:[draft.targets[0],draft.targets[0]]},{...draft,targets:[{taskId:'../other',expectedRevision:1}]},{...draft,expectedGraphCursor:{...draft.expectedGraphCursor,rootSessionId:'foreign'}},{...draft,targets:[]}])expect(cancelQueuedTasksInputSchema.safeParse(invalid).success).toBe(false);
    await expect(f.cancel({...draft,expectedGraphCursor:{...draft.expectedGraphCursor,seq:draft.expectedGraphCursor.seq-1}})).rejects.toMatchObject({code:'CANCEL_GRAPH_STALE'});
    await expect(f.cancel({...draft,targets:draft.targets.map(target=>({...target,expectedRevision:2}))})).rejects.toMatchObject({code:'CANCEL_TASK_STALE'});
    await expect(f.service.cancelQueued({...f.identity,rootSessionId:'foreign'},f.scopeId,f.runId,'foreign-root',draft)).rejects.toMatchObject({code:'DISPATCH_SCOPE_IDENTITY'});
    await expect(f.service.cancelQueued(f.identity,'foreign-scope',f.runId,'foreign-scope',draft)).rejects.toMatchObject({code:'DISPATCH_SCOPE_IDENTITY'});
    expect(await fs.readFile(path.join(f.directory,'dispatch.jsonl'))).toEqual(before);
    await f.cancel(draft);await expect(f.cancel(await f.input(),'second-cancel')).rejects.toMatchObject({code:'CANCEL_NOT_ALLOWED'});
    await f.service.closeScope(f.identity,f.scopeId,'cancelled');await expect(f.cancel(await f.input([f.a.taskId]),'closed')).rejects.toMatchObject({code:'DISPATCH_SCOPE_CLOSED'});
  }finally{await f.cleanup()}
});

it('依赖闭包穿过已撤销节点检查后继，已领取/候选/求助/跨周期事实不能漏判',async()=>{
  const f=await setup();try{
    const draft=await f.input([f.a.taskId,f.b.taskId,f.c.taskId]),state=await f.store.read();
    const cases=[(s:typeof state)=>{s.graphs[0].tasks[2].runIds=['old-run']},(s:typeof state)=>{s.graphs[0].tasks[2].scopeId='other-scope'},(s:typeof state)=>{s.outbox.find(item=>item.taskId===f.c.taskId)!.claim={runId:'claimed',leaseEpoch:1}},(s:typeof state)=>{s.graphs[0].tasks[1].status='blocked'}];
    for(const mutate of cases){const changed=structuredClone(state);mutate(changed);expect(()=>queuedCancellationSelection(changed,f.identity,f.scopeId,draft)).toThrowError(expect.objectContaining({code:'CANCEL_NOT_ALLOWED'}))}
    await f.cancel(await f.input([f.c.taskId]),'cancel-tail');const oldC=(await f.store.read()).graphs[0].tasks[2];await f.cancel(await f.input([f.b.taskId]),'cancel-middle');expect((await f.store.read()).graphs[0].tasks[2]).toEqual(oldC);
    const later=await f.assign([f.c.taskId]);await expect(f.cancel(await f.input([f.a.taskId]),'cancel-head-only')).rejects.toMatchObject({code:'CANCEL_DEPENDENTS_REQUIRED',message:expect.stringContaining(later.taskId)});
    await f.cancel(await f.input([f.a.taskId,later.taskId]),'cancel-head-and-new-tail');expect((await f.store.read()).graphs[0].tasks.every(task=>task.status==='cancelled')).toBe(true);
  }finally{await f.cleanup()}
});

it('撤销推进图基线使旧等待审阅失效；新审阅可安全等待，但撤销本身不能使目标完成',async()=>{
  const f=await setup();try{
    const review={expectedRevision:2,decision:'awaiting_user' as const,checks:[{criterionId:'artifact',outcome:'unmet' as const,reason:'缺少输入',evidence:[]}],superseded:[],gaps:['需用户补充'],reason:'等待补充'};
    const old=await f.service.goals.review(f.identity,f.scopeId,f.runId,'wait-before',review);
    await f.cancel(await f.input([f.a.taskId,f.b.taskId,f.c.taskId]));await f.journal.append({type:'run.settled',data:{status:'completed'}});const summary=await RunJournal.read(f.journal.directory);
    await expect(f.service.parkScope(f.identity,f.scopeId,summary,[f.runId])).rejects.toMatchObject({code:'GOAL_GRAPH_CHANGED'});
    await expect(f.service.goals.review(f.identity,f.scopeId,f.runId,'cannot-complete',{...review,expectedRevision:3,decision:'complete'})).rejects.toThrow();
    const fresh=await f.service.goals.review(f.identity,f.scopeId,f.runId,'wait-after',{...review,expectedRevision:3});expect(fresh.goal!.review!.graphCursor.seq).toBeGreaterThan(old.goal!.review!.graphCursor.seq);
    const waiting=await f.service.parkScope(f.identity,f.scopeId,summary,[f.runId]);expect(waiting.status).toBe('waiting');expect((await f.store.read()).members.filter(item=>item.executionScopeId===f.scopeId).every(item=>item.lifecycle==='active'&&item.activity==='idle')).toBe(true);
    await expect(f.cancel(await f.input(),'while-waiting')).rejects.toMatchObject({code:'DISPATCH_SCOPE_WAITING'});
  }finally{await f.cleanup()}
});

it('持久事务不能遗漏依赖后继、顺带改目标、伪造领取或重写已撤销任务',async()=>{
  const f=await setup();try{
    const before=await fs.readFile(path.join(f.directory,'dispatch.jsonl')),draft=await f.input();let captured:DispatchMutation|undefined;
    const original=f.store.transact.bind(f.store),spy=vi.spyOn(f.store,'transact');spy.mockImplementation((command,prepare)=>original(command,async state=>{const mutation=await prepare(state);captured=structuredClone(mutation);return mutation}));
    await f.cancel(draft);spy.mockRestore();
    for(const mode of ['omit','rewrite','claim'] as const){
      const dir=path.join(f.temp,'invalid-'+mode);await fs.mkdir(dir);await fs.writeFile(path.join(dir,'dispatch.jsonl'),before);const store=new FileDispatchStore(dir,f.entry.id);
      try{const mutation=structuredClone(captured!);
        if(mode==='omit'){mutation.batch!.changes=mutation.batch!.changes.filter(change=>change.type==='task.upserted'?change.task.taskId!==f.c.taskId:change.type==='agent.upserted'?change.agent.agentInstanceId!==captured!.members![1].agentInstanceId:true);mutation.members=mutation.members!.slice(0,1);mutation.messages=mutation.messages!.slice(0,1)}
        if(mode==='rewrite'){const change=mutation.batch!.changes.find(change=>change.type==='task.upserted')!;if(change.type==='task.upserted')change.task.goal='改写业务目标'}
        if(mode==='claim')mutation.messages![0]={...mutation.messages![0],claim:{runId:'forged-run',leaseEpoch:0}};
        await expect(store.transact({commandId:'cancel-one',fingerprint:'forged-'+mode},async()=>mutation)).rejects.toThrow();expect(await fs.readFile(path.join(dir,'dispatch.jsonl'))).toEqual(before);
      }finally{await store.close()}
    }
    const state=await f.store.read(),graph=state.graphs[0],task=graph.tasks.find(item=>item.taskId===f.b.taskId)!;
    await expect(f.store.transact({commandId:'rewrite-history',fingerprint:'rewrite'},async()=>({batch:{version:1,identity:graph.identity,streamId:graph.cursor.streamId,seq:graph.cursor.seq+1,eventId:'rewrite',commandId:'rewrite-history',cause:'task.revised',committedAt:new Date().toISOString(),changes:[{type:'task.upserted',task:{...task,revision:task.revision+1,waitReason:'改写'}}]},receipt:true}))).rejects.toMatchObject({code:'GRAPH_INPUT_INVALID'});
  }finally{await f.cleanup()}
});

it('领取与撤销竞争只有一个提交者；已登记运行绝不改称未启动撤销',async()=>{
  for(const winner of ['cancel','start'] as const){const f=await setup();let wake=()=>{},releasePrepare=()=>{};let members:MemberExecutionManager|undefined;try{
    const target=await f.assign(),draft=await f.input([target.taskId]);let preparing=()=>{};const prepareReached=new Promise<void>(resolve=>{preparing=resolve}),prepareGate=new Promise<void>(resolve=>{releasePrepare=resolve});
    // 在实际领取事务的岗位核验中暂停，保持原用例“领取先占事务、撤销随后竞争”的顺序。
    const verify=f.service.owners.verifyTask.bind(f.service.owners);vi.spyOn(f.service.owners,'verifyTask').mockImplementation(async(...args)=>{const binding=await verify(...args);preparing();if(winner==='start')await prepareGate;return binding});
    const prepare=():PreparedEngine=>({model:f.model,create:async(_run,_task,hooks)=>new LoopRuntime({storage:f.storage,directory:path.join(f.directory,'runs'),acquireLease:async()=>()=>{},onEngineReady:hooks.onEngineReady,onEvent:hooks.onEvent,toolPolicy:async()=>({allow:true}),createEngine:()=>({kind:'cancel-race',start:async context=>context.emit({type:'session.bound',data:{sessionId:context.nativeSessionId,sessionFile:path.join(f.directory,'native-'+context.nativeSessionId)}}),run:()=>new Promise(resolve=>{wake=()=>resolve({status:'cancelled'})}),stop:async()=>wake(),close:async()=>{}})})});
    members=new MemberExecutionManager(f.owner,f.store,{acquire:()=>()=>{},inspect:run=>f.storage.read(path.join(f.directory,'runs',run.binding.taskId,run.binding.runId)),owners:f.service.owners,prepare:async()=>prepare(),withEngineConfiguration:(reference,_options,use)=>f.app.engineModels.withRuntimeConfiguration(reference,configuration=>use({model:configuration.profile,prepare}))});await members.initialize();
    const start=()=>members!.start({...f.identity,taskId:target.taskId,expectedRevision:1,commandId:'start-race',options:{permission:'read'}});
    if(winner==='cancel'){await f.cancel(draft,'cancel-race');await expect(start()).rejects.toMatchObject({code:'GRAPH_REVISION_CONFLICT'});expect((await members.inspect({...f.identity,taskId:target.taskId})).runs).toEqual([])}
    else {const launched=start();await prepareReached;const cancellation=f.cancel(draft,'cancel-race');releasePrepare();await launched;await expect(cancellation).rejects.toMatchObject({code:'CANCEL_GRAPH_STALE'});const view=await members.inspect({...f.identity,taskId:target.taskId});expect(view.runs).toHaveLength(1);expect(view.task.cancelledBeforeStart).toBeUndefined();await members.stop({...f.identity,taskId:target.taskId});await members.waitForSettlement({...f.identity,taskId:target.taskId});await expect(f.cancel(await f.input([target.taskId]),'after-run')).rejects.toMatchObject({code:'CANCEL_NOT_ALLOWED'})}
  }finally{releasePrepare();wake();await members?.close();await f.cleanup()}}
});
