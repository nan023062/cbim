/**
 * 目录归属：backend/scheduler-engine/goals；目标状态与核证恢复服务。
 * 作用定位：为已关闭周期的异常执行创建独立只读核实周期，持久化用户观察和一次性全新上下文意图。
 * 设计原因：旧运行未知时不能续接或重放；成员/主来源在事务外核实，再以短事务核原身份和会话槽。原请求先查回执，新周期冻结明确处置且不放宽只读权限。
 */
import {z} from 'zod';
import {fail} from '../../core/foundation/errors';
import {hash,json} from '../../core/foundation/serialization';
import type {KnowledgeWorkspace} from '../../core/knowledge/ports';
import type {DispatchStore,DispatchState} from '../../core/dispatch/dispatch-storage';
import type {DispatchScope} from '../../core/tasks/dispatch-scope';
import type {GraphIdentity} from '../../core/tasks/graph-types';
import {graphIdentityInput} from '../../core/tasks/dispatch-commands';
import {recoveryRequestSchema,recoveryLookupSchema,recoveryContextSchema,recoveryRequestSource,type RecoveryRequest,type RecoveryLookup,type RecoveryReceipt,type ScopeRecovery,type RecoveryContext} from '../../core/tasks/scope-recovery';
import {sameGoalValue} from '../../core/tasks/scope-goal';
import {scopeFreshContext} from '../../core/tasks/fresh-context';
import {ExecutionReportService} from '../evidence/execution-report-service';
import type {ScopeGoalPorts} from './scope-goal-service';
import {createScopeRunTracking} from '../../core/tasks/scope-run-tracking';
import type {EffectObservationService} from '../evidence/effect-observation-service';
import {effectStateStamp} from '../evidence/effect-source';
import {sameEffectSubject} from '../../core/tasks/effect-observation';

type Owner=Pick<KnowledgeWorkspace,'entry'|'assert'>;
/** 真实启动标识和被隔离旧运行由运行时在租约内取得，不能接受模型或公开请求传入。 */
export type RecoveryLaunch={runId:string;nativeSessionId:string;excludedRunIds:string[];signal?:AbortSignal};
/** fresh 只存在于本次提交的内存返回值；持久回执不能被用作重复启动许可。 */
export type AcceptedRecovery={scope:DispatchScope;recovery:ScopeRecovery;fresh:boolean};
function check(condition:unknown,code:string,message:string):asserts condition{if(!condition)fail(code,message)}

