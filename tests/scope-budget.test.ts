import {expect,it} from 'vitest';
import {randomUUID} from 'node:crypto';
import path from 'node:path';
import {scopeBudgetPolicySchema,createScopeBudget,evaluateScopeBudget,type ScopeBudgetObservation,type ScopeBudgetPolicy,type ScopeBudgetAdmission} from '../src/backend/core/budget/scope-budget';
import {validateScopeBudgets} from '../src/backend/core/budget/scope-budget-invariants';
import {validateDispatchScopes} from '../src/backend/core/tasks/dispatch-scope-invariants';
import {emptyScopeSnapshot,summarizeScope,applyScopeBatch,validateScopeSnapshot,readScopeDetail} from '../src/backend/core/tasks/scope-view';
import type {DispatchScope} from '../src/backend/core/tasks/dispatch-scope';
import type {DispatchState,DispatchMutation} from '../src/backend/core/dispatch/dispatch-storage';
import type {DispatchRun} from '../src/backend/core/tasks/dispatch-execution';
import type {TaskNode} from '../src/backend/core/tasks/graph-types';
import {fixture} from './helpers';
import {FileDispatchStore} from '../src/backend/main/dispatch-storage/dispatch-store';
import {WorkspaceDispatchService} from '../src/backend/scheduler-engine/dispatch/dispatch-service';

const at='2026-11-07T10:00:00.000Z';
const policy:ScopeBudgetPolicy={revision:3,enabled:true,limits:{tokens:100}};
const observed=(patch:Partial<ScopeBudgetObservation>={}):ScopeBudgetObservation=>({basis:'basis',observedAt:at,registeredRuns:1,coverage:'tracked',consistency:'stable',liveRunIds:[],tokens:20,tokensComplete:true,estimatedCostUsd:0.02,costComplete:true,unknownRunIds:[],...patch});
const proof=(runId='main-1',observation=observed({registeredRuns:0,tokens:0,estimatedCostUsd:0,tokensComplete:false,costComplete:false})):ScopeBudgetAdmission=>({runId,kind:'main',taskId:'root',policyRevision:3,observation});
const scope=():DispatchScope=>({workspaceId:'workspace',rootSessionId:'root',scopeId:'scope',status:'active',createdAt:at,goal:{revision:1,input:{message:'原目标',attachmentIds:[]}},runTracking:{version:1,mainRunIds:['main-1']},budget:{...createScopeBudget(policy),lastAdmission:proof()}});
function state(scopes:DispatchScope[],runs:DispatchRun[]=[]):DispatchState{return {workspaceId:'workspace',members:[],sessions:[],outbox:[],runs,scopes,graphs:[{version:1,identity:{workspaceId:'workspace',rootSessionId:'root'},cursor:{workspaceId:'workspace',rootSessionId:'root',streamId:'stream',seq:1},root:{kind:'session-root',nodeId:'session:root',identity:{workspaceId:'workspace',rootSessionId:'root'},agent:{agentId:'cbim:main',agentInstanceId:'main-instance',agentSessionId:'main-session',name:'主'},revision:1,createdAt:at},tasks:[],edges:[],agents:[]}]}}
function transition(before:DispatchScope[],after:DispatchScope[],mutation:DispatchMutation={scopes:after,receipt:true}){validateDispatchScopes(state(before),state(after),mutation)}
function parked():DispatchScope {
  const base=scope(),stamp={runId:'main-1',recordedAt:at,knowledgeRevision:'knowledge',graphCursor:{streamId:'stream',seq:1}};
  const plan={...stamp,revision:2,objective:'原目标',constraints:[],criteria:[{id:'human',text:'用户补充',kind:'human' as const}],assignments:[{agentId:'cbim:main',agentName:'主',teamId:'.cbim/team',moduleIds:[],moduleNames:[],criterionIds:['human'],reason:'等待补充'}],reason:'规划'};
  const review={...stamp,revision:3,planRevision:2,decision:'awaiting_user' as const,checks:[{criterionId:'human',outcome:'needs_human' as const,reason:'等待输入',evidence:[]}],superseded:[],gaps:['补充'],reason:'待补充',observedSeq:1,lastEffectSeq:0};
  return {...base,status:'waiting',goal:{...base.goal!,revision:3,plan,review},wait:{waitId:randomUUID(),reason:'待补充',createdAt:at,runId:'main-1',goalRevision:3,graphCursor:stamp.graphCursor,knowledgeRevision:stamp.knowledgeRevision,mainRunIds:['main-1']}};
}

