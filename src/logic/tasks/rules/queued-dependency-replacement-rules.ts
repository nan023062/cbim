/**
 * 作用定位：纯选取单条前置替换的目标、可靠候选及完整未启动后继集合，供提交服务和重放校验共用。
 * 设计原因：可靠失败/求助及明确放弃检查点可换入真实候选；不能扩大到普通取消、已领取任务、过期角色或其他周期，旧来源与后继身份保持。
 * 职责边界：只检查持久结构和基线，不读取 canonical 证据或知识正文；调度服务仍须在提交前复核这些事实。
 */
import {fail} from '../../../core/errors';
import type {DispatchState} from '../../dispatch/rules/dispatch-storage';
import type {GraphIdentity,TaskNode} from './graph-types';
import type {ReplaceQueuedDependencyInput} from './queued-dependency-replacement';
import {goalNeedsReplan} from './scope-goal';
import {sameWorkflowSelectionsForModules} from './workflow-selection';
import {abandonedCheckpointSource} from './checkpoint-handoff-rules';

function check(value:unknown,code:string,message:string):asserts value{if(!value)fail(code,message)}
const sameSet=(a:string[],b:string[])=>a.length===b.length&&a.every(value=>b.includes(value));
const pending=(task:TaskNode)=>['planned','queued','waiting'].includes(task.status);

