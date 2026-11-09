/**
 * 作用定位：核实追加依赖的不可变审计与精确原子变更，并向统一边门禁返回本批已验证的新边许可。
 * 设计原因：事件名称或审计字段存在都不能授权改边；必须从原快照重新选取闭包并逐项比较任务、成员和边的实际变化。
 * 职责边界：许可只在 Core 提交校验调用链内使用，不持久化、不来自模型，也不替代服务的知识/停止复核。
 */
import {fail} from '../foundation/errors';
import type {DispatchState,DispatchMutation,DispatchCommand} from './dispatch-storage';
import type {TaskNode} from './graph-types';
import {sameGoalValue} from './scope-goal';
import {dependencyAdditionSchema,type DependencyAddition} from './queued-dependency-addition';
import {queuedDependencyAdditionSelection} from './queued-dependency-addition-rules';

function valid(value:unknown,message:string):asserts value{if(!value)fail('GRAPH_INPUT_INVALID',message)}
/** 仅完整合法的单次追加返回一个 edgeId；无追加返回空集合，失败不产生任何放行依据。 */
export function validateQueuedDependencyAddition(previous:DispatchState,next:DispatchState,mutation:DispatchMutation,command:DispatchCommand):ReadonlySet<string>{
  const additions:{task:TaskNode;record:DependencyAddition}[]=[],commands=new Set<string>(),edges=new Set<string>();
  for(const graph of next.graphs)for(const task of graph.tasks){
    const old=previous.graphs.find(value=>value.identity.rootSessionId===graph.identity.rootSessionId)?.tasks.find(value=>value.taskId===task.taskId),history=old?.dependencyAdditions??[],records=task.dependencyAdditions??[];
    valid(records.length>=history.length&&records.length<=history.length+1&&records.length<=32&&history.every((record,index)=>sameGoalValue(record,records[index]))&&(!old?.dependencyAdditions||!!task.dependencyAdditions),'前置追加审计只能逐次追加，不能改删历史');
    if(records.length>history.length){valid(old,'新任务不能伪造已有任务的前置追加');additions.push({task,record:records.at(-1)!})}
    for(const record of records){
      valid(dependencyAdditionSchema.safeParse(record).success&&record.scopeId===task.scopeId&&!commands.has(record.commandId)&&!edges.has(record.dependency.edgeId),'前置追加审计结构或身份无效');commands.add(record.commandId);edges.add(record.dependency.edgeId);
      const scope=next.scopes?.find(value=>value.scopeId===task.scopeId&&value.rootSessionId===task.identity.rootSessionId&&value.workspaceId===task.identity.workspaceId);
      valid(scope?.runTracking?.mainRunIds.includes(record.mainRunId)&&!(next.runs??[]).some(run=>run.binding.runId===record.mainRunId),'前置追加主运行不属于本周期');
    }
  }
  valid(additions.length<=1,'单次事务只能追加一个目标的一条前置');
  if(!additions.length)return new Set<string>();
  const {task,record}=additions[0],selected=queuedDependencyAdditionSelection(previous,task.identity,record.scopeId,record.mainRunId,{expectedGraphCursor:record.graphCursor,expectedGoalRevision:record.goalRevision,source:{taskId:record.dependency.sourceTaskId,expectedRevision:record.dependency.sourceTaskRevision,expectedPlanRevision:record.dependency.sourcePlanRevision},target:{taskId:task.taskId,expectedRevision:record.previousTaskRevision,expectedPlanRevision:record.targetPlanRevision},reason:record.reason});
  const {graph,scope,source,target,tasks,members}=selected,batch=mutation.batch;
  valid(batch&&batch.cause==='dependency.changed'&&batch.commandId===command.commandId&&record.commandId===command.commandId&&sameGoalValue(batch.identity,graph.identity),'追加必须由同一主调度命令提交');
  valid(record.goalPlanRevision===scope.goal!.plan!.revision&&record.knowledgeRevision===scope.goal!.plan!.knowledgeRevision,'追加的目标计划或知识基线不一致');
  valid(!graph.edges.some(edge=>edge.edgeId===record.dependency.edgeId),'新增前置必须使用全新边身份');
  valid(sameGoalValue(record.trackedTaskIds,tasks.map(value=>value.taskId)),'必须精确记录两端及其全部未领取后继');
  valid(tasks.every(value=>Date.parse(record.addedAt)>=Date.parse(value.updatedAt))&&Date.parse(record.addedAt)<=Date.parse(batch.committedAt),'追加时间不能早于待办或晚于提交');
  valid(sameGoalValue(task,{...target,revision:target.revision+1,status:'waiting',updatedAt:record.addedAt,waitReason:'等待新增前置任务的有效结果',dependencyAdditions:[...(target.dependencyAdditions??[]),record]}),'追加只能修改目标版本、等待状态与审计');
  valid(!mutation.scopes?.length&&!mutation.sessions?.length&&!mutation.runs?.length&&!mutation.messages?.length&&mutation.members?.length===1&&batch.changes.length===3,'追加不能夹带周期、运行、信封或其它成员变更');
  const member=members.find(value=>value.agentInstanceId===target.assignee.agentInstanceId)!,view=graph.agents.find(value=>value.agentInstanceId===member.agentInstanceId);
  valid(view,'目标成员缺少原图投影');
  valid(sameGoalValue(mutation.members[0],{...member,activity:'waiting',waitingTaskIds:[target.taskId]}),'追加只能把目标成员标为等待本任务');
  valid(batch.changes.some(value=>value.type==='task.upserted'&&sameGoalValue(value.task,task)),'追加缺少原子目标节点');
  valid(batch.changes.some(value=>value.type==='agent.upserted'&&sameGoalValue(value.agent,{...view,revision:view.revision+1,state:'waiting',runningTaskId:undefined,waitingTaskIds:[target.taskId]})),'追加缺少原子目标成员投影');
  valid(batch.changes.some(value=>value.type==='edge.upserted'&&sameGoalValue(value.edge,{edgeId:record.dependency.edgeId,identity:graph.identity,kind:'dependency',fromNodeId:source.nodeId,toNodeId:target.nodeId,revision:1,enabled:true,condition:{kind:'result_ready',planRevision:source.planRevision}})),'新增边必须只固定来源计划，不得提前伪造结果');
  return new Set([record.dependency.edgeId]);
}
