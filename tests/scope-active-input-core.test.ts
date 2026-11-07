import {expect,it} from 'vitest';
import {randomUUID} from 'node:crypto';
import {hash,json} from '../src/backend/core/foundation/serialization';
import type {DispatchState} from '../src/backend/core/tasks/dispatch-storage';
import type {DispatchScope} from '../src/backend/core/tasks/dispatch-scope';
import {dispatchScopeGoalSchema,type DispatchScopeGoal} from '../src/backend/core/tasks/scope-goal';
import {validateDispatchScopes} from '../src/backend/core/tasks/dispatch-scope-invariants';
import {scopeActiveInputSchema,scopeActiveInputSendReceiptSchema,scopeActiveInputStatus,validateScopeInputHistory,type ScopeActiveInput,type AcceptedScopeActiveInput} from '../src/backend/core/tasks/scope-active-input';
import {scopedActiveInputHash,validateScopeActiveInputs} from '../src/backend/core/tasks/scope-active-input-rules';
import {mainToolScopeSchema,projectMainScope} from '../src/backend/core/tasks/main-tool-scope';
import {summarizeScope,emptyScopeSnapshot,validateScopeSnapshot} from '../src/backend/core/tasks/scope-view';
import {currentHumanContinuation} from '../src/backend/core/tasks/human-continuation-rules';
import {humanFixture,continued} from './human-continuation-core-fixture';

const at='2026-11-07T08:00:00.000Z',later='2026-11-07T08:00:01.000Z';
const identity={workspaceId:'workspace',rootSessionId:'root'},cursor={streamId:'stream',seq:1};
function fixture(goal?:DispatchScopeGoal):DispatchState{
  const agent={agentId:'cbim:main',agentInstanceId:'main',agentSessionId:'session',name:'主调度'};
  return {workspaceId:identity.workspaceId,members:[],sessions:[],outbox:[],runs:[],graphs:[{version:1,identity,cursor:{...identity,...cursor},root:{kind:'session-root',nodeId:'session:root',identity,agent,revision:1,createdAt:at},tasks:[],edges:[],agents:[{agentInstanceId:'main',agentId:'cbim:main',name:'主调度',revision:1,state:'idle',waitingTaskIds:[]}]}],scopes:[{scopeId:'scope',...identity,status:'active',createdAt:at,runTracking:{version:1,mainRunIds:['run']},goal:goal??{revision:1,input:{message:'原始目标',attachmentIds:[]}}}]};
}
const scope=(state:DispatchState)=>state.scopes![0];
function check(before:DispatchState,after:DispatchState){validateDispatchScopes(before,after,{scopes:[scope(after)],receipt:true})}
function prepare(before:DispatchState,message='新增约束',index=0):DispatchState{
  const next=structuredClone(before),value=scope(next),goal=value.goal!;
  const queueId='queue-'+index,runId=value.runTracking!.mainRunIds.at(-1)!,input={message},item:ScopeActiveInput={insertionId:hash(json({scopeId:value.scopeId,runId,queueId})),queueId,runId,preparedAt:later,baseGoalRevision:goal.revision,baseInputRevision:goal.inputRevision??1,inputHash:scopedActiveInputHash(input),messageBytes:new TextEncoder().encode(message).byteLength,messageCharacters:message.length,status:'pending'};
  value.activeInputs=[...(value.activeInputs??[]),item];return next;
}
function accept(before:DispatchState,message='新增约束'):DispatchState{
  const next=structuredClone(before),value=scope(next),item=value.activeInputs!.at(-1)!;
  const seq=10+(value.activeInputs!.length-1)*2;
  const record:AcceptedScopeActiveInput={...item,status:'accepted',acceptedAt:later,inputRevision:item.baseInputRevision+1,goalRevision:item.baseGoalRevision+1,input:{message,...(item.attachmentIds?{attachmentIds:item.attachmentIds}:{})},requestedSeq:seq,acceptedSeq:seq+1};
  value.activeInputs![value.activeInputs!.length-1]=record;
  const {review:_,...goal}=value.goal!;value.goal={...goal,revision:record.goalRevision,inputRevision:record.inputRevision};return next;
}
function planned():DispatchScopeGoal{
  return {revision:3,input:{message:'原始目标',attachmentIds:[]},plan:{revision:2,inputRevision:1,runId:'run',recordedAt:at,knowledgeRevision:'knowledge',graphCursor:cursor,objective:'原始目标',constraints:[],criteria:[{id:'proof',text:'真实证据',kind:'evidence'}],assignments:[{agentId:'cbim:main',agentName:'主调度',teamId:'team',moduleIds:[],moduleNames:[],criterionIds:['proof'],reason:'知识治理'}],reason:'计划'},review:{revision:3,inputRevision:1,planRevision:2,runId:'run',recordedAt:at,knowledgeRevision:'knowledge',graphCursor:cursor,observedSeq:5,lastEffectSeq:0,decision:'complete',checks:[{criterionId:'proof',outcome:'satisfied',reason:'有据',evidence:[{kind:'main-knowledge',toolCallIds:['read']}]}],superseded:[],gaps:[],reason:'完成申请'}};
}