/** 服务使用同一 state 提交，不读取存储或扩大模型明确选择的边；后继只用于安全校验及后续批次跟踪。 */
export function queuedDependencyReplacementSelection(state:DispatchState,identity:GraphIdentity,scopeId:string,input:ReplaceQueuedDependencyInput){
  check(state.workspaceId===identity.workspaceId,'GRAPH_IDENTITY_MISMATCH','替换目标不属于当前工作区');
  const graph=state.graphs.find(value=>value.identity.workspaceId===identity.workspaceId&&value.identity.rootSessionId===identity.rootSessionId),scope=state.scopes?.find(value=>value.scopeId===scopeId&&value.workspaceId===identity.workspaceId&&value.rootSessionId===identity.rootSessionId);
  check(graph&&scope,'DISPATCH_SCOPE_IDENTITY','替换周期不属于当前主会话');
  check(scope.status==='active'&&!scope.budget?.blocked,'DEPENDENCY_NOT_ALLOWED','只能修订当前活动且未被预算阻止的周期');
  const goal=scope.goal,plan=goal?.plan;
  check(goal&&plan&&!goal.blocked&&!goal.review&&!goalNeedsReplan(goal),'GOAL_REPLAN_REQUIRED','修订前置前必须具有当前有效目标计划，不能绕过已有审阅或用户补充');
  check(goal.revision===input.expectedGoalRevision,'GOAL_REVISION_CONFLICT','目标版本已变化，请重新核实');
  check(graph.cursor.streamId===input.expectedGraphCursor.streamId&&graph.cursor.seq===input.expectedGraphCursor.seq,'DEPENDENCY_GRAPH_STALE','任务图已变化，请读取最新游标');
  const target=graph.tasks.find(task=>task.taskId===input.target.taskId),edge=graph.edges.find(value=>value.edgeId===input.replace.edgeId);
  check(target?.scopeId===scopeId,'DEPENDENCY_NOT_ALLOWED','目标任务不属于本周期');
  check(target.revision===input.target.expectedRevision&&target.planRevision===input.target.expectedPlanRevision,'DEPENDENCY_TASK_STALE','目标任务版本已变化');
  check((target.dependencyReplacements?.length??0)<32,'DEPENDENCY_LIMIT','同一任务的前置替换已达到 32 次上限');
  check(edge?.kind==='dependency'&&edge.enabled&&edge.toNodeId===target.nodeId,'DEPENDENCY_EDGE_INVALID','只能明确替换目标当前启用的一条前置依赖');
  check(edge.revision===input.replace.expectedRevision,'DEPENDENCY_EDGE_STALE','原依赖版本已变化');
  const source=graph.tasks.find(task=>task.nodeId===edge.fromNodeId),replacement=graph.tasks.find(task=>task.taskId===input.with.taskId);
  check(source?.scopeId===scopeId&&source.planRevision===edge.condition.planRevision&&!source.activeRunId&&!source.result&&source.runIds.length&&(source.status==='failed'||source.status==='blocked'&&source.help||source.status==='cancelled'&&source.checkpointAbandonment),'DEPENDENCY_SOURCE_INVALID','原来源必须是可靠失败、求助或明确放弃的检查点，不能替换未决或仍执行的来源');
  if(source.status==='cancelled')abandonedCheckpointSource(state,identity,scopeId,source);
  const sourceRuns=(state.runs??[]).filter(run=>run.binding.taskId===source.taskId&&run.binding.rootSessionId===identity.rootSessionId);
  check(sourceRuns.length===source.runIds.length&&sourceRuns.every(run=>source.runIds.includes(run.binding.runId)&&run.binding.workspaceId===identity.workspaceId&&run.binding.planRevision===source.planRevision&&run.status===(source.help||source.checkpointAbandonment?'completed':'failed')),'DEPENDENCY_SOURCE_INVALID','原来源缺少匹配的已结算运行');
  check(replacement?.scopeId===scopeId&&replacement.taskId!==target.taskId&&graph.tasks.indexOf(replacement)>graph.tasks.indexOf(source),'DEPENDENCY_CANDIDATE_INVALID','新前置必须是同周期后续创建的其它任务');
  check(replacement.revision===input.with.expectedRevision&&replacement.planRevision===input.with.expectedPlanRevision,'DEPENDENCY_TASK_STALE','新前置任务版本已变化');
  const result=replacement.result,run=(state.runs??[]).find(value=>value.binding.taskId===replacement.taskId&&value.binding.runId===input.with.runId);
  check(replacement.status==='result_ready'&&!replacement.activeRunId&&!replacement.help&&result&&result.planRevision===replacement.planRevision&&result.runId===input.with.runId&&result.resultId===input.with.resultId&&replacement.runIds.includes(result.runId),'DEPENDENCY_CANDIDATE_INVALID','新前置没有对应当前计划的真实交付候选');
  check(run?.status==='completed'&&run.binding.workspaceId===identity.workspaceId&&run.binding.rootSessionId===identity.rootSessionId&&run.binding.planRevision===replacement.planRevision&&run.binding.agentId===replacement.assignee.agentId&&run.binding.agentInstanceId===replacement.assignee.agentInstanceId&&run.binding.agentSessionId===replacement.assignee.agentSessionId,'DEPENDENCY_CANDIDATE_INVALID','新前置候选与完成运行绑定不一致');
  check(run.prepared.knowledgeRevision===plan.knowledgeRevision&&replacement.modules.every(module=>module.knowledgeRevision===plan.knowledgeRevision),'DEPENDENCY_KNOWLEDGE_STALE','新前置属于旧知识基线，不能刷新后继续使用');
  check(source.modules.every(module=>replacement.modules.some(value=>value.moduleId===module.moduleId)),'DEPENDENCY_MODULE_SCOPE','新前置候选没有覆盖原来源的模块集合');
  check(!graph.edges.some(value=>value.enabled&&value.kind==='dependency'&&value.fromNodeId===replacement.nodeId&&value.toNodeId===target.nodeId),'DEPENDENCY_EDGE_DUPLICATE','目标已经依赖该候选，不能通过重复边删除另一项门禁');

  const byNode=new Map(graph.tasks.map(task=>[task.nodeId,task])),outgoing=new Map<string,string[]>();
  for(const value of graph.edges)if(value.enabled&&value.kind==='dependency')outgoing.set(value.fromNodeId,[...(outgoing.get(value.fromNodeId)??[]),value.toNodeId]);
  const queue=[target.nodeId],seen=new Set(queue),tasks:TaskNode[]=[];
  for(let index=0;index<queue.length;index++){
    const task=byNode.get(queue[index]);
    check(task?.scopeId===scopeId,'DEPENDENCY_NOT_ALLOWED','待办依赖后继不属于当前周期');
    check(task.taskId!==replacement.taskId,'GRAPH_CYCLE','新前置属于目标后继，将形成依赖循环');
    check(pending(task)&&!task.runIds.length&&!task.activeRunId&&!task.result&&!task.help&&!task.cancelledBeforeStart&&!task.awaitedChildren.length&&!(state.runs??[]).some(value=>value.binding.taskId===task.taskId),'DEPENDENCY_NOT_ALLOWED','目标或依赖后继已领取、执行或结束，不能替换前置：'+task.taskId);
    check(task.modules.every(module=>module.knowledgeRevision===plan.knowledgeRevision)&&plan.assignments.some(value=>value.agentId===task.assignee.agentId&&sameSet(value.moduleIds,task.modules.map(module=>module.moduleId))&&sameWorkflowSelectionsForModules(value.workflowSelections,task.workflowSelections,task.modules.map(module=>module.moduleId))),'DEPENDENCY_KNOWLEDGE_STALE','待办角色、模块流程或知识不再匹配当前目标计划：'+task.taskId);
    tasks.push(task);
    for(const nodeId of outgoing.get(task.nodeId)??[])if(!seen.has(nodeId)){seen.add(nodeId);queue.push(nodeId)}
  }
  const assignments=tasks.map(task=>{const items=state.outbox.filter(value=>value.kind==='assignment'&&value.taskId===task.taskId);check(items.length===1&&items[0].delivery==='pending'&&!items[0].claim,'DEPENDENCY_NOT_ALLOWED','待办信封已领取或身份不完整：'+task.taskId);return items[0]});
  const members=tasks.map(task=>{const member=state.members.find(value=>value.agentInstanceId===task.assignee.agentInstanceId);check(member&&member.executionScopeId===scopeId&&member.executionTaskId===task.taskId&&member.lifecycle==='active'&&['idle','waiting'].includes(member.activity)&&!member.activeRunId&&!member.activeTaskId&&!member.communicatingMessageIds.length&&member.waitingTaskIds.every(id=>id===task.taskId),'DEPENDENCY_NOT_ALLOWED','待办实例被占用、已释放或身份不一致：'+task.taskId);check(member.configurationRevision===plan.knowledgeRevision,'DEPENDENCY_KNOWLEDGE_STALE','待办成员配置已经过期：'+task.taskId);return member});
  check(new Set(members.map(member=>member.agentInstanceId)).size===members.length,'DEPENDENCY_NOT_ALLOWED','待办不是独立任务实例');
  const ready=graph.edges.filter(value=>value.enabled&&value.kind==='dependency'&&value.toNodeId===target.nodeId&&value.edgeId!==edge.edgeId).every(value=>{
    if(value.kind!=='dependency')return false;const task=byNode.get(value.fromNodeId);return task?.status==='result_ready'&&task.planRevision===value.condition.planRevision&&task.result?.planRevision===value.condition.planRevision&&(!value.condition.resultId||value.condition.resultId===task.result.resultId);
  });
  return {graph,scope,target,source,replacement,edge,tasks,assignments,members,status:ready?'queued' as const:'waiting' as const};
}
