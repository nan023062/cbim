/**
 * 作用定位：主调度在同一事务核实旧前置、安全替代候选与未启动后继，并原子提交单条依赖替换。
 * 设计原因：图上的 result_ready 不足以授权后续执行；历史候选按原证明核实，未领取闭包则在 Knowledge→模型→Store 锁序中核当前岗位，保留旧边和审计，不重启已执行任务。
 * 职责边界：不运行成员、不改变目标、Workflow 选择、权限或实例身份；按原选择复核待办，回执仅供当前主轮重新跟踪，停止或重开不能自动消费。
 */
import {randomUUID} from 'node:crypto';
import {z} from 'zod';
import {fail} from '../../core/foundation/errors';
import {hash,json} from '../../core/foundation/serialization';
import type {DispatchStore} from '../../core/tasks/dispatch-storage';
import type {GraphIdentity,GraphEdge,TaskNode} from '../../core/tasks/graph-types';
import {replaceQueuedDependencyInputSchema,type ReplaceQueuedDependencyInput,type DependencyReplacement,type ReplaceQueuedDependencyReceipt} from '../../core/tasks/queued-dependency-replacement';
import {queuedDependencyReplacementSelection} from '../../core/tasks/queued-dependency-replacement-rules';
import {prepareDispatchExecutionContext,recheckDispatchExecutionContext,type DispatchKnowledgeWorkspace} from '../context/execution-context';
import {memberBatch,memberView} from './member-state';
import type {ScopeGoalService} from './scope-goal-service';
import type {OwnerExecutionService} from './owner-execution-service';
import {ownerExecutionSelectionFor} from '../../core/team/member-execution-binding';