export class ScopeRecoveryService {
  constructor(private owner:Owner,private store:DispatchStore,private logs?:Pick<ScopeGoalPorts,'inspectMember'>,private budgets?:import('../budget/scope-budget-service').ScopeBudgetService,private effects?:EffectObservationService){}
  private parse<S extends z.ZodTypeAny>(schema:S,raw:unknown):z.output<S>{const parsed=schema.safeParse(raw);if(!parsed.success)fail('RECOVERY_INPUT_INVALID','只读核实请求或可信启动参数无效');return parsed.data}
  private identity(state:DispatchState,identity:GraphIdentity){
    this.owner.assert();check(identity.workspaceId===this.owner.entry.id&&state.workspaceId===identity.workspaceId,'RECOVERY_IDENTITY','核实请求不属于当前工作区');
    const graph=state.graphs.find(g=>g.identity.rootSessionId===identity.rootSessionId&&g.identity.workspaceId===identity.workspaceId);
    check(graph&&graph.root.agent.agentId==='cbim:main','RECOVERY_IDENTITY','核实请求没有对应的主会话实例');return graph;
  }
  private found(state:DispatchState,input:RecoveryLookup){
    this.identity(state,input);
    const scope=state.scopes?.find(s=>s.recovery?.recoveryId===input.commandId);
    if(scope)check(scope.workspaceId===input.workspaceId&&scope.rootSessionId===input.rootSessionId,'RECOVERY_IDENTITY','核实请求标识已用于其它主会话');return scope;
  }
  private receipt(scope:DispatchScope):RecoveryReceipt{
    const {context,...recovery}=scope.recovery!;
    return {workspaceId:scope.workspaceId,rootSessionId:scope.rootSessionId,scopeId:scope.scopeId,scopeStatus:scope.status,recovery:{...recovery,runId:context.initialRunId}};
  }
  private sameRequest(scope:DispatchScope,input:RecoveryRequest){
    const saved=scope.recovery!;
    check(sameGoalValue(recoveryRequestSource(saved.source),input.source)&&saved.dispositionId===input.dispositionId&&saved.operation===input.operation&&sameGoalValue(saved.observation,input.observation)&&sameGoalValue(saved.input,input.input)&&sameGoalValue(saved.options,input.options),'RECOVERY_COMMAND_CONFLICT','同一核实命令已经绑定不同来源、正文或模型配置');
  }
  /** 只查询已提交意图；即使新周期已经关闭，也不重新准备、修复日志或启动模型。 */
  async inspect(raw:RecoveryLookup):Promise<RecoveryReceipt|undefined>{const input=this.parse(recoveryLookupSchema,raw),scope=this.found(await this.store.read(),input);return scope?this.receipt(scope):undefined}
  /** 上下文边界按持久 scope 插入顺序选择；不得按时间或“最新可读运行”绕过新链异常。 */
  async latestContext(raw:GraphIdentity):Promise<RecoveryContext|undefined>{
    const identity=this.parse(graphIdentityInput,raw),state=await this.store.read();this.workspace(state,identity);
    const scope=(state.scopes??[]).filter(s=>s.rootSessionId===identity.rootSessionId&&s.workspaceId===identity.workspaceId&&scopeFreshContext(s)).at(-1);
    return scope?structuredClone(scopeFreshContext(scope)):undefined;
  }
  /** 即使旧启动意图尚未产生日志，也纳入下一次 fresh 上下文的隔离集合；普通旧聊天可以尚无任务图。 */
  async priorRunIds(raw:GraphIdentity):Promise<string[]>{
    const identity=this.parse(graphIdentityInput,raw),state=await this.store.read();this.workspace(state,identity);
    return [...new Set((state.scopes??[]).filter(s=>s.rootSessionId===identity.rootSessionId&&s.workspaceId===identity.workspaceId).flatMap(s=>{const context=scopeFreshContext(s);return [...(s.runTracking?.mainRunIds??[]),...(s.continuations??[]).map(c=>c.runId),...(context?[context.initialRunId,...context.excludedRunIds]:[])]}))].sort();
  }
  private workspace(state:DispatchState,identity:GraphIdentity){this.owner.assert();check(identity.workspaceId===this.owner.entry.id&&state.workspaceId===identity.workspaceId,'RECOVERY_IDENTITY','核实请求不属于当前工作区')}
  /** 预检不消费启动权；accept 在取得真实 runId 后必须重新执行相同检查。 */
  async preflight(raw:RecoveryRequest){const input=this.parse(recoveryRequestSchema,raw);return this.report(await this.store.read(),input)}
  private async report(state:DispatchState,input:RecoveryRequest){
    const graph=this.identity(state,input);
    check(!state.scopes?.some(s=>s.rootSessionId===input.rootSessionId&&s.status!=='closed')&&!state.runs?.some(r=>r.binding.rootSessionId===input.rootSessionId&&['starting','running'].includes(r.status)),'RECOVERY_BUSY','主会话还有未结束周期或成员运行');
    if('kind' in input.source){
      check(this.effects,'RECOVERY_UNAVAILABLE','未装配原调用影响观察');
      const {reportBasis,...subject}=input.source,report=await this.effects.observe({workspaceId:input.workspaceId,rootSessionId:input.rootSessionId,subject});
      check(report.consistency==='stable'&&report.basis===reportBasis,'RECOVERY_REPORT_STALE','原影响观察已变化，请重新核实');
      const source=state.scopes?.find(s=>s.scopeId===report.source.scopeId&&s.workspaceId===input.workspaceId&&s.rootSessionId===input.rootSessionId);
      check(source?.status==='closed'&&source.outcome,'RECOVERY_SOURCE_NOT_CLOSED','只读核实必须来自可信且已关闭的原周期');
      check(report.source.execution!=='in_flight','RECOVERY_BUSY','原运行尚在途');
      if(input.dispositionId){const record=state.effectDispositions?.find(r=>r.dispositionId===input.dispositionId);check(record&&record.request.workspaceId===input.workspaceId&&record.request.rootSessionId===input.rootSessionId&&record.request.decision==='inspect_more'&&sameEffectSubject(record.request.subject,subject)&&record.observation.basis===reportBasis,'RECOVERY_DISPOSITION_INVALID','处置不属于原来源、观察或继续核实决定')}
      const common={...input.source,scopeId:source.scopeId,scopeOutcome:source.outcome,reportExecution:report.source.execution,logState:report.source.logState,unknownToolCount:report.source.unknownToolCount,...(report.source.logPrefixHash?{logPrefixHash:report.source.logPrefixHash,throughSeq:report.source.throughSeq}:{})};
      const saved:ScopeRecovery['source']=input.source.kind==='main_run'?{...common,kind:'main_run',runId:input.source.runId,toolCallIds:input.source.toolCallIds,...(report.source.goalRevision?{sourceGoalRevision:report.source.goalRevision,sourceInputRevision:report.source.inputRevision}:{}),...(report.source.goalPlanRevision?{sourcePlanRevision:report.source.goalPlanRevision}:{})}:{...common,kind:'member_run',taskId:input.source.taskId,runId:input.source.runId,toolCallIds:input.source.toolCallIds,taskRevision:report.source.taskRevision!,planRevision:report.source.planRevision!};
      return saved;
    }
    check(!input.dispositionId,'RECOVERY_DISPOSITION_INVALID','旧来源协议不能夹带新处置引用');
    const selected=input.source,source=state.scopes?.find(s=>s.scopeId===selected.scopeId&&s.rootSessionId===input.rootSessionId&&s.workspaceId===input.workspaceId);
    check(source?.status==='closed'&&source.outcome,'RECOVERY_SOURCE_NOT_CLOSED','只读核实必须来自已关闭周期；活动或等待周期应先停止并结算');
    check(!state.scopes?.some(s=>s.rootSessionId===input.rootSessionId&&s.status!=='closed')&&!state.runs?.some(r=>r.binding.rootSessionId===input.rootSessionId&&['starting','running'].includes(r.status)),'RECOVERY_BUSY','主会话还有未结束周期或成员运行');
    const task=graph.tasks.find(t=>t.taskId===selected.taskId&&t.scopeId===source.scopeId);
    check(task&&!task.activeRunId,'RECOVERY_SOURCE_INVALID','来源任务不属于所选关闭周期或尚未结算');
    const runIds=new Set([...task.runIds,...(state.runs??[]).filter(r=>r.binding.rootSessionId===input.rootSessionId&&r.binding.taskId===task.taskId).map(r=>r.binding.runId)]);
    check(input.source.runId?runIds.has(input.source.runId):runIds.size===0,'RECOVERY_RUN_REQUIRED','已有运行必须明确选择轮次，不能省略或读取其它任务运行');
    check(this.logs,'RECOVERY_UNAVAILABLE','当前工作区没有接入可信运行核实');
    // 原协议仍读同一候选快照，但 canonical IO 只在 Store 事务外执行；不接受前端报告正文。
    const report=await new ExecutionReportService(this.owner,{read:async()=>structuredClone(state)},run=>this.logs!.inspectMember(run)).read({workspaceId:input.workspaceId,rootSessionId:input.rootSessionId,taskId:input.source.taskId,runId:input.source.runId});
    check(report.consistency==='stable'&&report.basis.key===input.source.reportBasis,'RECOVERY_REPORT_STALE','核实报告基线已变化，请重新核实后提交新请求');
    check(report.execution!=='in_flight','RECOVERY_BUSY','来源执行仍在途，请等待结束后核实');
    return {...input.source,taskRevision:report.basis.taskRevision,planRevision:report.basis.planRevision,scopeOutcome:source.outcome,reportExecution:report.execution,logState:report.log.state,unknownToolCount:report.tools.counts.unknown} satisfies ScopeRecovery['source'];
  }
  /** 新周期、当前软限额策略及首轮证明同事务提交；同命令变参拒绝，重复不读日志或提供 fresh。 */
  async accept(raw:RecoveryRequest,trusted:RecoveryLaunch):Promise<AcceptedRecovery>{
    const input=this.parse(recoveryRequestSchema,raw),context=this.parse(recoveryContextSchema,{initialRunId:trusted.runId,nativeSessionId:trusted.nativeSessionId,excludedRunIds:trusted.excludedRunIds});
    const command={commandId:'scope-recovery-'+input.commandId,fingerprint:hash(json({operation:'scope.recovery',input}))};
    const priorReceipt=await this.store.commandReceipt(command.commandId);
    if(priorReceipt){check(priorReceipt.fingerprint===command.fingerprint,'COMMAND_ID_CONFLICT','同一核实命令已绑定其它请求');const scope=this.found(await this.store.read(),input);check(scope?.recovery,'RECOVERY_UNKNOWN','原核实回执缺少意图');this.sameRequest(scope,input);return {scope,recovery:scope.recovery,fresh:false}}
    trusted.signal?.throwIfAborted();const before=await this.store.read(),savedSource=await this.report(before,input),stamp=effectStateStamp(before,input);trusted.signal?.throwIfAborted();
    let fresh=false;
    const receipt=await this.store.transact(command,async state=>{
      this.owner.assert();trusted.signal?.throwIfAborted();
      const previous=this.found(state,input);if(previous){this.sameRequest(previous,input);return {receipt:this.receipt(previous)}}
      check(!state.scopes?.some(s=>s.scopeId===input.commandId),'RECOVERY_COMMAND_CONFLICT','核实命令标识已被其它周期使用');
      check(effectStateStamp(state,input)===stamp,'RECOVERY_REPORT_STALE','取证后原身份或会话状态变化，请重新核实');
      const priorContexts=(state.scopes??[]).filter(s=>s.rootSessionId===input.rootSessionId).map(scopeFreshContext).filter(c=>c!==undefined);
      const priorRuns=(state.scopes??[]).filter(s=>s.rootSessionId===input.rootSessionId).flatMap(s=>[...(s.runTracking?.mainRunIds??[]),...(s.continuations??[]).map(item=>item.runId),...(scopeFreshContext(s)?[scopeFreshContext(s)!.initialRunId]:[])]);
      check(!state.runs?.some(r=>r.binding.runId===context.initialRunId)&&!state.scopes?.some(s=>s.runTracking?.mainRunIds.includes(context.initialRunId)||s.continuations?.some(c=>c.runId===context.initialRunId)||scopeFreshContext(s)?.initialRunId===context.initialRunId||scopeFreshContext(s)?.nativeSessionId===context.nativeSessionId),'RECOVERY_CONTEXT_CONFLICT','新的主运行或原生上下文身份已被使用');
      check([...priorContexts.flatMap(c=>c.excludedRunIds),...priorRuns].every(id=>context.excludedRunIds.includes(id)),'RECOVERY_CONTEXT_CONFLICT','新上下文必须隔离此前明确登记的全部主运行，包括没有日志的旧意图');
      const acceptedAt=new Date().toISOString(),recovery:ScopeRecovery={recoveryId:input.commandId,acceptedAt,source:savedSource,operation:input.operation,observation:input.observation,input:input.input,options:input.options,context,...(input.dispositionId?{dispositionId:input.dispositionId}:{})};
      let scope:DispatchScope={workspaceId:input.workspaceId,rootSessionId:input.rootSessionId,scopeId:input.commandId,status:'active',createdAt:acceptedAt,goal:{revision:1,input:{message:input.input.message,attachmentIds:[]}},runTracking:createScopeRunTracking(context.initialRunId),recovery};
      if(this.budgets)scope=this.budgets.initialize(scope,{kind:'main',taskId:input.rootSessionId,runId:context.initialRunId});
      fresh=true;return {scopes:[scope],receipt:this.receipt(scope)};
    });
    const scope=this.found(await this.store.read(),input);
    check(scope?.recovery&&scope.scopeId===receipt.scopeId&&scope.recovery.context.initialRunId===receipt.recovery.runId,'RECOVERY_UNKNOWN','已提交核实意图与当前周期不一致，请查询原命令，不能重放');
    this.sameRequest(scope,input);return {scope,recovery:scope.recovery,fresh};
  }
}
