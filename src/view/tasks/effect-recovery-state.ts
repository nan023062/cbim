/**
 * 作用定位：将显式影响观察与已保存的本机处置转换为新只读核实的界面候选。
 * 设计原因：主运行没有成员任务身份；只核对真实原来源与当前会话空闲条件，服务端仍独立核验日志、文件、处置和启动资格。
 */
import {sameEffectSubject} from '../../bridge/contracts/effect-observation';
import type {EffectDispositionRecord,EffectObservationInput,EffectObservationReport} from '../../bridge/contracts/effect-observation';
import type {RecoveryTarget} from './recovery-state';
import type {ScopeGoalState} from './scope-state';

/** 同主会话各面板使用同一时效标记；选中页签/周期不是来源版本，隐藏面板不能使另一面板永久过期。 */
export function effectObservationAnchor(state:Pick<ScopeGoalState,'graph'|'scopes'>|undefined):string{return JSON.stringify([state?.graph?.cursor,state?.scopes.map(scope=>[scope.scopeId,scope.stamp])])}

/** 旧无 scope 主日志仅显示诊断；不借当前选中周期或根节点补造归属。 */
export function effectRecoveryTarget(identity:EffectObservationInput,report:EffectObservationReport|undefined,fresh:boolean,disposition:EffectDispositionRecord|undefined,state:ScopeGoalState):{target?:RecoveryTarget;reason:string}{
  if(state.loading||state.error||!state.graph)return {reason:'请先同步本会话的任务与目标记录。'};
  if(state.graph.identity.workspaceId!==identity.workspaceId||state.graph.identity.rootSessionId!==identity.rootSessionId)return {reason:'原调用不属于当前主会话。'};
  if(!report||!fresh)return {reason:'请明确核实当前影响，再选择对应处置。'};
  if(report.identity.workspaceId!==identity.workspaceId||report.identity.rootSessionId!==identity.rootSessionId||!sameEffectSubject(report.identity.subject,identity.subject))return {reason:'影响报告来源不一致，请重新核实。'};
  const scope=state.scopes.find(x=>x.scopeId===report.source.scopeId);
  if(!scope||scope.status!=='closed'||report.source.scopeStatus!=='closed')return {reason:'缺少可信已关闭的原周期，仅提供当前诊断。'};
  if(state.openScope||state.scopes.some(x=>x.status!=='closed')||state.graph.tasks.some(x=>x.activeRunId)||report.source.execution==='in_flight')return {reason:'本会话仍有未结束的执行，暂不能创建另一个核实周期。'};
  const subject=identity.subject;
  if(subject.kind==='member_run'&&!state.graph.tasks.some(x=>x.taskId===subject.taskId&&x.scopeId===scope.scopeId&&x.runIds.includes(subject.runId)))return {reason:'成员来源已不匹配原任务与运行。'};
  if(!disposition||disposition.request.decision!=='inspect_more')return {reason:'请先保存或选择“继续核实”的明确处置。'};
  const request=disposition.request;
  if(request.workspaceId!==identity.workspaceId||request.rootSessionId!==identity.rootSessionId||!sameEffectSubject(request.subject,identity.subject)||request.expectedBasis!==report.basis)return {reason:'处置所依据的观察已变化，请保留旧处置并记录新的决定。'};
  return {target:{workspaceId:identity.workspaceId,rootSessionId:identity.rootSessionId,source:{...identity.subject,reportBasis:report.basis},dispositionId:disposition.dispositionId},reason:''};
}
