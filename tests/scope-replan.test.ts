import {registerServiceOwner} from './owner-service-fixture';
import {it,expect,vi} from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {fixture,request} from './helpers';
import {seedTeam} from './team-fixture';
import {json} from '../src/backend/core/foundation/serialization';
import {jsonToolResult} from '../src/backend/core/tools/results';
import {replanRequestSchema,replanReceiptSchema,type ReplanRequest} from '../src/backend/core/tasks/scope-replan';
import {FileDispatchStore} from '../src/backend/main/persistence/tasks/dispatch-store';
import {FileRunStorage} from '../src/backend/main/persistence/tasks/run-storage';
import {RunJournal} from '../src/backend/main/persistence/tasks/run-journal';
import {WorkspaceDispatchService} from '../src/backend/scheduler-engine/execution/dispatch-service';
import {MemberExecutionManager,type MemberExecutionPorts} from '../src/backend/scheduler-engine/execution/member-execution';
import {LoopRuntime} from '../src/backend/core/brain/runtime';
import type {EngineContext,TaskSpec,RunSummary} from '../src/backend/core/brain/types';
import type {ScopeGoalPorts} from '../src/backend/scheduler-engine/execution/scope-goal-service';

async function setup(human=false,legacy=false,multi=false,splitMain=false){
  const f=await fixture(),entry=await f.app.dispatch('add',{path:f.a}),workspace=f.app.workspace(entry.id),team=await seedTeam(workspace),snapshot=await workspace.snapshot(),moduleId=team.input.moduleId;
  const definition=JSON.parse(snapshot.files.find(x=>x.path===moduleId+'/module.json')!.text);definition.maintenance={bindingId:'maintain',maintainerPersonIds:['owner'],revision:1,state:'active',confirmation:{recordId:'review',source:'local_user',confirmedAt:'2026-11-06T00:00:00.000Z'}};
  const child=JSON.parse(snapshot.files.find(x=>x.path===team.child+'/module.json')!.text);child.maintenance={...definition.maintenance,bindingId:'maintain-child'};
  await workspace.commit(request(snapshot,[{path:'.cbim/team/people.json',text:json({people:[{id:'owner',name:'维护人',team:'.cbim/team'}]})},{path:moduleId+'/module.json',text:json(definition)},...(multi?[{path:team.child+'/module.json',text:json(child)}]:[])]));
  const {model}=await registerServiceOwner(f.app,workspace,'cbim:executor',multi?[moduleId,team.child]:[moduleId]);
  const store=workspace.dispatchStore,directory=store.directory,storage=new FileRunStorage(),identity={workspaceId:entry.id,rootSessionId:'main-root'},journals=new Map<string,RunJournal>();
  const ports:ScopeGoalPorts={inspectMain:vi.fn(async(_root,id)=>RunJournal.read(journals.get(id)!.directory)),inspectMember:vi.fn(async run=>storage.read(path.join(directory,'runs',run.binding.taskId,run.binding.runId)))};
  const service=new WorkspaceDispatchService(workspace,store,ports,undefined,undefined,f.app.models);await service.openScope(identity,'source',{message:'实现业务；保留人工验收'},'old-main');
  const selectionFor=async(ids:string[])=>(await service.owners.discover(ids)).groups[0].selection!;
  const ownerSelection=await selectionFor([moduleId]),sourceSelection=multi?await selectionFor([moduleId,team.child]):ownerSelection;
  const plan=(expectedRevision=1)=>({expectedRevision,objective:'核实并完成目标',constraints:[],criteria:[{id:'fact',text:'提供真实证据',kind:'evidence' as const}],assignments:[{agentId:'cbim:executor',moduleIds:[moduleId],ownerSelection,criterionIds:['fact'],reason:'负责模块'}],reason:'按图谱执行'});
  {const draft=plan();if(multi){draft.assignments[0].moduleIds.push(team.child);draft.assignments[0].ownerSelection=sourceSelection}await service.goals.plan(identity,'source','old-main','old-plan',human?{...draft,criteria:[{id:'fact',text:'人工验收结果',kind:'human'}]}:draft)}
  let command=0;
  const assign=(scopeId:string)=>service.dispatchTask({...identity,commandId:'assign-'+(++command),expectedParentRevision:1,task:{assigneeAgentId:'cbim:executor',moduleIds:multi&&scopeId==='source'?[moduleId,team.child]:[moduleId],ownerSelection:multi&&scopeId==='source'?sourceSelection:ownerSelection,goal:'读取模块当前状态',acceptance:[{id:'fact',text:'提供真实证据'}],prerequisites:[]}},scopeId);
  const oldTask=await assign('source');await service.closeScope(identity,'source','failed');
  const prepare:()=>Awaited<ReturnType<MemberExecutionPorts['prepare']>>=()=>({model,create:async(_run,_task,hooks)=>{
    let context:EngineContext;return new LoopRuntime({storage,directory:path.join(directory,'runs'),acquireLease:async()=>()=>{},onEngineReady:hooks.onEngineReady,onEvent:hooks.onEvent,toolPolicy:async call=>({allow:true,effects:[call.name==='read'?'read':'maintenance'],scope:{kind:'workspace',workspaceId:entry.id}}),createEngine:()=>({kind:'replan-fixture',start:async value=>{context=value;await context.emit({type:'session.bound',data:{sessionId:context.nativeSessionId,sessionFile:path.join(directory,'native-'+context.nativeSessionId+'.jsonl')}})},stop:async()=>{},close:async()=>{},run:async()=>{
      let index=0;const invoke=async(name:string,input:Record<string,unknown>)=>{const id='tool-'+(++index);await context.beforeTool({id,name,input});const result=name==='read'?jsonToolResult('read',{verified:true}):await context.taskTools!.call(name,input);await context.emit({type:'tool.finished',data:{id,name,result,isError:false}});return id};
      await invoke('cbim_task_plan',{expectedVersion:0,goal:context.task.goal,acceptance:context.task.acceptance,reason:'核实实际状态',steps:[{id:'read',title:'读取',owner:'当前成员'}]});const evidence=await invoke('read',{path:'src/app.ts'});await invoke('cbim_task_step',{expectedVersion:1,id:'read',state:'reported_done',evidenceIds:[evidence]});await invoke('cbim_delivery_prepare',{expectedVersion:2,summary:'已读取实际状态',limitations:[]});return {status:'completed'};
    }})});
  }});
  const members=new MemberExecutionManager(workspace,store,{acquire:()=>()=>{},inspect:ports.inspectMember,owners:service.owners,prepare:async()=>prepare(),withEngineConfiguration:(reference,_options,use)=>f.app.models.withRuntimeConfiguration(reference,configuration=>use({model:configuration.profile,prepare}))});await members.initialize();
  const report=await members.report({...identity,taskId:oldTask.taskId}),context={runId:randomUUID(),nativeSessionId:randomUUID(),excludedRunIds:['old-main']},options={profileId:randomUUID(),provider:'fixture',model:'fixture',permission:'read' as const};
  const accepted=await service.recoveries.accept({...identity,commandId:randomUUID(),source:{scopeId:'source',taskId:oldTask.taskId,reportBasis:report.basis.key},operation:'inspect_effects',observation:{text:'观察不是验收'},input:{message:'只读核实完整模块现状'},options},context),scopeId=accepted.scope.scopeId;
  const task:TaskSpec={mode:'chat',taskId:identity.rootSessionId,workspaceId:entry.id,root:f.a,goal:accepted.scope.goal!.input.message,agentId:'cbim:main',moduleIds:[],acceptance:[]},binding=await service.conversationBinding(task);let currentRun:string=context.runId,journal=new RunJournal(path.join(directory,'main',context.runId),task,context.runId);await journal.init();await journal.append({type:'run.started',data:{task,conversationBinding:binding,freshMain:{nativeSessionId:context.nativeSessionId,excludedRunIds:context.excludedRunIds}}});await journal.append({type:'session.bound',data:{sessionId:context.nativeSessionId,sessionFile:path.join(directory,'main-native.jsonl')}});journals.set(context.runId,journal);
  await service.goals.plan(identity,scopeId,context.runId,'inspection-plan',plan());const inspectionTask=await assign(scopeId);await members.start({...identity,taskId:inspectionTask.taskId,commandId:'inspection-start',expectedRevision:1,options:{permission:'read'}});await members.waitForSettlement({...identity,taskId:inspectionTask.taskId});
  const candidate=(await service.snapshot(identity)).tasks.find(task=>task.taskId===inspectionTask.taskId)!.result!;
  if(splitMain){await journal.append({type:'run.settled',data:{status:'completed'}});currentRun=randomUUID();await service.registerMainRun(identity,scopeId,currentRun);journal=new RunJournal(path.join(directory,'main',currentRun),task,currentRun);await journal.init();await journal.append({type:'run.started',data:{task,conversationBinding:binding,resumeFrom:context.runId}});await journal.append({type:'session.bound',data:{sessionId:context.nativeSessionId,sessionFile:path.join(directory,'main-native.jsonl')}});journals.set(currentRun,journal)}
  await service.goals.review(identity,scopeId,currentRun,'inspection-review',{expectedRevision:2,decision:'complete',checks:[{criterionId:'fact',outcome:'satisfied',reason:'有真实核实证据',evidence:[{kind:'member-result',taskId:inspectionTask.taskId,runId:candidate.runId,resultId:candidate.resultId,planRevision:candidate.planRevision,toolCallIds:candidate.evidenceRefs}]}],superseded:[],gaps:[],reason:'核实目标完成，不代表原业务完成'});
  await journal.append({type:'run.settled',data:{status:'completed'}});await service.closeScope(identity,scopeId,'completed',await RunJournal.read(journal.directory));
  const previewInput={...identity,inspectionScopeId:scopeId};
  const historicalRead=legacy?vi.spyOn(store,'read'):undefined;
  // Only a read-only historical shape is projected. Current commands still create a real owner-bound plan and never write a legacy task.
  if(historicalRead){const actual=await store.read();const historical=structuredClone(actual);delete historical.scopes!.find(scope=>scope.scopeId==='source')!.goal;historicalRead.mockResolvedValue(historical)}
  const preview=await service.replans.preview(previewInput);historicalRead?.mockRestore();
  const input:ReplanRequest={...identity,commandId:randomUUID(),source:{inspectionScopeId:scopeId,expectedBasis:preview.basis??'a'.repeat(64)},input:{message:'明确的新业务目标，不重播旧工具'},options:{...options,permission:'ask'}};
  const launch=async()=>({runId:randomUUID(),nativeSessionId:randomUUID(),excludedRunIds:await service.recoveries.priorRunIds(identity)});
  return {...f,entry,workspace,store,directory,service,members,ownerSelection,ports,journal,journals,currentRun,scopeId,previewInput,preview,input,launch,plan,moduleId,oldTask,inspectionTask,candidate,context,identity,cleanup:async()=>{await members.close();await service.close();await f.cleanup()}};
}

