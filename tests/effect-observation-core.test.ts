import {expect,test} from 'vitest';
import {randomUUID} from 'node:crypto';
import {effectObservationInputSchema,effectObservationReportSchema,effectDispositionRecordSchema,effectDispositionListSchema,sameEffectSubject} from '../src/backend/core/tasks/effect-observation';
import {effectObservationBasis,effectDispositionCommand,effectDispositionReceipt,effectDispositionRevision,summarizeEffectDisposition} from '../src/backend/core/tasks/effect-observation-rules';
import {projectEffectDispositionMutation,validateEffectDispositionLink} from '../src/backend/core/tasks/effect-observation-invariants';
import {recoveryRequestSchema,scopeRecoverySchema,recoveryRequestSource,recoverySourceKey,type ScopeRecovery} from '../src/backend/core/tasks/scope-recovery';
import {inspectionProofSchema} from '../src/backend/core/tasks/scope-replan';
import type {DispatchScope} from '../src/backend/core/tasks/dispatch-scope';
import {effectIdentity,effectTime,effectState,effectReport,effectRecord} from './effect-core-fixture';

function inspect(record=effectRecord()):DispatchScope {const report=record.observation,scopeId=randomUUID();return {...effectIdentity,scopeId,status:'active',createdAt:effectTime,recovery:{recoveryId:scopeId,acceptedAt:effectTime,source:{...report.identity.subject,scopeId:'source',reportBasis:report.basis,scopeOutcome:'failed',reportExecution:'unknown',logState:'verified',unknownToolCount:1,sourceGoalRevision:1,sourceInputRevision:1},operation:'inspect_effects',observation:{text:'明确核实'},input:{message:'读取现状'},options:{permission:'read',profileId:randomUUID(),provider:'fixture',model:'fixture'},context:{initialRunId:'inspect-run',nativeSessionId:randomUUID(),excludedRunIds:['main-run']},dispositionId:record.dispositionId}} as DispatchScope}
function append(state=effectState(),record=effectRecord()){return projectEffectDispositionMutation(state,{effectDispositions:[record],receipt:effectDispositionReceipt(record)},effectDispositionCommand(record.request))}

test('报告同事实在字段重排和 Schema 解析后依据一致，时钟/head独立，文件或限制变化失效',()=>{
  const report=effectReport(),frozen=structuredClone(report);
  const reordered=JSON.parse(JSON.stringify(report),(_key,value)=>value&&typeof value==='object'&&!Array.isArray(value)?Object.fromEntries(Object.entries(value).reverse()):value);
  expect(effectObservationBasis(reordered)).toBe(report.basis);expect(effectObservationBasis(effectObservationReportSchema.parse(report))).toBe(report.basis);
  expect(effectObservationBasis({...report,checkedAt:'2026-11-09T00:00:00.000Z',dispositionRevision:3})).toBe(report.basis);
  const changed=structuredClone(report);changed.calls[0].file!.sha256='d'.repeat(64);expect(effectObservationBasis(changed)).not.toBe(report.basis);
  expect(effectObservationBasis({...report,limitations:['只能证明其它事实']})).not.toBe(report.basis);expect(report).toEqual(frozen);
});

test('输入不收 scope/proof/actor，main不能伪装成员；调用选择保持原顺序且不可重复',()=>{
  const identity=effectReport().identity;expect(effectObservationInputSchema.safeParse(identity).success).toBe(true);
  for(const extra of [{scopeId:'guessed'},{actor:{kind:'local_desktop'}},{proof:'fake'}])expect(effectObservationInputSchema.safeParse({...identity,...extra}).success).toBe(false);
  expect(effectObservationInputSchema.safeParse({...identity,subject:{...identity.subject,taskId:'fake'}}).success).toBe(false);
  expect(effectObservationInputSchema.safeParse({...identity,subject:{...identity.subject,toolCallIds:['x','x']}}).success).toBe(false);
  expect(sameEffectSubject({...identity.subject,toolCallIds:['a','b']},{...identity.subject,toolCallIds:['b','a']})).toBe(false);
});

