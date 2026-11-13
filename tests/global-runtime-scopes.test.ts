import {expect,it,vi} from 'vitest';
import path from 'node:path';
import fs from 'node:fs/promises';
import {fixture} from './helpers';
import {GlobalRuntimeManager} from '../src/backend/scheduler-engine/runtime/global-runtime';
import {WorkspaceDispatchService} from '../src/backend/scheduler-engine/dispatch/dispatch-service';
import {FileDispatchStore} from '../src/backend/main/dispatch-storage/dispatch-store';
import {projectRuntimeScope} from '../src/logic/runtime/rules/runtime-scope';
import {runtimeCursorSchema,runtimeScopeSchema,runtimeReadSchema,runtimeSnapshotSchema} from '../src/logic/runtime/rules/runtime-validation';
import type {DispatchScope} from '../src/logic/tasks/rules/dispatch-scope';
import type {DispatchState,DispatchMutation} from '../src/logic/dispatch/rules/dispatch-storage';
import type {TaskNode} from '../src/logic/tasks/rules/graph-types';
import type {RunSummary,StoredEvent,TaskSpec} from '../src/logic/execution/rules/types';
import type {RuntimeSnapshot} from '../src/logic/runtime/rules/types';

const time='2026-11-07T10:00:00.000Z',later='2026-11-07T10:01:00.000Z';
const scope=(scopeId='scope',rootSessionId='root',workspaceId='workspace'):DispatchScope=>({scopeId,rootSessionId,workspaceId,status:'active',createdAt:time,goal:{revision:1,input:{message:'PRIVATE USER INPUT',attachmentIds:['private-file']}},runTracking:{version:1,mainRunIds:['main-run']}});
function waiting():DispatchScope{
  const base=scope(),stamp={runId:'main-run',recordedAt:time,knowledgeRevision:'private-knowledge',graphCursor:{streamId:'graph',seq:1}};
  const plan={...stamp,revision:2,objective:'PRIVATE OBJECTIVE',constraints:[],criteria:[{id:'human',text:'PRIVATE CRITERION',kind:'human' as const}],assignments:[{agentId:'cbim:main',agentName:'主',teamId:'.cbim/team',moduleIds:[],moduleNames:[],criterionIds:['human'],reason:'PRIVATE ASSIGNMENT'}],reason:'PRIVATE PLAN'};
  const review={...stamp,revision:3,planRevision:2,decision:'awaiting_user' as const,checks:[{criterionId:'human',outcome:'needs_human' as const,reason:'PRIVATE REVIEW',evidence:[]}],superseded:[],gaps:['PRIVATE GAP'],reason:'请补充目标',observedSeq:1,lastEffectSeq:0};
  return {...base,status:'waiting',goal:{...base.goal!,revision:3,plan,review},wait:{waitId:'private-wait',reason:'请补充目标',createdAt:time,runId:stamp.runId,goalRevision:3,graphCursor:stamp.graphCursor,knowledgeRevision:stamp.knowledgeRevision,mainRunIds:['main-run']}};
}
const close=(value:DispatchScope):DispatchScope=>({...value,status:'closed',closedAt:later,outcome:'cancelled'});
function baseline(workspaceId='workspace',roots=['root'],scopes:DispatchScope[]=[]):DispatchState{
  return {workspaceId,members:[],sessions:[],outbox:[],runs:[],scopes,graphs:roots.map(rootSessionId=>({version:1,identity:{workspaceId,rootSessionId},cursor:{workspaceId,rootSessionId,streamId:'graph-'+rootSessionId,seq:1},root:{kind:'session-root',nodeId:'session-'+rootSessionId,identity:{workspaceId,rootSessionId},agent:{agentId:'cbim:main',agentInstanceId:'main-'+rootSessionId,agentSessionId:'session-'+rootSessionId,name:'主'},revision:1,createdAt:time},tasks:[],edges:[],agents:[]}))};
}
function ready(scopes:DispatchScope[]=[]){const manager=new GlobalRuntimeManager(),epoch=manager.begin('workspace','项目');manager.restoreDispatch('workspace',epoch,baseline('workspace',['root','other-root'],scopes));manager.ready('workspace',epoch);return {manager,epoch}}
function dispatch(value:DispatchScope,seq=2):DispatchMutation{
  const identity={workspaceId:value.workspaceId,rootSessionId:value.rootSessionId},agent={agentId:'cbim:executor',agentInstanceId:'executor',agentSessionId:'executor-session',name:'执行者'};
  const task:TaskNode={kind:'task',identity,nodeId:'task-member',taskId:'member-task',scopeId:value.scopeId,requester:agent,assignee:agent,modules:[],goal:'PRIVATE BUSINESS GOAL',acceptance:[],revision:1,planRevision:1,status:'queued',awaitedChildren:[],runIds:[],createdAt:time,updatedAt:time};
  return {receipt:{},scopes:[value],members:[{workspaceId:value.workspaceId,teamId:'team',agentId:agent.agentId,agentInstanceId:agent.agentInstanceId,leaseEpoch:0,configurationRevision:'private-config',agentSessionIds:[agent.agentSessionId],activity:'idle',waitingTaskIds:[],communicatingMessageIds:[]}],batch:{version:1,identity,streamId:'graph-'+identity.rootSessionId,seq,eventId:'event-'+seq,commandId:'command-'+seq,cause:'task.dispatched',committedAt:time,changes:[{type:'task.upserted',task}]}};
}
function completed():RunSummary{
  const task:TaskSpec={workspaceId:'workspace',taskId:'root',root:'C:/private',goal:'PRIVATE INPUT',moduleIds:[],agentId:'cbim:main',acceptance:[],mode:'chat'};
  const events:StoredEvent[]=[{version:1,workspaceId:task.workspaceId,taskId:task.taskId,runId:'main-run',seq:1,time,type:'run.started',data:{task}},{version:1,workspaceId:task.workspaceId,taskId:task.taskId,runId:'main-run',seq:2,time:later,type:'run.settled',data:{status:'completed'}}];
  return {task,runId:'main-run',status:'completed',acceptance:'not_evaluated',unresolvedTools:[],events};
}
const wire=(value:unknown)=>JSON.parse(JSON.stringify(value));

