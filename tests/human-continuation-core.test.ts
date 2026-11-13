import {expect,it} from 'vitest';
import {randomUUID} from 'node:crypto';
import {humanContinuationRequestSchema,humanContinuationSubject,scopeHumanContinuationSchema,humanContinuationReceiptSchema} from '../src/logic/tasks/rules/human-continue';
import {goalContinuationRequestSchema} from '../src/logic/tasks/rules/scope-continuation';
import {scopeContinuationRecordSchema,isHumanContinuation} from '../src/logic/tasks/rules/scope-continuation-record';
import {currentHumanContinuation,waitingHumanDecisions,referencedHumanDecision,humanContinuationSubjectMatches} from '../src/logic/tasks/rules/human-continuation-rules';
import {validateHumanContinuations,validateHumanContinuationCommand} from '../src/logic/tasks/rules/human-continuation-invariants';
import {validateDispatchScopes} from '../src/logic/tasks/rules/dispatch-scope-invariants';
import {dispatchScopeGoalSchema} from '../src/logic/tasks/rules/scope-goal';
import type {DispatchState} from '../src/logic/dispatch/rules/dispatch-storage';
import {humanDecisionBasis} from '../src/logic/tasks/rules/human-decision-proof';
import {at,identity,options,humanFixture,continued,planned,reviewed} from './human-continuation-core-fixture';

const transition=(before:DispatchState,after:DispatchState)=>validateDispatchScopes(before,after,{scopes:after.scopes,receipt:true});
it('新入口无自由正文/actor/主体，普通补充不能带人工来源；联合保留旧无kind记录',()=>{
  const f=humanFixture(),request={...identity,waitId:'wait',expectedGoalRevision:3,expectedInputRevision:1,expectedDecisionRevision:1,commandId:randomUUID(),decisionIds:[f.record.decisionId],options};
  expect(humanContinuationRequestSchema.safeParse(request).success).toBe(true);
  for(const patch of [{message:'新目标'},{input:{message:'新目标'}},{actor:{kind:'local_desktop'}},{subject:{}},{proof:{}},{expectedDecisionRevision:0},{decisionIds:[]},{decisionIds:[f.record.decisionId,f.record.decisionId]},{priorTaskIds:[]}])expect(humanContinuationRequestSchema.safeParse({...request,...patch}).success).toBe(false);
  const text={...identity,waitId:'wait',expectedGoalRevision:3,expectedInputRevision:1,commandId:request.commandId,input:{message:'真实补充'},options};expect(goalContinuationRequestSchema.safeParse(text).success).toBe(true);expect(goalContinuationRequestSchema.safeParse({...text,decisionIds:request.decisionIds}).success).toBe(false);
  const next=continued(f.state);expect(scopeContinuationRecordSchema.safeParse(next.intent).success).toBe(true);expect(scopeHumanContinuationSchema.safeParse({...next.intent,input:{message:'伪造用户'}}).success).toBe(false);expect(humanContinuationReceiptSchema.safeParse({...identity,scopeStatus:'active',continuation:next.intent}).success).toBe(true);
  const {kind:_,decisionIds:__,decisionRevision:___,subject:____,priorTaskIds:_____,...base}=next.intent;expect(scopeContinuationRecordSchema.safeParse({...base,input:{message:'历史真实补充'}}).success).toBe(true);
});

it('业务主体排除解释与运行元数据、稳定排序，但保留目标/约束/验收/角色模块',()=>{
  const f=humanFixture(),plan=f.scope.goal!.plan!,subject=humanContinuationSubject(plan);expect(subject).not.toHaveProperty('reason');expect(subject.assignments[0]).not.toHaveProperty('agentName');
  expect(humanContinuationSubject({...plan,reason:'解释变化',revision:10} as typeof plan)).toEqual(subject);
  for(const key of ['objective','constraints','criteria','assignments'] as const){const changed=structuredClone(plan);if(key==='objective')changed.objective='不同目标';else if(key==='constraints')changed.constraints.push('新增约束');else if(key==='criteria')changed.criteria[0].text='不同验收';else changed.assignments[0].agentId='other';expect(humanContinuationSubject(changed)).not.toEqual(subject)}
});

