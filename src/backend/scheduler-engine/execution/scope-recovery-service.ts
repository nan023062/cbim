/**
 * 作用定位：为已关闭周期的异常执行创建独立只读核实周期，持久化用户观察和一次性全新上下文意图。
 * 设计原因：旧运行未知时不能续接或重放；事务核对来源与会话槽，重复命令只返回原事实。上下文查询同时尊重独立业务重规划的 fresh 边界，不因此放宽 recovery 只读权限。
 */
import {z} from 'zod';
import {fail} from '../../core/foundation/errors';
import {hash,json} from '../../core/foundation/serialization';
import type {KnowledgeWorkspace} from '../../core/knowledge/ports';
import type {DispatchStore,DispatchState} from '../../core/tasks/dispatch-storage';
import type {DispatchScope} from '../../core/tasks/dispatch-scope';
import type {GraphIdentity} from '../../core/tasks/graph-types';
import {graphIdentityInput} from '../../core/tasks/dispatch-commands';
import {recoveryRequestSchema,recoveryLookupSchema,recoveryContextSchema,type RecoveryRequest,type RecoveryLookup,type RecoveryReceipt,type ScopeRecovery,type RecoveryContext} from '../../core/tasks/scope-recovery';
import {sameGoalValue} from '../../core/tasks/scope-goal';
import {scopeFreshContext} from '../../core/tasks/fresh-context';
import {ExecutionReportService} from './execution-report-service';
import type {ScopeGoalPorts} from './scope-goal-service';

type Owner=Pick<KnowledgeWorkspace,'entry'|'assert'>;
/** 真实启动标识和被隔离旧运行由运行时在租约内取得，不能接受模型或公开请求传入。 */
export type RecoveryLaunch={runId:string;nativeSessionId:string;excludedRunIds:string[]};
/** fresh 只存在于本次提交的内存返回值；持久回执不能被用作重复启动许可。 */
export type AcceptedRecovery={scope:DispatchScope;recovery:ScopeRecovery;fresh:boolean};
function check(condition:unknown,code:string,message:string):asserts condition{if(!condition)fail(code,message)}

