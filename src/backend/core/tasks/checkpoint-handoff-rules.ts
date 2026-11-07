/**
 * 作用定位：从同一派发快照选择尚未消费、可以明确终止的原检查点及恢复预约。
 * 设计原因：处置不授予新执行资格，不读取今日知识、模型或产物；完整历史日志由服务核实，这里裁决身份、版本和领取竞争。
 */
import {fail} from '../foundation/errors';
import type {DispatchState} from './dispatch-storage';
import type {GraphIdentity} from './graph-types';
import {abandonCheckpointInputSchema,type AbandonCheckpointInput} from './checkpoint-handoff';
import {memberCheckpointProofSchema} from './member-checkpoint';
import {sameGoalValue} from './scope-goal';
import {scopeHasUnresolvedActiveInput} from './scope-active-input';

function check(value:unknown,code:string,message:string):asserts value{if(!value)fail(code,message)}
/** 无文件 IO、不修改输入；原 checkpoint 交接信封可独立 ACK，不作为服务前后比较的可变 stamp。 */
export function checkpointAbandonmentSelection(state:DispatchState,identity:GraphIdentity,scopeId:string,mainRunId:string,input:AbandonCheckpointInput){
  check(abandonCheckpointInputSchema.safeParse(input).success,'CHECKPOINT_HANDOFF_INPUT','检查点处置请求格式无效');
  check(state.workspaceId===identity.workspaceId,'GRAPH_IDENTITY_MISMATCH','检查点不属于当前工作区');
  const graph=state.graphs.find(value=>value.identity.workspaceId===identity.workspaceId&&value.identity.rootSessionId===identity.rootSessionId),scope=state.scopes?.find(value=>value.workspaceId===identity.workspaceId&&value.rootSessionId===identity.rootSessionId&&value.scopeId===scopeId);
  check(graph&&scope,'DISPATCH_SCOPE_IDENTITY','检查点不属于当前主会话周期');
  check(scope.status==='active','CHECKPOINT_HANDOFF_CLOSED','只能在原活动周期明确放弃检查点');
  check(scope.runTracking?.mainRunIds.at(-1)===mainRunId&&!(state.runs??[]).some(run=>run.binding.runId===mainRunId),'CHECKPOINT_HANDOFF_MAIN_INVALID','处置必须来自本周期当前登记的主运行');
  check(!scopeHasUnresolvedActiveInput(scope),'CHECKPOINT_HANDOFF_UNRESOLVED','运行内补充尚未确认，不能处置旧待办');
  check(scope.goal?.revision===input.expectedGoalRevision&&graph.cursor.streamId===input.expectedGraphCursor.streamId&&graph.cursor.seq===input.expectedGraphCursor.seq,'CHECKPOINT_HANDOFF_STALE','图或目标依据已变化，请重新核实处置请求');
  const task=graph.tasks.find(value=>value.taskId===input.taskId),checkpoint=task?.checkpoints?.[0];
  check(task?.scopeId===scopeId&&checkpoint&&!task.checkpointAbandonment&&!task.cancelledBeforeStart&&!task.activeRunId&&!task.result&&!task.help&&!task.awaitedChildren.length&&task.runIds.length===1&&task.runIds[0]===checkpoint.binding.runId,'CHECKPOINT_HANDOFF_NOT_ALLOWED','原任务没有唯一且尚未消费的可靠检查点');
  check(task.revision===input.expectedRevision&&task.planRevision===input.expectedPlanRevision&&checkpoint.checkpointId===input.checkpointId&&(task.resumeRequest?.requestId??null)===input.expectedResumeRequestId,'CHECKPOINT_HANDOFF_STALE','任务、计划、检查点或恢复预约已变化');
  check(task.resumeRequest?task.status==='queued':task.status==='checkpointed','CHECKPOINT_HANDOFF_NOT_ALLOWED','原检查点不再等待主调度或已进入领取');
  const runs=(state.runs??[]).filter(value=>value.binding.taskId===task.taskId&&value.binding.rootSessionId===identity.rootSessionId),run=runs[0];
  check(runs.length===1&&run.status==='completed'&&!run.resumeFrom&&memberCheckpointProofSchema.safeParse(run.checkpointProof).success&&sameGoalValue(run.checkpointProof!.checkpoint,checkpoint)&&sameGoalValue(run.binding,checkpoint.binding)&&run.binding.workspaceId===identity.workspaceId&&run.binding.taskId===task.taskId&&run.binding.rootSessionId===identity.rootSessionId&&run.binding.planRevision===task.planRevision,'CHECKPOINT_HANDOFF_PROOF_INVALID','原运行缺少对应的完整检查点证明');
  const member=state.members.find(value=>value.agentInstanceId===task.assignee.agentInstanceId),session=state.sessions.find(value=>value.agentSessionId===task.assignee.agentSessionId);
  check(member&&session&&member.lifecycle==='active'&&member.executionScopeId===scopeId&&member.executionTaskId===task.taskId&&member.workspaceId===identity.workspaceId&&member.agentId===run.binding.agentId&&member.teamId===run.binding.teamId&&member.leaseEpoch===run.binding.leaseEpoch&&member.activity==='idle'&&!member.activeTaskId&&!member.activeRunId&&!member.waitingTaskIds.length&&!member.communicatingMessageIds.length,'CHECKPOINT_HANDOFF_NOT_ALLOWED','原成员已领取、占用、释放或租约已变化');
  check(session.workspaceId===identity.workspaceId&&session.rootSessionId===identity.rootSessionId&&session.agentInstanceId===member.agentInstanceId&&session.agentId===run.binding.agentId&&session.agentSessionId===run.binding.agentSessionId&&member.agentSessionIds.includes(session.agentSessionId)&&session.lastRunId===run.binding.runId&&session.lastTaskId===task.taskId&&session.nativeSessionId===run.session.nativeSessionId&&!!run.session.sessionFile,'CHECKPOINT_HANDOFF_PROOF_INVALID','原成员通道与检查点运行不一致');
  const assignments=state.outbox.filter(value=>value.kind==='assignment'&&value.identity.rootSessionId===identity.rootSessionId&&value.taskId===task.taskId),original=assignments.find(value=>value.messageId===run.assignmentMessageId),resumeAssignment=assignments.find(value=>value.kind==='assignment'&&value.resumeFrom);
  check(original?.delivery==='processed'&&original.claim?.runId===run.binding.runId&&original.claim.leaseEpoch===run.binding.leaseEpoch&&assignments.length===(task.resumeRequest?2:1),'CHECKPOINT_HANDOFF_PROOF_INVALID','原运行或恢复信封不完整');
  if(task.resumeRequest)check(resumeAssignment?.kind==='assignment'&&resumeAssignment.messageId===task.resumeRequest.requestId&&resumeAssignment.delivery==='pending'&&!resumeAssignment.claim&&sameGoalValue(resumeAssignment.resumeFrom,{checkpointId:checkpoint.checkpointId,runId:run.binding.runId}),'CHECKPOINT_HANDOFF_NOT_ALLOWED','恢复预约已领取或不再是原待投递信封');
  else check(!resumeAssignment,'CHECKPOINT_HANDOFF_NOT_ALLOWED','未预约检查点不能存在恢复信封');
  const messages=state.outbox.filter(value=>value.kind==='checkpoint'&&value.taskId===task.taskId&&value.identity.rootSessionId===identity.rootSessionId);
  check(messages.length===1&&messages[0].kind==='checkpoint'&&messages[0].checkpointId===checkpoint.checkpointId&&messages[0].runId===run.binding.runId&&messages[0].replyTo===run.assignmentMessageId,'CHECKPOINT_HANDOFF_PROOF_INVALID','原检查点交接信封缺失或错配');
  return {graph,scope,task,member,session,run,checkpoint,resumeAssignment};
}
