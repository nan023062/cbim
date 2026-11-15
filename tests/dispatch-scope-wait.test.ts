import {it,expect} from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fixture} from './helpers';
import {request} from './data/knowledge';
import {seedTeam} from './team-fixture';
import {registerExplicitFixtureOwner} from './explicit-owner-fixture';
import type {MemberExecutionPorts} from '../src/logic/team/runtime/member-execution';
import {json,hash} from '../src/core/platform/node/serialization';
import type {AgentEngine,EngineContext,RunSummary,TaskSpec} from '../src/logic/execution/rules/types';
import type {GoalPlanInput,GoalReviewInput} from '../src/logic/tasks/rules/scope-goal';
import {LoopRuntime} from '../src/logic/execution/rules/runtime/runtime';
import {FileRunStorage} from '../src/logic/execution/storage/run-storage';
import {RunJournal} from '../src/logic/execution/storage/run-journal';
import {FileDispatchStore} from '../src/logic/dispatch/storage/dispatch-store';
import {WorkspaceDispatchService} from '../src/logic/dispatch/runtime/dispatch-service';
import {MemberExecutionManager} from '../src/logic/team/runtime/member-execution';

const plan:GoalPlanInput={expectedRevision:1,objective:'规划后等待维护者补充',constraints:['不冒充人工验收'],criteria:[{id:'choice',text:'维护者补充目标方向',kind:'human'}],assignments:[{agentId:'cbim:main',moduleIds:[],criterionIds:['choice'],reason:'协调目标'}],reason:'保留待确认目标'};
const review:GoalReviewInput={expectedRevision:2,decision:'awaiting_user',checks:[{criterionId:'choice',outcome:'needs_human',reason:'需要用户补充',evidence:[]}],superseded:[],gaps:['尚需用户选择'],reason:'请补充目标方向，当前没有继续执行的条件'};
async function setup(){
  const f=await fixture(),entry=await f.app.dispatch('add',{path:f.a}),workspace=f.app.workspace(entry.id),directory=workspace.dispatchStore.directory,memberDirectory=path.join(f.user,'waiting-members');
  const store=workspace.dispatchStore,identity={workspaceId:entry.id,rootSessionId:'root'},runId='main-run';
  let memberOverride:((summary:RunSummary)=>RunSummary)|undefined,members:MemberExecutionManager|undefined,leases=0;
  const service=new WorkspaceDispatchService(workspace,store,{inspectMain:()=>RunJournal.read(journal.directory),inspectMember:async run=>{const summary=await RunJournal.read(path.join(memberDirectory,run.binding.taskId,run.binding.runId));return memberOverride?memberOverride(summary):summary}},undefined,undefined,f.app.engineModels);
  const task:TaskSpec={mode:'chat',taskId:identity.rootSessionId,workspaceId:entry.id,root:f.a,goal:'旧会话标题',moduleIds:[],agentId:'cbim:main',acceptance:[]},binding=await service.conversationBinding(task);
  const scope=await service.openScope(identity,'scope',{message:'  本轮完整原文\n请先问清再执行',attachmentIds:[]});
  const journal=new RunJournal(path.join(f.user,'waiting-main'),task,runId);await journal.init();await journal.append({type:'run.started',data:{task,message:scope.goal!.input.message,conversationBinding:binding}});
  const makeReady=async(draft=plan,decision=review)=>{await service.goals.plan(identity,scope.scopeId,runId,'plan',draft);return service.goals.review(identity,scope.scopeId,runId,'review',decision)};
  const settle=async()=>{await journal.append({type:'run.settled',data:{status:'completed'}});return RunJournal.read(journal.directory)};
  const addMember=async()=>{
    const team=await seedTeam(workspace),snapshot=await workspace.snapshot(),moduleId=team.input.moduleId,definition=JSON.parse(snapshot.files.find(file=>file.path===moduleId+'/module.json')!.text);
    definition.maintenance={bindingId:'maintain',maintainerPersonIds:['owner'],revision:1,state:'active',confirmation:{recordId:'review',source:'local_user',confirmedAt:'2026-11-06T00:00:00.000Z'}};
    await workspace.commit(request(snapshot,[{path:'.cbim/team/people.json',text:json({people:[{id:'owner',name:'维护者',team:'.cbim/team'}]})},{path:moduleId+'/module.json',text:json(definition)}]));
    const settings=await f.app.models.save({profile:{name:'Wait service fixture',api:'openai-completions',auth:'none',baseUrl:'https://example.test/v1',defaultModel:'fixture',models:[{id:'fixture',name:'fixture',enabled:true,contextWindow:200000,maxTokens:1000,reasoning:false}]}}),profile=settings.profiles.find(item=>item.name==='Wait service fixture')!;
    const registered=await registerExplicitFixtureOwner(f.app,entry.id,{agentId:'.cbim/team/dev',moduleIds:[moduleId],profileId:profile.id,modelId:'fixture'}),ownerSelection=registered.selection,model=await f.app.engineModels.configuration(profile.id,'fixture');
    const storage=new FileRunStorage();
    const prepare=():Awaited<ReturnType<MemberExecutionPorts['prepare']>>=>({model,create:async(_run,_task,hooks)=>{
      let context:EngineContext;
      const engine:AgentEngine={kind:'waiting-test',start:async value=>{context=value;await context.emit({type:'session.bound',data:{sessionId:context.nativeSessionId,sessionFile:path.join(memberDirectory,'native.jsonl')}})},run:async()=>({status:'failed',error:'明确的测试失败，未执行任何工具'}),stop:async()=>{},close:async()=>{}};
      return new LoopRuntime({storage,directory:memberDirectory,createEngine:()=>engine,acquireLease:async()=>()=>{},onEngineReady:hooks.onEngineReady,onEvent:hooks.onEvent,toolPolicy:async()=>({allow:false})});
    }});
    members=new MemberExecutionManager(workspace,store,{acquire:()=>{leases++;return()=>{leases--}},inspect:run=>storage.read(path.join(memberDirectory,run.binding.taskId,run.binding.runId)),prepare:async()=>prepare(),owners:service.owners,withEngineConfiguration:(reference,_options,use)=>f.app.engineModels.withRuntimeConfiguration(reference,configuration=>use({model:configuration.profile,prepare}))});await members.initialize();
    const draft={...plan,assignments:[{agentId:'.cbim/team/dev',moduleIds:[moduleId],ownerSelection,criterionIds:['choice'],reason:'验证后交由用户判断'}]};
    await service.goals.plan(identity,scope.scopeId,runId,'plan',draft);
    const input={...identity,commandId:'dispatch',expectedParentRevision:1,task:{assigneeAgentId:'.cbim/team/dev',moduleIds:[moduleId],ownerSelection,goal:'核实目标模块',acceptance:[{id:'choice',text:'核实并说明结果'}],prerequisites:[]}};
    const receipt=await service.dispatchTask(input,scope.scopeId);
    return {input,receipt,members,run:async()=>{await members!.start({...identity,taskId:receipt.taskId,commandId:'start',expectedRevision:1,options:{permission:'read'}});await members!.waitForSettlement({...identity,taskId:receipt.taskId})}};
  };
  return {...f,entry,workspace,directory,store,identity,runId,scope,journal,service,makeReady,settle,addMember,leaseCount:()=>leases,overrideMember:(value:typeof memberOverride)=>{memberOverride=value},cleanup:async()=>{await members?.close();await store.close();await f.cleanup()}};
}

