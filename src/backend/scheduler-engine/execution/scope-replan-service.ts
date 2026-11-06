/**
 * 作用定位：在完成的只读核实基础上创建独立业务周期，冻结真实证据、原人工约束和用户明确的新目标。
 * 设计原因：旧任务和未知回执保持封存；预览与受理都重读 canonical 证据，同命令只读回执，fresh 仅当前事务产生。新业务权限不修改只读核实契约。
 */
import {z} from 'zod';
import {fail} from '../../core/foundation/errors';
import {hash,json} from '../../core/foundation/serialization';
import type {KnowledgeWorkspace} from '../../core/knowledge/ports';
import type {DispatchState,DispatchStore} from '../../core/tasks/dispatch-storage';
import type {DispatchScope} from '../../core/tasks/dispatch-scope';
import {freshContextSchema,scopeFreshContext} from '../../core/tasks/fresh-context';
import {replanPreviewInputSchema,replanRequestSchema,replanLookupSchema,type ReplanPreviewInput,type ReplanPreview,type ReplanRequest,type ReplanLookup,type ReplanReceipt,type ScopeReplan,type InspectionProof} from '../../core/tasks/scope-replan';
import {sameGoalValue} from '../../core/tasks/scope-goal';
import {ScopeGoalService,type ScopeGoalPorts} from './scope-goal-service';
import {ExecutionReportService} from './execution-report-service';
import {resolveDispatchModules} from '../context/dispatch-context';