it('默认关闭且不共享可变配置；启用须明确正数，拒绝未知字段/非安全数',()=>{
  expect(createScopeBudget().policy).toEqual({revision:1,enabled:false,limits:{}});
  const copied=createScopeBudget(policy);copied.policy.limits.tokens=1;expect(policy.limits.tokens).toBe(100);
  expect(scopeBudgetPolicySchema.safeParse({revision:1,enabled:false,limits:{tokens:50}}).success).toBe(true);
  for(const value of [{revision:1,enabled:true,limits:{}},{revision:0,enabled:false,limits:{}},{...policy,limits:{tokens:0}},{...policy,limits:{tokens:1.5}},{...policy,limits:{tokens:Number.MAX_SAFE_INTEGER+1}},{...policy,limits:{estimatedCostUsd:Infinity}},{...policy,limits:{estimatedCostUsd:0}},{...policy,limits:{tokens:50,currency:'USD'}},{...policy,authorization:true}])expect(scopeBudgetPolicySchema.safeParse(value).success).toBe(false);
  expect(evaluateScopeBudget(createScopeBudget().policy,observed({tokens:999,tokensComplete:false}))).toEqual({kind:'disabled'});
});

it('只限制下一轮，等于阈值拒绝，Token-only不因未知价格拒绝',()=>{
  expect(evaluateScopeBudget(policy,observed({tokens:99,costComplete:false,estimatedCostUsd:undefined}))).toEqual({kind:'allow'});
  expect(evaluateScopeBudget(policy,observed({tokens:100}))).toMatchObject({kind:'deny',reason:'token_limit'});
  const both={...policy,limits:{tokens:100,estimatedCostUsd:0.02}};
  expect(evaluateScopeBudget(both,observed())).toMatchObject({kind:'deny',reason:'cost_limit'});
  expect(evaluateScopeBudget({...policy,limits:{estimatedCostUsd:1}},observed({tokensComplete:false}))).toEqual({kind:'allow'});
  expect(evaluateScopeBudget(both,observed({estimatedCostUsd:undefined,costComplete:false,unknownRunIds:['main-1']}))).toMatchObject({kind:'deny',reason:'usage_unverifiable',unknownRunIds:['main-1']});
});

it('可信在途优先等待；已结束未知/旧归属/读取竞争拒绝，空新周期允许首次',()=>{
  expect(evaluateScopeBudget(policy,observed({tokens:1000,tokensComplete:false,liveRunIds:['main-1'],unknownRunIds:['main-1']}))).toEqual({kind:'wait',runIds:['main-1']});
  for(const patch of [{tokensComplete:false},{coverage:'legacy' as const},{consistency:'changed_during_read' as const}])expect(evaluateScopeBudget(policy,observed(patch))).toMatchObject({kind:'deny',reason:'usage_unverifiable'});
  expect(evaluateScopeBudget(policy,observed({unknownRunIds:['main-1']}))).toMatchObject({kind:'deny',reason:'usage_unverifiable'});
  expect(evaluateScopeBudget(policy,observed({registeredRuns:0,tokens:0,estimatedCostUsd:undefined,tokensComplete:false,costComplete:false}))).toEqual({kind:'allow'});
  expect(evaluateScopeBudget(policy,observed({registeredRuns:0,tokens:2}))).toMatchObject({kind:'deny',reason:'usage_unverifiable'});
});

it('金额阈值容忍真实浮点尾差，明显低于和极小正额度不误拦',()=>{
  const money={...policy,limits:{estimatedCostUsd:0.00042}};
  expect(evaluateScopeBudget(money,observed({estimatedCostUsd:0.00041999999999999996}))).toMatchObject({kind:'deny',reason:'cost_limit'});
  expect(evaluateScopeBudget(money,observed({estimatedCostUsd:0.000419}))).toEqual({kind:'allow'});
  expect(evaluateScopeBudget({...money,limits:{estimatedCostUsd:1e-20}},observed({estimatedCostUsd:0}))).toEqual({kind:'allow'});
  expect(evaluateScopeBudget({...money,limits:{estimatedCostUsd:Number.MIN_VALUE}},observed({estimatedCostUsd:0}))).toEqual({kind:'allow'});
});