it('只投影有界真实周期字段，不暴露目标正文、等待证明或预算观察',()=>{
  const value=waiting();value.wait!.reason='等'.repeat(300);value.goal!.blocked={reason:'阻'.repeat(300),at:time};
  value.budget={version:1,policy:{revision:1,enabled:true,limits:{tokens:100}},blocked:{decisionId:'private-budget',policyRevision:1,reason:'token_limit',observation:{basis:'private-basis',observedAt:time,registeredRuns:1,coverage:'tracked',consistency:'stable',liveRunIds:[],tokens:100,tokensComplete:true,costComplete:false,unknownRunIds:[]}}};
  const result=projectRuntimeScope(value);expect(result).toMatchObject({hasGoal:true,goalRevision:3,status:'waiting',reviewDecision:'awaiting_user',budgetBlocked:{reason:'token_limit'}});
  expect(result.wait!.reason).toHaveLength(240);expect(result.goalBlocked!.reason).toHaveLength(240);expect(JSON.stringify(result)).not.toMatch(/PRIVATE|private-|attachmentIds|mainRunIds|graphCursor|knowledgeRevision|policy|observation/);
  expect(projectRuntimeScope(close(value))).toMatchObject({status:'closed',outcome:'cancelled',wait:result.wait});
  expect(runtimeScopeSchema.parse(result)).toEqual(result);
});

it('complete审阅只显示申请，只有已提交closed/outcome表示周期结果',()=>{
  const source=waiting(),active={...source,status:'active' as const,wait:undefined,goal:{...source.goal!,review:{...source.goal!.review!,decision:'complete' as const}}};
  expect(projectRuntimeScope(active)).toMatchObject({status:'active',reviewDecision:'complete'});expect(projectRuntimeScope(active)).not.toHaveProperty('outcome');
  expect(projectRuntimeScope({...active,status:'closed',closedAt:later,outcome:'completed'})).toMatchObject({status:'closed',outcome:'completed'});
});