type Owner=Pick<KnowledgeWorkspace,'entry'|'instanceId'|'assert'|'snapshot'|'read'>;
export type ReplanLaunch={runId:string;nativeSessionId:string;excludedRunIds:string[]};
export type AcceptedReplan={scope:DispatchScope;replan:ScopeReplan;fresh:boolean};
function check(condition:unknown,code:string,message:string):asserts condition{if(!condition)fail(code,message)}
export class ScopeReplanService {
  constructor(private owner:Owner,private store:DispatchStore,private goals:ScopeGoalService,private logs?:ScopeGoalPorts){}
  private parse<S extends z.ZodTypeAny>(schema:S,raw:unknown):z.output<S>{const value=schema.safeParse(raw);if(!value.success)fail('REPLAN_INPUT_INVALID','业务重规划请求或启动参数无效');return value.data}
  private identity(state:DispatchState,input:{workspaceId:string;rootSessionId:string}){
    this.owner.assert();check(state.workspaceId===input.workspaceId&&this.owner.entry.id===input.workspaceId,'REPLAN_IDENTITY','业务重规划不属于当前工作区');
    const graph=state.graphs.find(item=>item.identity.workspaceId===input.workspaceId&&item.identity.rootSessionId===input.rootSessionId);
    check(graph?.root.agent.agentId==='cbim:main','REPLAN_IDENTITY','业务重规划缺少可信主会话实例');return graph;
  }
  private found(state:DispatchState,input:ReplanLookup){this.identity(state,input);const scope=state.scopes?.find(item=>item.replan?.replanId===input.commandId);if(scope)check(scope.workspaceId===input.workspaceId&&scope.rootSessionId===input.rootSessionId,'REPLAN_IDENTITY','命令属于另一主会话');return scope}
  private receipt(scope:DispatchScope):ReplanReceipt{const {context,...replan}=scope.replan!;return {workspaceId:scope.workspaceId,rootSessionId:scope.rootSessionId,scopeId:scope.scopeId,scopeStatus:scope.status,replan:{...replan,runId:context.initialRunId}}}
  private sameRequest(scope:DispatchScope,input:ReplanRequest){const saved=scope.replan!;check(saved.source.inspectionScopeId===input.source.inspectionScopeId&&saved.source.expectedBasis===input.source.expectedBasis&&sameGoalValue(saved.input,input.input)&&sameGoalValue(saved.options,input.options),'REPLAN_COMMAND_CONFLICT','同一业务重规划命令已绑定不同目标、证据或配置')}
  /** 查询只返回受理事实，不重新核实旧证明或启动模型。 */
  async inspect(raw:ReplanLookup):Promise<ReplanReceipt|undefined>{const input=this.parse(replanLookupSchema,raw),scope=this.found(await this.store.read(),input);return scope?this.receipt(scope):undefined}
  private async proof(state:DispatchState,input:ReplanPreviewInput){
    const graph=this.identity(state,input),inspection=state.scopes?.find(item=>item.scopeId===input.inspectionScopeId&&item.rootSessionId===input.rootSessionId&&item.workspaceId===input.workspaceId);
    check(inspection?.recovery&&inspection.status==='closed'&&inspection.outcome==='completed','REPLAN_SOURCE_INVALID','请选择已经完成的只读核实周期');
    check(!state.scopes?.some(item=>item.rootSessionId===input.rootSessionId&&item.status!=='closed')&&!state.runs?.some(item=>item.binding.rootSessionId===input.rootSessionId&&['starting','running'].includes(item.status)),'REPLAN_BUSY','主会话仍有未结束周期或运行');
    check(state.scopes?.filter(item=>item.rootSessionId===input.rootSessionId).at(-1)?.scopeId===inspection.scopeId,'REPLAN_STALE','只读核实之后已有新的会话周期，必须重新核实再创建业务目标');
    const source=state.scopes?.find(item=>item.scopeId===inspection.recovery!.source.scopeId),task=graph.tasks.find(item=>item.taskId===inspection.recovery!.source.taskId);
    check(source?.goal?.plan&&source.status==='closed'&&source.rootSessionId===input.rootSessionId&&task?.scopeId===source.scopeId,'REPLAN_LEGACY','原业务缺少可信目标计划，不能推断或补造人工验收条件');
    check(this.logs,'REPLAN_PROOF_INVALID','没有可用的可信运行核实入口');
    const verified=await this.goals.validateCompletedInspection(state,inspection),required=[...new Set([...task.modules.map(item=>item.moduleId),...source.goal.plan.assignments.flatMap(item=>item.moduleIds)])].sort();
    check(required.length>0&&required.length<=50&&required.every(id=>verified.coveredModuleIds.includes(id)),'REPLAN_PROOF_INVALID','只读核实的真实成功候选尚未覆盖原业务全部目标模块');
    const snapshot=await this.owner.snapshot();check(snapshot.revision===verified.knowledgeRevision,'REPLAN_KNOWLEDGE_CHANGED','业务图谱已经变化，请重新核实');
    const modules=await resolveDispatchModules(snapshot,required),requiredModules=modules.map(item=>({moduleId:item.moduleId,name:item.name}));
    const inheritedHuman=source.goal.plan.criteria.filter(item=>item.kind==='human').map(item=>({id:item.id,text:item.text,kind:'human' as const,sourceScopeId:source.scopeId,sourceGoalRevision:source.goal!.revision}));
    // 同一候选状态供只读报告使用，事务中不重入存储。原业务仍可 unknown；报告只参与当前证据版本，不更正历史。
    const reports=new ExecutionReportService(this.owner,{read:async()=>structuredClone(state)},run=>this.logs!.inspectMember(run));
    const selection={workspaceId:input.workspaceId,rootSessionId:input.rootSessionId,taskId:task.taskId,runId:inspection.recovery.source.runId},report=await reports.read(selection);
    check(report.consistency==='stable'&&report.execution!=='in_flight','REPLAN_STALE','来源执行报告正在变化，请重新核实');
    const proof:InspectionProof={inspectionGoalRevision:inspection.goal!.revision,inspectionPlanRevision:inspection.goal!.plan!.revision,reviewRunId:inspection.goal!.review!.runId,knowledgeRevision:verified.knowledgeRevision,sourceScopeId:source.scopeId,sourceTaskId:task.taskId,...(selection.runId?{sourceRunId:selection.runId}:{}),sourceReportBasis:report.basis.key,evidenceDigest:verified.evidenceDigest,requiredModules,inheritedHuman};
    check((await reports.read(selection)).basis.key===report.basis.key&&(await this.owner.read()).revision===verified.knowledgeRevision,'REPLAN_STALE','核实依据在读取期间变化');
    const graphCursor={streamId:graph.cursor.streamId,seq:graph.cursor.seq},basis=hash(json({identity:input,graphCursor,proof}));return {proof,basis,graphCursor};
  }
  /** 只读预览：检查不足返回安全问题列表，不回显原始损坏日志或私有路径。 */
  async preview(raw:ReplanPreviewInput):Promise<ReplanPreview>{
    const input=this.parse(replanPreviewInputSchema,raw);
    try{const state=await this.store.read(),value=await this.proof(state,input);check(sameGoalValue(state,await this.store.read()),'REPLAN_STALE','派发记录在预览期间变化');return {identity:input,eligible:true,basis:value.basis,graphCursor:value.graphCursor,inspectionGoalRevision:value.proof.inspectionGoalRevision,knowledgeRevision:value.proof.knowledgeRevision,requiredModules:value.proof.requiredModules,inheritedHuman:value.proof.inheritedHuman,issues:[]}}
    catch(error){const code=(error as {code?:string})?.code;return {identity:input,eligible:false,requiredModules:[],inheritedHuman:[],issues:[{code:typeof code==='string'&&/^(REPLAN_|GOAL_)/.test(code)?code:'REPLAN_PROOF_INVALID',message:'当前核实证据未满足业务重规划条件，请检查来源周期、完整日志、知识版本和模块覆盖。'}]}}
  }
  /** 预检不授予启动权；仅 accept 在可信真实 runId 到达后原子记录一次新意图。 */
  async preflight(raw:ReplanRequest){const input=this.parse(replanRequestSchema,raw),value=await this.proof(await this.store.read(),{workspaceId:input.workspaceId,rootSessionId:input.rootSessionId,inspectionScopeId:input.source.inspectionScopeId});check(value.basis===input.source.expectedBasis,'REPLAN_STALE','业务重规划依据已变化，请重新预览');return value}
  async accept(raw:ReplanRequest,trusted:ReplanLaunch):Promise<AcceptedReplan>{
    const input=this.parse(replanRequestSchema,raw),context=this.parse(freshContextSchema,{initialRunId:trusted.runId,nativeSessionId:trusted.nativeSessionId,excludedRunIds:trusted.excludedRunIds});let fresh=false;
    const receipt=await this.store.transact({commandId:'scope-replan-'+input.commandId,fingerprint:hash(json({operation:'scope.replan',input}))},async state=>{
      const old=this.found(state,input);if(old){this.sameRequest(old,input);return {receipt:this.receipt(old)}}
      check(!state.scopes?.some(item=>item.scopeId===input.commandId),'REPLAN_COMMAND_CONFLICT','命令标识已经被其它周期使用');
      const value=await this.proof(state,{workspaceId:input.workspaceId,rootSessionId:input.rootSessionId,inspectionScopeId:input.source.inspectionScopeId});check(value.basis===input.source.expectedBasis,'REPLAN_STALE','业务重规划依据已变化，请重新预览');
      const contexts=(state.scopes??[]).map(scopeFreshContext).filter(item=>item!==undefined),prior=(state.scopes??[]).filter(item=>item.rootSessionId===input.rootSessionId).flatMap(item=>{const c=scopeFreshContext(item);return [...(item.continuations??[]).map(c=>c.runId),...(c?[c.initialRunId,...c.excludedRunIds]:[])]});
      check(!state.runs?.some(item=>item.binding.runId===context.initialRunId)&&!state.scopes?.some(item=>item.continuations?.some(c=>c.runId===context.initialRunId))&&!contexts.some(c=>c.initialRunId===context.initialRunId||c.nativeSessionId===context.nativeSessionId)&&prior.every(id=>context.excludedRunIds.includes(id)),'REPLAN_CONTEXT_CONFLICT','新的原生上下文身份冲突或没有隔离此前运行');
      const acceptedAt=new Date().toISOString(),replan:ScopeReplan={replanId:input.commandId,acceptedAt,source:{...input.source,proof:value.proof},operation:'business_replan',input:input.input,options:input.options,context},scope:DispatchScope={workspaceId:input.workspaceId,rootSessionId:input.rootSessionId,scopeId:input.commandId,status:'active',createdAt:acceptedAt,goal:{revision:1,input:{message:input.input.message,attachmentIds:[]}},replan};
      fresh=true;return {scopes:[scope],receipt:this.receipt(scope)};
    });
    const scope=this.found(await this.store.read(),input);check(scope?.replan&&scope.scopeId===receipt.scopeId&&scope.replan.context.initialRunId===receipt.replan.runId,'REPLAN_UNKNOWN','已提交业务意图与当前记录不一致，请查询原命令');this.sameRequest(scope,input);return {scope,replan:scope.replan,fresh};
  }
}
