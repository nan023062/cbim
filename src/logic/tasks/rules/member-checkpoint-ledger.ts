/**
 * 作用定位：从同一派发快照核实已完成且最新段未消费的检查点链，供等待、预约与交接共用。
 * 设计原因：仅检查最后一段会遗漏旧运行、权限或信封篡改；这里核全链原事实，不读取当前文件或签发执行许可。
 */
import {fail} from '../../../core/errors';
import type {DispatchState} from '../../dispatch/rules/dispatch-storage';
import type {TaskNode} from './graph-types';
import {memberCheckpointProofSchema} from './member-checkpoint';
import {memberResumeRequests,currentMemberResumeRequest,validMemberCheckpointChain} from './member-checkpoint-chain';
import {sameGoalValue} from './scope-goal';
/** 最新预约可以未领取或已被显式处置；具体 delivery 由等待/交接调用方核实，过去各段必须已领取并结束。 */
export function completedCheckpointLedger(state:DispatchState,task:TaskNode,code='MEMBER_CHECKPOINT_INVALID'){
  function check(value:unknown,message:string):asserts value{if(!value)fail(code,message)}
  check(validMemberCheckpointChain(task)&&!!task.checkpoints?.length&&task.runIds.length===task.checkpoints.length,'最新检查点必须尚未被运行消费，完整历史不能缺段');
  const checkpoints=task.checkpoints!,requests=memberResumeRequests(task),currentRequest=currentMemberResumeRequest(task),allRuns=(state.runs??[]).filter(run=>run.binding.taskId===task.taskId&&run.binding.rootSessionId===task.identity.rootSessionId);
  check(allRuns.length===task.runIds.length,'检查点链存在多余或遗漏运行');
  const runs=task.runIds.map(id=>{const run=allRuns.find(r=>r.binding.runId===id);if(!run)fail(code,'检查点链缺少原运行');return run});
  const assignments=state.outbox.filter(m=>m.kind==='assignment'&&m.taskId===task.taskId&&m.identity.rootSessionId===task.identity.rootSessionId),messages=state.outbox.filter(m=>m.kind==='checkpoint'&&m.taskId===task.taskId&&m.identity.rootSessionId===task.identity.rootSessionId);
  check(assignments.length===runs.length+(currentRequest?1:0)&&messages.length===checkpoints.length,'检查点链原派发或交接信封不完整');
  for(let index=0;index<runs.length;index++){
    const run=runs[index],checkpoint=checkpoints[index],first=runs[0],assignment=assignments.find(m=>m.messageId===run.assignmentMessageId),message=messages.find(m=>m.kind==='checkpoint'&&m.checkpointId===checkpoint.checkpointId);
    check(run.status==='completed'&&memberCheckpointProofSchema.safeParse(run.checkpointProof).success&&sameGoalValue(run.checkpointProof!.checkpoint,checkpoint)&&sameGoalValue(run.binding,checkpoint.binding),'每段必须有对应的正常终态和冻结检查点证明');
    check(run.binding.workspaceId===task.identity.workspaceId&&run.binding.planRevision===task.planRevision&&run.binding.agentId===task.assignee.agentId&&run.binding.agentInstanceId===task.assignee.agentInstanceId&&run.binding.agentSessionId===task.assignee.agentSessionId&&checkpoint.knowledgeRevision===run.prepared.knowledgeRevision,'检查点链原任务、实例或知识不一致');
    check(sameGoalValue({...run.binding,runId:first.binding.runId,leaseEpoch:first.binding.leaseEpoch},first.binding)&&run.binding.leaseEpoch===first.binding.leaseEpoch+index&&sameGoalValue(run.prepared,first.prepared)&&sameGoalValue(run.model,first.model)&&run.permission===first.permission&&run.turnTimeoutMs===first.turnTimeoutMs&&sameGoalValue(run.prerequisites??[],first.prerequisites??[])&&sameGoalValue(run.session,first.session),'检查点链不能改换原权限、岗位、模型、知识、前置或原生通道');
    const from=index?{checkpointId:checkpoints[index-1].checkpointId,runId:runs[index-1].binding.runId}:undefined;
    check(sameGoalValue(run.resumeFrom,from)&&(!index||requests[index-1].requestId===run.assignmentMessageId),'检查点链续执行来源或原预约不一致');
    check(assignment?.kind==='assignment'&&assignment.identity.workspaceId===task.identity.workspaceId&&assignment.to.agentInstanceId===task.assignee.agentInstanceId&&assignment.to.agentSessionId===task.assignee.agentSessionId&&assignment.delivery==='processed'&&assignment.claim?.runId===run.binding.runId&&assignment.claim.leaseEpoch===run.binding.leaseEpoch&&sameGoalValue(assignment.resumeFrom,from),'检查点链缺少匹配的原领取信封');
    check(message?.kind==='checkpoint'&&message.identity.workspaceId===task.identity.workspaceId&&message.runId===run.binding.runId&&message.replyTo===run.assignmentMessageId,'检查点链原交接信封错配');
  }
  const run=runs.at(-1)!,checkpoint=checkpoints.at(-1)!,resumeAssignment=currentRequest?assignments.find(m=>m.messageId===currentRequest.requestId):undefined;
  if(currentRequest)check(resumeAssignment?.kind==='assignment'&&sameGoalValue(resumeAssignment.resumeFrom,{checkpointId:checkpoint.checkpointId,runId:run.binding.runId})&&!resumeAssignment.claim,'最新预约必须保留未领取的原信封');
  return {runs,run,checkpoint,currentRequest,resumeAssignment};
}