const id=z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/);
const contextSchema=z.object({workspaceId:id,rootSessionId:id,scopeId:id,runId:id,commandId:id}).strict();
export class QueuedDependencyReplacementService {
  constructor(private readonly owner:DispatchKnowledgeWorkspace,private readonly store:DispatchStore,private readonly goals:ScopeGoalService,private readonly owners?:OwnerExecutionService){}
  /** 身份由主轮闭包固定；版本/候选/停止任何核实失败都不改边，同命令只返回原回执，不再次排队或运行。 */
  async replace(identity:GraphIdentity,scopeId:string,runId:string,commandId:string,raw:ReplaceQueuedDependencyInput,assertCurrent?:()=>void):Promise<ReplaceQueuedDependencyReceipt>{
    const parsed=replaceQueuedDependencyInputSchema.safeParse(raw),context=contextSchema.safeParse({...identity,scopeId,runId,commandId});
    if(!parsed.success||!context.success)fail('DEPENDENCY_INPUT_INVALID','前置替换参数或主调度运行身份无效');
    const input=parsed.data,fixed=context.data,alive=()=>{this.owner.assert();assertCurrent?.();if(fixed.workspaceId!==this.owner.entry.id)fail('GRAPH_IDENTITY_MISMATCH','前置替换不属于当前工作区')};
    const command={commandId:fixed.commandId,fingerprint:hash(json({operation:'dispatch.replaceDependency',context:fixed,input}))};
    if(!this.owners)fail('OWNER_EXECUTION_UNAVAILABLE','未装配岗位前置核验');const old=await this.owners.replay<ReplaceQueuedDependencyReceipt>(command);if(old)return old.receipt;
    alive();
    return this.owners.withContext(state=>this.owners!.selections(queuedDependencyReplacementSelection(state,fixed,scopeId,input).tasks),context=>this.store.transact(command,async state=>{
      alive();const {graph,scope,target,source,replacement,edge,tasks,members,status}=queuedDependencyReplacementSelection(state,fixed,scopeId,input);
      if(!scope.runTracking?.mainRunIds.includes(runId))fail('DEPENDENCY_MAIN_INVALID','修订需要本周期完整登记的主运行；旧周期不能补造来源');
      const current=await this.owner.read(),knowledgeRevision=scope.goal!.plan!.knowledgeRevision;
      if(current.revision!==knowledgeRevision)fail('DEPENDENCY_KNOWLEDGE_STALE','知识基线已变化，不能刷新旧任务后继续执行');
      await this.goals.validateDependencySource(state,scope,source);alive();
      await this.goals.validateMemberCandidate(state,scope,graph,replacement,knowledgeRevision);alive();
      const candidateRun=state.runs!.find(run=>run.binding.runId===replacement.result!.runId&&run.binding.taskId===replacement.taskId)!;
      for(const task of tasks){
        const binding=await this.owners!.verifyTask(state,context,task);alive();
        this.goals.validateDispatch(state,scope,{assigneeAgentId:task.assignee.agentId,ownerSelection:ownerExecutionSelectionFor(binding),moduleIds:task.modules.map(module=>module.moduleId),...(task.workflowSelections?{workflowSelections:task.workflowSelections}:{}),goal:task.goal,acceptance:task.acceptance,prerequisites:[]},knowledgeRevision,binding);
        const prepared=await prepareDispatchExecutionContext(this.owner,task,context.snapshot,state.workspaceMembers!.find(member=>member.memberId===binding.memberId));alive();
        if(prepared.knowledgeRevision!==knowledgeRevision||prepared.agent.teamId!==members.find(member=>member.agentInstanceId===task.assignee.agentInstanceId)!.teamId)fail('DEPENDENCY_KNOWLEDGE_STALE','待办角色或模块基线已经过期');
      }
      await recheckDispatchExecutionContext(this.owner,candidateRun.prepared);alive();
      const now=new Date().toISOString(),newEdgeId=randomUUID(),trackedTaskIds=tasks.map(task=>task.taskId);
      const record:DependencyReplacement={commandId:fixed.commandId,scopeId,mainRunId:runId,replacedAt:now,reason:input.reason,graphCursor:{...input.expectedGraphCursor},goalRevision:scope.goal!.revision,goalPlanRevision:scope.goal!.plan!.revision,knowledgeRevision,previousTaskRevision:target.revision,targetPlanRevision:target.planRevision,retired:{edgeId:edge.edgeId,revision:edge.revision,sourceTaskId:source.taskId,sourcePlanRevision:source.planRevision,...(edge.condition.resultId?{resultId:edge.condition.resultId}:{})},replacement:{edgeId:newEdgeId,sourceTaskId:replacement.taskId,sourceTaskRevision:replacement.revision,sourcePlanRevision:replacement.planRevision,runId:replacement.result!.runId,resultId:replacement.result!.resultId},trackedTaskIds};
      const updated:TaskNode={...target,revision:target.revision+1,status,updatedAt:now,waitReason:status==='waiting'?'等待其余前置任务的有效结果':undefined,dependencyReplacements:[...(target.dependencyReplacements??[]),record]};
      const nextEdge:GraphEdge={edgeId:newEdgeId,identity:graph.identity,kind:'dependency',fromNodeId:replacement.nodeId,toNodeId:target.nodeId,revision:1,enabled:true,condition:{kind:'result_ready',planRevision:replacement.planRevision,resultId:replacement.result!.resultId}};
      const member=members.find(value=>value.agentInstanceId===target.assignee.agentInstanceId)!,nextMember={...member,activity:status==='waiting'?'waiting' as const:'idle' as const,waitingTaskIds:status==='waiting'?[target.taskId]:[]};
      const batch={...memberBatch(graph,commandId,'dependency.changed',[{type:'edge.upserted',edge:{...edge,revision:edge.revision+1,enabled:false}},{type:'edge.upserted',edge:nextEdge},{type:'task.upserted',task:updated},{type:'agent.upserted',agent:memberView(graph,nextMember,updated)}]),committedAt:now};
      return {members:[nextMember],batch,receipt:{workspaceId:fixed.workspaceId,rootSessionId:fixed.rootSessionId,scopeId,mainRunId:runId,commandId,taskId:target.taskId,status,trackedTaskIds,replacement:record,graphCursor:{streamId:batch.streamId,seq:batch.seq}}};
    }),alive);
  }
}