it('启用周期首轮和追加需同事务证明；冻结策略、旧缺省及运行计数不可伪造',()=>{
  const first=scope();expect(()=>transition([],[first])).not.toThrow();
  const next={...first,runTracking:{version:1 as const,mainRunIds:['main-1','main-2']},budget:{...first.budget!,lastAdmission:proof('main-2')}};
  expect(()=>transition([first],[next])).toThrow(); // 默认 proof 的观察只有空集合，不能漏算首轮。
  next.budget.lastAdmission=proof('main-2',observed());expect(()=>transition([first],[next])).not.toThrow();
  expect(()=>transition([first],[next],{receipt:true})).toThrow();
  for(const altered of [{...first,budget:{...first.budget!,policy:{...policy,revision:4}}},{...first,budget:undefined},{...next,budget:first.budget},{...first,budget:{...first.budget!,lastAdmission:proof('standalone',observed())}}])expect(()=>transition([first],[altered])).toThrow();
  const legacy={...first,budget:undefined};expect(()=>transition([legacy],[first])).toThrow();expect(()=>transition([legacy],[legacy])).not.toThrow();
  const bad=structuredClone(next);bad.budget.lastAdmission.observation.unknownRunIds=['foreign'];expect(()=>transition([first],[bad])).toThrow();
});

it('成员claim必须绑定实际task和同周期证明，不能并行跨过未结算运行',()=>{
  const first=scope(),previous=state([first]);
  previous.graphs[0].tasks=[{taskId:'task',scopeId:'scope'} as TaskNode];
  const run={binding:{workspaceId:'workspace',rootSessionId:'root',taskId:'task',runId:'member-1'},status:'starting'} as DispatchRun;
  const next=structuredClone(previous);next.runs=[run];next.scopes![0].budget!.lastAdmission={runId:'member-1',kind:'member',taskId:'task',policyRevision:3,observation:observed()};
  const mutation={scopes:next.scopes,runs:[run],receipt:true};expect(()=>validateScopeBudgets(previous,next,mutation)).not.toThrow();
  const wrong=structuredClone(next);wrong.scopes![0].budget!.lastAdmission!.taskId='other';expect(()=>validateScopeBudgets(previous,wrong,mutation)).toThrow();
  expect(()=>validateScopeBudgets(previous,next,{runs:[run],receipt:true})).toThrow();
  previous.runs=[{...run,binding:{...run.binding,runId:'member-old'}}];next.runs!.push(previous.runs[0]);next.scopes![0].budget!.lastAdmission!.observation.registeredRuns=2;
  expect(()=>validateScopeBudgets(previous,next,{...mutation,scopes:next.scopes})).toThrow();
});

it('安全waiting仅追加预算拒绝，不能消费检查点；普通完成/停止仍可结束',()=>{
  const waiting=parked(),blocked={...waiting,budget:{...waiting.budget!,blocked:{decisionId:'denied',policyRevision:3,reason:'token_limit' as const,observation:observed({tokens:100})}}};
  expect(()=>transition([waiting],[blocked])).not.toThrow();expect(blocked.wait).toBe(waiting.wait);expect(blocked.goal).toBe(waiting.goal);
  expect(()=>transition([blocked],[{...blocked,status:'closed',closedAt:at,outcome:'cancelled'}])).not.toThrow();
  expect(()=>transition([waiting],[blocked],{scopes:[blocked],messages:[],batch:{} as never,receipt:true})).toThrow();
  expect(()=>transition([blocked],[waiting])).toThrow();
  const changed=structuredClone(blocked);changed.goal!.revision++;expect(()=>transition([waiting],[changed])).toThrow();
  const first=scope();expect(()=>transition([first],[{...first,status:'closed',closedAt:at,outcome:'completed'}])).not.toThrow();
  const closed={...blocked,status:'closed' as const,closedAt:at,outcome:'cancelled' as const};expect(()=>transition([closed],[{...closed,budget:waiting.budget}])).toThrow();
});