export class ScopeRecoveryService {
  constructor(private owner:Owner,private store:DispatchStore,private logs?:Pick<ScopeGoalPorts,'inspectMember'>){}
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
    check(saved.source.scopeId===input.source.scopeId&&saved.source.taskId===input.source.taskId&&saved.source.runId===input.source.runId&&saved.source.reportBasis===input.source.reportBasis&&saved.operation===input.operation&&sameGoalValue(saved.observation,input.observation)&&sameGoalValue(saved.input,input.input)&&sameGoalValue(saved.options,input.options),'RECOVERY_COMMAND_CONFLICT','同一核实命令已经绑定不同来源、正文或模型配置');
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
    return [...new Set((state.scopes??[]).filter(s=>s.rootSessionId===identity.rootSessionId&&s.workspaceId===identity.workspaceId).flatMap(s=>{const context=scopeFreshContext(s);return [...(s.continuations??[]).map(c=>c.runId),...(context?[context.initialRunId,...context.excludedRunIds]:[])]}))].sort();
  }
  private workspace(state:DispatchState,identity:GraphIdentity){this.owner.assert();check(identity.workspaceId===this.owner.entry.id&&state.workspaceId===identity.workspaceId,'RECOVERY_IDENTITY','核实请求不属于当前工作区')}
  /** 预检不消费启动权；accept 在取得真实 runId 后必须重新执行相同检查。 */
  async preflight(raw:RecoveryRequest){const input=this.parse(recoveryRequestSchema,raw);return this.report(await this.store.read(),input)}
  private async report(state:DispatchState,input:RecoveryRequest){
    const graph=this.identity(state,input),source=state.scopes?.find(s=>s.scopeId===input.source.scopeId&&s.rootSessionId===input.rootSessionId&&s.workspaceId===input.workspaceId);
    check(source?.status==='closed'&&source.outcome,'RECOVERY_SOURCE_NOT_CLOSED','只读核实必须来自已关闭周期；活动或等待周期应先停止并结算');
    check(!state.scopes?.some(s=>s.rootSessionId===input.rootSessionId&&s.status!=='closed')&&!state.runs?.some(r=>r.binding.rootSessionId===input.rootSessionId&&['starting','running'].includes(r.status)),'RECOVERY_BUSY','主会话还有未结束周期或成员运行');
    const task=graph.tasks.find(t=>t.taskId===input.source.taskId&&t.scopeId===source.scopeId);
    check(task&&!task.activeRunId,'RECOVERY_SOURCE_INVALID','来源任务不属于所选关闭周期或尚未结算');
    const runIds=new Set([...task.runIds,...(state.runs??[]).filter(r=>r.binding.rootSessionId===input.rootSessionId&&r.binding.taskId===task.taskId).map(r=>r.binding.runId)]);
    check(input.source.runId?runIds.has(input.source.runId):runIds.size===0,'RECOVERY_RUN_REQUIRED','已有运行必须明确选择轮次，不能省略或读取其它任务运行');
    check(this.logs,'RECOVERY_UNAVAILABLE','当前工作区没有接入可信运行核实');
    // 事务持锁时使用同一候选快照，不重入 DispatchStore.read；canonical 日志仍重新读取，不接受前端传来的报告正文。
    const report=await new ExecutionReportService(this.owner,{read:async()=>structuredClone(state)},run=>this.logs!.inspectMember(run)).read({workspaceId:input.workspaceId,rootSessionId:input.rootSessionId,taskId:input.source.taskId,runId:input.source.runId});
    check(report.consistency==='stable'&&report.basis.key===input.source.reportBasis,'RECOVERY_REPORT_STALE','核实报告基线已变化，请重新核实后提交新请求');
    check(report.execution!=='in_flight','RECOVERY_BUSY','来源执行仍在途，请等待结束后核实');
    return report;
  }
  /** 新周期及真实启动意图在一个事务提交；同命令变参拒绝，重复命令不重新读取日志或提供 fresh。 */
  async accept(raw:RecoveryRequest,trusted:RecoveryLaunch):Promise<AcceptedRecovery>{
    const input=this.parse(recoveryRequestSchema,raw),context=this.parse(recoveryContextSchema,{initialRunId:trusted.runId,nativeSessionId:trusted.nativeSessionId,excludedRunIds:trusted.excludedRunIds});
    let fresh=false;
    const receipt=await this.store.transact({commandId:'scope-recovery-'+input.commandId,fingerprint:hash(json({operation:'scope.recovery',input}))},async state=>{
      const previous=this.found(state,input);if(previous){this.sameRequest(previous,input);return {receipt:this.receipt(previous)}}
      check(!state.scopes?.some(s=>s.scopeId===input.commandId),'RECOVERY_COMMAND_CONFLICT','核实命令标识已被其它周期使用');
      const report=await this.report(state,input),source=state.scopes!.find(s=>s.scopeId===input.source.scopeId)!;
      const priorContexts=(state.scopes??[]).filter(s=>s.rootSessionId===input.rootSessionId).map(scopeFreshContext).filter(c=>c!==undefined);
      const priorRuns=(state.scopes??[]).filter(s=>s.rootSessionId===input.rootSessionId).flatMap(s=>[...(s.continuations??[]).map(item=>item.runId),...(scopeFreshContext(s)?[scopeFreshContext(s)!.initialRunId]:[])]);
      check(!state.runs?.some(r=>r.binding.runId===context.initialRunId)&&!state.scopes?.some(s=>s.continuations?.some(c=>c.runId===context.initialRunId)||scopeFreshContext(s)?.initialRunId===context.initialRunId||scopeFreshContext(s)?.nativeSessionId===context.nativeSessionId),'RECOVERY_CONTEXT_CONFLICT','新的主运行或原生上下文身份已被使用');
      check([...priorContexts.flatMap(c=>c.excludedRunIds),...priorRuns].every(id=>context.excludedRunIds.includes(id)),'RECOVERY_CONTEXT_CONFLICT','新上下文必须隔离此前明确登记的全部主运行，包括没有日志的旧意图');
      const acceptedAt=new Date().toISOString(),recovery:ScopeRecovery={recoveryId:input.commandId,acceptedAt,source:{...input.source,taskRevision:report.basis.taskRevision,planRevision:report.basis.planRevision,scopeOutcome:source.outcome!,reportExecution:report.execution,logState:report.log.state,unknownToolCount:report.tools.counts.unknown},operation:input.operation,observation:input.observation,input:input.input,options:input.options,context};
      const scope:DispatchScope={workspaceId:input.workspaceId,rootSessionId:input.rootSessionId,scopeId:input.commandId,status:'active',createdAt:acceptedAt,goal:{revision:1,input:{message:input.input.message,attachmentIds:[]}},recovery};
      fresh=true;return {scopes:[scope],receipt:this.receipt(scope)};
    });
    const scope=this.found(await this.store.read(),input);
    check(scope?.recovery&&scope.scopeId===receipt.scopeId&&scope.recovery.context.initialRunId===receipt.recovery.runId,'RECOVERY_UNKNOWN','已提交核实意图与当前周期不一致，请查询原命令，不能重放');
    this.sameRequest(scope,input);return {scope,recovery:scope.recovery,fresh};
  }
}
