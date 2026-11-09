import {expect,it} from 'vitest';
import {randomUUID} from 'node:crypto';
import path from 'node:path';
import {fixture} from './helpers';
import {FileDispatchStore} from '../src/backend/main/persistence/tasks/dispatch-store';
import {WorkspaceDispatchService} from '../src/backend/scheduler-engine/execution/dispatch-service';
import type {DispatchScope} from '../src/backend/core/tasks/dispatch-scope';
import type {DispatchState,DispatchMutation} from '../src/backend/core/tasks/dispatch-storage';
import type {DispatchRun} from '../src/backend/core/tasks/dispatch-execution';
import {createScopeRunTracking,appendScopeMainRun,scopeRunTrackingSchema} from '../src/backend/core/tasks/scope-run-tracking';
import {validateDispatchScopes} from '../src/backend/core/tasks/dispatch-scope-invariants';

const time='2026-11-07T10:00:00.000Z';
const scope=(scopeId='scope',rootSessionId='root'):DispatchScope=>({scopeId,workspaceId:'workspace',rootSessionId,status:'active',createdAt:time,goal:{revision:1,input:{message:'原目标',attachmentIds:[]}},runTracking:createScopeRunTracking('first-'+scopeId)});
function state(scopes:DispatchScope[]):DispatchState{return {workspaceId:'workspace',members:[],sessions:[],outbox:[],runs:[],scopes,graphs:[...new Set(scopes.map(s=>s.rootSessionId))].map(rootSessionId=>({version:1,identity:{workspaceId:'workspace',rootSessionId},cursor:{workspaceId:'workspace',rootSessionId,streamId:'stream',seq:1},root:{kind:'session-root',nodeId:'session:'+rootSessionId,identity:{workspaceId:'workspace',rootSessionId},agent:{agentId:'cbim:main',agentInstanceId:'main-'+rootSessionId,agentSessionId:'session-'+rootSessionId,name:'主'},revision:1,createdAt:time},tasks:[],edges:[],agents:[]}))}}
const transition=(before:DispatchScope[],after:DispatchScope[],mutation:DispatchMutation={scopes:after,receipt:true})=>validateDispatchScopes(state(before),state(after),mutation);
function waiting():DispatchScope {
  const base=scope(),stamp={runId:'first-scope',recordedAt:time,knowledgeRevision:'knowledge',graphCursor:{streamId:'stream',seq:1}};
  const plan={...stamp,revision:2,objective:'原目标',constraints:[],criteria:[{id:'human',text:'用户补充',kind:'human' as const}],assignments:[{agentId:'cbim:main',agentName:'主',teamId:'.cbim/team',moduleIds:[],moduleNames:[],criterionIds:['human'],reason:'等待补充'}],reason:'规划'};
  const review={...stamp,revision:3,planRevision:2,decision:'awaiting_user' as const,checks:[{criterionId:'human',outcome:'needs_human' as const,reason:'等待输入',evidence:[]}],superseded:[],gaps:['补充'],reason:'待补充',observedSeq:1,lastEffectSeq:0};
  return {...base,status:'waiting',goal:{...base.goal!,revision:3,plan,review},wait:{waitId:randomUUID(),reason:'待补充',createdAt:time,runId:stamp.runId,goalRevision:3,graphCursor:stamp.graphCursor,knowledgeRevision:stamp.knowledgeRevision,mainRunIds:['first-scope']}};
}

it('新清单严格首轮，主运行有序追加且重复不增；legacy不升级',()=>{
  const first=scope();expect(()=>transition([], [first])).not.toThrow();
  const next=appendScopeMainRun(first,'second');expect(next.runTracking?.mainRunIds).toEqual(['first-scope','second']);expect(first.runTracking?.mainRunIds).toEqual(['first-scope']);expect(appendScopeMainRun(next,'second')).toBe(next);expect(()=>transition([first],[next])).not.toThrow();
  expect(()=>transition([], [next])).toThrow();
  const {runTracking:_omit,...legacy}=first;expect(appendScopeMainRun(legacy,'second')).toBe(legacy);
  expect(()=>transition([legacy],[first])).toThrow();expect(()=>transition([first],[legacy])).toThrow();
  for(const ids of [[],['same','same'],['../foreign'],Array.from({length:33},(_,i)=>'run-'+i)])expect(scopeRunTrackingSchema.safeParse({version:1,mainRunIds:ids}).success).toBe(false);
  expect(scopeRunTrackingSchema.safeParse({version:1,mainRunIds:['first'],extra:true}).success).toBe(false);
});

