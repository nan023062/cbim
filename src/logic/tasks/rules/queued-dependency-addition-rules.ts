/**
 * 作用定位：从同一派发快照选取可追加前置的两端及其完整未领取后继，供提交与重放共用。
 * 设计原因：任务创建顺序不代表依赖顺序；只允许收紧尚未执行任务的等待条件，并保持原角色、模块和 Workflow 基线。
 * 职责边界：纯规则不读知识或模型日志；服务在同一派发事务内另行准备并复核知识和停止状态。
 */
import {fail} from '../../../core/errors';
import type {DispatchState} from '../../dispatch/rules/dispatch-storage';
import type {GraphIdentity} from './graph-types';
import {addQueuedDependencyInputSchema,type AddQueuedDependencyInput} from './queued-dependency-addition';
import {goalNeedsReplan} from './scope-goal';
import {scopeHasUnresolvedActiveInput} from './scope-active-input';
import {sameWorkflowSelectionsForModules} from './workflow-selection';

function check(value:unknown,code:string,message:string):asserts value{if(!value)fail(code,message)}
const sameSet=(a:string[],b:string[])=>a.length===b.length&&a.every(value=>b.includes(value));

/** 返回闭包按图持久顺序排列；不扩张模型指定的边，不按时间或创建先后推断执行先后。 */
export function queuedDependencyAdditionSelection(state:DispatchState,identity:GraphIdentity,scopeId:string,mainRunId:string,input:AddQueuedDependencyInput){
  check(addQueuedDependencyInputSchema.safeParse(input).success,'DEPENDENCY_INPUT_INVALID','追加前置参数无效');
  check(state.workspaceId===identity.workspaceId,'GRAPH_IDENTITY_MISMATCH','追加前置不属于当前工作区');
  const graph=state.graphs.find(value=>value.identity.workspaceId===identity.workspaceId&&value.identity.rootSessionId===identity.rootSessionId),scope=state.scopes?.find(value=>value.scopeId===scopeId&&value.workspaceId===identity.workspaceId&&value.rootSessionId===identity.rootSessionId);
  check(graph&&scope,'DISPATCH_SCOPE_IDENTITY','追加前置不属于当前主会话周期');
  check(scope.status==='active'&&!scope.budget?.blocked,'DEPENDENCY_NOT_ALLOWED','只能修订活动且未被预算阻止的周期');
  check(!scopeHasUnresolvedActiveInput(scope),'GOAL_ACTIVE_INPUT_UNRESOLVED','运行中补充尚未核实，不能修订前置');
  const goal=scope.goal,plan=goal?.plan;
  check(goal&&plan&&!goal.blocked&&!goal.review&&!goalNeedsReplan(goal),'GOAL_REPLAN_REQUIRED','追加前置需要当前有效且未经审阅的目标计划');
  check(scope.runTracking?.mainRunIds.at(-1)===mainRunId&&!(state.runs??[]).some(run=>run.binding.runId===mainRunId),'DEPENDENCY_MAIN_INVALID','追加前置必须来自本周期最新登记主运行');
  check(goal.revision===input.expectedGoalRevision,'GOAL_REVISION_CONFLICT','目标版本已经变化');
  check(graph.cursor.streamId===input.expectedGraphCursor.streamId&&graph.cursor.seq===input.expectedGraphCursor.seq,'DEPENDENCY_GRAPH_STALE','任务图已变化，请重新读取游标');
  const source=graph.tasks.find(task=>task.taskId===input.source.taskId),target=graph.tasks.find(task=>task.taskId===input.target.taskId);
  check(source?.scopeId===scopeId&&target?.scopeId===scopeId,'DEPENDENCY_NOT_ALLOWED','两端任务必须属于同一当前周期');
  check(source.taskId!==target.taskId,'DEPENDENCY_EDGE_INVALID','任务不能依赖自身');
  check(source.revision===input.source.expectedRevision&&source.planRevision===input.source.expectedPlanRevision&&target.revision===input.target.expectedRevision&&target.planRevision===input.target.expectedPlanRevision,'DEPENDENCY_TASK_STALE','来源或目标任务版本已变化');
  check((target.dependencyAdditions?.length??0)<32,'DEPENDENCY_LIMIT','同一任务的前置追加已达到 32 次上限');
  check(!graph.edges.some(edge=>edge.enabled&&edge.kind==='dependency'&&edge.fromNodeId===source.nodeId&&edge.toNodeId===target.nodeId),'DEPENDENCY_EDGE_DUPLICATE','目标已经具有该启用前置');

  const outgoing=new Map<string,string[]>();
  for(const edge of graph.edges)if(edge.enabled&&edge.kind==='dependency')outgoing.set(edge.fromNodeId,[...(outgoing.get(edge.fromNodeId)??[]),edge.toNodeId]);
  const reachable=(start:string)=>{const queue=[start],seen=new Set(queue);for(let index=0;index<queue.length;index++)for(const id of outgoing.get(queue[index])??[])if(!seen.has(id)){seen.add(id);queue.push(id)}return seen};
  const targetNodes=reachable(target.nodeId);check(!targetNodes.has(source.nodeId),'GRAPH_CYCLE','新来源属于目标后继，追加将形成循环');
  const nodes=new Set([...targetNodes,...reachable(source.nodeId)]),tasks=graph.tasks.filter(task=>nodes.has(task.nodeId));
  check(tasks.length===nodes.size&&tasks.length<=500,'DEPENDENCY_NOT_ALLOWED','依赖闭包包含未知节点或超出范围');
  for(const task of tasks){
    check(task.scopeId===scopeId,'DEPENDENCY_NOT_ALLOWED','依赖后继不属于当前周期：'+task.taskId);
    check(['queued','waiting'].includes(task.status)&&!task.runIds.length&&!task.activeRunId&&!task.result&&!task.help&&!task.checkpoints&&!task.resumeRequest&&!task.cancelledBeforeStart&&!task.awaitedChildren.length&&!(state.runs??[]).some(run=>run.binding.taskId===task.taskId&&run.binding.rootSessionId===identity.rootSessionId),'DEPENDENCY_NOT_ALLOWED','两端或后继已经领取、执行或结束：'+task.taskId);
    check(task.modules.every(module=>module.knowledgeRevision===plan.knowledgeRevision)&&plan.assignments.some(item=>item.agentId===task.assignee.agentId&&sameSet(item.moduleIds,task.modules.map(module=>module.moduleId))&&sameWorkflowSelectionsForModules(item.workflowSelections,task.workflowSelections,task.modules.map(module=>module.moduleId))),'DEPENDENCY_KNOWLEDGE_STALE','待办角色、模块或流程不匹配当前计划：'+task.taskId);
  }
  const assignments=tasks.map(task=>{const values=state.outbox.filter(value=>value.kind==='assignment'&&value.taskId===task.taskId&&value.identity.rootSessionId===identity.rootSessionId);check(values.length===1&&values[0].delivery==='pending'&&!values[0].claim,'DEPENDENCY_NOT_ALLOWED','待办信封已领取或不完整：'+task.taskId);return values[0]});
  const members=tasks.map(task=>{
    const member=state.members.find(value=>value.agentInstanceId===task.assignee.agentInstanceId);
    check(member&&member.workspaceId===identity.workspaceId&&member.agentId===task.assignee.agentId&&member.executionScopeId===scopeId&&member.executionTaskId===task.taskId&&member.lifecycle==='active'&&['idle','waiting'].includes(member.activity)&&!member.activeRunId&&!member.activeTaskId&&!member.communicatingMessageIds.length&&member.waitingTaskIds.every(id=>id===task.taskId),'DEPENDENCY_NOT_ALLOWED','待办实例被占用或不属于原任务：'+task.taskId);
    check(member.configurationRevision===plan.knowledgeRevision,'DEPENDENCY_KNOWLEDGE_STALE','待办成员配置已经过期：'+task.taskId);return member;
  });
  check(new Set(members.map(member=>member.agentInstanceId)).size===members.length,'DEPENDENCY_NOT_ALLOWED','待办必须保持独立的原执行实例');
  return {graph,scope,source,target,tasks,members,assignments};
}
