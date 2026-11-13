/**
 * 前置修订保留新增边审阅要求，同时兼容历史未带要求的原子记录。
 * 作用定位：验证多边前置修订的原审计、精确节点/成员/边变更，返回本批新增与退役许可。
 * 设计原因：通用Store不能只信服务或事件名称；从旧快照重新计算完整闭包，历史审计不可修改或借用。
 * 职责边界：纯状态校验不执行 IO；许可仅在同一提交校验内传递，不来自模型或持久回执。
 */
import {fail} from '../../../core/errors';
import type {DispatchState,DispatchMutation,DispatchCommand} from '../../dispatch/rules/dispatch-storage';
import type {TaskNode,GraphChange} from './graph-types';
import {sameGoalValue as equal} from './scope-goal';
import {dependencyRevisionSchema,reviseQueuedDependenciesReceiptSchema,type DependencyRevision} from './queued-dependency-revision';
import {queuedDependencyRevisionSelection} from './queued-dependency-revision-rules';
function valid(v:unknown,message:string):asserts v{if(!v)fail('GRAPH_INPUT_INVALID',message)}
/** 每批一个目标的一次原子修订；无新审计返回空许可，已有审计仍逐项检查不可变。 */
export function validateQueuedDependencyRevision(previous:DispatchState,next:DispatchState,mutation:DispatchMutation,command:DispatchCommand){
 const additions:{task:TaskNode;record:DependencyRevision}[]=[],commands=new Set<string>(),edgeIds=new Set<string>();
 for(const graph of next.graphs)for(const task of graph.tasks){
  const old=previous.graphs.find(g=>g.identity.rootSessionId===graph.identity.rootSessionId)?.tasks.find(t=>t.taskId===task.taskId),history=old?.dependencyRevisions??[],records=task.dependencyRevisions??[];
  valid(records.length>=history.length&&records.length<=history.length+1&&records.length<=32&&history.every((r,i)=>equal(r,records[i]))&&(!old?.dependencyRevisions||!!task.dependencyRevisions),'前置修订审计只能追加，不能改删');
  if(records.length>history.length){valid(old,'新任务不能携带修订历史');additions.push({task,record:records.at(-1)!})}
  for(const r of records){valid(dependencyRevisionSchema.safeParse(r).success&&r.scopeId===task.scopeId&&r.request.target.taskId===task.taskId&&!commands.has(r.commandId),'修订审计身份无效或复用命令');commands.add(r.commandId);const scope=next.scopes?.find(s=>s.scopeId===task.scopeId&&s.rootSessionId===task.identity.rootSessionId&&s.workspaceId===task.identity.workspaceId);valid(scope?.runTracking?.mainRunIds.includes(r.mainRunId)&&!next.runs?.some(x=>x.binding.runId===r.mainRunId),'修订缺少原主运行');for(const e of r.added){valid(!edgeIds.has(e.edgeId),'修订新增边不能复用');edgeIds.add(e.edgeId)}}
 }
 valid(additions.length<=1,'单次前置修订只能改变一个目标');
 const permits={added:new Set<string>(),retired:new Set<string>()};if(!additions.length)return permits;
 const {task,record:r}=additions[0],{graph,scope,target,removed,added,tasks,members,status}=queuedDependencyRevisionSelection(previous,task.identity,r.scopeId,r.mainRunId,r.request),batch=mutation.batch;
 valid(batch&&batch.commandId===command.commandId&&r.commandId===command.commandId&&batch.cause==='dependency.changed'&&equal(batch.identity,graph.identity),'修订须来自同一原子命令');
 valid(r.goalPlanRevision===scope.goal!.plan!.revision&&r.knowledgeRevision===scope.goal!.plan!.knowledgeRevision&&equal(r.trackedTaskIds,tasks.map(t=>t.taskId)),'修订计划、知识或完整闭包不一致');
 valid(tasks.every(t=>Date.parse(r.revisedAt)>=Date.parse(t.updatedAt))&&Date.parse(r.revisedAt)<=Date.parse(batch.committedAt),'修订时间不符合原任务与提交');
 valid(equal(r.removed,removed.map(e=>{const source=graph.tasks.find(t=>t.nodeId===e.fromNodeId)!;return {edgeId:e.edgeId,edgeRevision:e.revision,sourceTaskId:source.taskId,sourceTaskRevision:source.revision,sourcePlanRevision:source.planRevision}})),'退役审计与原边不一致');
 valid(r.added.length===added.length&&r.added.every((e,i)=>equal(e,{edgeId:e.edgeId,sourceTaskId:added[i].taskId,sourceTaskRevision:added[i].revision,sourcePlanRevision:added[i].planRevision})&&!graph.edges.some(old=>old.edgeId===e.edgeId)),'新边来源或身份错误');
 const waitReason=status==='waiting'?'等待修订后的前置任务有效结果':undefined,updated={...target,revision:target.revision+1,status,waitReason,updatedAt:r.revisedAt,dependencyRevisions:[...(target.dependencyRevisions??[]),r]};
 valid(equal(task,updated),'修订只能更新目标等待、版本与审计');
 const member=members.find(m=>m.agentInstanceId===target.assignee.agentInstanceId)!,view=graph.agents.find(v=>v.agentInstanceId===member.agentInstanceId);valid(view,'修订缺少原成员投影');
 const activity=status==='waiting'?'waiting' as const:'idle' as const,waitingTaskIds=status==='waiting'?[target.taskId]:[];
 valid(!mutation.scopes?.length&&!mutation.sessions?.length&&!mutation.runs?.length&&!mutation.messages?.length&&!mutation.workspaceMemberChanges?.length&&!mutation.ownershipChanges?.length&&!mutation.knowledgeSourceChanges?.length&&!mutation.effectDispositions?.length&&!mutation.controlledFileChanges?.length&&equal(mutation.members,[{...member,activity,waitingTaskIds}]),'修订不能夹带其它领域或成员状态');
 // 历史日志可能没有审阅标志；新边保留提交中的要求，后续不可清除。
 const reviewRequired=(edgeId:string)=>batch.changes.some(c=>c.type==='edge.upserted'&&c.edge.edgeId===edgeId&&c.edge.kind==='dependency'&&c.edge.condition.reviewRequired);
 const expected:GraphChange[]=[...removed.map(e=>({type:'edge.upserted' as const,edge:{...e,revision:e.revision+1,enabled:false}})),...r.added.map(e=>({type:'edge.upserted' as const,edge:{edgeId:e.edgeId,identity:graph.identity,kind:'dependency' as const,fromNodeId:'task:'+e.sourceTaskId,toNodeId:target.nodeId,revision:1,enabled:true,condition:{kind:'result_ready' as const,planRevision:e.sourcePlanRevision,...(reviewRequired(e.edgeId)?{reviewRequired:true as const}:{})}}})),{type:'task.upserted',task:updated},{type:'agent.upserted',agent:{...view,revision:view.revision+1,state:activity,runningTaskId:undefined,waitingTaskIds}}];
 valid(batch.changes.length===expected.length&&expected.every(e=>batch.changes.some(c=>equal(c,e))),'修订须精确包含所有增删边、目标和成员投影');
 const receipt={workspaceId:task.identity.workspaceId,rootSessionId:task.identity.rootSessionId,scopeId:r.scopeId,mainRunId:r.mainRunId,commandId:command.commandId,taskId:task.taskId,status,trackedTaskIds:r.trackedTaskIds,revision:r,graphCursor:{streamId:batch.streamId,seq:batch.seq}};
 valid(reviseQueuedDependenciesReceiptSchema.safeParse(mutation.receipt).success&&equal(mutation.receipt,receipt),'修订回执不匹配实际变更');
 for(const e of r.added)permits.added.add(e.edgeId);for(const e of removed)permits.retired.add(e.edgeId);return permits;
}