it('完成核实的预览只读，显式业务新周期幂等持久化，同主实例而新scope/native；旧记录不变',async()=>{
  const f=await setup();try{
    expect(f.preview).toMatchObject({eligible:true,issues:[],requiredModules:[{moduleId:f.moduleId}],inheritedHuman:[]});
    const before=await f.store.read(),bytes=await fs.readFile(path.join(f.directory,'dispatch.jsonl'));expect(await f.service.replans.preview(f.previewInput)).toEqual(f.preview);expect(await fs.readFile(path.join(f.directory,'dispatch.jsonl'))).toEqual(bytes);
    const launches=[await f.launch(),await f.launch()],accepted=await Promise.all(launches.map(value=>f.service.replans.accept(f.input,value)));expect(accepted.filter(value=>value.fresh)).toHaveLength(1);expect(accepted[0].replan).toEqual(accepted[1].replan);
    const after=await f.store.read();expect(after.graphs).toEqual(before.graphs);expect(after.members).toEqual(before.members);expect(after.runs).toEqual(before.runs);expect(after.scopes!.slice(0,-1)).toEqual(before.scopes);expect(accepted[0].scope.recovery).toBeUndefined();expect(accepted[0].replan.context.nativeSessionId).not.toBe(f.context.nativeSessionId);
    const looked=await f.service.replans.inspect({...f.identity,commandId:f.input.commandId});expect(replanReceiptSchema.safeParse(looked).success).toBe(true);expect(JSON.stringify(looked)).not.toMatch(/excludedRunIds|nativeSessionId/);expect(await f.service.recoveries.latestContext(f.identity)).toEqual(accepted[0].replan.context);
    await f.service.closeScope(f.identity,f.input.commandId,'cancelled');expect((await f.service.replans.accept(f.input,await f.launch())).fresh).toBe(false);
    expect((await f.service.replans.preview(f.previewInput)).issues[0].code).toBe('REPLAN_STALE');await expect(f.service.replans.accept({...f.input,commandId:randomUUID()},await f.launch())).rejects.toMatchObject({code:'REPLAN_STALE'});
    const reader=new FileDispatchStore(f.directory,f.entry.id);try{const service=new WorkspaceDispatchService(f.workspace,reader);expect((await service.replans.inspect({...f.identity,commandId:f.input.commandId}))?.scopeStatus).toBe('closed');expect(await service.recoveries.priorRunIds(f.identity)).toContain(accepted[0].replan.context.initialRunId)}finally{await reader.close()}
  }finally{await f.cleanup()}
});