it('普通无计划对话准备不增版，真实接受增版且保留初始输入/同一run',()=>{
  const initial=fixture(),pending=prepare(initial);check(initial,pending);
  expect(scope(pending).goal).toEqual(scope(initial).goal);
  const accepted=accept(pending);check(pending,accepted);
  expect(scope(accepted).goal).toEqual({revision:2,inputRevision:2,input:scope(initial).goal!.input});
  expect(scope(accepted).runTracking).toEqual(scope(initial).runTracking);
  expect(dispatchScopeGoalSchema.safeParse(scope(accepted).goal).success).toBe(true);
  expect(mainToolScopeSchema.safeParse(projectMainScope(scope(accepted))).success).toBe(true);
  const next=prepare(accepted,'第二项',1),done=accept(next,'第二项');check(accepted,next);check(next,done);
  expect(scope(done).goal?.inputRevision).toBe(3);
});

it('完整审阅后接受只清旧review，保留计划及人工条件，不允许自行增版',()=>{
  const initial=fixture(planned()),pending=prepare(initial),accepted=accept(pending);check(initial,pending);check(pending,accepted);
  expect(scope(accepted).goal).toMatchObject({revision:4,inputRevision:2,plan:scope(initial).goal!.plan});expect(scope(accepted).goal?.review).toBeUndefined();
  const bad=structuredClone(accepted);scope(bad).goal!.review=scope(initial).goal!.review;expect(()=>check(pending,bad)).toThrow();
  const staleComplete=structuredClone(accepted);Object.assign(scope(staleComplete),{status:'closed',outcome:'completed',closedAt:later});expect(()=>check(accepted,staleComplete)).toThrow('旧计划完成');expect(mainToolScopeSchema.safeParse(projectMainScope(scope(staleComplete))).success).toBe(false);
  const forged=structuredClone(initial);scope(forged).goal!.inputRevision=2;expect(()=>check(initial,forged)).toThrow();
});

it.each(['rejected','unknown'] as const)('%s 不增版且终态不可改写；unknown禁止普通聊天完成',status=>{
  const initial=fixture(),pending=prepare(initial),next=structuredClone(pending);
  scope(next).activeInputs![0]={...scope(next).activeInputs![0],status,resolvedAt:later,reason:'发送事实'};
  check(pending,next);expect(scope(next).goal).toEqual(scope(initial).goal);
  expect(()=>check(next,accept(next))).toThrow();
  for(const outcome of ['completed','cancelled','failed','interrupted'] as const){
    const closed=structuredClone(next);Object.assign(scope(closed),{status:'closed',outcome,closedAt:later});
    if(status==='unknown'&&outcome==='completed')expect(()=>check(next,closed)).toThrow();else check(next,closed);
  }
});

it('pending不允许另一次准备/规划/完成或夹带任务、权限与原输入变更',()=>{
  const initial=fixture(),pending=prepare(initial);check(initial,pending);
  expect(()=>check(pending,prepare(pending,'新消息',1))).toThrow();
  const plan=structuredClone(pending);scope(plan).goal=planned();expect(()=>check(pending,plan)).toThrow();
  const done=structuredClone(pending);Object.assign(scope(done),{status:'closed',closedAt:later,outcome:'completed'});expect(()=>check(pending,done)).toThrow();
  const accepted=accept(pending);scope(accepted).goal!.input.message='改掉原文';expect(()=>check(pending,accepted)).toThrow();
  const other=prepare(initial);expect(()=>validateDispatchScopes(initial,other,{scopes:other.scopes,members:[{} as never],receipt:true})).toThrow();
});