it('安全等待冻结原始目标和主轮预算，独立delta更新；重放与恢复不关闭、不创建新运行',async()=>{
  const f=await setup();try{
    const reviewed=await f.makeReady(),summary=await f.settle(),before=await f.service.sessionRead({identity:f.identity});
    const ids=['earlier-main',f.runId],pending=f.service.parkScope(f.identity,f.scope.scopeId,summary,ids);ids.push('mutated-after-call');
    const parked=await pending;
    expect(parked).toMatchObject({status:'waiting',goal:reviewed.goal,wait:{reason:review.reason,runId:f.runId,goalRevision:3,mainRunIds:['earlier-main',f.runId]}});
    expect(parked.goal!.input).toEqual(f.scope.goal!.input);expect(parked).not.toHaveProperty('outcome');expect(parked).not.toHaveProperty('closedAt');
    const update=await f.service.sessionRead({identity:f.identity,graphCursor:before.graph.cursor,scopeCursor:before.scopes.cursor});expect(update.graph.mode).toBe('noop');expect(update.scopes.mode).toBe('delta');
    if(update.scopes.mode!=='delta')throw Error('missing scope delta');
    expect(update.scopes.batches[0].scopes[0]).toMatchObject({status:'waiting',wait:{waitId:parked.wait!.waitId,reason:review.reason}});expect(update.scopes.batches[0].scopes[0].wait).not.toHaveProperty('runId');expect(update.scopes.batches[0].scopes[0].wait).not.toHaveProperty('mainRunIds');
    expect(update.detail).toMatchObject({mode:'updated',scope:{wait:parked.wait}});
    expect(await f.service.parkScope(f.identity,f.scope.scopeId,summary,['earlier-main',f.runId])).toEqual(parked);
    const file=path.join(f.directory,'dispatch.jsonl'),beforeRecovery=await fs.readFile(file,'utf8');await f.service.recoverScopes();expect(await fs.readFile(file,'utf8')).toBe(beforeRecovery);
    const reopened=new FileDispatchStore(f.directory,f.entry.id);try{const service=new WorkspaceDispatchService(f.workspace,reopened);await service.recoverScopes();expect(await service.waitingScopes()).toEqual([parked]);expect((await reopened.read()).runs).toEqual([])}finally{await reopened.close()}
    await expect(f.service.goals.plan(f.identity,f.scope.scopeId,f.runId,'late-plan',{...plan,expectedRevision:3})).rejects.toMatchObject({code:'GOAL_WAITING'});
    await expect(f.service.goals.review(f.identity,f.scope.scopeId,f.runId,'late-review',{...review,expectedRevision:3})).rejects.toMatchObject({code:'GOAL_WAITING'});
    await expect(f.service.openScope(f.identity,'another',{message:'另一个目标'})).rejects.toMatchObject({code:'DISPATCH_SCOPE_BUSY'});
    await expect(f.service.openScope(f.identity,f.scope.scopeId,f.scope.goal!.input)).rejects.toMatchObject({code:'DISPATCH_SCOPE_WAITING'});
  }finally{await f.cleanup()}
});

