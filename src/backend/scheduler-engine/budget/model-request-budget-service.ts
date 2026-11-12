/**
 * 目录归属：backend/scheduler-engine/budget；预算准入与统计服务。
 * 作用定位：通过专用预算端口保存每个真实主/成员请求的预留、发送意图和终态，不读取或改写其它调度领域。
 * 设计原因：准入决定必须在同一事务读取全部预留，不能先读余额再独立扣减；内存主运行占位防止历史 run 冒充当前执行。
 * 职责边界：只返回后端可信端口，不发网络、不接受模型传入身份；重开和查询只读历史，不释放未决消耗。
 */
import {randomUUID} from 'node:crypto';
import {fail} from '../../core/foundation/errors';
import type {RequestBudgetStore,RequestBudgetState,RequestBudgetAdmission} from '../../core/budget/model-request-budget-storage';
import {requestBudgetBindingSchema,requestBudgetModelSchema,requestBudgetQuerySchema,requestBudgetUsageSchema,type RequestBudgetBinding,type RequestBudgetIntent,type ModelRequestBudgetChange} from '../../core/budget/model-request-budget';
import {requestBudgetRecords,requestBudgetReport,requestBudgetReservation,requestBudgetCost,requestBudgetDecision,requestBudgetCommand,requestBudgetReceipt} from '../../core/budget/model-request-budget-rules';
import type {ResolvedLlm} from '../../core/models/ports';
import type {RequestBudgetPort,RequestBudgetTicket,RequestUnknownReason} from '../../core/models/request-budget';
import {workspaceMemberModelHash} from '../../core/team/workspace-member-rules';