it('严格绑定正文hash/字节/附件、原run和仅一次真实日志序号',()=>{
  const pending=prepare(fixture()),accepted=accept(pending),record=scope(accepted).activeInputs![0];
  for(const patch of [{inputHash:'b'.repeat(64)},{messageBytes:1},{messageCharacters:1},{runId:'other'},{baseGoalRevision:2},{acceptedSeq:10},{attachmentIds:[randomUUID()]},{inputRevision:3},{arbitrary:true}]){
    const bad=structuredClone(accepted);Object.assign(scope(bad).activeInputs![0],patch);expect(()=>check(pending,bad)).toThrow();
  }
  const token={scopeId:'scope',insertionId:record.insertionId,queueId:record.queueId,runId:'run',inputHash:record.inputHash,requestedSeq:10,acceptedSeq:11};
  expect(scopeActiveInputSendReceiptSchema.safeParse(token).success).toBe(true);expect(scopeActiveInputSendReceiptSchema.safeParse({...token,acceptedSeq:9}).success).toBe(false);
});

it('输入次数/64决策及正文预留在pending提交前拒绝，不回写截断内容',()=>{
  const initial=fixture(planned());scope(initial).goal!.revision=63;scope(initial).goal!.review!.revision=63;
  expect(()=>check(initial,prepare(initial))).toThrow();
  const large='字'.repeat(180000),pending=prepare(fixture(),large);expect(scopeActiveInputSchema.safeParse(scope(pending).activeInputs![0]).success).toBe(false);
  const first=prepare(fixture(),'x'.repeat(200000)),accepted=accept(first,'x'.repeat(200000));check(fixture(),first);check(first,accepted);
  expect(()=>check(accepted,prepare(accepted,'x'.repeat(60001),1))).toThrow();
  const revisions=Array.from({length:31},(_,index)=>({inputRevision:index+2}));expect(()=>validateScopeInputHistory({goal:{inputRevision:32},continuations:revisions})).not.toThrow();
  expect(()=>validateScopeInputHistory({goal:{inputRevision:32},continuations:[...revisions,{inputRevision:33}]})).toThrow();
});

it('active与waiting混合输入有序且无缺口，旧continuations形状无需补字段',()=>{
  const a=scope(accept(prepare(fixture()))).activeInputs![0];
  expect(()=>validateScopeInputHistory({goal:{inputRevision:4},activeInputs:[a,{...a,insertionId:'b'.repeat(64),status:'accepted',baseGoalRevision:3,goalRevision:4,baseInputRevision:3,inputRevision:4} as AcceptedScopeActiveInput],continuations:[{inputRevision:3}]})).not.toThrow();
  for(const values of [[{inputRevision:2}],[{inputRevision:4}],[{inputRevision:3},{inputRevision:3}]])expect(()=>validateScopeInputHistory({goal:{inputRevision:values.length+2},activeInputs:[a],continuations:values})).toThrow();
  expect(()=>validateScopeInputHistory({goal:{},continuations:[]})).not.toThrow();
  expect(Object.hasOwn(projectMainScope(scope(fixture())),'activeInputs')).toBe(false);
});

it('同一队列明确拒绝后只有新run可显式准备，旧attempt永久保留',()=>{
  const pending=prepare(fixture()),rejected=structuredClone(pending);
  scope(rejected).activeInputs![0]={...scope(rejected).activeInputs![0],status:'rejected',resolvedAt:later,reason:'确认未发送'};check(pending,rejected);
  const duplicate=prepare(rejected);expect(()=>check(rejected,duplicate)).toThrow();
  const registered=structuredClone(rejected);scope(registered).runTracking!.mainRunIds.push('run-2');check(rejected,registered);
  const fresh=prepare(registered);check(registered,fresh);expect(scope(fresh).activeInputs![0]).toEqual(scope(rejected).activeInputs![0]);
  expect(scope(fresh).activeInputs![1].insertionId).not.toBe(scope(rejected).activeInputs![0].insertionId);
  const unknown=structuredClone(pending);scope(unknown).activeInputs![0]={...scope(unknown).activeInputs![0],status:'unknown',resolvedAt:later,reason:'无法确定'};
  const nextRun=structuredClone(unknown);scope(nextRun).runTracking!.mainRunIds.push('run-2');expect(()=>check(unknown,nextRun)).toThrow();
});

