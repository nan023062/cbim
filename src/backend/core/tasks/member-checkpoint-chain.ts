/**
 * 作用定位：读取同任务的有序检查点和预约历史，供图、调度及公开视图选择当前段。
 * 设计原因：旧单次 resumeRequest 保持兼容；再次预约时只将原值移入只追加历史，当前检查点不能误用前一段已消费的预约。
 * 职责边界：纯选择和结构校验，不读文件、不签发恢复许可；完整运行和信封由联合不变量核实。
 */
import {memberCheckpointLimit,memberCheckpointRecordSchema,type MemberCheckpointRecord} from './member-checkpoint';
import {memberResumeRequestSchema,type MemberResumeRequest} from './queued-member-resume';
/** 结构化只读输入不依赖 TaskNode，避免图类型与检查点协议形成类型环。 */
export interface MemberCheckpointChain {
  checkpoints?:readonly MemberCheckpointRecord[];
  resumeRequest?:MemberResumeRequest;
  /** 不含最新 resumeRequest；旧记录缺省，不自动补空数组。 */
  resumeHistory?:readonly MemberResumeRequest[];
  runIds:readonly string[];
}
/** 按真实预约顺序读取；本函数不修复损坏或重复的历史。 */
export function memberResumeRequests(task:MemberCheckpointChain):readonly MemberResumeRequest[]{return [...(task.resumeHistory??[]),...(task.resumeRequest?[task.resumeRequest]:[])]}
/** 当前段没有预约时返回 undefined，即使前一段已消费的预约仍保留在任务上。 */
export function currentMemberResumeRequest(task:MemberCheckpointChain):MemberResumeRequest|undefined{const checkpoint=task.checkpoints?.at(-1);return checkpoint&&task.resumeRequest?.checkpointId===checkpoint.checkpointId?task.resumeRequest:undefined}
/** 仅检查有序形状和来源对应；任务身份、权限、canonical 及跨表原子性仍由各边界重核。 */
export function validMemberCheckpointChain(task:MemberCheckpointChain):boolean{
  const checkpoints=task.checkpoints,requests=memberResumeRequests(task);
  if(!checkpoints)return !task.resumeRequest&&!task.resumeHistory;
  if(!checkpoints.length||checkpoints.length>memberCheckpointLimit||task.resumeHistory&&(!task.resumeHistory.length||!task.resumeRequest)||new Set(task.runIds).size!==task.runIds.length)return false;
  if(task.runIds.length<checkpoints.length||task.runIds.length>checkpoints.length+1||requests.length<checkpoints.length-1||requests.length>checkpoints.length||task.runIds.length>requests.length+1)return false;
  const ids=new Set<string>(),requestIds=new Set<string>(),commands=new Set<string>();
  for(let i=0;i<checkpoints.length;i++){
    const cp=checkpoints[i],request=requests[i];
    if(!memberCheckpointRecordSchema.safeParse(cp).success||cp.binding.runId!==task.runIds[i]||ids.has(cp.checkpointId))return false;ids.add(cp.checkpointId);
    if(i>0&&(cp.binding.leaseEpoch!==checkpoints[i-1].binding.leaseEpoch+1||Date.parse(cp.requestedAt)<Date.parse(checkpoints[i-1].requestedAt)))return false;
    if(i>0&&(!requests[i-1]||Date.parse(cp.requestedAt)<Date.parse(requests[i-1].requestedAt)||request&&(request.previousTaskRevision<=requests[i-1].previousTaskRevision||request.graphCursor.streamId!==requests[i-1].graphCursor.streamId||request.graphCursor.seq<=requests[i-1].graphCursor.seq)))return false;
    if(request){if(!memberResumeRequestSchema.safeParse(request).success||request.checkpointId!==cp.checkpointId||request.runId!==cp.binding.runId||requestIds.has(request.requestId)||commands.has(request.commandId)||Date.parse(request.requestedAt)<Date.parse(cp.requestedAt))return false;requestIds.add(request.requestId);commands.add(request.commandId)}
  }
  return true;
}
