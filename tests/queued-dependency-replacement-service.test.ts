import {runtimeToolGroup} from './runtime-tool-group';
import {expect,it,vi} from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fixture} from './helpers';
import {request} from './data/knowledge';
import {seedTeam} from './team-fixture';
import {json} from '../src/backend/core/foundation/serialization';
import {jsonToolResult} from '../src/backend/core/tools/results';
import type {RunSummary,AgentEngine,EngineContext} from '../src/backend/core/brain/types';
import type {DispatchRun} from '../src/backend/core/tasks/dispatch-execution';
import type {ReplaceQueuedDependencyInput} from '../src/backend/core/tasks/queued-dependency-replacement';
import {FileDispatchStore} from '../src/backend/main/persistence/tasks/dispatch-store';
import {FileRunStorage} from '../src/backend/main/persistence/tasks/run-storage';
import {LoopRuntime} from '../src/backend/core/brain/runtime';
import {MemberExecutionManager,type PreparedEngine} from '../src/backend/scheduler-engine/execution/member-execution';
import {WorkspaceDispatchService} from '../src/backend/scheduler-engine/execution/dispatch-service';
import {registerServiceOwner} from './owner-service-fixture';

function deferred<T>(){let resolve!:(value:T)=>void;const promise=new Promise<T>(r=>{resolve=r});return {promise,resolve}}
async function setup(explicitWorkflow=false){
  const f=await fixture(),entry=await f.app.dispatch('add',{path:f.a}),workspace=f.app.workspace(entry.id),team=await seedTeam(workspace);
  const snapshot=await workspace.snapshot(),moduleId=team.input.moduleId,definition=JSON.parse(snapshot.files.find(file=>file.path===moduleId+'/module.json')!.text);
  definition.maintenance={bindingId:'maintain',maintainerPersonIds:['owner'],revision:1,state:'active',confirmation:{recordId:'review',source:'local_user',confirmedAt:'2026-11-06T00:00:00.000Z'}};
  await workspace.commit(request(snapshot,[{path:'.cbim/team/people.json',text:json({people:[{id:'owner',name:'维护人',team:'.cbim/team'}]})},{path:moduleId+'/module.json',text:json(definition)}]));
  const {model}=await registerServiceOwner(f.app,workspace,'.cbim/team/dev',[moduleId]);
  const store=workspace.dispatchStore,directory=store.directory,logs=path.join(f.user,'member-logs'),storage=new FileRunStorage();
  const read=(run:DispatchRun)=>storage.read(path.join(logs,run.binding.taskId,run.binding.runId));
  const inspect=vi.fn(read),service=new WorkspaceDispatchService(workspace,store,{inspectMember:inspect,inspectMain:async()=>{throw Error('replacement must not read or run main')}},undefined,undefined,f.app.models);
  const identity={workspaceId:entry.id,rootSessionId:'dependency-root'},scopeId='dependency-scope',mainRunId='main-run';
  await service.openScope(identity,scopeId,{message:'安全替换前置，保持下游身份'},mainRunId);
  const selected=explicitWorkflow?{workflowSelections:[{moduleId,workflowId:team.input.workflowId}]}:{};
  const ownerSelection=(await service.owners.discover([moduleId])).groups[0].selection!;
  await service.goals.plan(identity,scopeId,mainRunId,'plan-one',{expectedRevision:1,objective:'核实业务',constraints:[],criteria:[{id:'c1',kind:'evidence',text:'可追溯的结果'}],assignments:[{agentId:'.cbim/team/dev',moduleIds:[moduleId],ownerSelection,...selected,criterionIds:['c1'],reason:'独立执行'}],reason:'计划'});
  let failRun=true;
  const prepare=():PreparedEngine=>({model,create:async(_run,_task,hooks)=>{
      let context:EngineContext;
      const engine:AgentEngine={kind:'dependency-fixture',start:async value=>{context=value;await context.emit({type:'session.bound',data:{sessionId:context.nativeSessionId,sessionFile:path.join(logs,'native-'+context.nativeSessionId+'.jsonl')}})},stop:async()=>{},close:async()=>{},run:async()=>{
        if(failRun)return {status:'failed',error:'明确执行失败'};
        let sequence=0;
        const invoke=async(name:string,input:Record<string,unknown>)=>{
          const id='tool-'+(++sequence),decision=await context.beforeTool({id,name,input});expect(decision.allow).toBe(true);
          const result=name==='read'?jsonToolResult('read',{verified:true}):await runtimeToolGroup(context,'task-progress')!.call(name,input);
          await context.emit({type:'tool.finished',data:{id,name,result,isError:false}});return id;
        };
        await invoke('cbim_task_plan',{expectedVersion:0,goal:context.task.goal,acceptance:context.task.acceptance,reason:'核验目标',steps:[{id:'verify',title:'验证',owner:'当前成员'}]});
        const evidence=await invoke('read',{path:'src/app.ts'});
        await invoke('cbim_task_step',{expectedVersion:1,id:'verify',state:'reported_done',evidenceIds:[evidence]});
        await invoke('cbim_delivery_prepare',{expectedVersion:2,summary:'已验证结果',limitations:[]});return {status:'completed'};
      }};
      return new LoopRuntime({storage,directory:logs,createEngine:()=>engine,acquireLease:async()=>()=>{},onEngineReady:hooks.onEngineReady,onEvent:hooks.onEvent,toolPolicy:async call=>({allow:true,effects:[call.name==='read'?'read':'maintenance'],scope:{kind:'workspace',workspaceId:entry.id}})});
    }});
  const members=new MemberExecutionManager(workspace,store,{acquire:()=>()=>{},inspect:read,prepare:async()=>prepare(),owners:service.owners,withEngineConfiguration:(reference,_options,use)=>f.app.models.withRuntimeConfiguration(reference,configuration=>use({model:configuration.profile,prepare}))});await members.initialize();
  const assign=async(commandId:string,prerequisites:{taskId:string;expectedPlanRevision:number}[]=[])=>service.dispatchTask({...identity,commandId,expectedParentRevision:1,task:{assigneeAgentId:'.cbim/team/dev',moduleIds:[moduleId],ownerSelection,...selected,goal:commandId,acceptance:[{id:'c1',text:'真实证据'}],prerequisites}},scopeId);
  const execute=async(taskId:string)=>{await members.start({...identity,taskId,commandId:'start-'+taskId,expectedRevision:1,options:{permission:'read'}});await members.waitForSettlement({...identity,taskId})};
  const a=await assign('A'),b=await assign('B',[{taskId:a.taskId,expectedPlanRevision:1}]),c=await assign('C',[{taskId:b.taskId,expectedPlanRevision:1}]);
  await execute(a.taskId);failRun=false;const a2=await assign('A2');await execute(a2.taskId);
  const graph=await service.snapshot(identity),source=graph.tasks.find(task=>task.taskId===a.taskId)!,target=graph.tasks.find(task=>task.taskId===b.taskId)!,replacement=graph.tasks.find(task=>task.taskId===a2.taskId)!;
  const edge=graph.edges.find(item=>item.kind==='dependency'&&item.fromNodeId===source.nodeId&&item.toNodeId===target.nodeId)!;
  const input:ReplaceQueuedDependencyInput={expectedGraphCursor:{streamId:graph.cursor.streamId,seq:graph.cursor.seq},expectedGoalRevision:2,target:{taskId:b.taskId,expectedRevision:target.revision,expectedPlanRevision:target.planRevision},replace:{edgeId:edge.edgeId,expectedRevision:edge.revision},with:{taskId:a2.taskId,expectedRevision:replacement.revision,expectedPlanRevision:replacement.planRevision,runId:replacement.result!.runId,resultId:replacement.result!.resultId},reason:'补做已经提供当前知识基线的有效结果'};
  return {...f,entry,workspace,directory,logs,store,service,identity,scopeId,mainRunId,source,target,replacement,c,graph,input,read,inspect,
    replace:(commandId='replace-one',assertCurrent?:()=>void)=>service.replaceQueuedDependency(identity,scopeId,mainRunId,commandId,input,assertCurrent),
    cleanup:async()=>{await members.close();await store.close();await f.cleanup()}};
}