it('只有明确awaiting_user可等待，未结算主轮、错误身份和不完整预算证明均被拒绝',async()=>{
  const f=await setup();try{
    await f.makeReady();const running=await RunJournal.read(f.journal.directory);
    await expect(f.service.parkScope(f.identity,f.scope.scopeId,running,[f.runId])).rejects.toMatchObject({code:'GOAL_MAIN_UNSETTLED'});
    const summary=await f.settle();
    for(const ids of [[],['other'],[f.runId,f.runId],Array.from({length:33},(_,i)=>i?`run-${i}`:f.runId)])await expect(f.service.parkScope(f.identity,f.scope.scopeId,summary,ids)).rejects.toMatchObject({code:'GOAL_WAIT_RUNS'});
    await expect(f.service.parkScope(f.identity,f.scope.scopeId,{...summary,runId:'foreign'},['foreign'])).rejects.toMatchObject({code:'GOAL_EVIDENCE_IDENTITY'});
    await expect(f.service.parkScope(f.identity,f.scope.scopeId,{...summary,unresolvedTools:['unknown']},[f.runId])).rejects.toMatchObject({code:'GOAL_MAIN_UNSETTLED'});
    const ids=Array.from({length:32},(_,i)=>i?`run-${i}`:f.runId);expect((await f.service.parkScope(f.identity,f.scope.scopeId,summary,ids)).wait!.mainRunIds).toEqual(ids);
  }finally{await f.cleanup()}
  for(const decision of ['blocked','replan'] as const){const other=await setup();try{await other.makeReady(plan,{...review,decision});await expect(other.service.parkScope(other.identity,other.scope.scopeId,await other.settle(),[other.runId])).rejects.toMatchObject({code:'GOAL_WAIT_REQUIRED'})}finally{await other.cleanup()}}
});