it('scope-only提交推进一次全局游标，图序号和私有清单变化不冒充公开变化',()=>{
  const {manager,epoch}=ready(),before=manager.snapshot();manager.dispatchCommitted('workspace',epoch,{scopes:[scope()],receipt:{}});
  const first=manager.snapshot();expect(first.cursor.revision).toBe(before.cursor.revision+1);expect(first.scopes).toEqual([projectRuntimeScope(scope())]);
  manager.dispatchCommitted('workspace',epoch,{scopes:[{...scope(),runTracking:{version:1,mainRunIds:['main-run','next-run']}}],receipt:{}});
  expect(manager.read(first.cursor)).toEqual({mode:'noop',cursor:first.cursor});
  manager.dispatchCommitted('workspace',epoch,{scopes:[waiting()],receipt:{}});expect(manager.snapshot().cursor.revision).toBe(first.cursor.revision+1);
  manager.dispatchCommitted('workspace',epoch,dispatch(waiting()));expect(manager.snapshot().tasks).toHaveLength(1);
});

it('同事务成员/任务/周期只发布一次版本，真实任务归属和重放保持一致',()=>{
  const {manager,epoch}=ready(),first=manager.snapshot(),mutation=dispatch(scope());manager.dispatchCommitted('workspace',epoch,mutation);
  const next=manager.snapshot();expect(next.cursor.revision).toBe(first.cursor.revision+1);expect(next.members).toHaveLength(1);expect(next.tasks[0]).toMatchObject({scopeId:'scope',source:'dispatch'});expect(next.scopes).toHaveLength(1);
  manager.dispatchCommitted('workspace',epoch,mutation);expect(manager.read(next.cursor)).toEqual({mode:'noop',cursor:next.cursor});expect(runtimeSnapshotSchema.parse(wire(next))).toEqual(wire(next));
});

it('周期和任务的工作区/主会话隔离，覆盖已有周期不改变持久插入顺序',()=>{
  const first=scope(),second=scope('other-scope','other-root'),{manager,epoch}=ready([first,second]);
  const b=manager.begin('second','另一个项目');manager.restoreDispatch('second',b,baseline('second',['root'],[scope('scope','root','second')]));manager.ready('second',b);
  manager.dispatchCommitted('workspace',epoch,{scopes:[close(first)],receipt:{}});
  const next=scope('new-scope');next.createdAt='2026-11-06T00:00:00.000Z';manager.dispatchCommitted('workspace',epoch,{scopes:[next],receipt:{}});
  const snapshot=manager.snapshot();expect(snapshot.scopes.map(value=>[value.workspaceId,value.scopeId])).toEqual([['workspace','scope'],['workspace','other-scope'],['workspace','new-scope'],['second','scope']]);
  expect(runtimeSnapshotSchema.safeParse(snapshot).success).toBe(true);snapshot.scopes[0].outcome='completed';expect(manager.snapshot().scopes[0].outcome).toBe('cancelled');
});

it('周期身份、重复和未知根失败时整批不留下半个成员或任务投影',()=>{
  const {manager,epoch}=ready([scope()]),before=manager.snapshot();
  const changes=[{...scope(),workspaceId:'foreign'},{...scope(),rootSessionId:'missing'},{...scope(),rootSessionId:'other-root'},scope('second-scope'),{...scope(),status:'closed' as const}];
  for(const bad of changes){const mutation=dispatch(bad);if(mutation.batch)mutation.batch.identity={workspaceId:'workspace',rootSessionId:'root'};expect(()=>manager.dispatchCommitted('workspace',epoch,mutation)).toThrow();expect(manager.snapshot()).toEqual(before)}
  expect(()=>manager.dispatchCommitted('workspace',epoch,{scopes:[scope(),scope()],receipt:{}})).toThrow();expect(manager.snapshot()).toEqual(before);
});

it('旧epoch和关闭后迟到的scope提交不改变新投影，关闭保留真实等待历史',()=>{
  const {manager,epoch}=ready([waiting()]);manager.detach('workspace',epoch);const closed=manager.snapshot();manager.dispatchCommitted('workspace',epoch,{scopes:[close(waiting())],receipt:{}});expect(manager.snapshot()).toEqual(closed);expect(closed.scopes[0].status).toBe('waiting');
  const fresh=manager.begin('workspace','重开');manager.restoreDispatch('workspace',fresh,baseline('workspace',['root'],[waiting()]));manager.ready('workspace',fresh);const current=manager.snapshot();manager.dispatchCommitted('workspace',epoch,{scopes:[close(waiting())],receipt:{}});manager.restoreDispatch('workspace',epoch,baseline());expect(manager.snapshot()).toEqual(current);
  manager.forget('workspace');expect(manager.snapshot().scopes).toEqual([]);
});

