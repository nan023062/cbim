/**
 * 作用定位：在同一派发事务核实未领取任务及两端后继，为原目标追加一条结果前置。
 * 设计原因：后创建的任务也能成为先前待办的前置；在 Knowledge→模型→Store 锁序内重核全部待办岗位、角色和 Workflow，审计和等待状态一起保存，不能靠事件名称绕过门禁。
 * 职责边界：不创建运行、不改原信封或任务计划；成功只登记依赖，当前主轮结束后仍沿原权限、预算和结果领取规则执行。
 */
import {randomUUID} from 'node:crypto';
import {z} from 'zod';
import {fail} from '../../core/foundation/errors';
import {hash,json} from '../../core/foundation/serialization';
import {contextualMainCommand} from './main-command-request';
import type {DispatchStore} from '../../core/tasks/dispatch-storage';
import type {GraphIdentity,GraphEdge,TaskNode} from '../../core/tasks/graph-types';
import {addQueuedDependencyInputSchema,type AddQueuedDependencyInput,type DependencyAddition,type AddQueuedDependencyReceipt} from '../../core/tasks/queued-dependency-addition';
import {queuedDependencyAdditionSelection} from '../../core/tasks/queued-dependency-addition-rules';
import {prepareDispatchExecutionContext,recheckDispatchExecutionContext,type DispatchKnowledgeWorkspace} from '../context/execution-context';
import {memberBatch,memberView} from './member-state';
import type {ScopeGoalService} from './scope-goal-service';
import type {OwnerExecutionService} from './owner-execution-service';
import {ownerExecutionSelectionFor} from '../../core/team/member-execution-binding';

const id=z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/);
const contextSchema=z.object({workspaceId:id,rootSessionId:id,scopeId:id,runId:id,commandId:id}).strict();
export class QueuedDependencyAdditionService {
  constructor(private readonly owner:DispatchKnowledgeWorkspace,private readonly store:DispatchStore,private readonly goals:ScopeGoalService,private readonly owners?:OwnerExecutionService){}
  /** 主轮闭包提供身份和停止屏障；同命令先返回原提交回执，变参拒绝，读取/停止不自动重新加边。 */
  async add(identity:GraphIdentity,scopeId:string,runId:string,commandId:string,raw:AddQueuedDependencyInput,assertCurrent?:()=>void):Promise<AddQueuedDependencyReceipt>{
    const parsed=addQueuedDependencyInputSchema.safeParse(raw),context=contextSchema.safeParse({...identity,scopeId,runId,commandId});
    if(!parsed.success||!context.success)fail('DEPENDENCY_INPUT_INVALID','前置追加参数或主调度运行身份无效');
    const input=parsed.data,fixed=context.data,alive=()=>{this.owner.assert();assertCurrent?.();if(fixed.workspaceId!==this.owner.entry.id)fail('GRAPH_IDENTITY_MISMATCH','前置追加不属于当前工作区')};
    const command=contextualMainCommand('dispatch.addDependency',fixed,input);
    if(!this.owners)fail('OWNER_EXECUTION_UNAVAILABLE','未装配岗位前置核验');const old=await this.owners.replay<AddQueuedDependencyReceipt>(command);if(old)return old.receipt;
    alive();
    return this.owners.withContext(state=>this.owners!.selections(queuedDependencyAdditionSelection(state,fixed,scopeId,runId,input).tasks),context=>this.store.transact(command,async state=>{
      alive();const {graph,scope,source,target,tasks,members}=queuedDependencyAdditionSelection(state,fixed,scopeId,runId,input);
      const knowledgeRevision=scope.goal!.plan!.knowledgeRevision;
      if((await this.owner.read()).revision!==knowledgeRevision)fail('DEPENDENCY_KNOWLEDGE_STALE','知识基线已变化，不能给旧待办追加前置');alive();
      let latest:Awaited<ReturnType<typeof prepareDispatchExecutionContext>>|undefined;
      for(const task of tasks){
        const binding=await this.owners!.verifyTask(state,context,task);alive();
        this.goals.validateDispatch(state,scope,{assigneeAgentId:task.assignee.agentId,ownerSelection:ownerExecutionSelectionFor(binding),moduleIds:task.modules.map(module=>module.moduleId),...(task.workflowSelections?{workflowSelections:task.workflowSelections}:{}),goal:task.goal,acceptance:task.acceptance,prerequisites:[]},knowledgeRevision,binding);
        latest=await prepareDispatchExecutionContext(this.owner,task,context.snapshot,state.workspaceMembers!.find(member=>member.memberId===binding.memberId));alive();
        if(latest.knowledgeRevision!==knowledgeRevision||latest.agent.teamId!==members.find(member=>member.agentInstanceId===task.assignee.agentInstanceId)!.teamId)fail('DEPENDENCY_KNOWLEDGE_STALE','待办角色、模块或 Workflow 已经变化');
      }
      if(!latest)fail('DEPENDENCY_INPUT_INVALID','前置追加缺少完整待办范围');
      // 所有准备均要求同一全局知识版本；最后读取屏障也覆盖前面任务准备后的并发治理。
      await recheckDispatchExecutionContext(this.owner,latest);alive();
      const now=new Date().toISOString(),edgeId=randomUUID(),trackedTaskIds=tasks.map(task=>task.taskId);
      const addition:DependencyAddition={commandId:fixed.commandId,scopeId,mainRunId:runId,addedAt:now,reason:input.reason,graphCursor:{...input.expectedGraphCursor},goalRevision:scope.goal!.revision,goalPlanRevision:scope.goal!.plan!.revision,knowledgeRevision,previousTaskRevision:target.revision,targetPlanRevision:target.planRevision,dependency:{edgeId,sourceTaskId:source.taskId,sourceTaskRevision:source.revision,sourcePlanRevision:source.planRevision},trackedTaskIds};
      const updated:TaskNode={...target,revision:target.revision+1,status:'waiting',updatedAt:now,waitReason:'等待新增前置任务的有效结果',dependencyAdditions:[...(target.dependencyAdditions??[]),addition]};
      const edge:GraphEdge={edgeId,identity:graph.identity,kind:'dependency',fromNodeId:source.nodeId,toNodeId:target.nodeId,revision:1,enabled:true,condition:{kind:'result_ready',planRevision:source.planRevision}};
      const member=members.find(value=>value.agentInstanceId===target.assignee.agentInstanceId)!,nextMember={...member,activity:'waiting' as const,waitingTaskIds:[target.taskId]};
      const batch={...memberBatch(graph,commandId,'dependency.changed',[{type:'edge.upserted',edge},{type:'task.upserted',task:updated},{type:'agent.upserted',agent:memberView(graph,nextMember,updated)}]),committedAt:now};
      return {members:[nextMember],batch,receipt:{workspaceId:fixed.workspaceId,rootSessionId:fixed.rootSessionId,scopeId,mainRunId:runId,commandId,taskId:target.taskId,status:'waiting',trackedTaskIds,addition,graphCursor:{streamId:batch.streamId,seq:batch.seq}}};
    }),alive);
  }
}