type Owner={entry:{id:string};instanceId:string;assert():void};
/** 每个活动工作区仅一份；实例代际来自工作区所有权，不从磁盘请求或页面输入恢复。 */
export class ModelRequestBudgetService {
  /** 当前实例发现的未知先同步封住同周期所有端口，随后可靠保存；重开仍从原日志判断未知。 */
  private readonly stoppedScopes=new Set<string>();
  constructor(private readonly owner:Owner,private readonly store:RequestBudgetStore,private readonly budgets:RequestBudgetAdmission){}
  /** 主工厂已解析配置但尚未消费等待时调用；没有当前周期表示新目标，由其首次请求独立核验。 */
  async preflight(rootSessionId:string,scopeId:string|undefined,llm:ResolvedLlm|undefined):Promise<void>{
    if(!scopeId)return;this.owner.assert();const state=await this.store.readBudget(),scope=state.scopes?.find(s=>s.scopeId===scopeId&&s.rootSessionId===rootSessionId);
    if(!scope?.budget?.policy.enabled||scope.budget.policy.enforcement!=='request')return;
    if(!llm)fail('MODEL_REQUEST_CONFIGURATION','逐请求预算缺少已解析模型，原等待保留');this.budgets.preflightRequest(state,scope,llm.profile);
  }
  /** 在真实 run 已登记之后装配；成员可以处于 starting，但 reserve/issue 必须等领取 running 落盘。 */
  async forRun(input:{rootSessionId:string;taskId:string;runId:string;kind:'main'|'member';scopeId?:string},llm?:ResolvedLlm):Promise<RequestBudgetPort|undefined>{
    this.owner.assert();const state=await this.store.readBudget();
    const scope=input.kind==='main'?state.scopes?.find(s=>s.rootSessionId===input.rootSessionId&&s.runTracking?.mainRunIds.includes(input.runId)):state.scopes?.find(s=>s.scopeId===input.scopeId&&s.rootSessionId===input.rootSessionId);
    if(!scope?.budget?.policy.enabled||scope.budget.policy.enforcement!=='request')return;
    if(!llm)fail('MODEL_REQUEST_CONFIGURATION','逐请求预算缺少已解析的可信模型，未启动模型请求');
    const p=llm.profile,binding=requestBudgetBindingSchema.parse({...input,scopeId:scope.scopeId,workspaceId:this.owner.entry.id,ownerInstanceId:this.owner.instanceId});
    const model=requestBudgetModelSchema.parse({profileId:p.id,modelId:p.model,configurationHash:workspaceMemberModelHash(p),api:p.api,contextWindow:p.contextWindow,maxTokens:p.maxTokens,...(p.pricing?{pricing:p.pricing}:{})});
    const policyRevision=scope.budget.policy.revision;
    return {model:structuredClone(model),reserve:async request=>{
      this.assertLive(binding);
      if(this.stoppedScopes.has(binding.scopeId))fail('MODEL_REQUEST_UNVERIFIED','本周期请求结果待核实，未发送新的请求');
      const intent:RequestBudgetIntent={version:1,requestId:randomUUID(),binding,policyRevision,model,requestHash:request.requestHash,maxOutputTokens:request.maxOutputTokens,...requestBudgetReservation(model,request.maxOutputTokens),createdAt:new Date().toISOString()};
      const initial:ModelRequestBudgetChange={requestId:intent.requestId,revision:1,recordedAt:intent.createdAt,phase:'reserved',intent};let denial='';
      const receipt=await this.store.transactBudget(requestBudgetCommand(initial),async current=>{
        this.assertLive(binding);const currentScope=current.scopes?.find(s=>s.scopeId===binding.scopeId);
        if(!currentScope?.budget)fail('MODEL_REQUEST_BUDGET_STALE','请求所属周期或冻结预算已不存在');
        const records=requestBudgetRecords(current.modelRequestBudgetChanges??[]),report=this.summary(current,binding),reason=requestBudgetDecision(currentScope.budget.policy,report,intent,records);
        const change:ModelRequestBudgetChange=reason?{...initial,phase:'denied',reason}:initial;
        if(reason){const limit=currentScope.budget.policy.limits;denial=reason==='token_reserve'?`本次请求需要预留 ${intent.tokens} Token，剩余 ${Math.max(0,(limit.tokens??0)-report.tokens-report.reservedTokens)} Token`:reason==='cost_reserve'?`本次请求需预留约 $${intent.estimatedCostUsd}，剩余约 $${Math.max(0,(limit.estimatedCostUsd??0)-report.estimatedCostUsd-report.reservedCostUsd)}`:reason==='unpriced'?'原模型价格缺失，无法核实美元预算':reason==='capacity'?'请求审计容量已满':'本周期存在未核实请求或超出原预留的报告';}
        return {modelRequestBudgetChanges:[change],receipt:requestBudgetReceipt(change)};
      });
      if(receipt.phase==='denied')fail('MODEL_REQUEST_BUDGET_DENIED',denial+'；已在发送前停止，原结果保留');
      return this.ticket(intent);
    }};
  }
  /** 纯读取，不补终态、不启动模型；调用者必须提供完整的周期归属。 */
  async report(input:unknown){this.owner.assert();const query=requestBudgetQuerySchema.parse(input);if(query.workspaceId!==this.owner.entry.id)fail('MODEL_REQUEST_IDENTITY','请求账本属于其它工作区');return this.summary(await this.store.readBudget(),query)}
  private summary(state:RequestBudgetState,b:{workspaceId:string;rootSessionId:string;scopeId:string}){
    const scope=state.scopes?.find(s=>s.scopeId===b.scopeId&&s.rootSessionId===b.rootSessionId&&s.workspaceId===b.workspaceId);
    if(!scope?.budget?.policy.enabled||scope.budget.policy.enforcement!=='request')fail('MODEL_REQUEST_NOT_ENABLED','本周期没有启用逐请求预算');
    return requestBudgetReport(requestBudgetRecords(state.modelRequestBudgetChanges??[]),{workspaceId:b.workspaceId,rootSessionId:b.rootSessionId,scopeId:b.scopeId,policyRevision:scope.budget.policy.revision},this.owner.instanceId);
  }
  private assertLive(binding:RequestBudgetBinding){this.owner.assert();if(binding.kind==='main'&&!this.budgets.isMainLive(binding.runId))fail('MODEL_REQUEST_RUN_STALE','原主运行已结束，未发送新的模型请求')}
  private ticket(intent:RequestBudgetIntent):RequestBudgetTicket{
    let revision=1,phase:'reserved'|'issuing'|'terminal'='reserved',busy=false;
    const save=async(next:Omit<ModelRequestBudgetChange,'requestId'|'revision'|'recordedAt'>)=>{
      if(busy||phase==='terminal')fail('MODEL_REQUEST_STAGE','同一请求阶段不可并发或重新结算');busy=true;
      const change={...next,requestId:intent.requestId,revision:revision+1,recordedAt:new Date().toISOString()} as ModelRequestBudgetChange;
      try{await this.store.transactBudget(requestBudgetCommand(change),async()=>{if(change.phase==='issuing'){this.assertLive(intent.binding);if(this.stoppedScopes.has(intent.binding.scopeId))fail('MODEL_REQUEST_UNVERIFIED','本周期已有未核实请求')}return {modelRequestBudgetChanges:[change],receipt:requestBudgetReceipt(change)}});revision++;phase=change.phase==='issuing'?'issuing':'terminal'}catch(error){if(phase==='issuing'||change.phase==='issuing')this.stoppedScopes.add(intent.binding.scopeId);throw error}finally{busy=false}
    };
    return {requestId:intent.requestId,issue:()=>save({phase:'issuing'}),assertSend:()=>{this.assertLive(intent.binding);if(phase!=='issuing'||this.stoppedScopes.has(intent.binding.scopeId))fail('MODEL_REQUEST_UNVERIFIED','原请求已停止或有待核实消耗')},report:usage=>{const verified=requestBudgetUsageSchema.parse(usage);if(verified.input+verified.cacheRead+verified.cacheWrite>intent.model.contextWindow||verified.output>intent.maxOutputTokens)this.stoppedScopes.add(intent.binding.scopeId);return save({phase:'reported',usage:verified,estimatedCostUsd:requestBudgetCost(intent.model,verified)} as ModelRequestBudgetChange)},unknown:(reason:RequestUnknownReason)=>{this.stoppedScopes.add(intent.binding.scopeId);return save({phase:'unknown',reason} as ModelRequestBudgetChange)},notSent:reason=>save({phase:'not_sent',reason} as ModelRequestBudgetChange)};
  }
}
