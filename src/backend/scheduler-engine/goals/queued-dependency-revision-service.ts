/**
 * 目录归属：backend/scheduler-engine/goals；目标状态与核证恢复服务。
 * 原子修订依赖复核原自动任务范围和兜底模型，不把图调整当作重新选型。
 * 作用定位：在同一可靠事务中退役和新增未领取目标的多条前置，保存原请求与完整闭包审计。
 * 设计原因：知识→模型→Store 固定锁序核全部受影响岗位，增删后的图一次生效；不改原计划、实例或信封。
 * 职责边界：不启动成员，不回滚已执行来源；同命令返回原回执，回包未知须查询而不能换键重做。
 */
import {randomUUID} from 'node:crypto';
import {z} from 'zod';
import {fail} from '../../core/foundation/errors';
import {contextualMainCommand} from './main-command-request';
import type {DispatchStore} from '../../core/dispatch/dispatch-storage';
import type {GraphIdentity,GraphChange,TaskNode} from '../../core/tasks/graph-types';
import {reviseQueuedDependenciesInputSchema,type ReviseQueuedDependenciesInput,type DependencyRevision,type ReviseQueuedDependenciesReceipt} from '../../core/tasks/queued-dependency-revision';
import {queuedDependencyRevisionSelection} from '../../core/tasks/queued-dependency-revision-rules';
import {prepareDispatchExecutionContext,recheckDispatchExecutionContext,type DispatchKnowledgeWorkspace} from '../context/execution-context';
import {memberBatch,memberView} from '../members/member-state';
import type {ScopeGoalService} from './scope-goal-service';
import type {OwnerExecutionService} from '../dispatch/owner-execution-service';
import {ownerExecutionSelectionFor} from '../../core/team/member-execution-binding';

const id=z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/);
const contextSchema=z.object({workspaceId:id,rootSessionId:id,scopeId:id,runId:id,commandId:id}).strict();
export class QueuedDependencyRevisionService {
  constructor(private readonly owner:DispatchKnowledgeWorkspace,private readonly store:DispatchStore,private readonly goals:ScopeGoalService,private readonly owners:OwnerExecutionService){}
  /** 停止和版本竞争在读取前后复核；已保存的同命令只读返回，不再次变更或启动任务。 */
  async revise(identity:GraphIdentity,scopeId:string,runId:string,commandId:string,raw:ReviseQueuedDependenciesInput,assertCurrent?:()=>void):Promise<ReviseQueuedDependenciesReceipt>{
    const parsed=reviseQueuedDependenciesInputSchema.safeParse(raw),context=contextSchema.safeParse({...identity,scopeId,runId,commandId});
    if(!parsed.success||!context.success)fail('DEPENDENCY_INPUT_INVALID','前置修订参数或主身份无效');
    const input=parsed.data,fixed=context.data,alive=()=>{this.owner.assert();assertCurrent?.();if(fixed.workspaceId!==this.owner.entry.id)fail('GRAPH_IDENTITY_MISMATCH','前置修订不属于当前工作区')};
    const command=contextualMainCommand('dispatch.reviseDependencies',fixed,input),old=await this.owners.replay<ReviseQueuedDependenciesReceipt>(command);if(old)return old.receipt;
    alive();
    return this.owners.withContext(state=>this.owners.selections(queuedDependencyRevisionSelection(state,fixed,scopeId,runId,input).tasks),context=>this.store.transact(command,async state=>{
      alive();const {graph,scope,target,removed,added,tasks,members,status}=queuedDependencyRevisionSelection(state,fixed,scopeId,runId,input),knowledgeRevision=scope.goal!.plan!.knowledgeRevision;
      if((await this.owner.read()).revision!==knowledgeRevision)fail('DEPENDENCY_KNOWLEDGE_STALE','知识基线已变化，不能修订旧待办');alive();
      let latest:Awaited<ReturnType<typeof prepareDispatchExecutionContext>>|undefined;
      for(const task of tasks){
        await this.owners.verifyTask(state,context,task);alive();const binding=task.ownerBinding;
        this.goals.validateDispatch(state,scope,{assigneeAgentId:task.assignee.agentId,...(binding?{ownerSelection:ownerExecutionSelectionFor(binding)}:{}),moduleIds:task.modules.map(m=>m.moduleId),...(task.workflowSelections?{workflowSelections:task.workflowSelections}:{}),goal:task.goal,acceptance:task.acceptance,prerequisites:[]},knowledgeRevision,binding,task.fallbackBinding);
        latest=await prepareDispatchExecutionContext(this.owner,task,context.snapshot,binding?state.workspaceMembers!.find(member=>member.memberId===binding.memberId):undefined);alive();
        if(latest.knowledgeRevision!==knowledgeRevision||latest.agent.teamId!==members.find(m=>m.agentInstanceId===task.assignee.agentInstanceId)!.teamId)fail('DEPENDENCY_KNOWLEDGE_STALE','待办角色、模块或 Workflow 已变化');
      }
      if(!latest)fail('DEPENDENCY_INPUT_INVALID','修订缺少完整待办范围');
      await recheckDispatchExecutionContext(this.owner,latest);alive();
      const now=new Date().toISOString(),trackedTaskIds=tasks.map(t=>t.taskId);
      const revision:DependencyRevision={commandId,scopeId,mainRunId:runId,revisedAt:now,request:structuredClone(input),goalPlanRevision:scope.goal!.plan!.revision,knowledgeRevision,removed:removed.map(e=>{const source=graph.tasks.find(t=>t.nodeId===e.fromNodeId)!;return {edgeId:e.edgeId,edgeRevision:e.revision,sourceTaskId:source.taskId,sourceTaskRevision:source.revision,sourcePlanRevision:source.planRevision}}),added:added.map(t=>({edgeId:randomUUID(),sourceTaskId:t.taskId,sourceTaskRevision:t.revision,sourcePlanRevision:t.planRevision})),trackedTaskIds};
      const updated:TaskNode={...target,revision:target.revision+1,status,updatedAt:now,waitReason:status==='waiting'?'等待修订后的前置任务有效结果':undefined,dependencyRevisions:[...(target.dependencyRevisions??[]),revision]};
      const member=members.find(m=>m.agentInstanceId===target.assignee.agentInstanceId)!,nextMember={...member,activity:status==='waiting'?'waiting' as const:'idle' as const,waitingTaskIds:status==='waiting'?[target.taskId]:[]};
      const changes:GraphChange[]=[...removed.map(e=>({type:'edge.upserted' as const,edge:{...e,revision:e.revision+1,enabled:false}})),...revision.added.map(e=>({type:'edge.upserted' as const,edge:{edgeId:e.edgeId,identity:graph.identity,kind:'dependency' as const,fromNodeId:'task:'+e.sourceTaskId,toNodeId:target.nodeId,revision:1,enabled:true,condition:{kind:'result_ready' as const,planRevision:e.sourcePlanRevision}}})),{type:'task.upserted',task:updated},{type:'agent.upserted',agent:memberView(graph,nextMember,updated)}];
      const batch={...memberBatch(graph,commandId,'dependency.changed',changes),committedAt:now};
      return {members:[nextMember],batch,receipt:{workspaceId:fixed.workspaceId,rootSessionId:fixed.rootSessionId,scopeId,mainRunId:runId,commandId,taskId:target.taskId,status,trackedTaskIds,revision,graphCursor:{streamId:batch.streamId,seq:batch.seq}}};
    }),alive);
  }
}