it('真实日志核实后原子换边且不启动下游，同命令不回读，存储重开保留审计',async()=>{
  const f=await setup();try{
    const before=await f.store.read(),receipt=await f.replace();expect(new Set(receipt.trackedTaskIds)).toEqual(new Set([f.target.taskId,f.c.taskId]));
    const after=await f.store.read(),updated=after.graphs[0].tasks.find(task=>task.taskId===f.target.taskId)!;
    expect(updated).toMatchObject({status:'queued',planRevision:f.target.planRevision,assignee:f.target.assignee,runIds:[],dependencyReplacements:[receipt.replacement]});
    expect(after.runs).toEqual(before.runs);expect(after.outbox).toEqual(before.outbox);expect(after.sessions).toEqual(before.sessions);
    expect(after.graphs[0].tasks.find(task=>task.taskId===f.source.taskId)).toEqual(f.source);
    f.inspect.mockClear();expect(await f.replace()).toEqual(receipt);expect(f.inspect).not.toHaveBeenCalled();
    await expect(f.service.replaceQueuedDependency(f.identity,f.scopeId,f.mainRunId,'replace-one',{...f.input,reason:'改写原因'})).rejects.toMatchObject({code:'COMMAND_ID_CONFLICT'});
    const reader=new FileDispatchStore(f.directory,f.entry.id);try{expect(await reader.read()).toEqual(after)}finally{await reader.close()}
  }finally{await f.cleanup()}
});

