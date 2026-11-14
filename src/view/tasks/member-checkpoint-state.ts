/**
 * 先核完整检查点与预约链，再选择所查看的段；早期消费事实不因末段再次停泊而消失。
 * 作用定位：将同任务的检查点交接和后续运行投影为成员卡片、节点与详情共用的只读状态。
 * 设计原因：工具暂存、主调度预约、真实新 run 与显式放弃各有独立事实；只展示匹配身份的公开记录，不把普通取消推断成交接，也不读取原生文件或签发恢复授权。
 */
import {validMemberCheckpointChain,memberResumeRequests,currentMemberResumeRequest,checkpointAbandonmentSchema,type CheckpointAbandonment,type MemberCheckpointRecord,type MemberResumeRequest,type TaskNode} from '../../bridge/contracts/dispatch';

/** 缺省 record 表示没有该项历史；invalid 明确区分损坏记录与尚未保存，不从正文补造状态。 */
export interface MemberCheckpointView {
  record?:MemberCheckpointRecord;
  invalid:boolean;
  phase?:'parked'|'queued'|'resumed'|'sealed'|'abandoned';
  /** 只公开与原检查点、预约及任务身份吻合的处置；普通 cancelled 不生成该字段。 */
  abandonment?:CheckpointAbandonment;
  resumedRunId?:string;
  /** 对应所选检查点的原预约；历史段不借用最新预约说明。 */
  request?:MemberResumeRequest;
  segment?:number;
  total?:number;
}
export const checkpointPhaseLabels={parked:'已保存检查点',queued:'等待续执行',resumed:'续执行轮次已登记',sealed:'检查点已封存',abandoned:'已为交接放弃'} as const;

/** 核完整链后优先展示所选运行自己保存的检查点，否则展示其来源段；默认最新段，历史段仅供阅读。 */
export function memberCheckpointView(task:TaskNode,runId?:string):MemberCheckpointView {
  if(task.checkpoints===undefined)return {invalid:task.status==='checkpointed'||!!task.resumeRequest||!!task.resumeHistory||task.checkpointAbandonment!==undefined};
  if(!validMemberCheckpointChain(task)||!task.scopeId||task.cancelledBeforeStart)return {invalid:true};
  const records=task.checkpoints,requests=memberResumeRequests(task),latest=records.at(-1)!,latestRequest=currentMemberResumeRequest(task),lastRunId=task.runIds.at(-1),consumed=lastRunId!==latest.binding.runId;
  for(const record of records){const binding=record.binding;
    if(binding.workspaceId!==task.identity.workspaceId||binding.rootSessionId!==task.identity.rootSessionId||binding.taskId!==task.taskId||binding.planRevision!==task.planRevision||binding.agentId!==task.assignee.agentId||binding.agentInstanceId!==task.assignee.agentInstanceId||binding.agentSessionId!==task.assignee.agentSessionId)return {invalid:true};
  }
  if(requests.some(request=>request.scopeId!==task.scopeId||request.previousTaskRevision>=task.revision||!request.trackedTaskIds.includes(task.taskId)))return {invalid:true};
  if(task.activeRunId&&(!consumed||task.activeRunId!==lastRunId)||task.result&&(!consumed||task.result.runId!==lastRunId)||task.help&&(!consumed||task.help.binding.runId!==lastRunId))return {invalid:true};
  let abandonment:CheckpointAbandonment|undefined;
  if(task.checkpointAbandonment!==undefined){
    const audit=checkpointAbandonmentSchema.safeParse(task.checkpointAbandonment);
    if(!audit.success)return {invalid:true};
    abandonment=audit.data;
    if(task.status!=='cancelled'||consumed||task.activeRunId||task.result||task.help||task.awaitedChildren.length||abandonment.scopeId!==task.scopeId||abandonment.sourceRunId!==latest.binding.runId||abandonment.checkpointId!==latest.checkpointId||abandonment.planRevision!==task.planRevision||abandonment.previousTaskRevision+1!==task.revision||abandonment.previousLeaseEpoch!==latest.binding.leaseEpoch||abandonment.abandonedAt!==task.updatedAt||abandonment.reason!==task.waitReason||abandonment.resumeRequestId!==(latestRequest?.requestId??null))return {invalid:true};
  }
  const sealed=['failed','cancelled','interrupted'].includes(task.status)||consumed&&task.status==='blocked';
  if(!sealed&&(consumed?task.status==='checkpointed':latestRequest?!['queued','waiting'].includes(task.status):task.status!=='checkpointed'))return {invalid:true};
  if(runId!==undefined&&!task.runIds.includes(runId))return {invalid:false};
  const index=runId===undefined?records.length-1:Math.min(task.runIds.indexOf(runId),records.length-1),record=records[index],request=requests[index],resumedRunId=task.runIds[index+1],historical=index<records.length-1;
  return {record,request,invalid:false,resumedRunId,segment:index+1,total:records.length,abandonment:historical?undefined:abandonment,phase:historical?'resumed':abandonment?'abandoned':sealed?'sealed':resumedRunId?'resumed':request?'queued':'parked'};
}