it('新业务计划必须继承人工条件并完整限定已核实模块，直接事务篡改也拒绝',async()=>{
  const f=await setup(true);try{
    expect(f.preview.eligible).toBe(true);expect(f.preview.inheritedHuman).toMatchObject([{id:'fact',text:'人工验收结果',kind:'human',sourceScopeId:'source'}]);const accepted=await f.service.replans.accept(f.input,await f.launch()),id=accepted.scope.scopeId,run=accepted.replan.context.initialRunId;
    await expect(f.service.goals.plan(f.identity,id,run,'drop-human',f.plan())).rejects.toMatchObject({code:'GOAL_HUMAN_REQUIRED'});
    const draft={...f.plan(),criteria:[{id:'fact',text:'人工验收结果',kind:'human' as const}]};
    const outsideSelection={...f.ownerSelection,expectedOwners:[...f.ownerSelection.expectedOwners,{...f.ownerSelection.expectedOwners[0],moduleId:'other'}]};
    await expect(f.service.goals.plan(f.identity,id,run,'outside',{...draft,assignments:[{...draft.assignments[0],moduleIds:[f.moduleId,'other'],ownerSelection:outsideSelection}]})).rejects.toMatchObject({code:'GOAL_MODULE_SCOPE'});
    const planned=await f.service.goals.plan(f.identity,id,run,'preserve-human',draft);expect(planned.goal!.plan!.criteria).toEqual(draft.criteria);
    const bad=structuredClone(planned);bad.replan!.source.proof.inheritedHuman=[];await expect(f.store.transact({commandId:'tamper',fingerprint:'tamper'},async()=>({scopes:[bad],receipt:true}))).rejects.toMatchObject({code:'GRAPH_INPUT_INVALID'});
    await expect(f.service.goals.review(f.identity,id,run,'approve-human',{expectedRevision:2,decision:'complete',checks:[{criterionId:'fact',outcome:'satisfied',reason:'用户同意',evidence:[]}],superseded:[],gaps:[],reason:'直接同意'})).rejects.toThrow();
  }finally{await f.cleanup()}
});

