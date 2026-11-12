/**
 * 作用定位：计算同一未领取目标的前置原子修订及完整受影响后继，供真实提交与重放校验。
 * 设计原因：先应用完整增删集合再判环，避免中间态误判；删除不能绕过已执行来源或把旧未知伪装成可领取。
 * 职责边界：纯快照规则不读取知识或启动成员，当前岗位和知识由服务在固定锁序内复核。
 */
import {fail} from '../foundation/errors';
import type {DispatchState} from '../dispatch/dispatch-storage';
import type {GraphIdentity,GraphEdge} from './graph-types';
import {reviseQueuedDependenciesInputSchema,type ReviseQueuedDependenciesInput} from './queued-dependency-revision';
import {goalNeedsReplan} from './scope-goal';
import {scopeHasUnresolvedActiveInput} from './scope-active-input';
import {sameWorkflowSelectionsForModules} from './workflow-selection';
import {usableResult} from './graph-rules';
function check(v:unknown,code:string,message:string):asserts v{if(!v)fail(code,message)}
const sameSet=(a:string[],b:string[])=>a.length===b.length&&a.every(x=>b.includes(x));

/** 返回持久任务顺序的闭包；不以创建时间推断先后，未变化的反向前置不被扩入闭包。 */
export function queuedDependencyRevisionSelection(state:DispatchState,identity:GraphIdentity,scopeId:string,mainRunId:string,input:ReviseQueuedDependenciesInput){
 check(reviseQueuedDependenciesInputSchema.safeParse(input).success,'DEPENDENCY_INPUT_INVALID','前置修订参数无效');
 check(state.workspaceId===identity.workspaceId,'GRAPH_IDENTITY_MISMATCH','前置修订不属于当前工作区');
 const graph=state.graphs.find(g=>g.identity.rootSessionId===identity.rootSessionId&&g.identity.workspaceId===identity.workspaceId),scope=state.scopes?.find(s=>s.scopeId===scopeId&&s.rootSessionId===identity.rootSessionId&&s.workspaceId===identity.workspaceId);
 check(graph&&scope,'DISPATCH_SCOPE_IDENTITY','前置修订不属于当前主周期');
 const goal=scope.goal,plan=goal?.plan;
 check(scope.status==='active'&&!scope.budget?.blocked,'DEPENDENCY_NOT_ALLOWED','只能修订活动且预算未阻止的周期');
 check(!scopeHasUnresolvedActiveInput(scope),'GOAL_ACTIVE_INPUT_UNRESOLVED','原补充尚未核实');
 check(goal&&plan&&!goal.blocked&&!goal.review&&!goalNeedsReplan(goal),'GOAL_REPLAN_REQUIRED','前置修订需要当前未经审阅的有效计划');
 check(scope.runTracking?.mainRunIds.at(-1)===mainRunId&&!state.runs?.some(r=>r.binding.runId===mainRunId),'DEPENDENCY_MAIN_INVALID','修订须来自当前最新主运行');
 check(goal.revision===input.expectedGoalRevision,'GOAL_REVISION_CONFLICT','目标版本已变化');
 check(graph.cursor.streamId===input.expectedGraphCursor.streamId&&graph.cursor.seq===input.expectedGraphCursor.seq,'DEPENDENCY_GRAPH_STALE','任务图已变化');
 const target=graph.tasks.find(t=>t.taskId===input.target.taskId);
 check(target&&target.scopeId===scopeId,'DEPENDENCY_NOT_ALLOWED','目标不属于当前周期');
 check(target.revision===input.target.expectedRevision&&target.planRevision===input.target.expectedPlanRevision,'DEPENDENCY_TASK_STALE','目标任务版本已变化');
 check((target.dependencyRevisions?.length??0)<32,'DEPENDENCY_LIMIT','同目标前置修订已达32次');
 const removed=input.remove.map(ref=>{const e=graph.edges.find(e=>e.edgeId===ref.edgeId);check(e?.kind==='dependency'&&e.enabled&&e.toNodeId===target.nodeId&&e.revision===ref.expectedRevision&&!e.condition.resultId,'DEPENDENCY_EDGE_INVALID','原边不存在、已退役、已消费或版本变化');const source=graph.tasks.find(t=>t.nodeId===e.fromNodeId);check(source?.planRevision===e.condition.planRevision,'DEPENDENCY_TASK_STALE','原边锁定的来源计划已失效');return e});
 const added=input.add.map(ref=>{const t=graph.tasks.find(t=>t.taskId===ref.taskId);check(t&&t.scopeId===scopeId&&t.taskId!==target.taskId,'DEPENDENCY_EDGE_INVALID','新来源无效或自引用');check(t.revision===ref.expectedRevision&&t.planRevision===ref.expectedPlanRevision,'DEPENDENCY_TASK_STALE','新来源版本已变化');check(!graph.edges.some(e=>e.kind==='dependency'&&e.enabled&&e.fromNodeId===t.nodeId&&e.toNodeId===target.nodeId),'DEPENDENCY_EDGE_DUPLICATE','新来源已为原前置，不能退役后原样添加');return t});
 const prior=graph.edges.filter((e):e is Extract<GraphEdge,{kind:'dependency'}>=>e.kind==='dependency'&&e.enabled),removedIds=new Set(removed.map(e=>e.edgeId));
 const after=prior.filter(e=>!removedIds.has(e.edgeId)).map(e=>[e.fromNodeId,e.toNodeId] as const).concat(added.map(t=>[t.nodeId,target.nodeId] as const));
 const outgoing=new Map<string,string[]>();for(const [from,to]of after)outgoing.set(from,[...(outgoing.get(from)??[]),to]);
 const degree=new Map(graph.tasks.map(t=>[t.nodeId,0]));for(const [,to]of after)degree.set(to,(degree.get(to)??0)+1);const queue=[...degree].filter(([,n])=>!n).map(([n])=>n);for(let i=0;i<queue.length;i++)for(const to of outgoing.get(queue[i])??[]){degree.set(to,degree.get(to)!-1);if(!degree.get(to))queue.push(to)}check(queue.length===degree.size,'GRAPH_CYCLE','修订后的完整依赖图存在环');
 const seeds=[target.nodeId,...removed.map(e=>e.fromNodeId),...added.map(t=>t.nodeId)],nodes=new Set(seeds),pending=[...nodes],both=[...prior.map(e=>[e.fromNodeId,e.toNodeId] as const),...after];
 for(let i=0;i<pending.length;i++)for(const [from,to]of both)if(from===pending[i]&&!nodes.has(to)){nodes.add(to);pending.push(to)}
 const tasks=graph.tasks.filter(t=>nodes.has(t.nodeId));check(tasks.length===nodes.size&&tasks.length<=500,'DEPENDENCY_NOT_ALLOWED','前置闭包缺节点或超限');
 for(const t of tasks){
  check(t.scopeId===scopeId&&['queued','waiting'].includes(t.status)&&!t.runIds.length&&!t.activeRunId&&!t.result&&!t.help&&!t.checkpoints&&!t.resumeRequest&&!t.cancelledBeforeStart&&!t.awaitedChildren.length&&!state.runs?.some(r=>r.binding.taskId===t.taskId&&r.binding.rootSessionId===identity.rootSessionId),'DEPENDENCY_NOT_ALLOWED','两端或后继已经领取、执行或结束：'+t.taskId);
  check(t.modules.every(m=>m.knowledgeRevision===plan.knowledgeRevision)&&plan.assignments.some(a=>a.agentId===t.assignee.agentId&&sameSet(a.moduleIds,t.modules.map(m=>m.moduleId))&&sameWorkflowSelectionsForModules(a.workflowSelections,t.workflowSelections,t.modules.map(m=>m.moduleId))),'DEPENDENCY_KNOWLEDGE_STALE','待办与当前计划或知识不一致');
  const messages=state.outbox.filter(m=>m.kind==='assignment'&&m.taskId===t.taskId&&m.identity.rootSessionId===identity.rootSessionId);check(messages.length===1&&messages[0].delivery==='pending'&&!messages[0].claim,'DEPENDENCY_NOT_ALLOWED','待办信封已经领取或缺失');
 }
 const members=tasks.map(t=>{const m=state.members.find(m=>m.agentInstanceId===t.assignee.agentInstanceId);check(m&&m.workspaceId===identity.workspaceId&&m.agentId===t.assignee.agentId&&m.executionScopeId===scopeId&&m.executionTaskId===t.taskId&&m.lifecycle==='active'&&['idle','waiting'].includes(m.activity)&&!m.activeRunId&&!m.activeTaskId&&!m.communicatingMessageIds.length&&m.waitingTaskIds.every(id=>id===t.taskId),'DEPENDENCY_NOT_ALLOWED','原执行实例被占用或身份错误');check(m.configurationRevision===plan.knowledgeRevision,'DEPENDENCY_KNOWLEDGE_STALE','原实例配置已过期');return m});
 check(new Set(members.map(m=>m.agentInstanceId)).size===members.length,'DEPENDENCY_NOT_ALLOWED','待办实例不能复用');
 const status=added.length||prior.some(e=>!removedIds.has(e.edgeId)&&e.toNodeId===target.nodeId&&!usableResult(graph.tasks.find(t=>t.nodeId===e.fromNodeId)!,e.condition.planRevision,e.condition.resultId))?'waiting' as const:'queued' as const;
 return {graph,scope,target,removed,added,tasks,members,status};
}