it('等待请求后的图、知识或副作用变化不能混入检查点',async()=>{
  for(const drift of ['graph','knowledge','effect'] as const){const f=await setup();try{
    await f.makeReady();
    if(drift==='graph')await f.store.transact({commandId:'graph-change',fingerprint:'graph-change'},async state=>{const graph=state.graphs[0];return {receipt:true,batch:{version:1,identity:f.identity,streamId:graph.cursor.streamId,seq:graph.cursor.seq+1,eventId:'changed',commandId:'graph-change',cause:'agent.state_changed',committedAt:new Date().toISOString(),changes:[{type:'root.upserted',root:{...graph.root,revision:graph.root.revision+1}}]}}});
    if(drift==='knowledge'){const snapshot=await f.workspace.snapshot();await f.workspace.commit(request(snapshot,[{path:'.cbim/README.md',text:'# 已改变的知识基线'}]))}
    if(drift==='effect'){await f.journal.append({type:'tool.allowed',data:{id:'later-write',name:'write',input:{path:'app.ts'},allow:true,effects:['business-write']}});await f.journal.append({type:'tool.finished',data:{id:'later-write',name:'write',result:{content:[{type:'text',text:'done'}]},isError:false}})}
    await expect(f.service.parkScope(f.identity,f.scope.scopeId,await f.settle(),[f.runId])).rejects.toMatchObject({code:drift==='graph'?'GOAL_GRAPH_CHANGED':drift==='knowledge'?'GOAL_KNOWLEDGE_CHANGED':'GOAL_EFFECT_CHANGED'});
    expect((await f.store.read()).scopes![0].status).toBe('active');
  }finally{await f.cleanup()}}
});

it('未启动任务拒绝停泊，真实明确失败的成员可等待；未知成员工具记录不能成为安全检查点',async()=>{
  const pending=await setup();try{await pending.addMember();await pending.service.goals.review(pending.identity,pending.scope.scopeId,pending.runId,'review',review);await expect(pending.service.parkScope(pending.identity,pending.scope.scopeId,await pending.settle(),[pending.runId])).rejects.toMatchObject({code:'GOAL_WORK_PENDING'})}finally{await pending.cleanup()}
  const f=await setup();try{
    const member=await f.addMember();await member.run();expect(f.leaseCount()).toBe(0);
    await f.service.goals.review(f.identity,f.scope.scopeId,f.runId,'review',review);const main=await f.settle();
    f.overrideMember(summary=>({...summary,unresolvedTools:['unconfirmed-write']}));
    await expect(f.service.parkScope(f.identity,f.scope.scopeId,main,[f.runId])).rejects.toMatchObject({code:'GOAL_WAIT_UNCERTAIN'});
    f.overrideMember(undefined);const parked=await f.service.parkScope(f.identity,f.scope.scopeId,main,[f.runId]);expect(parked.status).toBe('waiting');
    const state=await f.store.read(),instance=state.members.find(item=>item.executionScopeId===f.scope.scopeId)!;
    expect(instance).toMatchObject({lifecycle:'active',activity:'idle'});expect(instance.activeRunId).toBeUndefined();
    await expect(f.service.dispatchTask({...member.input,commandId:'late-scoped'},f.scope.scopeId)).rejects.toMatchObject({code:'DISPATCH_SCOPE_WAITING'});
    await expect(member.members.start({...f.identity,taskId:member.receipt.taskId,commandId:'late-start',expectedRevision:state.graphs[0].tasks[0].revision,options:{permission:'read'}})).rejects.toMatchObject({code:'GOAL_WAITING'});
    const closed=await f.service.closeScope(f.identity,f.scope.scopeId,'cancelled');expect(closed.wait).toEqual(parked.wait);expect((await f.store.read()).members.find(item=>item.agentInstanceId===instance.agentInstanceId)?.lifecycle).toBe('released');
  }finally{await f.cleanup()}
});