it('人工接续原子消费等待并共享输入版本/主轮累计，不改原文或决定历史',()=>{
  const f=humanFixture(),next=continued(f.state);expect(()=>transition(f.state,next.state)).not.toThrow();
  expect(next.scope.goal!.input).toEqual(f.scope.goal!.input);expect(next.scope.humanDecisions).toEqual(f.scope.humanDecisions);expect(next.intent.wait).toEqual(f.scope.wait);expect(next.scope.runTracking!.mainRunIds).toEqual(['main-run','human-run']);expect(next.scope.goal!.review).toBeUndefined();expect(next.scope.goal!.plan).toEqual(f.scope.goal!.plan);
  expect(()=>validateHumanContinuationCommand(f.state,{scopes:[next.scope],receipt:true},{commandId:'scope-human-continue-'+next.intent.continuationId,fingerprint:'x'})).not.toThrow();expect(()=>validateHumanContinuationCommand(f.state,{scopes:[next.scope],receipt:true},{commandId:'scope-continue-'+next.intent.continuationId,fingerprint:'x'})).toThrow();
});

it('跨basis最新意见全集不能挑旧接受、漏掉新拒绝或混入旧等待',()=>{
  const f=humanFixture(),negative=structuredClone(f.record);negative.decisionId=randomUUID();negative.revision=2;negative.decision='reject';negative.comment='新意见';negative.proof.limitations.push('新的观察范围');negative.basis=humanDecisionBasis(negative.proof);f.scope.humanDecisions={revision:2,records:[f.record,negative]};
  expect(waitingHumanDecisions(f.scope).map(item=>item.decisionId)).toEqual([negative.decisionId]);const next=continued(f.state);expect(()=>transition(f.state,next.state)).not.toThrow();
  next.intent.decisionIds=[f.record.decisionId];expect(()=>transition(f.state,next.state)).toThrow();next.intent.decisionIds=[negative.decisionId];next.intent.decisionRevision=1;expect(()=>transition(f.state,next.state)).toThrow();
  const other=humanFixture();other.scope.humanDecisions!.records[0].proof.source.waitId='old-wait';expect(waitingHumanDecisions(other.scope)).toEqual([]);expect(()=>transition(other.state,continued(other.state).state)).toThrow();
});

it('拒绝受理同时改写决定/主体/已有任务基线，终态不能旁路',()=>{
  const f=humanFixture();
  for(const mutate of [(value:ReturnType<typeof continued>)=>{value.intent.subject.objective='新目标'},(value:ReturnType<typeof continued>)=>{value.intent.priorTaskIds=[]},(value:ReturnType<typeof continued>)=>{value.scope.humanDecisions!.records[0].comment='改写决定'},(value:ReturnType<typeof continued>)=>{value.intent.runId='main-run'},(value:ReturnType<typeof continued>)=>{value.intent.wait.waitId='foreign'}]){const next=continued(f.state);mutate(next);expect(()=>transition(f.state,next.state)).toThrow()}
  const closed=structuredClone(f.state);closed.scopes![0].status='closed';expect(()=>transition(closed,continued(closed).state)).toThrow();
  const next=continued(f.state);expect(()=>validateHumanContinuations(f.state,next.state,{scopes:[next.scope],runs:[{}] as never,receipt:true})).toThrow();
});

it('未先消费、普通文本补充、另一input版均不能引用人工accept满足目标',()=>{
  const f=humanFixture(),next=continued(f.state),plan=planned(next.state),review=reviewed(plan);expect(()=>transition(next.state,plan)).not.toThrow();expect(()=>transition(plan,review)).not.toThrow();
  expect(dispatchScopeGoalSchema.safeParse(review.scopes![0].goal).success).toBe(true);
  for(const mutate of [(state:DispatchState)=>{delete state.scopes![0].continuations},(state:DispatchState)=>{state.scopes![0].goal!.inputRevision=3},(state:DispatchState)=>{const item=state.scopes![0].continuations![0];if(!isHumanContinuation(item))throw Error('human');const {kind:_,decisionIds:__,decisionRevision:___,subject:____,priorTaskIds:_____,...base}=item;state.scopes![0].continuations=[{...base,input:{message:'同意'}}]},(state:DispatchState)=>{const ref=state.scopes![0].goal!.review!.checks[0].evidence[0];if(ref.kind==='human-decision')ref.continuationId=randomUUID()}]){const invalid=structuredClone(review);mutate(invalid);expect(()=>validateHumanContinuations(plan,invalid,{scopes:invalid.scopes,receipt:true})).toThrow()}
});