test('unknown 文件事实可以保留，但当前 hash 不伪装成功、缺失不补 hash、跨范围/错误日志拒绝',()=>{
  const report=effectReport();expect(effectObservationReportSchema.safeParse(report).success).toBe(true);
  for(const mutate of [(v:typeof report)=>{v.calls[0].file!.state='missing'},(v:typeof report)=>{v.calls[0].toolName='bash'},(v:typeof report)=>{v.calls[0].scope!.workspaceId='foreign'},(v:typeof report)=>{v.calls[0].allowedSeq=99},(v:typeof report)=>{v.source.state='unverifiable'},(v:typeof report)=>{v.source.taskRevision=1},(v:typeof report)=>{v.calls[0].toolCallId='other'}]){const bad=structuredClone(report);mutate(bad);expect(effectObservationReportSchema.safeParse(bad).success).toBe(false)}
  const missing=structuredClone(report);missing.calls[0].file={relativePath:'result.json',state:'missing'};expect(effectObservationReportSchema.safeParse(missing).success).toBe(true);
});

test('record严格绑定同subject/head/basis/本机actor；历史摘要不隐式重置root revision',()=>{
  const record=effectRecord();expect(effectDispositionRecordSchema.safeParse(record).success).toBe(true);
  for(const mutate of [(v:typeof record)=>{v.actor.interaction='model' as never},(v:typeof record)=>{v.observation.dispositionRevision=2},(v:typeof record)=>{v.request.subject={...v.request.subject,runId:'foreign'}},(v:typeof record)=>{v.revision=9},(v:typeof record)=>{v.observation.consistency='changed_during_read'}]){const bad=structuredClone(record);mutate(bad);expect(effectDispositionRecordSchema.safeParse(bad).success).toBe(false)}
  const summary=summarizeEffectDisposition(record);expect(effectDispositionListSchema.safeParse({identity:record.observation.identity,revision:2,records:[summary],readOnly:true}).success).toBe(true);
  expect(effectDispositionListSchema.safeParse({identity:record.observation.identity,revision:0,records:[summary],readOnly:true}).success).toBe(false);
  expect(effectDispositionRevision({effectDispositions:[record]},'other-root')).toBe(0);
});

test('64条摘要保持有界且明确截断，完整理由与Unicode字符不被改写',()=>{
  const record=effectRecord();record.request.reason='中'.repeat(511)+'😀'+'文'.repeat(3000);const original=record.request.reason;
  const summary=summarizeEffectDisposition(record);expect(summary.reason).toBe('中'.repeat(511));expect(summary.reasonTruncated).toBe(true);expect(record.request.reason).toBe(original);
  const records=Array.from({length:64},(_,i)=>({...summary,dispositionId:randomUUID(),revision:i+1}));
  const list={identity:record.observation.identity,revision:64,records,readOnly:true};expect(effectDispositionListSchema.safeParse(list).success).toBe(true);expect(new TextEncoder().encode(JSON.stringify(list)).length).toBeLessThan(128*1024);
});