it('真实active→waiting→continuation→active混合事务保留原字段与连续输入版本',()=>{
  const pending=prepare(fixture()),accepted=accept(pending);check(pending,accepted);
  const planning=structuredClone(accepted);scope(planning).goal={...scope(planning).goal!,revision:3,plan:{...planned().plan!,revision:3,inputRevision:2,recordedAt:later}};check(accepted,planning);
  const reviewing=structuredClone(planning);scope(reviewing).goal={...scope(reviewing).goal!,revision:4,review:{...planned().review!,revision:4,planRevision:3,inputRevision:2,recordedAt:later,decision:'awaiting_user',checks:[],gaps:['确认格式']}};check(planning,reviewing);
  const waiting=structuredClone(reviewing);scope(waiting).status='waiting';scope(waiting).wait={waitId:'wait',reason:'确认格式',createdAt:later,runId:'run',goalRevision:4,graphCursor:cursor,knowledgeRevision:'knowledge',mainRunIds:['run']};check(reviewing,waiting);
  const resumed=structuredClone(waiting),value=scope(resumed),wait=value.wait!;
  value.status='active';delete value.wait;value.runTracking!.mainRunIds.push('run-2');value.continuations=[{continuationId:randomUUID(),acceptedAt:later,wait,inputRevision:3,input:{message:'采用列表'},runId:'run-2',options:{provider:'provider',model:'model',profileId:randomUUID(),permission:'read'}}];
  value.goal={...value.goal!,revision:5,inputRevision:3};delete value.goal.review;check(waiting,resumed);
  const pendingAgain=prepare(resumed,'新增限制',1),acceptedAgain=accept(pendingAgain,'新增限制');check(resumed,pendingAgain);check(pendingAgain,acceptedAgain);
  expect(scope(acceptedAgain).goal?.inputRevision).toBe(4);expect(scope(acceptedAgain).continuations).toEqual(value.continuations);
  expect(scope(acceptedAgain).activeInputs?.map(item=>item.status==='accepted'?item.inputRevision:0)).toEqual([2,4]);
  expect(mainToolScopeSchema.safeParse(projectMainScope(scope(acceptedAgain))).success).toBe(true);
});

it('已接受输入的过期计划阻止旧排队成员领取，但不取消任务或拒已运行结算',()=>{
  const pending=prepare(fixture(planned())),accepted=accept(pending);
  accepted.graphs[0].tasks=[{taskId:'queued-task',scopeId:'scope'} as never];
  const run={binding:{rootSessionId:'root',taskId:'queued-task',runId:'member-run'}} as never;
  expect(()=>validateScopeActiveInputs(accepted,accepted,{runs:[run],receipt:true})).toThrow('尚未重新规划');
  accepted.runs=[run];expect(()=>validateScopeActiveInputs(accepted,accepted,{runs:[run],receipt:true})).not.toThrow();
});

it('strict主输出拒绝跨周期run、重复历史及复用ACK；未知预留不被省略',()=>{
  const first=accept(prepare(fixture())),pending=prepare(first,'第二项',1),done=accept(pending,'第二项');
  for(const transform of [
    (s:DispatchScope)=>{s.activeInputs![0].runId='other-run'},
    (s:DispatchScope)=>{s.activeInputs![0].inputHash='c'.repeat(64)},
    (s:DispatchScope)=>{s.activeInputs![0].insertionId='c'.repeat(64)},
    (s:DispatchScope)=>{s.activeInputs!.push(s.activeInputs![0])},
    (s:DispatchScope)=>{Object.assign(s.activeInputs![1],{requestedSeq:10,acceptedSeq:11})},
    (s:DispatchScope)=>{Object.assign(s.activeInputs![0],{status:'unknown',resolvedAt:later,reason:'未知'})},
  ]){const bad=structuredClone(scope(done));transform(bad);expect(mainToolScopeSchema.safeParse(projectMainScope(bad)).success).toBe(false)}
  const state=prepare(fixture(),'x'.repeat(200000)),unknown=structuredClone(state);scope(unknown).activeInputs![0]={...scope(unknown).activeInputs![0],status:'unknown',resolvedAt:later,reason:'未知'};
  // 检查损坏历史时也计算 unknown 的预留，不能以“没有正文”为由漏计。
  const huge=structuredClone(unknown);scope(huge).continuations=[{input:{message:'x'.repeat(60001)}} as never];
  expect(()=>validateScopeActiveInputs(huge,huge,{receipt:true})).toThrow('超过允许大小');
});

