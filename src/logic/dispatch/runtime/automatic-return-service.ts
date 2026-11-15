/**
 * 自动返回模型指纹包含全部角色，模型变化不能用原返回请求继续。
 * 作用定位：持久保存主轮待回传批次，重启时核实可自动接收的已完成成员结果。
 * 设计原因：恢复只转交可靠成果，不运行旧成员；最新启动意图、完整日志、模型配置与当前文件均须匹配，同目标异常额度从持久任务图核实，未知保持封存。
 */
import {fail} from '../../../core/errors';
import {hash,json} from '../../../core/platform/node/serialization';
import {automaticReturnSchema,type AutomaticReturn} from '../../tasks/rules/automatic-return';
import {sameGoalValue} from '../../tasks/rules/scope-goal';
import type {DispatchStore} from '../rules/dispatch-storage';
import type {GraphIdentity} from '../../tasks/rules/graph-types';
import type {DispatchScope} from '../../tasks/rules/dispatch-scope';
import type {RunSummary} from '../../execution/rules/types';
import type {KnowledgeWorkspace} from '../../knowledge/rules/ports';
import type {ScopeGoalService,ScopeGoalPorts} from '../../tasks/runtime/scope-goal-service';
import {workspaceMemberModelHash} from '../../team/rules/workspace-member-rules';
import type {OwnerExecutionModelPorts} from './owner-execution-service';
import {memberFailureStopReason} from './member-failure-limit';

export class AutomaticReturnService {
  constructor(private owner:Pick<KnowledgeWorkspace,'entry'|'assert'|'read'>,private store:DispatchStore,private goals:ScopeGoalService,private logs?:ScopeGoalPorts,private models?:OwnerExecutionModelPorts){}
  private async modelHash(options:AutomaticReturn['options']){
    if(!this.models)fail('AUTO_RETURN_UNAVAILABLE','模型配置核实未装配');
    return workspaceMemberModelHash(await this.models.configuration(options.profileId,options.model,options.engine,options.modelRoles));
  }
  /** 真实主轮结算后、首次启动成员前保存；同批重复只查原记录，不刷新指纹或改变权限。 */
  async record(identity:GraphIdentity,scopeId:string,summary:RunSummary,taskIds:string[],options:AutomaticReturn['options']):Promise<void>{
    this.owner.assert();const state=await this.store.read(),scope=state.scopes?.find(value=>value.scopeId===scopeId&&value.rootSessionId===identity.rootSessionId&&value.workspaceId===identity.workspaceId);
    if(!scope||identity.workspaceId!==this.owner.entry.id)fail('AUTO_RETURN_IDENTITY','回传批次不属于当前工作区');
    const prior=scope.automaticReturns?.find(value=>value.mainRunId===summary.runId);
    if(prior){if(!sameGoalValue(prior.taskIds,taskIds)||!sameGoalValue(prior.options,options))fail('AUTO_RETURN_CONFLICT','原回传批次不能改变任务或选项');return}
    if(summary.status!=='completed'||summary.unresolvedTools.length||scope.status!=='active'||scope.runTracking?.mainRunIds.at(-1)!==summary.runId)fail('AUTO_RETURN_UNSAFE','主运行尚未可靠结算');
    const canonical=await this.logs?.inspectMain(identity.rootSessionId,summary.runId);
    if(!canonical||canonical.logIntegrity?.partialTail!==false||!sameGoalValue(canonical.events,summary.events))fail('AUTO_RETURN_UNSAFE','主运行日志不可核实');
    const record=automaticReturnSchema.parse({mainRunId:summary.runId,taskIds,options,sourceLogHash:hash(json(canonical.events)),modelHash:await this.modelHash(options),recordedAt:new Date().toISOString()});
    await this.store.transact({commandId:'auto-return-record-'+hash(json({scopeId,runId:summary.runId})),fingerprint:hash(json({scopeId,runId:summary.runId,taskIds,options}))},async current=>{
      this.owner.assert();const fresh=current.scopes?.find(value=>value.scopeId===scopeId);
      if(!fresh||fresh.status!=='active'||fresh.runTracking?.mainRunIds.at(-1)!==summary.runId)fail('AUTO_RETURN_UNSAFE','批次保存前周期已变化');
      return {scopes:[{...fresh,automaticReturns:[...(fresh.automaticReturns??[]),record]}],receipt:true};
    });
  }
  /** 只读完整核实；有新主轮意图、缺日志、旧成果变化或未消费集合不精确都拒绝，不补发旧命令。 */
  async inspect(scope:DispatchScope){
    this.owner.assert();
    const record=scope.automaticReturns?.at(-1);
    if(!record||scope.status!=='active'||scope.goal?.blocked||scope.recovery||scope.runTracking?.mainRunIds.at(-1)!==record.mainRunId)return;
    if(await this.modelHash(record.options)!==record.modelHash)fail('AUTO_RETURN_MODEL_CHANGED','原主模型配置变化，不能无人值守接续');
    const summary=await this.logs?.inspectMain(scope.rootSessionId,record.mainRunId);
    if(!summary||hash(json(summary.events))!==record.sourceLogHash)fail('AUTO_RETURN_UNSAFE','原主运行日志已变化');
    const identity={workspaceId:scope.workspaceId,rootSessionId:scope.rootSessionId};
    const context=await this.goals.repairContext(identity,scope.scopeId,summary),state=await this.store.read();
    if(!sameGoalValue(context.scope,scope))fail('AUTO_RETURN_UNSAFE','取证期间原周期变化');
    // 重启也从原任务终态累计异常，不能因内存重建获得新的自动接续额度。
    const failureReason=memberFailureStopReason(context.graph,scope.scopeId);
    if(failureReason)fail('GOAL_MEMBER_FAILURE_LIMIT',failureReason);
    const tasks=context.graph.tasks.filter(task=>task.scopeId===scope.scopeId),knowledge=await this.owner.read();
    if(!tasks.length||tasks.some(task=>task.status!=='result_ready'||!task.result||task.activeRunId))fail('AUTO_RETURN_UNSAFE','自动恢复仅支持全部成员已可靠交付的周期');
    for(const task of tasks)await this.goals.validateMemberCandidate(state,scope,context.graph,task,knowledge.revision);
    const messages=state.outbox.filter(message=>message.kind==='result'&&record.taskIds.includes(message.taskId)&&message.identity.rootSessionId===scope.rootSessionId&&message.identity.workspaceId===scope.workspaceId&&message.to.agentInstanceId===context.graph.root.agent.agentInstanceId&&message.to.agentSessionId===context.graph.root.agent.agentSessionId);
    if(messages.length!==record.taskIds.length||new Set(messages.map(message=>message.taskId)).size!==record.taskIds.length||messages.some(message=>message.delivery!=='pending'||message.kind!=='result'||!tasks.some(task=>task.taskId===message.taskId&&task.result?.resultId===message.resultId&&task.result.runId===message.runId)))fail('AUTO_RETURN_UNSAFE','结果信封缺失、变化或已经消费');
    if(!sameGoalValue(await this.store.read(),state))fail('AUTO_RETURN_UNSAFE','核实期间调度状态变化');
    const repairs=[];
    for(const runId of scope.runTracking.mainRunIds){const run=await this.logs!.inspectMain(scope.rootSessionId,runId);if(run.source?.kind==='goal-repair')repairs.push(run.source)}
    return {...context,record,summary,repairs};
  }
  /** 每个活动周期独立核实；错误由宿主记录并封存，不能影响其他可证明安全的周期。 */
  async scopes(){this.owner.assert();return (await this.store.read()).scopes??[]}
}