it('核实主链损坏、成员未知或正文回执不一致都拒绝；缺目标的旧形状投影不能推断没有人工条件',async()=>{
  const f=await setup();try{
    const inspect=vi.mocked(f.ports.inspectMain),good=await RunJournal.read(f.journal.directory);
    for(const mutate of [(s:RunSummary)=>{s.logIntegrity={partialTail:true}},(s:RunSummary)=>{s.events[0].data.freshMain={nativeSessionId:randomUUID(),excludedRunIds:[]}},(s:RunSummary)=>{s.unresolvedTools=['unknown']}]){
      const bad=structuredClone(good);mutate(bad);inspect.mockResolvedValue(bad);expect((await f.service.replans.preview(f.previewInput)).eligible).toBe(false);
    }inspect.mockImplementation(async()=>RunJournal.read(f.journal.directory));
    const member=vi.mocked(f.ports.inspectMember),read=member.getMockImplementation()!;member.mockImplementation(async run=>{const summary=await read(run),finish=summary.events.find(event=>event.type==='tool.finished'&&event.data.name==='read')!;finish.data.result={changed:true};return summary});
    expect((await f.service.replans.preview(f.previewInput)).eligible).toBe(false);expect((await f.store.read()).scopes).toHaveLength(2);
  }finally{await f.cleanup()}
  const legacy=await setup(false,true);try{expect(legacy.preview).toMatchObject({eligible:false,issues:[{code:'REPLAN_LEGACY'}]})}finally{await legacy.cleanup()}
});