it('拒绝事实与实际观察须一致且永久保留，不允许伪造原因或恢复启动',()=>{
  const first=scope(),blocked={...first,budget:{...first.budget!,blocked:{decisionId:'denied',policyRevision:3,reason:'token_limit' as const,observation:observed({tokens:100})}}};
  expect(()=>transition([first],[blocked])).not.toThrow();
  for(const patch of [{tokens:50},{registeredRuns:0,tokens:100},{liveRunIds:['main-1']}]){const bad=structuredClone(blocked);Object.assign(bad.budget.blocked.observation,patch);expect(()=>transition([first],[bad])).toThrow()}
  const badReason=structuredClone(blocked);badReason.budget.blocked.reason='cost_limit' as 'token_limit';expect(()=>transition([first],[badReason])).toThrow();
  const restarted={...blocked,runTracking:{version:1 as const,mainRunIds:['main-1','main-2']},budget:{...blocked.budget,lastAdmission:proof('main-2',observed())}};expect(()=>transition([blocked],[restarted])).toThrow();
});

it('scope增量公开冻结策略和拒绝，证明仅在详情，legacy不补策略',()=>{
  const first=scope(),identity={workspaceId:'workspace',rootSessionId:'root'},empty=emptyScopeSnapshot(identity,'graph');
  const initial=applyScopeBatch(empty,{identity,streamId:empty.cursor.streamId,seq:1,scopes:[summarizeScope(first,empty.cursor.streamId,1)]});validateScopeSnapshot(initial);
  expect(initial.scopes[0].budget).toEqual({policy});expect(initial.scopes[0].budget).not.toHaveProperty('lastAdmission');
  const detail=readScopeDetail(initial,[first]);expect(detail.mode==='updated'&&detail.scope.budget?.lastAdmission).toEqual(first.budget?.lastAdmission);
  const blocked={...first,budget:{...first.budget!,blocked:{decisionId:'denied',policyRevision:3,reason:'token_limit' as const,observation:observed({tokens:100})}}};
  const updated=applyScopeBatch(initial,{identity,streamId:initial.cursor.streamId,seq:2,scopes:[summarizeScope(blocked,initial.cursor.streamId,2)]});validateScopeSnapshot(updated);
  expect(updated.scopes[0].goalRevision).toBe(initial.scopes[0].goalRevision);expect(updated.scopes[0].stamp.seq).toBe(2);expect(readScopeDetail(updated,[blocked],undefined,initial.scopes[0].stamp).mode).toBe('updated');
  expect(summarizeScope({...first,budget:undefined},'stream',1).budget).toBeUndefined();
});

it('真实事务重开保留冻结额度和拒绝，预算独立增量不推进任务图',async()=>{
  const f=await fixture();let writer:FileDispatchStore|undefined,reader:FileDispatchStore|undefined;
  try{
    const entry=await f.app.dispatch('add',{path:f.a}),owner=f.app.workspace(entry.id),directory=path.join(f.user,'budget-scopes');writer=new FileDispatchStore(directory,entry.id);const dispatch=new WorkspaceDispatchService(owner,writer),identity={workspaceId:entry.id,rootSessionId:'root'};await dispatch.openGraph({...identity,commandId:'graph'});
    const first={...scope(),...identity,createdAt:new Date().toISOString()};await writer.transact({commandId:'first',fingerprint:'first'},async()=>({scopes:[first],receipt:true}));const graph=(await writer.snapshot(identity)).cursor;
    const blocked={...first,budget:{...first.budget!,blocked:{decisionId:'denied',policyRevision:3,reason:'token_limit' as const,observation:observed({tokens:100})}}};
    await writer.transact({commandId:'block',fingerprint:'block'},async()=>({scopes:[blocked],receipt:true}));expect((await writer.snapshot(identity)).cursor).toEqual(graph);
    const view=await writer.sessionRead({identity});expect(view.scopes.mode==='reset'&&view.scopes.snapshot.scopes[0].budget?.blocked?.reason).toBe('token_limit');
    await dispatch.closeScope(identity,'scope','cancelled');const expected=await writer.read();await writer.close();writer=undefined;
    reader=new FileDispatchStore(directory,entry.id);expect(await reader.read()).toEqual(expected);
  }finally{await reader?.close();await writer?.close();await f.cleanup()}
});