it('换边重验待办时保留原显式Workflow选择，不降为缺省或改变后继流程',async()=>{
  const f=await setup(true);try{
    const before=await f.store.read(),receipt=await f.replace(),after=await f.store.read(),updated=after.graphs[0].tasks.find(task=>task.taskId===f.target.taskId)!;
    expect(updated.workflowSelections).toEqual(f.target.workflowSelections);expect(updated.workflowSelections).toHaveLength(1);expect(updated.modules).toEqual(f.target.modules);
    expect(after.graphs[0].tasks.find(task=>task.taskId===f.c.taskId)).toEqual(before.graphs[0].tasks.find(task=>task.taskId===f.c.taskId));expect(after.runs).toEqual(before.runs);expect(new Set(receipt.trackedTaskIds)).toEqual(new Set([f.target.taskId,f.c.taskId]));
  }finally{await f.cleanup()}
});

it('失败来源日志缺失、截断、身份篡改和未决副作用都不能作为安全替换证据',async()=>{
  const f=await setup();try{
    const before=await f.store.read(),file=path.join(f.directory,'dispatch.jsonl'),bytes=await fs.readFile(file,'utf8');
    const mutations=[(s:RunSummary)=>{s.logIntegrity=undefined},(s:RunSummary)=>{s.logIntegrity={partialTail:true}},(s:RunSummary)=>{s.events[0].data.memberBinding={...s.memberBinding,agentInstanceId:'foreign'}},(s:RunSummary)=>{s.unresolvedTools=['unsettled-write']}];
    for(const mutate of mutations){f.inspect.mockImplementation(async run=>{const summary=await f.read(run);if(run.binding.taskId===f.source.taskId)mutate(summary);return summary});await expect(f.replace()).rejects.toMatchObject({code:'GOAL_EVIDENCE_INVALID'});expect(await f.store.read()).toEqual(before)}
    f.inspect.mockImplementation(async run=>{if(run.binding.taskId===f.source.taskId)throw Object.assign(Error('missing log'),{code:'ENOENT'});return f.read(run)});
    await expect(f.replace()).rejects.toMatchObject({code:'ENOENT'});expect(await fs.readFile(file,'utf8')).toBe(bytes);
    f.inspect.mockImplementation(async run=>{const summary=await f.read(run);if(run.binding.taskId===f.replacement.taskId)summary.toolReceipts![0].outcome='unknown';return summary});
    await expect(f.replace()).rejects.toMatchObject({code:'GOAL_EVIDENCE_INVALID'});expect(await f.store.read()).toEqual(before);
    for(const mutate of [(s:RunSummary)=>{s.task.goal='别的目标'},(s:RunSummary)=>{s.task.moduleIds=[]},(s:RunSummary)=>{s.task.acceptance=['伪造验收']},(s:RunSummary)=>{s.task.mode='chat'},(s:RunSummary)=>{s.sessionFile='foreign-native.jsonl'},(s:RunSummary)=>{s.events.find(event=>event.type==='session.bound')!.data.sessionId='foreign-native'},(s:RunSummary)=>{s.events=s.events.filter(event=>event.type!=='session.bound').map((event,index)=>({...event,seq:index+1}))}]){
      f.inspect.mockImplementation(async run=>{const summary=await f.read(run);if(run.binding.taskId===f.source.taskId)mutate(summary);return summary});
      await expect(f.replace()).rejects.toMatchObject({code:'GOAL_EVIDENCE_IDENTITY'});expect(await f.store.read()).toEqual(before);
    }
  }finally{await f.cleanup()}
});