test('legacy recovery/proof保持原字段与request key，不生成kind/disposition或主任务',()=>{
  const request={...effectIdentity,commandId:randomUUID(),source:{scopeId:'source',taskId:'old-task',runId:'old-run',reportBasis:'a'.repeat(64)},operation:'inspect_effects',observation:{text:'原说明'},input:{message:'原输入'},options:{permission:'read',profileId:randomUUID(),provider:'fixture',model:'fixture'}};
  expect(recoveryRequestSchema.parse(request)).toEqual(request);expect(recoverySourceKey(request.source)).toBe(JSON.stringify(['source','old-task','old-run']));
  const persisted={...request.source,taskRevision:2,planRevision:1,scopeOutcome:'failed',reportExecution:'unknown',logState:'missing',unknownToolCount:1} satisfies ScopeRecovery['source'];
  expect(JSON.stringify(recoveryRequestSource(persisted))).toBe(JSON.stringify(request.source));
  const proof={inspectionGoalRevision:3,inspectionPlanRevision:1,reviewRunId:'read-run',knowledgeRevision:'knowledge',sourceScopeId:'source',sourceTaskId:'old-task',sourceRunId:'old-run',sourceReportBasis:'a'.repeat(64),evidenceDigest:'b'.repeat(64),requiredModules:[{moduleId:'module',name:'模块'}],inheritedHuman:[]};
  expect(inspectionProofSchema.parse(proof)).toEqual(proof);expect('kind' in inspectionProofSchema.parse(proof)).toBe(false);
  const {sourceTaskId:_,...main}=proof;const value={...main,kind:'main_run',sourceToolCallIds:['call'],sourceGoalRevision:2,sourceInputRevision:1,sourcePlanRevision:1};
  expect(inspectionProofSchema.safeParse(value).success).toBe(true);expect(inspectionProofSchema.safeParse({...value,sourceTaskId:'fake'}).success).toBe(false);expect(inspectionProofSchema.safeParse({...value,sourcePlanRevision:undefined}).success).toBe(false);
});

test('main recovery允许无原plan的只读来源，不能夹带任务版本或可写权限',()=>{
  const scope=inspect(),recovery=scope.recovery!;expect(scopeRecoverySchema.safeParse(recovery).success).toBe(true);
  expect(scopeRecoverySchema.safeParse({...recovery,source:{...recovery.source,scopeId:'_source-'+ 'a'.repeat(200)}}).success).toBe(true);
  expect(scopeRecoverySchema.safeParse({...recovery,source:{...recovery.source,taskId:'fake',taskRevision:1}}).success).toBe(false);
  expect(scopeRecoverySchema.safeParse({...recovery,options:{...recovery.options,permission:'execute'}}).success).toBe(false);
  expect(scopeRecoverySchema.safeParse({...recovery,source:{...recovery.source,sourceInputRevision:undefined}}).success).toBe(false);
});

test('文件总字节按路径去重并校验相同事实，不能靠报告字段绕过有界观察',()=>{
  const report=effectReport();report.calls[0].file!.byteLength=8*1024*1024;
  report.calls=Array.from({length:5},(_,i)=>({...structuredClone(report.calls[0]),toolCallId:'call-'+i}));report.identity.subject.toolCallIds=report.calls.map(c=>c.toolCallId);
  expect(effectObservationReportSchema.safeParse(report).success).toBe(true);
  report.calls[1].file!.sha256='d'.repeat(64);expect(effectObservationReportSchema.safeParse(report).success).toBe(false);report.calls[1].file!.sha256=report.calls[0].file!.sha256;
  report.calls.forEach((call,i)=>{call.file!.relativePath='result-'+i+'.json'});expect(effectObservationReportSchema.safeParse(report).success).toBe(false);
  const huge=effectReport();huge.calls=Array.from({length:16},(_,i)=>({...structuredClone(huge.calls[0]),toolCallId:'call-'+i,limitations:Array(32).fill('中'.repeat(512))}));huge.identity.subject.toolCallIds=huge.calls.map(c=>c.toolCallId);expect(effectObservationReportSchema.safeParse(huge).success).toBe(false);
});