it('等待不能恢复、修改目标或伪造completed；显式取消保留检查点并释放唯一槽',async()=>{
  const f=await setup();try{
    await f.makeReady();const main=await f.settle(),parked=await f.service.parkScope(f.identity,f.scope.scopeId,main,[f.runId]);
    const attempts=[{...parked,status:'active',wait:undefined},{...parked,wait:undefined},{...parked,wait:{...parked.wait!,reason:'改写历史'}},{...parked,goal:{...parked.goal!,input:{message:'新目标',attachmentIds:[]}}},{...parked,status:'closed',outcome:'completed',closedAt:new Date().toISOString()}];
    for(const [index,value] of attempts.entries())await expect(f.store.transact({commandId:'tamper-'+index,fingerprint:'tamper-'+index},async()=>({scopes:[value as typeof parked],receipt:true}))).rejects.toMatchObject({code:'GRAPH_INPUT_INVALID'});
    await expect(f.service.closeScope(f.identity,f.scope.scopeId,'completed',main)).rejects.toMatchObject({code:'GOAL_WAITING'});
    const closed=await f.service.closeScope(f.identity,f.scope.scopeId,'cancelled');expect(closed.wait).toEqual(parked.wait);expect(closed.goal).toEqual(parked.goal);expect(await f.service.waitingScopes()).toEqual([]);
    await expect(f.service.parkScope(f.identity,f.scope.scopeId,main,[f.runId])).rejects.toMatchObject({code:'DISPATCH_SCOPE_CLOSED'});
    await f.service.openScope(f.identity,'next',{message:'显式新目标'});
    expect((await f.store.read()).scopes!.find(item=>item.scopeId==='next')!.status).toBe('active');
  }finally{await f.cleanup()}
});

it('即使重新计算哈希链，重放仍拒绝等待检查点篡改和新增活动周期',async()=>{
  const f=await setup();try{
    await f.makeReady();await f.service.parkScope(f.identity,f.scope.scopeId,await f.settle(),[f.runId]);
    const file=path.join(f.directory,'dispatch.jsonl'),original=await fs.readFile(file,'utf8');
    for(const mutate of [(scope:any)=>{scope.wait.goalRevision++},(scope:any)=>{scope.wait.mainRunIds=[]},(scope:any)=>{scope.status='active'},(scope:any)=>{scope.goal.review.decision='blocked'}]){
      const records=original.trim().split('\n').map(line=>JSON.parse(line)),last=records.at(-1);mutate(last.body.mutation.scopes[0]);let previousHash='';
      for(const record of records){record.body.previousHash=previousHash;record.checksum=hash(JSON.stringify(record.body));previousHash=record.checksum}
      await fs.writeFile(file,records.map(record=>JSON.stringify(record)).join('\n')+'\n');
      const reader=new FileDispatchStore(f.directory,f.entry.id);try{await expect(reader.read()).rejects.toMatchObject({code:'GRAPH_LOG_CORRUPT'})}finally{await reader.close();await fs.writeFile(file,original)}
    }
  }finally{await f.cleanup()}
});