it('异步候选核实期间停止会取消整个事务，不留下审计、半条边或成功回执',async()=>{
  const f=await setup(),entered=deferred<void>(),resume=deferred<void>();let stopped=false;
  try{
    const before=await f.store.read(),file=path.join(f.directory,'dispatch.jsonl'),bytes=await fs.readFile(file,'utf8');
    f.inspect.mockImplementation(async run=>{const summary=await f.read(run);if(run.binding.taskId===f.replacement.taskId){entered.resolve();await resume.promise}return summary});
    const replacing=f.replace('replace-stopped',()=>{if(stopped)throw Object.assign(Error('主调度已停止'),{code:'COLLABORATION_STOPPED'})});
    await entered.promise;stopped=true;resume.resolve();await expect(replacing).rejects.toMatchObject({code:'COLLABORATION_STOPPED'});
    expect(await f.store.read()).toEqual(before);expect(await fs.readFile(file,'utf8')).toBe(bytes);
    stopped=false;f.inspect.mockImplementation(f.read);expect((await f.replace('replace-stopped')).taskId).toBe(f.target.taskId);
  }finally{resume.resolve();await f.cleanup()}
});

it('知识变化拒绝替换，不能刷新旧待办的配置后继续执行',async()=>{
  const f=await setup();try{
    const snapshot=await f.workspace.snapshot();await f.workspace.commit(request(snapshot,[{path:'.cbim/README.md',text:'# changed baseline'}]));const before=await f.store.read();
    await expect(f.replace()).rejects.toMatchObject({code:'DEPENDENCY_KNOWLEDGE_STALE'});expect(await f.store.read()).toEqual(before);expect(f.inspect).not.toHaveBeenCalled();
  }finally{await f.cleanup()}
});

it('候选读取期间知识发生变化也整体拒绝，不提交旧基线的审计或边',async()=>{
  const f=await setup(),entered=deferred<void>(),resume=deferred<void>();try{
    const before=await f.store.read();f.inspect.mockImplementation(async run=>{const summary=await f.read(run);if(run.binding.taskId===f.replacement.taskId){entered.resolve();await resume.promise}return summary});
    const replacing=f.replace();await entered.promise;await fs.writeFile(path.join(f.workspace.entry.path,'.cbim/README.md'),'# external change during evidence read');resume.resolve();
    await expect(replacing).rejects.toMatchObject({code:'KNOWLEDGE_CHANGED'});expect(await f.store.read()).toEqual(before);
  }finally{resume.resolve();await f.cleanup()}
});