test('append只增加一个不可变事实；图/运行/周期、actor、命令指纹、原身份与source版本都不能伪造',()=>{
  const state=effectState(),record=effectRecord(),before=structuredClone(state),mutation={effectDispositions:[record],receipt:effectDispositionReceipt(record)},command=effectDispositionCommand(record.request);
  expect(append(state,record).effectDispositions).toEqual([record]);expect(state).toEqual(before);
  for(const extra of [{scopes:[]},{members:[]},{runs:[]},{unknown:true}])expect(()=>projectEffectDispositionMutation(state,{...mutation,...extra},command)).toThrow();
  expect(()=>projectEffectDispositionMutation(state,{...mutation,effectDispositions:[record,record]},command)).toThrow();
  expect(()=>projectEffectDispositionMutation(state,mutation,{...command,fingerprint:'wrong'})).toThrow();
  for(const mutate of [(v:typeof record)=>{v.observation.source.goalRevision=2},(v:typeof record)=>{v.observation.identity.subject.runId='wrong'},(v:typeof record)=>{v.observation.source.scopeId='wrong'}]){const bad=structuredClone(record);mutate(bad);expect(()=>append(state,bad)).toThrow()}
  expect(()=>append({...state,sessions:state.sessions.filter(s=>s.purpose!=='conversation')},record)).toThrow();
});

test('root CAS 和历史上限拒绝不覆盖，跨root不能借记录；旧缺省不补数组',()=>{
  const state=effectState(),first=effectRecord();state.effectDispositions=append(state,first).effectDispositions;
  expect(()=>append(state,effectRecord())).toThrow();const second=effectRecord(1);expect(append(state,second).effectDispositions).toEqual([first,second]);
  expect(()=>append(state,first)).toThrow();expect(()=>append({...state,workspaceId:'foreign'},second)).toThrow();
  const full=Array.from({length:64},(_,i)=>effectRecord(i));expect(()=>append({...state,effectDispositions:full},effectRecord(64))).toThrowError(/上限/);
  expect(projectEffectDispositionMutation(effectState(),{receipt:true},{commandId:'legacy-read',fingerprint:'old'})).toEqual({});
  expect(()=>projectEffectDispositionMutation(effectState(),{receipt:true},effectDispositionCommand(first.request))).toThrow();
});

test('inspection引用同一次inspect_more；repair只接受独立repair决定而不重写旧意图',()=>{
  const record=effectRecord(),state={...effectState(),effectDispositions:[record]},scope=inspect(record);expect(()=>validateEffectDispositionLink(state,scope)).not.toThrow();
  const changed=structuredClone(scope);changed.recovery!.source.reportBasis='f'.repeat(64);expect(()=>validateEffectDispositionLink(state,changed)).toThrow();
  const wrong=effectRecord(0,'repair_in_new_cycle');expect(()=>validateEffectDispositionLink({...state,effectDispositions:[wrong]},inspect(wrong))).toThrow();
  const repair=structuredClone(scope);delete repair.recovery;repair.replan={replanId:scope.scopeId,acceptedAt:effectTime,source:{inspectionScopeId:'inspection',expectedBasis:'d'.repeat(64),proof:{kind:'main_run',inspectionGoalRevision:3,inspectionPlanRevision:1,reviewRunId:'read-run',knowledgeRevision:'knowledge',sourceScopeId:'source',sourceRunId:'main-run',sourceToolCallIds:['write-call'],sourceGoalRevision:1,sourceInputRevision:1,sourcePlanRevision:1,sourceReportBasis:wrong.observation.basis,evidenceDigest:'e'.repeat(64),requiredModules:[{moduleId:'module',name:'模块'}],inheritedHuman:[]}},operation:'business_replan',input:{message:'新修复'},options:{permission:'ask',profileId:randomUUID(),provider:'fixture',model:'fixture'},context:{initialRunId:'repair-run',nativeSessionId:randomUUID(),excludedRunIds:['main-run','inspect-run']},dispositionId:wrong.dispositionId};
  expect(()=>validateEffectDispositionLink({...state,effectDispositions:[wrong]},repair)).not.toThrow();
  repair.replan.source.proof.sourceReportBasis='0'.repeat(64);expect(()=>validateEffectDispositionLink({...state,effectDispositions:[wrong]},repair)).toThrow();
});