it('waiting恢复与最近主运行completed同时存在，不启动、不伪造活跃或目标完成',()=>{
  const {manager,epoch}=ready([waiting()]);manager.restoreRun('workspace',epoch,completed());const snapshot=manager.snapshot();
  expect(snapshot.scopes[0]).toMatchObject({status:'waiting',reviewDecision:'awaiting_user'});expect(snapshot.scopes[0]).not.toHaveProperty('outcome');expect(snapshot.tasks[0]).toMatchObject({source:'loop',status:'completed'});expect(snapshot.pressure).toMatchObject({activeRuns:0,activeMembers:0});expect(runtimeSnapshotSchema.safeParse(wire(snapshot)).success).toBe(true);
});

it('旧基线没有scopes保持空集；已知运行也不能反向创建周期或清单',()=>{
  const manager=new GlobalRuntimeManager(),epoch=manager.begin('workspace','旧记录'),old=baseline();delete old.scopes;manager.restoreDispatch('workspace',epoch,old);manager.restoreRun('workspace',epoch,completed());manager.ready('workspace',epoch);
  expect(manager.snapshot().scopes).toEqual([]);expect(manager.snapshot().runs).toHaveLength(1);expect(runtimeSnapshotSchema.safeParse(wire(manager.snapshot())).success).toBe(true);
});

it('预算阻塞scope-only可见但不改目标版本/等待身份，不附带准入许可',()=>{
  const source=waiting(),{manager,epoch}=ready([source]),before=manager.snapshot();source.budget={version:1,policy:{revision:2,enabled:true,limits:{estimatedCostUsd:1}},blocked:{decisionId:'deny',policyRevision:2,reason:'usage_unverifiable',observation:{basis:'proof',observedAt:time,registeredRuns:1,coverage:'tracked',consistency:'stable',liveRunIds:[],tokens:0,tokensComplete:false,costComplete:false,unknownRunIds:['main-run']}}};
  manager.dispatchCommitted('workspace',epoch,{scopes:[source],receipt:{}});const after=manager.snapshot();expect(after.cursor.revision).toBe(before.cursor.revision+1);expect(after.scopes[0]).toEqual({...before.scopes[0],budgetBlocked:{reason:'usage_unverifiable'}});expect(after.pressure).toEqual(before.pressure);expect(after.usage).toEqual(before.usage);
});

it('严格传输拒绝私有字段、矛盾状态、跨身份与重复集合，不给旧客户端补造scopes',()=>{
  const {manager,epoch}=ready([scope()]);manager.dispatchCommitted('workspace',epoch,dispatch(scope()));const snapshot=wire(manager.snapshot()) as RuntimeSnapshot;
  const mutations:Array<(value:any)=>void>=[value=>delete value.scopes,value=>{value.secret='bad'},value=>{value.scopes[0].goal={input:'private'}},value=>{value.scopes[0].hasGoal=false},value=>{value.scopes[0].status='closed'},value=>{value.scopes[0].wait={createdAt:time,reason:'旧等待'}},value=>{value.scopes[0].budgetBlocked={reason:'other'}},value=>{value.scopes.push(value.scopes[0])},value=>{value.scopes[0].workspaceId='foreign'},value=>{value.tasks[0].rootSessionId='other-root'},value=>{value.usage.cost=Infinity},value=>{value.pressure.activeRuns=-1}];
  for(const change of mutations){const bad=structuredClone(snapshot);change(bad);expect(runtimeSnapshotSchema.safeParse(bad).success).toBe(false)}
  expect(runtimeReadSchema.safeParse({mode:'snapshot',cursor:{...snapshot.cursor,revision:snapshot.cursor.revision+1},snapshot}).success).toBe(false);
  expect(runtimeReadSchema.safeParse({mode:'snapshot',cursor:snapshot.cursor,snapshot}).success).toBe(true);expect(runtimeReadSchema.safeParse({mode:'noop',cursor:snapshot.cursor}).success).toBe(true);
  for(const cursor of [{streamId:'../bad',revision:1},{streamId:'stream',revision:-1},{streamId:'stream',revision:1,taskId:'bad'}])expect(runtimeCursorSchema.safeParse(cursor).success).toBe(false);
});