it('拒绝清单改写、跳增、伴随目标变更和封存追加，32轮不可突破',()=>{
  const before=appendScopeMainRun(scope(),'second');
  for(const mainRunIds of [['second','first-scope'],['first-scope'],['first-scope','other'],['first-scope','second','third','fourth']])expect(()=>transition([before],[{...before,runTracking:{version:1,mainRunIds}}])).toThrow();
  const after=appendScopeMainRun(before,'third');expect(()=>transition([before],[{...after,goal:{...after.goal!,blocked:{reason:'旁路修改',at:time}}}])).toThrow();
  const closed={...before,status:'closed' as const,closedAt:time,outcome:'cancelled' as const};expect(()=>transition([before],[closed])).not.toThrow();expect(()=>transition([closed],[{...closed,runTracking:after.runTracking}])).toThrow();
  const full={...scope(),runTracking:{version:1 as const,mainRunIds:Array.from({length:32},(_,i)=>'run-'+i)}};expect(()=>appendScopeMainRun(full,'overflow')).toThrowError(expect.objectContaining({code:'GOAL_CYCLE_LIMIT'}));
});

it('主run全工作区唯一且不得借用其他周期旧意图或成员run',()=>{
  const first=scope(),other=scope('other','other-root');other.runTracking=createScopeRunTracking('first-scope');expect(()=>transition([],[first,other])).toThrow();
  const legacy={...waiting(),scopeId:'legacy',rootSessionId:'legacy-root',runTracking:undefined,status:'closed' as const,closedAt:time,outcome:'cancelled' as const};expect(()=>transition([legacy],[legacy])).not.toThrow();
  expect(()=>transition([legacy],[legacy,first],{scopes:[first],receipt:true})).toThrow();
  const next=state([first]);next.runs=[{binding:{runId:'first-scope'}} as DispatchRun];expect(()=>validateDispatchScopes(state([]),next,{scopes:[first],receipt:true})).toThrow();
});

it('waiting只能在合法补充事务中追加，检查点必须是完整有序前缀',()=>{
  const parked=waiting();expect(()=>transition([parked],[parked])).not.toThrow();
  const {wait, ...rest}=parked,{review:_review,...goal}=parked.goal!;
  const continued=appendScopeMainRun({...rest,status:'active' as const,goal:{...goal,revision:4,inputRevision:2},continuations:[{continuationId:randomUUID(),acceptedAt:time,wait:wait!,inputRevision:2,input:{message:'补充'},runId:'continued',options:{provider:'fixture',model:'fixture',profileId:randomUUID(),permission:'read' as const}}]},'continued');
  expect(()=>transition([parked],[continued])).not.toThrow();
  expect(()=>transition([parked],[{...continued,runTracking:parked.runTracking}])).toThrow();
  expect(()=>transition([parked],[{...parked,runTracking:{version:1,mainRunIds:['first-scope','extra']}}])).toThrow();
  const bad=structuredClone(continued);bad.continuations[0].wait.mainRunIds=['different'];expect(()=>transition([parked],[bad])).toThrow();
  const nextWaiting={...continued,status:'waiting' as const,wait:{...wait!,mainRunIds:['continued','first-scope']}};expect(()=>transition([continued],[nextWaiting])).toThrow();
});

it('完整清单中的计划和审阅不能借用未登记主轮',()=>{
  const parked=waiting(),active={...parked,status:'active' as const,wait:undefined};
  for(const field of ['plan','review'] as const){const bad=structuredClone(active);bad.goal![field]!.runId='unregistered';expect(()=>transition([active],[bad])).toThrow()}
});

it('真实存储提交与重放保护主轮清单，追加不推进任务图，关闭后仍完整保留',async()=>{
  const f=await fixture();let store:FileDispatchStore|undefined,reader:FileDispatchStore|undefined;
  try{
    const entry=await f.app.dispatch('add',{path:f.a}),workspace=f.app.workspace(entry.id),directory=path.join(f.user,'tracked-scopes');store=new FileDispatchStore(directory,entry.id);
    const dispatch=new WorkspaceDispatchService(workspace,store),identity={workspaceId:entry.id,rootSessionId:'tracked-root'};await dispatch.openGraph({...identity,commandId:'root'});
    const first={...scope(),...identity,createdAt:new Date().toISOString()};await store.transact({commandId:'first',fingerprint:'first'},async()=>({scopes:[first],receipt:true}));const graph=(await store.snapshot(identity)).cursor;
    const next=appendScopeMainRun(first,'second');await store.transact({commandId:'second',fingerprint:'second'},async()=>({scopes:[next],receipt:true}));expect((await store.snapshot(identity)).cursor).toEqual(graph);
    await expect(store.transact({commandId:'rewrite',fingerprint:'rewrite'},async()=>({scopes:[first],receipt:true}))).rejects.toMatchObject({code:'GRAPH_INPUT_INVALID'});
    await dispatch.closeScope(identity,first.scopeId,'cancelled');const expected=await store.read();await store.close();store=undefined;
    reader=new FileDispatchStore(directory,entry.id);expect(await reader.read()).toEqual(expected);expect((await reader.read()).scopes![0].runTracking?.mainRunIds).toEqual(['first-scope','second']);
  }finally{await reader?.close();await store?.close();await f.cleanup()}
});
