/**
 * 目录归属：backend/scheduler-engine/members；主运行与成员执行管理。
 * 问答边界：结算复用当前业务证据谓词，旧记录或合成进度不能借成功的答案/取消回执产生候选；不禁止未引用的提问。
 * 作用定位：成员执行事务的图增量、占用和交付候选投影，并提供独立求助验证入口。
 * 设计原因：纯状态计算与进程生命周期分开；已请求求助的运行不能同时产出交付候选，模型正文不签发完成或验收事实。
 */
import {randomUUID} from 'node:crypto';
import {fail} from '../../core/foundation/errors';
import type {RunSummary} from '../../core/execution/types';
import type {DispatchState} from '../../core/dispatch/dispatch-storage';
import type {GraphSnapshot,GraphEventBatch,GraphChange,TaskNode,AgentGraphView} from '../../core/tasks/graph-types';
import type {AgentInstance} from '../../core/team/agent-types';
import {isProgressEvidence} from '../../core/tasks/member-tool-output';
import {hasMemberHelp} from './member-help-state';
export {memberHelpCandidate,hasMemberHelp} from './member-help-state';

/** 查找始终限定主会话，不允许凭 taskId 跨图定位。 */
export function memberTask(state:DispatchState,rootSessionId:string,taskId:string){
  const graph=state.graphs.find(g=>g.identity.rootSessionId===rootSessionId);
  const task=graph?.tasks.find(t=>t.taskId===taskId);
  if(!graph||!task)fail('TASK_NOT_FOUND','当前主会话没有此派发任务');
  const member=state.members.find(m=>m.agentInstanceId===task.assignee.agentInstanceId);
  const session=state.sessions.find(s=>s.agentSessionId===task.assignee.agentSessionId);
  if(!member||!session)fail('MEMBER_NOT_FOUND','成员实例或通道缺失');
  return {graph,task,member,session};
}
/** 一个提交只推进一个主会话的连续游标；观察者在落盘成功后才能收到。 */
export function memberBatch(graph:GraphSnapshot,commandId:string,cause:GraphEventBatch['cause'],changes:GraphChange[]):GraphEventBatch {
  return {version:1,identity:graph.identity,streamId:graph.cursor.streamId,seq:graph.cursor.seq+1,eventId:randomUUID(),commandId,cause,committedAt:new Date().toISOString(),changes};
}
/** 本图活动视图不能泄漏其他主会话的任务身份，真实全局占用保留在 AgentInstance。 */
export function memberView(graph:GraphSnapshot,member:AgentInstance,task:TaskNode):AgentGraphView {
  const old=graph.agents.find(a=>a.agentInstanceId===member.agentInstanceId)!;
  const tasks=graph.tasks.map(t=>t.taskId===task.taskId?task:t);
  const running=tasks.find(t=>t.taskId===member.activeTaskId&&t.status==='running');
  const waiting=tasks.filter(t=>t.assignee.agentInstanceId===member.agentInstanceId&&t.status==='waiting').map(t=>t.taskId);
  return {...old,revision:old.revision+1,state:running?'working':member.activeTaskId===task.taskId?'communicating':waiting.length?'waiting':'idle',runningTaskId:running?.taskId,waitingTaskIds:waiting};
}
/** 所有依赖必须仍匹配指定计划和候选结果，不能把回合结束当作放行条件。 */
export function dependenciesReady(graph:GraphSnapshot,task:TaskNode){
  return graph.edges.filter(e=>e.enabled&&e.kind==='dependency'&&e.toNodeId===task.nodeId).every(edge=>{
    if(edge.kind!=='dependency')return false;
    const source=graph.tasks.find(t=>t.nodeId===edge.fromNodeId);
    return source?.status==='result_ready'&&source.planRevision===edge.condition.planRevision&&source.result?.planRevision===edge.condition.planRevision&&(!edge.condition.resultId||edge.condition.resultId===source.result.resultId);
  });
}
/** 交付候选仍需人工或治理验收；只认同一 run 的结构化计划及成功工具证据。 */
export function memberCandidate(task:TaskNode,summary:RunSummary):TaskNode['result'] {
  const progress=summary.taskProgress;
  if(hasMemberHelp(summary)||summary.status!=='completed'||summary.unresolvedTools.length||progress?.state!=='awaiting_review'||!progress.delivery||!progress.steps.length)return;
  if(progress.goal!==task.goal||JSON.stringify(progress.acceptance)!==JSON.stringify(task.acceptance.map(a=>a.text)))return;
  const identity={workspaceId:task.identity.workspaceId,taskId:task.taskId,runId:summary.runId};
  const receipts=new Set((summary.toolReceipts??[]).filter(receipt=>isProgressEvidence(receipt,identity)).map(receipt=>receipt.toolCallId));
  if(progress.steps.some(step=>step.state!=='reported_done'||!step.evidence.length||step.evidence.some(id=>!receipts.has(id))))return;
  return {resultId:randomUUID(),runId:summary.runId,planRevision:task.planRevision,summary:progress.delivery.summary,limitations:progress.delivery.limitations,evidenceRefs:[...new Set(progress.steps.flatMap(step=>step.evidence))],acceptance:'not_evaluated'};
}