it('未报告消耗保持未知，严格传输不把费用缺省补成零或宣称完整计量',()=>{
  const {manager,epoch}=ready();manager.restoreRun('workspace',epoch,completed());const snapshot=manager.snapshot(),parsed=runtimeSnapshotSchema.parse(wire(snapshot));
  expect(parsed.usage).toMatchObject({runCount:1,reportedRuns:0,unreportedRuns:1,usageReported:false,costPartial:true});expect(parsed.usage).not.toHaveProperty('cost');expect(parsed.complete).toBe(true);
  const spy=vi.spyOn(manager,'snapshot');expect(manager.read(snapshot.cursor)).toEqual({mode:'noop',cursor:snapshot.cursor});expect(spy).not.toHaveBeenCalled();spy.mockRestore();
  expect(manager.read({...snapshot.cursor,revision:snapshot.cursor.revision+10}).mode).toBe('snapshot');expect(manager.read({...snapshot.cursor,streamId:'old-process'}).mode).toBe('snapshot');
});

it('真实存储scope-only提交与重开沿原Observer更新，回执重放及监管读取均无额外文件读取',async()=>{
  const f=await fixture();let store:FileDispatchStore|undefined,reader:FileDispatchStore|undefined;
  try{
    const entry=await f.app.dispatch('add',{path:f.a}),workspace=f.app.workspace(entry.id),directory=path.join(f.user,'runtime-scopes'),manager=new GlobalRuntimeManager(),epoch=manager.begin(entry.id,'真实项目');
    const observer={loaded:(state:DispatchState)=>manager.restoreDispatch(entry.id,epoch,state),committed:(mutation:DispatchMutation)=>manager.dispatchCommitted(entry.id,epoch,mutation),failed:vi.fn()};
    store=new FileDispatchStore(directory,entry.id,observer);const service=new WorkspaceDispatchService(workspace,store),identity={workspaceId:entry.id,rootSessionId:'root'};
    await service.openGraph({...identity,commandId:'root'});manager.ready(entry.id,epoch);const before=manager.snapshot(),graphBefore=(await store.snapshot(identity)).cursor;
    const opened=await service.openScope(identity,'scope',{message:'PRIVATE ORIGINAL INPUT'},'main-run'),first=manager.snapshot();expect(first.cursor.revision).toBe(before.cursor.revision+1);expect((await store.snapshot(identity)).cursor).toEqual(graphBefore);expect(first.scopes).toEqual([projectRuntimeScope(opened)]);
    await service.openScope(identity,'scope',{message:'PRIVATE ORIGINAL INPUT'},'main-run');expect(manager.snapshot()).toEqual(first);
    await service.closeScope(identity,'scope','cancelled');const finished=manager.snapshot(),graphAfter=(await store.snapshot(identity)).cursor;expect(finished.scopes[0]).toMatchObject({status:'closed',outcome:'cancelled'});expect(graphAfter).toEqual(graphBefore);
    const read=vi.spyOn(fs,'readFile');try{expect(manager.read(finished.cursor)).toEqual({mode:'noop',cursor:finished.cursor});expect(read).not.toHaveBeenCalled()}finally{read.mockRestore()}
    await store.close();store=undefined;manager.detach(entry.id,epoch);const reopened=manager.begin(entry.id,'真实项目');reader=new FileDispatchStore(directory,entry.id,{loaded:state=>manager.restoreDispatch(entry.id,reopened,state),committed:()=>{throw Error('恢复不允许新提交')},failed:observer.failed});await reader.read();manager.ready(entry.id,reopened);expect(manager.snapshot().scopes).toEqual(finished.scopes);expect(manager.snapshot().runs).toEqual([]);expect(observer.failed).not.toHaveBeenCalled();
  }finally{await reader?.close();await store?.close();await f.cleanup()}
});
