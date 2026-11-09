/**
 * 多段放弃仅封存最新未消费段，所有已消费检查点与预约保持原样。
 * 作用定位：核实检查点放弃的不可变历史和精确联合事务，返回仅供检查点状态机使用的任务许可。
 * 设计原因：事件名、取消状态或自报审计均不授权处置；原运行/原生通道及 checkpoint 信封不变，后续纯 ACK 和周期释放仍须合法。
 */
import {fail} from '../foundation/errors';
import type {DispatchState,DispatchMutation,DispatchCommand} from './dispatch-storage';
import type {TaskNode} from './graph-types';
import {checkpointAbandonmentSchema,abandonCheckpointReceiptSchema,type CheckpointAbandonment} from './checkpoint-handoff';
import {checkpointAbandonmentSelection} from './checkpoint-handoff-rules';
import {sameGoalValue} from './scope-goal';
import {currentMemberResumeRequest} from './member-checkpoint-chain';

function valid(value:unknown,message:string):asserts value{if(!value)fail('GRAPH_INPUT_INVALID',message)}
/** 新增处置完整通过才返回许可；已核实的历史处置也保留取消许可，但其整个任务必须不变。 */
export function validateCheckpointAbandonment(previous:DispatchState,next:DispatchState,mutation:DispatchMutation,command:DispatchCommand):ReadonlySet<string>{
  const added:{task:TaskNode;record:CheckpointAbandonment}[]=[],commands=new Set<string>(),permitted=new Set<string>();
  for(const graph of next.graphs)for(const task of graph.tasks){
    const old=previous.graphs.find(value=>value.identity.rootSessionId===graph.identity.rootSessionId)?.tasks.find(value=>value.taskId===task.taskId),record=task.checkpointAbandonment;
    if(old?.checkpointAbandonment)valid(sameGoalValue(old,task),'已为交接放弃的任务不可改写或恢复');
    if(!record)continue;
    valid(checkpointAbandonmentSchema.safeParse(record).success&&!commands.has(record.commandId),'交接放弃审计无效或命令重复');commands.add(record.commandId);
    const scope=next.scopes?.find(value=>value.scopeId===task.scopeId&&value.workspaceId===task.identity.workspaceId&&value.rootSessionId===task.identity.rootSessionId),checkpoint=task.checkpoints?.at(-1),run=next.runs?.find(value=>value.binding.runId===record.sourceRunId),member=next.members.find(value=>value.agentInstanceId===task.assignee.agentInstanceId);
    valid(scope&&record.scopeId===scope.scopeId&&scope.runTracking?.mainRunIds.includes(record.mainRunId)&&!next.runs?.some(value=>value.binding.runId===record.mainRunId),'交接处置缺少本周期真实主运行');
    valid(task.status==='cancelled'&&!task.activeRunId&&!task.result&&!task.help&&!task.cancelledBeforeStart&&task.runIds.length===task.checkpoints?.length&&task.runIds.at(-1)===record.sourceRunId&&checkpoint?.checkpointId===record.checkpointId&&checkpoint.binding.runId===record.sourceRunId&&(currentMemberResumeRequest(task)?.requestId??null)===record.resumeRequestId,'交接放弃没有保留原任务与检查点终态');
    valid(record.planRevision===task.planRevision&&record.previousTaskRevision+1===task.revision&&record.abandonedAt===task.updatedAt&&record.reason===task.waitReason&&record.graphCursor.streamId===graph.cursor.streamId&&record.graphCursor.seq<graph.cursor.seq,'交接放弃与任务版本或图基线不一致');
    valid(run?.status==='completed'&&sameGoalValue(run.checkpointProof?.checkpoint,checkpoint)&&member&&member.leaseEpoch>=record.nextLeaseEpoch,'交接放弃缺少原完成段或已递增租约');
    const resume=record.resumeRequestId?next.outbox.find(value=>value.messageId===record.resumeRequestId):undefined;
    valid(!record.resumeRequestId||resume?.kind==='assignment'&&resume.delivery==='processed'&&!resume.claim,'放弃的恢复预约必须保留且未领取消费');
    permitted.add(JSON.stringify([task.identity.rootSessionId,task.taskId]));
    if(!old?.checkpointAbandonment){valid(old,'不能在新任务中补造检查点交接历史');added.push({task,record})}
  }
  valid(added.length<=1,'一次命令只能放弃一个检查点');if(!added.length)return permitted;
  const {task,record}=added[0],selected=checkpointAbandonmentSelection(previous,task.identity,record.scopeId,record.mainRunId,{expectedGraphCursor:record.graphCursor,expectedGoalRevision:record.goalRevision,taskId:task.taskId,expectedRevision:record.previousTaskRevision,expectedPlanRevision:record.planRevision,checkpointId:record.checkpointId,expectedResumeRequestId:record.resumeRequestId,reason:record.reason}),batch=mutation.batch;
  valid(batch&&batch.cause==='task.cancelled'&&batch.commandId===command.commandId&&record.commandId===command.commandId&&sameGoalValue(batch.identity,task.identity)&&batch.committedAt===record.abandonedAt,'放弃必须由同一主命令和提交时间产生');
  valid(Object.keys(mutation).every(key=>['batch','members','messages','receipt'].includes(key))&&mutation.members?.length===1&&batch.changes.length===2,'检查点放弃不能夹带其它任务、周期、来源或运行写入');
  valid(record.previousLeaseEpoch===selected.member.leaseEpoch&&record.nextLeaseEpoch===selected.member.leaseEpoch+1&&Date.parse(record.abandonedAt)>=Date.parse(selected.task.updatedAt),'放弃必须准确记录本次原租约和处置时间');
  valid(sameGoalValue(task,{...selected.task,status:'cancelled',revision:selected.task.revision+1,updatedAt:record.abandonedAt,waitReason:record.reason,checkpointAbandonment:record}),'放弃只能取消原待办并追加不可变审计');
  valid(sameGoalValue(mutation.members[0],{...selected.member,leaseEpoch:record.nextLeaseEpoch}),'放弃只递增原空闲成员租约，不改身份或配置');
  const view=selected.graph.agents.find(value=>value.agentInstanceId===selected.member.agentInstanceId);
  valid(view&&view.state==='idle'&&!view.runningTaskId&&!view.waitingTaskIds.length,'原检查点缺少空闲图投影');
  valid(batch.changes.some(value=>value.type==='task.upserted'&&sameGoalValue(value.task,task))&&batch.changes.some(value=>value.type==='agent.upserted'&&sameGoalValue(value.agent,{...view,revision:view.revision+1})),'处置缺少精确原任务及成员图投影');
  if(selected.resumeAssignment)valid(mutation.messages?.length===1&&sameGoalValue(mutation.messages[0],{...selected.resumeAssignment,delivery:'processed'}),'仅消费原 pending 恢复预约，不领取或改写其它信封');
  else valid(mutation.messages===undefined,'未预约检查点不能夹带任何信封变更');
  const expectedReceipt={workspaceId:task.identity.workspaceId,rootSessionId:task.identity.rootSessionId,scopeId:record.scopeId,mainRunId:record.mainRunId,commandId:record.commandId,taskId:task.taskId,status:'cancelled',abandonment:record,graphCursor:{streamId:batch.streamId,seq:batch.seq}};
  valid(abandonCheckpointReceiptSchema.safeParse(mutation.receipt).success&&sameGoalValue(mutation.receipt,expectedReceipt),'检查点放弃回执与真实提交不一致');
  return permitted;
}