it('接受不能跨当前主体/知识/候选变化；负面意见永不满足human',()=>{
  for(const mutate of [(state:DispatchState)=>{state.scopes![0].goal!.plan!.objective='新目标'},(state:DispatchState)=>{state.scopes![0].goal!.review!.knowledgeRevision='new'},(state:DispatchState)=>{state.graphs[0].tasks[0].result!.resultId='new'},(state:DispatchState)=>{state.graphs[0].tasks[0].revision++}]){const f=humanFixture(),active=planned(continued(f.state).state),review=reviewed(active);mutate(review);expect(()=>validateHumanContinuations(active,review,{scopes:review.scopes,receipt:true})).toThrow()}
  for(const decision of ['reject','request_evidence'] as const){const f=humanFixture(decision),active=planned(continued(f.state).state),review=reviewed(active);expect(()=>validateHumanContinuations(active,review,{scopes:review.scopes,receipt:true})).toThrow()}
  const f=humanFixture(),active=planned(continued(f.state).state),review=reviewed(active),candidate=f.record.proof.candidates[0];
  review.scopes![0].goal!.review!.checks[0].evidence.push({kind:'member-result',taskId:candidate.taskId,runId:candidate.runId,resultId:candidate.resultId,planRevision:candidate.planRevision,toolCallIds:[...candidate.evidenceToolCallIds]});
  expect(()=>validateHumanContinuations(active,review,{scopes:review.scopes,receipt:true})).not.toThrow();
  for(const patch of [{taskId:'another-task'},{runId:'another-run'},{resultId:'another-result'},{planRevision:candidate.planRevision+1},{toolCallIds:['not-reviewed']}]){const invalid=structuredClone(review),check=invalid.scopes![0].goal!.review!.checks[0];check.evidence[1]={...check.evidence[1],...patch} as typeof check.evidence[number];expect(()=>validateHumanContinuations(active,invalid,{scopes:invalid.scopes,receipt:true})).toThrow()}
});

it('人工返工仅允许消费之后的新成功任务覆盖原模块，旧result_ready历史不变',()=>{
  const f=humanFixture('reject'),active=planned(continued(f.state).state),after=reviewed(active),scope=after.scopes![0],intent=currentHumanContinuation(scope)!;
  scope.goal!.review!.decision='awaiting_user';scope.goal!.review!.checks[0]={criterionId:'human',outcome:'needs_human',reason:'新结果待人确认',evidence:[]};scope.goal!.review!.gaps=['待人工'];
  const original=after.graphs[0].tasks[0],replacement=structuredClone(original);replacement.taskId='new-task';replacement.nodeId='task:new-task';replacement.result={...replacement.result!,resultId:'new-result',runId:'new-run'};replacement.runIds=['new-run'];after.graphs[0].tasks.push(replacement);
  scope.goal!.review!.superseded=[{taskId:'task',replacementTaskIds:['new-task'],reason:'按拒绝意见返工',humanDecision:{decisionId:f.record.decisionId,continuationId:intent.continuationId}}];
  expect(()=>validateHumanContinuations(active,after,{scopes:[scope],receipt:true})).not.toThrow();expect(original).toEqual(f.task);
  for(const mutate of [(state:DispatchState)=>{currentHumanContinuation(state.scopes![0])!.priorTaskIds.push('new-task')},(state:DispatchState)=>{state.graphs[0].tasks[1].modules=[]},(state:DispatchState)=>{state.graphs[0].tasks[1].status='running'},(state:DispatchState)=>{state.scopes![0].goal!.review!.superseded[0].humanDecision!.decisionId=randomUUID()},(state:DispatchState)=>{delete state.scopes![0].goal!.review!.superseded[0].humanDecision},(state:DispatchState)=>{state.graphs[0].tasks[0].revision++},(state:DispatchState)=>{state.graphs[0].tasks[0].result!.evidenceRefs=[]}]){const bad=structuredClone(after);mutate(bad);expect(()=>validateHumanContinuations(active,bad,{scopes:bad.scopes,receipt:true})).toThrow()}
});

it('冻结历史在后来的人工记录后仍可读，当前新版只允许最新意图且不恢复旧接受',()=>{
  const f=humanFixture(),active=continued(f.state),prior=currentHumanContinuation(active.scope)!;
  expect(referencedHumanDecision(active.scope,{decisionId:f.record.decisionId,continuationId:prior.continuationId})).toEqual(f.record);expect(humanContinuationSubjectMatches(active.scope)).toBe(true);
  const later=structuredClone(active.state),record={...structuredClone(f.record),decisionId:randomUUID(),revision:2,decision:'reject' as const,comment:'最新拒绝',supersedesDecisionId:f.record.decisionId};later.scopes![0].humanDecisions={revision:2,records:[f.record,record]};
  expect(referencedHumanDecision(later.scopes![0],{decisionId:f.record.decisionId,continuationId:prior.continuationId})).toBeUndefined();expect(()=>validateHumanContinuations(active.state,later,{scopes:later.scopes,receipt:true})).not.toThrow();
  const invalid=structuredClone(active.state);invalid.scopes![0].continuations![0].acceptedAt='2026-11-07T09:00:00.000Z';expect(()=>transition(active.state,invalid)).toThrow();
});
