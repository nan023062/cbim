/**
 * 作用定位：将同任务的检查点交接和后续运行投影为成员卡片、节点与详情共用的只读状态。
 * 设计原因：工具暂存、主调度预约与真实新 run 是三个不同事实；只展示匹配身份的公开记录，不读原生文件，不把字节一致或静态状态当恢复授权。
 */
import {memberCheckpointRecordSchema,memberResumeRequestSchema,type MemberCheckpointRecord,type TaskNode} from '../../bridge/contracts/dispatch';

/** 缺省 record 表示没有该项历史；invalid 明确区分损坏记录与尚未保存，不从正文补造状态。 */
export interface MemberCheckpointView {
  record?:MemberCheckpointRecord;
  invalid:boolean;
  phase?:'parked'|'queued'|'resumed'|'sealed';
  resumedRunId?:string;
}
export const checkpointPhaseLabels={parked:'已保存检查点',queued:'等待续执行',resumed:'续执行轮次已登记',sealed:'检查点已封存'} as const;

/** 先核对节点身份；选中运行必须属于该检查点的源或唯一后继，历史终态仍保留交接记录。 */
export function memberCheckpointView(task:TaskNode,runId?:string):MemberCheckpointView {
  if(task.checkpoints===undefined)return {invalid:task.status==='checkpointed'||!!task.resumeRequest};
  const parsed=memberCheckpointRecordSchema.array().length(1).safeParse(task.checkpoints);
  if(!parsed.success||!task.scopeId)return {invalid:true};
  const record=parsed.data[0],binding=record.binding,request=task.resumeRequest;
  if(binding.workspaceId!==task.identity.workspaceId||binding.rootSessionId!==task.identity.rootSessionId||binding.taskId!==task.taskId||binding.planRevision!==task.planRevision||binding.agentId!==task.assignee.agentId||binding.agentInstanceId!==task.assignee.agentInstanceId||binding.agentSessionId!==task.assignee.agentSessionId||task.runIds[0]!==binding.runId||task.runIds.length>2||task.cancelledBeforeStart)return {invalid:true};
  if(request&&(!memberResumeRequestSchema.safeParse(request).success||request.scopeId!==task.scopeId||request.previousTaskRevision>=task.revision||!request.trackedTaskIds.includes(task.taskId)||request.checkpointId!==record.checkpointId||request.runId!==binding.runId))return {invalid:true};
  const resumedRunId=task.runIds[1];
  if(resumedRunId&&(!request||resumedRunId===binding.runId)||task.activeRunId&&task.activeRunId!==resumedRunId)return {invalid:true};
  if(task.result&&task.result.runId!==resumedRunId||task.help&&task.help.binding.runId!==resumedRunId)return {invalid:true};
  const sealed=['failed','cancelled','interrupted'].includes(task.status)||!!resumedRunId&&task.status==='blocked';
  if(!sealed&&(!resumedRunId&&task.status!=='checkpointed'&&!(request&&['queued','waiting'].includes(task.status))||resumedRunId&&task.status==='checkpointed'))return {invalid:true};
  if(runId!==undefined&&runId!==binding.runId&&runId!==resumedRunId)return {invalid:false};
  return {record,invalid:false,resumedRunId,phase:sealed?'sealed':resumedRunId?'resumed':request?'queued':'parked'};
}
