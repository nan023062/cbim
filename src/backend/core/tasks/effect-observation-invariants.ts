/**
 * 作用定位：在唯一派发 Store 的实时提交与原日志重放中核实影响处置附录及新周期引用。
 * 设计原因：处置是当时本机观察的不可变记录，不借此修改原运行；历史回放只核当时前缀，不用今天文件推翻旧事实。
 */
import {isDeepStrictEqual} from 'node:util';
import {fail} from '../foundation/errors';
import {effectDispositionRecordSchema,effectObservationLimits,sameEffectSubject,type EffectSubject,type EffectDispositionRecord} from './effect-observation';
import {effectDispositionCommand,effectDispositionReceipt,effectDispositionRevision,effectObservationBasis} from './effect-observation-rules';
import type {DispatchState,DispatchMutation,DispatchCommand} from '../dispatch/dispatch-storage';
import type {DispatchScope} from './dispatch-scope';
import {isMainRecoverySource} from './scope-recovery';

const check=(v:unknown,message:string)=>{if(!v)fail('EFFECT_DISPOSITION_AUDIT',message)};
/** 原始位置必须能从持久归属确定；坏 canonical 可保留诊断，但不能借另一个任务/主运行签署。 */
function validateSource(state:DispatchState,record:EffectDispositionRecord){
  const {request,observation}=record,subject=request.subject,source=observation.source;
  const graph=state.graphs.find(g=>g.identity.workspaceId===request.workspaceId&&g.identity.rootSessionId===request.rootSessionId);
  check(graph&&state.workspaceId===request.workspaceId,'处置不属于当前工作区主图');
  const scope=state.scopes?.find(s=>s.workspaceId===request.workspaceId&&s.rootSessionId===request.rootSessionId&&s.scopeId===source.scopeId);
  check(scope&&scope.status===source.scopeStatus&&scope.outcome===source.scopeOutcome,'处置来源周期或状态不一致');
  check(scope!.status==='closed'&&source.execution!=='in_flight','处置必须在原周期关闭且运行已结算或明确未知后追加');
  if(subject.kind==='member_run'){
    const task=graph!.tasks.find(t=>t.taskId===subject.taskId),run=state.runs?.find(r=>r.binding.runId===subject.runId&&r.binding.rootSessionId===request.rootSessionId&&r.binding.workspaceId===request.workspaceId&&r.binding.taskId===subject.taskId);
    check(task&&task.scopeId===scope!.scopeId&&task.runIds.includes(subject.runId)&&run,'处置缺少原成员任务及运行归属');
    check(source.taskRevision===task!.revision&&source.planRevision===task!.planRevision,'处置成员版本已变化');
  }else{
    const scopes=state.scopes?.filter(s=>s.workspaceId===request.workspaceId&&s.rootSessionId===request.rootSessionId&&s.runTracking?.mainRunIds.includes(subject.runId))??[];
    check(scopes.length===1&&scopes[0].scopeId===scope!.scopeId,'处置主运行没有唯一原周期');
    check(state.sessions.some(s=>s.workspaceId===request.workspaceId&&s.rootSessionId===request.rootSessionId&&s.purpose==='conversation'&&s.agentInstanceId===graph!.root.agent.agentInstanceId&&s.agentId==='cbim:main'),'处置主运行缺少真实对话通道');
  }
  check(source.goalRevision===scope!.goal?.revision&&source.inputRevision===(scope!.goal?(scope!.goal.inputRevision??1):undefined)&&source.goalPlanRevision===scope!.goal?.plan?.revision,'处置目标版本与来源周期不一致');
}

/** 无记录时保留旧缺省；记录存在时只能一条独立 append，命令与回执均从原输入重算。 */
export function projectEffectDispositionMutation(previous:DispatchState,mutation:DispatchMutation,command:DispatchCommand):Pick<DispatchState,'effectDispositions'>{
  if(mutation.effectDispositions===undefined){check(!command.commandId.startsWith('effect-disposition-'),'处置命令缺少不可变记录');return previous.effectDispositions===undefined?{}:{effectDispositions:previous.effectDispositions}}
  check(Array.isArray(mutation.effectDispositions)&&mutation.effectDispositions.length===1,'处置事务必须只追加一条记录');
  check(Object.keys(mutation).every(k=>k==='effectDispositions'||k==='receipt'),'处置不能夹带周期、任务图、运行或其它领域写入');
  const record=mutation.effectDispositions[0],parsed=effectDispositionRecordSchema.safeParse(record);
  check(parsed.success&&isDeepStrictEqual(parsed.data,record),'处置记录结构无效或需要转换');
  const records=previous.effectDispositions??[];
  check(!records.some(r=>r.dispositionId===record.dispositionId||r.request.commandId===record.request.commandId),'处置命令或身份重复');
  check(record.request.expectedRevision===effectDispositionRevision(previous,record.request.rootSessionId),'处置附录版本已变化');
  check(record.observation.basis===effectObservationBasis(record.observation),'处置观察依据指纹不一致');
  const expected=effectDispositionCommand(record.request);
  check(isDeepStrictEqual(command,expected)&&isDeepStrictEqual(mutation.receipt,effectDispositionReceipt(record)),'处置命令指纹或回执与原事实不一致');
  validateSource(previous,record);
  const next=[...records,structuredClone(record)];
  if(next.length>effectObservationLimits.records||record.revision>effectObservationLimits.recordsPerRoot||new TextEncoder().encode(JSON.stringify(next)).length>effectObservationLimits.storedBytes)fail('EFFECT_DISPOSITION_LIMIT','处置历史达到保存上限，原记录不删除');
  return {effectDispositions:next};
}

/** 新意图只引用既存处置，不回填旧意图；声明修复仍必须过完整 replan 门禁。 */
export function validateEffectDispositionLink(state:DispatchState,scope:DispatchScope):void{
  const intent=scope.recovery??scope.replan;if(!intent?.dispositionId)return;
  const record=state.effectDispositions?.find(r=>r.dispositionId===intent.dispositionId);
  check(record&&record.request.workspaceId===scope.workspaceId&&record.request.rootSessionId===scope.rootSessionId,'新周期引用了其它主会话或不存在的处置');
  let subject:EffectSubject;
  if(scope.recovery){const source=scope.recovery.source;check('kind' in source,'旧无种类核实不能补造新处置关联');if(!('kind' in source))return;subject=isMainRecoverySource(source)?{kind:'main_run',runId:source.runId,toolCallIds:source.toolCallIds}:{kind:'member_run',taskId:source.taskId,runId:source.runId,toolCallIds:source.toolCallIds};check(source.reportBasis===record!.observation.basis&&source.scopeId===record!.observation.source.scopeId&&record!.request.decision==='inspect_more','核实与原处置依据或决定不一致')}
  else{const proof=scope.replan!.source.proof;check('kind' in proof,'旧证明不能补造新处置关联');if(!('kind' in proof))return;subject=proof.kind==='main_run'?{kind:'main_run',runId:proof.sourceRunId,toolCallIds:proof.sourceToolCallIds}:{kind:'member_run',taskId:proof.sourceTaskId,runId:proof.sourceRunId,toolCallIds:proof.sourceToolCallIds};check(record!.request.decision==='repair_in_new_cycle'&&proof.sourceScopeId===record!.observation.source.scopeId&&proof.sourceReportBasis===record!.observation.basis,'业务重规划与修复处置不一致')}
  check(sameEffectSubject(record!.request.subject,subject),'新周期处置引用不属于相同的原调用集合');
}
