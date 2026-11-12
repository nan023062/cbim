/**
 * 目录归属：backend/scheduler-engine/evidence；目标状态与核证恢复服务。
 * 作用定位：从唯一任务存储与 canonical 日志核实原成员/主运行，供影响观察和新核实来源共用。
 * 设计原因：主对话与成员领取是不同身份协议；只向内部返回日志，不把缺失、坏尾或同名角色拼接成可信文件来源。
 * 职责边界：不读当前模型/知识，不修复日志，不操作 native；返回的摘要仍需公开白名单投影。
 */
import {isDeepStrictEqual} from 'node:util';
import {hash,json} from '../../core/foundation/serialization';
import type {RunSummary} from '../../core/execution/types';
import type {DispatchState} from '../../core/dispatch/dispatch-storage';
import type {DispatchRun} from '../../core/tasks/dispatch-execution';
import type {EffectObservationInput,EffectObservationReport} from '../../core/tasks/effect-observation';
import {goalInputRevision} from '../../core/tasks/scope-goal';
import {memberPublicTask} from '../runtime/member-events';
import {executionToolFacts} from './execution-report-facts';
import type {CommandVerificationService} from './command-verification-service';

export interface EffectSourcePorts {inspectMember(run:DispatchRun):Promise<RunSummary>}
export type EffectSourceRead={source:EffectObservationReport['source'];summary?:RunSummary;run?:DispatchRun;stamp:string;facts?:ReturnType<typeof executionToolFacts>};
/** 当前根的真实身份/版本屏障；处置附录和信封迟到 ACK 不改变原执行事实。 */
export function effectStateStamp(state:DispatchState,input:Pick<EffectObservationInput,'workspaceId'|'rootSessionId'>){
  const graph=state.graphs.find(g=>g.identity.workspaceId===input.workspaceId&&g.identity.rootSessionId===input.rootSessionId);
  return hash(json({workspaceId:state.workspaceId,graph,scopes:state.scopes?.filter(s=>s.workspaceId===input.workspaceId&&s.rootSessionId===input.rootSessionId),runs:state.runs?.filter(r=>r.binding.rootSessionId===input.rootSessionId),members:state.members.filter(m=>m.mainRootSessionId===input.rootSessionId||graph?.tasks.some(t=>t.assignee.agentInstanceId===m.agentInstanceId)),sessions:state.sessions.filter(s=>s.rootSessionId===input.rootSessionId)}));
}
/** 只在可信 Store 归属下读取指定原 run；不按最近可读日志补齐选择。 */
export async function readEffectSource(state:DispatchState,input:EffectObservationInput,root:string,ports:EffectSourcePorts|undefined,commands:CommandVerificationService):Promise<EffectSourceRead>{
  const source:EffectObservationReport['source']={state:'unverifiable',execution:'unknown',logState:'unavailable',unknownToolCount:0};
  const finish=(summary?:RunSummary,run?:DispatchRun,facts?:ReturnType<typeof executionToolFacts>):EffectSourceRead=>({source,summary,run,facts,stamp:hash(json({source,summary}))});
  const graph=state.graphs.find(g=>g.identity.workspaceId===input.workspaceId&&g.identity.rootSessionId===input.rootSessionId),subject=input.subject;
  const task=subject.kind==='member_run'?graph?.tasks.find(t=>t.taskId===subject.taskId):undefined;
  const runs=(state.runs??[]).filter(r=>r.binding.workspaceId===input.workspaceId&&r.binding.rootSessionId===input.rootSessionId&&r.binding.runId===subject.runId);
  const scopes=state.scopes?.filter(s=>s.workspaceId===input.workspaceId&&s.rootSessionId===input.rootSessionId&&(subject.kind==='main_run'?s.runTracking?.mainRunIds.includes(subject.runId):s.scopeId===task?.scopeId))??[];
  const scope=scopes.length===1?scopes[0]:undefined;
  if(!graph||!scope||subject.kind==='member_run'&&(!task||runs.length!==1||runs[0].binding.taskId!==task.taskId||!task.runIds.includes(subject.runId))||subject.kind==='main_run'&&runs.length){source.logState='identity_mismatch';return finish()}
  Object.assign(source,{scopeId:scope.scopeId,scopeStatus:scope.status,...(scope.outcome?{scopeOutcome:scope.outcome}:{}),...(scope.goal?{goalRevision:scope.goal.revision,inputRevision:goalInputRevision(scope.goal),...(scope.goal.plan?{goalPlanRevision:scope.goal.plan.revision}:{})}:{}),...(task?{taskRevision:task.revision,planRevision:task.planRevision}:{})});
  let summary:RunSummary|undefined,run:DispatchRun|undefined;
  if(subject.kind==='main_run'){
    const checked=await commands.inspectSource({workspaceId:input.workspaceId,rootSessionId:input.rootSessionId,runId:subject.runId,toolCallId:subject.toolCallIds[0]},state);
    source.logState=checked.source.state==='legacy_unverified'?'incomplete':checked.source.state==='verified'?'verified':checked.source.state;
    if(!checked.summary||checked.source.state!=='verified')return finish();summary=checked.summary;
  }else{
    run=runs[0];if(!ports)return finish();
    try{summary=await ports.inspectMember(run)}catch(error){const code=(error as {code?:string})?.code;source.logState=code==='ENOENT'?'missing':code==='RUN_LOG_EMPTY'?'incomplete':code==='RUN_LOG_INVALID'?'invalid':code==='MEMBER_LOG_IDENTITY'?'identity_mismatch':'unavailable';return finish()}
    const binding=run.binding,member=state.members.find(m=>m.agentInstanceId===binding.agentInstanceId),session=state.sessions.find(s=>s.agentSessionId===binding.agentSessionId),first=summary.events[0],bounds=summary.events.filter(e=>e.type==='session.bound');
    if(!member||!session||member.workspaceId!==input.workspaceId||member.agentId!==binding.agentId||!member.agentSessionIds.includes(binding.agentSessionId)||session.workspaceId!==input.workspaceId||session.rootSessionId!==input.rootSessionId||session.agentInstanceId!==binding.agentInstanceId||session.agentId!==binding.agentId||binding.agentId!==task!.assignee.agentId||binding.agentInstanceId!==task!.assignee.agentInstanceId||binding.agentSessionId!==task!.assignee.agentSessionId||summary.runId!==subject.runId||!isDeepStrictEqual(summary.memberBinding,binding)||summary.conversationBinding||!isDeepStrictEqual(summary.task,memberPublicTask(task!,root))||first?.type!=='run.started'||!isDeepStrictEqual(first.data.task,summary.task)||!isDeepStrictEqual(first.data.memberBinding,binding)||summary.sessionFile!==run.session.sessionFile||bounds.some(e=>e.data.sessionId!==run!.session.nativeSessionId||e.data.sessionFile!==run!.session.sessionFile)||run.session.sessionFile&&!bounds.length){source.logState='identity_mismatch';return finish()}
  }
  const terminal=summary.events.filter(e=>e.type==='run.settled'||e.type==='run.interrupted');
  if(summary.events.filter(e=>e.type==='run.started').length!==1||summary.events.some((e,i)=>e.version!==1||e.seq!==i+1||e.workspaceId!==input.workspaceId||e.taskId!==(subject.kind==='member_run'?subject.taskId:input.rootSessionId)||e.runId!==subject.runId)||terminal.length>1||terminal.length===1&&summary.events.some(e=>e.seq>terminal[0].seq&&e.type!=='run.stop_requested')){source.logState='invalid';return finish()}
  if(summary.logIntegrity?.partialTail!==false){source.logState='incomplete';return finish()}
  const facts=executionToolFacts(summary,{binding:{workspaceId:input.workspaceId,taskId:summary.task.taskId,runId:subject.runId}},{toolCallIdLimit:512});
  if(facts.invalid||subject.toolCallIds.some(id=>!facts.items.some(item=>item.toolCallId===id&&item.proposedSeq))){source.logState='invalid';return finish()}
  source.state='verified';source.logState='verified';source.logPrefixHash=hash(json(summary.events));source.throughSeq=summary.events.at(-1)!.seq;source.unknownToolCount=facts.counts.unknown;
  source.execution=summary.status==='running'||run&&['starting','running'].includes(run.status)?'in_flight':terminal.length===1&&(!run||summary.status===run.status)?'settled':'unknown';
  return finish(summary,run,facts);
}