it('严格请求、过期联合基线与知识变动拒绝；受理后返回读取失败仍查询同一意图',async()=>{
  const f=await setup();try{
    expect(replanRequestSchema.safeParse({...f.input,options:{...f.input.options,permission:'read'}}).success).toBe(false);expect(replanRequestSchema.safeParse({...f.input,runId:'untrusted'}).success).toBe(false);
    await expect(f.service.replans.accept({...f.input,source:{...f.input.source,expectedBasis:'f'.repeat(64)}},await f.launch())).rejects.toMatchObject({code:'REPLAN_STALE'});
    const start=await f.launch(),read=vi.spyOn(f.store,'read');read.mockRejectedValueOnce(Error('postcommit read failed'));await expect(f.service.replans.accept(f.input,start)).rejects.toThrow('postcommit read failed');
    expect((await f.service.replans.inspect({...f.identity,commandId:f.input.commandId}))?.replan.runId).toBe(start.runId);expect((await f.service.replans.accept(f.input,await f.launch())).fresh).toBe(false);
    await expect(f.service.replans.accept({...f.input,input:{message:'改参'}},await f.launch())).rejects.toMatchObject({code:'COMMAND_ID_CONFLICT'});
    await f.service.closeScope(f.identity,f.input.commandId,'cancelled');const snapshot=await f.workspace.snapshot();await f.workspace.commit(request(snapshot,[{path:'.cbim/README.md',text:'# 已变更的知识'}]));expect((await f.service.replans.preview(f.previewInput)).eligible).toBe(false);
  }finally{await f.cleanup()}
});

it('只覆盖部分原业务模块的核实不签发重规划依据；新上下文不能遗漏此前主运行意图',async()=>{
  const partial=await setup(false,false,true);try{expect(partial.preview).toMatchObject({eligible:false,issues:[{code:'REPLAN_PROOF_INVALID'}]});await expect(partial.service.replans.accept(partial.input,await partial.launch())).rejects.toMatchObject({code:'REPLAN_PROOF_INVALID'})}finally{await partial.cleanup()}
  const f=await setup();try{
    await expect(f.service.replans.accept(f.input,{...await f.launch(),excludedRunIds:[]})).rejects.toMatchObject({code:'REPLAN_CONTEXT_CONFLICT'});
    const accepted=await f.service.replans.accept(f.input,await f.launch()),scopeId=accepted.scope.scopeId,runId=accepted.replan.context.initialRunId;
    const changed=structuredClone(accepted.scope);changed.recovery=(await f.store.read()).scopes!.find(item=>item.scopeId===f.scopeId)!.recovery;
    await expect(f.store.transact({commandId:'mix-intents',fingerprint:'mix-intents'},async()=>({scopes:[changed],receipt:true}))).rejects.toMatchObject({code:'GRAPH_INPUT_INVALID'});
    const draft=f.plan();await f.service.goals.plan(f.identity,scopeId,runId,'business-plan',draft);await f.service.closeScope(f.identity,scopeId,'failed');
    expect((await f.service.recoveries.latestContext(f.identity))?.initialRunId).toBe(runId);
  }finally{await f.cleanup()}
});