it('普通运行补充使当前人工接续失效，不能继承旧接受',()=>{
  const human=continued(humanFixture().state),value=human.state.scopes![0];
  expect(currentHumanContinuation(value)).toBeDefined();
  const current=structuredClone(value);current.goal!.inputRevision=(value.goal!.inputRevision??1)+1;
  expect(currentHumanContinuation(current)).toBeUndefined();
});

it('摘要显式显示全部attempts和未确认状态；accepted保留严格公开详情',()=>{
  const pending=scope(prepare(fixture())),summary=summarizeScope(pending,'scopes:stream',1);
  expect(summary).toMatchObject({activeInputCount:1,activeInputStatus:'pending'});expect(scopeActiveInputStatus(pending)).toBe('pending');
  const snapshot={...emptyScopeSnapshot(identity,'stream'),cursor:{...identity,kind:'scopes' as const,streamId:'scopes:stream',seq:1},scopes:[summary]};validateScopeSnapshot(snapshot);
  expect(()=>validateScopeSnapshot({...snapshot,scopes:[{...summary,status:'closed',outcome:'completed',closedAt:later}]})).toThrow();
  const accepted=scope(accept(prepare(fixture()))),wire=projectMainScope(accepted);expect(mainToolScopeSchema.safeParse(wire).success).toBe(true);
  expect(wire.activeInputs).toEqual(accepted.activeInputs);expect(summarizeScope(accepted,'scopes:stream',2).activeInputStatus).toBeUndefined();
});

it('活动未决按新增事实拒绝派发和领取，不能换cause或省略scope绕过',()=>{
  for(const status of ['pending','unknown'] as const){
    const before=prepare(fixture());
    if(status==='unknown')scope(before).activeInputs![0]={...scope(before).activeInputs![0],status,resolvedAt:later,reason:'未知'};
    for(const cause of ['task.created','task.dispatched'] as const)for(const scoped of [true,false]){
      const next=structuredClone(before);next.graphs[0].tasks.push({taskId:'new-task',...(scoped?{scopeId:'scope'}:{})} as never);
      expect(()=>validateScopeActiveInputs(before,next,{batch:{identity,cause} as never,receipt:true})).toThrow('不能派发');
    }
    before.graphs[0].tasks.push({taskId:'legacy-task'} as never);
    const run={binding:{rootSessionId:'root',taskId:'legacy-task',runId:'legacy-run'}} as never;
    expect(()=>validateScopeActiveInputs(before,before,{runs:[run],receipt:true})).toThrow('不能领取');
    before.runs=[run];expect(()=>validateScopeActiveInputs(before,before,{runs:[run],receipt:true})).not.toThrow();
  }
});

it('封存unknown或旧过期目标不阻断同主根新周期的真实派发与领取',()=>{
  for(const kind of ['unknown','accepted-stale'] as const){
    const before=kind==='unknown'?prepare(fixture()):accept(prepare(fixture(planned())));
    if(kind==='unknown')scope(before).activeInputs![0]={...scope(before).activeInputs![0],status:'unknown',resolvedAt:later,reason:'未知'};
    Object.assign(scope(before),{status:'closed',outcome:'cancelled',closedAt:later});
    const next=structuredClone(before),fresh=scope(fixture());fresh.scopeId='scope-2';fresh.runTracking!.mainRunIds=['run-2'];next.scopes!.push(fresh);
    next.graphs[0].tasks.push({taskId:'later-task',scopeId:'scope-2'} as never);
    const run={binding:{rootSessionId:'root',taskId:'later-task',runId:'member-later'}} as never;
    expect(()=>validateScopeActiveInputs(before,next,{batch:{identity,cause:'task.dispatched'} as never,runs:[run],receipt:true})).not.toThrow();
    expect(scope(next)).toEqual(scope(before));
  }
});
