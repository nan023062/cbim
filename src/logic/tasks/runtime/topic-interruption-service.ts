/**
 * 作用定位：保存整话题补充意图，并在可信协调器排空全部参与者后建立等待检查点。
 * 设计原因：复用原目标接续事务推进输入版本，独立记录停止前的请求；无法证实退出时保持原意图，不恢复旧运行或伪造暂停成功。
 */
import {fail} from '../../../core/errors';
import {hash,json} from '../../../core/platform/node/serialization';
import type {KnowledgeWorkspace} from '../../knowledge/rules/ports';
import type {DispatchStore,DispatchState} from '../../dispatch/rules/dispatch-storage';
import type {RunSummary} from '../../execution/rules/types';
import type {DispatchScope} from '../rules/dispatch-scope';
import {sameGoalValue} from '../rules/scope-goal';
import {scopeContinuationTotalTextLimit} from '../rules/scope-continuation';
import {scopeHasUnresolvedActiveInput} from '../rules/scope-active-input';
import {topicInterruptionRequestSchema,pendingTopicInterruption,type TopicInterruptionRequest} from '../rules/topic-interruption';

export class TopicInterruptionService {
  constructor(private readonly owner:Pick<KnowledgeWorkspace,'entry'|'assert'|'snapshot'>,private readonly store:DispatchStore){}
  private scope(state:DispatchState,request:TopicInterruptionRequest):DispatchScope{
    this.owner.assert();
    const scope=state.scopes?.find(value=>value.scopeId===request.scopeId&&value.rootSessionId===request.rootSessionId&&value.workspaceId===request.workspaceId);
    if(request.workspaceId!==this.owner.entry.id||!scope)fail('TOPIC_IDENTITY','补充不属于指定办公室的话题');
    return scope;
  }
  /** 相同命令只查原记录；已完成话题不可重开，调用方应另建关联话题。 */
  async prepare(raw:TopicInterruptionRequest):Promise<DispatchScope>{
    const request=topicInterruptionRequestSchema.parse(raw);
    const scope=this.scope(await this.store.read(),request),existing=scope.topicInterruptions?.find(value=>value.request.commandId===request.commandId);
    if(existing){if(!sameGoalValue(existing.request,request))fail('TOPIC_INPUT_CONFLICT','同一补充标识已绑定其他正文、话题或配置');return scope}
    await this.store.transact({commandId:'topic-interrupt-'+request.commandId,fingerprint:hash(json(request))},async state=>{
      const current=this.scope(state,request);
      if(current.status!=='active'||pendingTopicInterruption(current))fail('TOPIC_NOT_ACTIVE','话题已结束、正在暂停或已有补充，请刷新原话题');
      if(!current.goal||current.goal.blocked||scopeHasUnresolvedActiveInput(current))fail('TOPIC_NOT_READY','话题存在未核实记录，不能插入新指令');
      if((current.goal.inputRevision??1)!==request.expectedInputRevision)fail('TOPIC_INPUT_CONFLICT','话题输入版本已变化，请刷新后补充');
      if((current.topicInterruptions?.length??0)>=31||request.expectedInputRevision>=32)fail('GOAL_INPUT_LIMIT','话题补充次数已达上限');
      if(current.goal.revision>62||(current.runTracking?.mainRunIds.length??32)>=32)fail('GOAL_CYCLE_LIMIT','当前话题已无重新规划额度，请结束后另建话题');
      const text=(current.continuations??[]).reduce((total,item)=>total+('input' in item?item.input.message.length:0),0)+(current.activeInputs??[]).reduce((total,item)=>total+(item.status==='rejected'?0:item.messageCharacters),0);
      if(text+request.input.message.length>scopeContinuationTotalTextLimit)fail('GOAL_INPUT_LIMIT','本话题补充正文已达到上限，请结束后另建话题');
      const next={...current,topicInterruptions:[...(current.topicInterruptions??[]),{request,requestedAt:new Date().toISOString()}]};
      return {scopes:[next],receipt:true};
    });
    return this.scope(await this.store.read(),request);
  }
  /** summary 来自已停止主运行的 canonical；成员真实终态和图游标在提交时再次核对。 */
  async park(request:TopicInterruptionRequest,summary:RunSummary):Promise<DispatchScope>{
    const knowledge=await this.owner.snapshot();
    await this.store.transact({commandId:'topic-paused-'+request.commandId,fingerprint:hash(json({request,runId:summary.runId}))},async state=>{
      const scope=this.scope(state,request),intent=pendingTopicInterruption(scope);
      if(scope.status!=='active'||!intent||!sameGoalValue(intent.request,request)||!scope.goal)fail('TOPIC_NOT_ACTIVE','原补充已变化或话题已结束');
      if(!['completed','cancelled'].includes(summary.status)||summary.logIntegrity?.partialTail!==false||summary.unresolvedTools.length||!summary.sessionFile||summary.task.taskId!==request.rootSessionId||summary.task.workspaceId!==request.workspaceId||scope.runTracking?.mainRunIds.at(-1)!==summary.runId)fail('TOPIC_MAIN_UNSETTLED','主 Agent 尚未安全退出，请核实原运行，补充仍保留');
      const graph=state.graphs.find(value=>value.identity.rootSessionId===request.rootSessionId)!;
      const taskIds=new Set(graph.tasks.filter(value=>value.scopeId===scope.scopeId).map(value=>value.taskId));
      if(graph.tasks.some(value=>taskIds.has(value.taskId)&&value.activeRunId)||state.runs?.some(value=>taskIds.has(value.binding.taskId)&&['starting','running','interrupted'].includes(value.status)))fail('TOPIC_MEMBERS_UNSETTLED','话题成员仍在执行或存在未知结果，补充保留等待核实');
      const next:DispatchScope={...scope,status:'waiting',wait:{waitId:request.commandId,interruptionId:request.commandId,reason:'用户补充已保存，全部参与者已退出，等待主 Agent 重新分析',createdAt:new Date().toISOString(),runId:summary.runId,goalRevision:scope.goal.revision,graphCursor:{streamId:graph.cursor.streamId,seq:graph.cursor.seq},knowledgeRevision:knowledge.revision,mainRunIds:[...scope.runTracking!.mainRunIds]}};
      return {scopes:[next],receipt:true};
    });
    return this.scope(await this.store.read(),request);
  }
}