it('核实证明逐轮验证同一原生主链，不能只借用最终成功审阅掩盖上游损坏或循环',async()=>{
  const f=await setup(false,false,false,true);try{
    expect(f.preview.eligible).toBe(true);const inspect=vi.mocked(f.ports.inspectMain),original=inspect.getMockImplementation()!;
    inspect.mockImplementation(async(root,id)=>{const value=await original(root,id);if(id===f.context.runId)value.events.find(event=>event.type==='session.bound')!.data.sessionId=randomUUID();return value});expect((await f.service.replans.preview(f.previewInput)).eligible).toBe(false);
    inspect.mockImplementation(async(root,id)=>{const value=await original(root,id);if(id===f.currentRun)value.events[0].data.resumeFrom=f.currentRun;return value});expect((await f.service.replans.preview(f.previewInput)).eligible).toBe(false);
    inspect.mockImplementation(async(root,id)=>{const value=await original(root,id);if(id===f.context.runId)value.logIntegrity={partialTail:true};return value});expect((await f.service.replans.preview(f.previewInput)).eligible).toBe(false);
    inspect.mockImplementation(original);expect((await f.service.replans.preview(f.previewInput)).eligible).toBe(true);
  }finally{await f.cleanup()}
});

it('核实后任何新周期都使旧依据失效；新的完整只读核实仍可成为业务来源',async()=>{
  const f=await setup();try{
    await f.service.openScope(f.identity,'later-chat',{message:'后续对话'});await f.service.closeScope(f.identity,'later-chat','cancelled');expect((await f.service.replans.preview(f.previewInput)).issues[0].code).toBe('REPLAN_STALE');
    const report=await f.members.report({...f.identity,taskId:f.oldTask.taskId}),launch=await f.launch(),accepted=await f.service.recoveries.accept({...f.identity,commandId:randomUUID(),source:{scopeId:'source',taskId:f.oldTask.taskId,reportBasis:report.basis.key},operation:'inspect_effects',observation:{text:'重新核实后续目标的影响'},input:{message:'再次只读核实'},options:{...f.input.options,permission:'read'}},launch),scopeId=accepted.scope.scopeId;
    const task:TaskSpec={mode:'chat',taskId:f.identity.rootSessionId,workspaceId:f.entry.id,root:f.a,goal:accepted.scope.goal!.input.message,agentId:'cbim:main',moduleIds:[],acceptance:[]},binding=await f.service.conversationBinding(task),journal=new RunJournal(path.join(f.directory,'main',launch.runId),task,launch.runId);await journal.init();await journal.append({type:'run.started',data:{task,conversationBinding:binding,freshMain:{nativeSessionId:launch.nativeSessionId,excludedRunIds:launch.excludedRunIds}}});await journal.append({type:'session.bound',data:{sessionId:launch.nativeSessionId,sessionFile:path.join(f.directory,'next-native.jsonl')}});f.journals.set(launch.runId,journal);
    await f.service.goals.plan(f.identity,scopeId,launch.runId,'next-plan',f.plan());const assigned=await f.service.dispatchTask({...f.identity,commandId:'next-dispatch',expectedParentRevision:1,task:{assigneeAgentId:'cbim:executor',moduleIds:[f.moduleId],ownerSelection:f.ownerSelection,goal:'重新核实',acceptance:[{id:'fact',text:'提供真实证据'}],prerequisites:[]}},scopeId);
    await f.members.start({...f.identity,taskId:assigned.taskId,commandId:'next-run',expectedRevision:1,options:{permission:'read'}});await f.members.waitForSettlement({...f.identity,taskId:assigned.taskId});const result=(await f.service.snapshot(f.identity)).tasks.find(item=>item.taskId===assigned.taskId)!.result!;
    await f.service.goals.review(f.identity,scopeId,launch.runId,'next-review',{expectedRevision:2,decision:'complete',checks:[{criterionId:'fact',outcome:'satisfied',reason:'重新取得证据',evidence:[{kind:'member-result',taskId:assigned.taskId,runId:result.runId,resultId:result.resultId,planRevision:result.planRevision,toolCallIds:result.evidenceRefs}]}],superseded:[],gaps:[],reason:'新的核实目标完成'});await journal.append({type:'run.settled',data:{status:'completed'}});await f.service.closeScope(f.identity,scopeId,'completed',await RunJournal.read(journal.directory));
    const preview=await f.service.replans.preview({...f.identity,inspectionScopeId:scopeId});expect(preview.eligible).toBe(true);expect((await f.service.replans.accept({...f.input,commandId:randomUUID(),source:{inspectionScopeId:scopeId,expectedBasis:preview.basis!}},await f.launch())).fresh).toBe(true);
  }finally{await f.cleanup()}
});
