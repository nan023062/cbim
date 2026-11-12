/**
 * 自动任务的续段也须与当前计划保持同一兜底模型、原因和知识，不以缺少 ownerBinding 作为通配。
 * 作用定位：在已提交状态中选择唯一可预约的成员检查点与尚未启动的依赖后继。
 * 设计原因：预约不消费运行；当前计划须仍保留原岗位和流程选择，文件/知识/原生字节及当前岗位资格仍须在预约和真正领取时重新核实。
 */
import {sameAutomaticExecutionForModules} from '../team/automatic-execution';
import {fail} from '../foundation/errors';
import {completedCheckpointLedger} from './member-checkpoint-ledger';
import type {DispatchState} from '../dispatch/dispatch-storage';
import type {GraphIdentity} from './graph-types';
import type {ResumeMemberInput} from './queued-member-resume';
import {goalNeedsReplan} from './scope-goal';
import {sameWorkflowSelectionsForModules} from './workflow-selection';
import {sameOwnerExecutionForModules} from '../team/member-execution-binding';
import {validMemberCheckpointChain,currentMemberResumeRequest} from './member-checkpoint-chain';
function check(value:unknown,code:string,message:string):asserts value{if(!value)fail(code,message)}
/** 不修改状态、不访问文件；返回的闭包只供调度跟踪，不能作为运行许可。 */
export function memberResumeSelection(state:DispatchState,identity:GraphIdentity,scopeId:string,mainRunId:string,input:ResumeMemberInput){
  check(state.workspaceId===identity.workspaceId,'GRAPH_IDENTITY_MISMATCH','检查点不属于当前工作区');
  const graph=state.graphs.find(graph=>graph.identity.workspaceId===identity.workspaceId&&graph.identity.rootSessionId===identity.rootSessionId),scope=state.scopes?.find(scope=>scope.workspaceId===identity.workspaceId&&scope.rootSessionId===identity.rootSessionId&&scope.scopeId===scopeId);
  check(graph&&scope,'DISPATCH_SCOPE_IDENTITY','检查点不属于当前主会话周期');
  check(scope.status==='active'&&!scope.goal?.blocked&&!scope.budget?.blocked,'MEMBER_RESUME_CLOSED','只能在未阻塞的原活动周期预约续执行');
  check(scope.runTracking?.mainRunIds.includes(mainRunId),'MEMBER_RESUME_MAIN_INVALID','预约必须来自当前周期已登记的主运行');
  check(graph.cursor.streamId===input.expectedGraphCursor.streamId&&graph.cursor.seq===input.expectedGraphCursor.seq,'MEMBER_RESUME_STALE','任务图已变化，请重新核实检查点');
  check(scope.goal?.plan&&scope.goal.revision===input.expectedGoalRevision&&!goalNeedsReplan(scope.goal)&&!scope.goal.review,'MEMBER_RESUME_STALE','目标计划已变化、尚未建立或已进入审阅');
  const task=graph.tasks.find(task=>task.taskId===input.taskId),checkpoint=task?.checkpoints?.at(-1);
  check(task?.scopeId===scopeId&&checkpoint&&validMemberCheckpointChain(task)&&task.status==='checkpointed'&&!currentMemberResumeRequest(task)&&task.runIds.at(-1)===checkpoint.binding.runId&&!task.activeRunId&&!task.result&&!task.help,'MEMBER_RESUME_NOT_ALLOWED','任务没有尚未预约的最新安全检查点');
  check(task.revision===input.expectedRevision&&checkpoint.checkpointId===input.checkpointId,'MEMBER_RESUME_STALE','任务或检查点身份已变化');
  const member=state.members.find(member=>member.agentInstanceId===task.assignee.agentInstanceId),session=state.sessions.find(session=>session.agentSessionId===task.assignee.agentSessionId);
  const {run}=completedCheckpointLedger(state,task,'MEMBER_RESUME_NOT_ALLOWED');
  check(member&&session&&member.lifecycle==='active'&&member.executionScopeId===scopeId&&member.executionTaskId===task.taskId&&member.workspaceId===identity.workspaceId&&member.agentId===run.binding.agentId&&member.teamId===run.binding.teamId&&member.leaseEpoch===run.binding.leaseEpoch&&member.activity==='idle'&&!member.activeRunId&&!member.activeTaskId&&!member.waitingTaskIds.length&&!member.communicatingMessageIds.length,'MEMBER_RESUME_NOT_ALLOWED','原成员实例已占用、释放或待通信');
  check(run?.status==='completed'&&run.checkpointProof?.checkpoint.checkpointId===checkpoint.checkpointId&&session.workspaceId===identity.workspaceId&&session.rootSessionId===identity.rootSessionId&&session.agentInstanceId===member.agentInstanceId&&session.agentId===member.agentId&&member.agentSessionIds.includes(session.agentSessionId)&&session.lastRunId===run.binding.runId&&session.lastTaskId===task.taskId&&session.nativeSessionId===run.session.nativeSessionId&&!!run.session.sessionFile,'MEMBER_RESUME_NOT_ALLOWED','原成员运行或原生通道没有可靠检查点证明');
  check(scope.goal.plan.knowledgeRevision===run.prepared.knowledgeRevision&&scope.goal.plan.assignments.some(assignment=>assignment.agentId===task.assignee.agentId&&task.modules.every(module=>assignment.moduleIds.includes(module.moduleId))&&sameWorkflowSelectionsForModules(assignment.workflowSelections,task.workflowSelections,task.modules.map(module=>module.moduleId))&&sameAutomaticExecutionForModules(assignment.fallbackBinding,task.fallbackBinding,task.modules.map(module=>module.moduleId))&&sameOwnerExecutionForModules(assignment.ownerBinding,task.ownerBinding,task.modules.map(module=>module.moduleId))),'MEMBER_RESUME_STALE','当前计划不再保留原岗位、成员、模块流程或知识基线');
  check(!state.outbox.some(message=>message.kind==='assignment'&&message.taskId===task.taskId&&message.identity.rootSessionId===identity.rootSessionId&&message.resumeFrom?.checkpointId===checkpoint.checkpointId),'MEMBER_RESUME_NOT_ALLOWED','本段检查点已预约，不能创建第二个续执行信封');
  const trackedTaskIds=[task.taskId],byNode=new Map(graph.tasks.map(task=>[task.nodeId,task])),visited=new Set([task.nodeId]),queue=[task.nodeId];
  for(let index=0;index<queue.length;index++)for(const edge of graph.edges){
    if(!edge.enabled||edge.kind!=='dependency'||edge.fromNodeId!==queue[index]||visited.has(edge.toNodeId))continue;
    visited.add(edge.toNodeId);queue.push(edge.toNodeId);const next=byNode.get(edge.toNodeId);
    check(next?.scopeId===scopeId&&!next.runIds.length&&!next.activeRunId&&!next.result&&!next.help&&!next.checkpoints&&!state.runs?.some(run=>run.binding.taskId===next.taskId),'MEMBER_RESUME_DEPENDENTS','检查点依赖后继已经执行或不属于本周期');
    if(next.status==='cancelled')continue;
    check(['planned','queued','waiting'].includes(next.status),'MEMBER_RESUME_DEPENDENTS','检查点后继不是未启动待办');trackedTaskIds.push(next.taskId);
  }
  check(trackedTaskIds.length<=500,'MEMBER_RESUME_DEPENDENTS','续执行后继超过本次支持上限');
  return {graph,scope,task,member,session,run,checkpoint,trackedTaskIds};
}
