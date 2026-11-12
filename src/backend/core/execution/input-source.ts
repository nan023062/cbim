/**
 * 目录归属：backend/core/execution；运行协议与计量。
 * 作用定位：定义可信入口提交的成员结果、目标返工反馈、真实用户补充与人工决定系统转交来源。
 * 设计原因：接续须持久化身份防止重复启动；真实附件补充只引用可信清单指纹，人工决定按固定记录转交，不伪造自由正文或扩大批准范围。
 */
import {safeId} from '../foundation/identity';

/** 可信调度接续元数据；正文单独传入，模型和公开聊天参数不能构造此来源。 */
export interface MemberResultSource {
  kind:'member-results';
  /** 同一主会话的一批回传使用稳定标识；启动后重试应核实原运行，不重复注入。 */
  continuationId:string;
  /** 已提交的结果信封集合；失败或受阻任务没有候选信封时可以为空。 */
  messageIds:string[];
  /** 本次回注涉及的派发任务集合，与 messageIds 不要求逐项对应。 */
  taskIds:string[];
}
/** 只有显式等待目标入口生成；普通聊天、队列和模型正文不能构造这一恢复权。 */
export interface UserContinuationSource {
  kind:'user-continuation';
  continuationId:string;
  scopeId:string;
  waitId:string;
  /** 原始输入为 1；本条真实补充提交后的输入版本。 */
  inputRevision:number;
  /** 可信启动闭包生成，绑定同次快照清单；旧文本来源缺省，不携带图片字节或权限。 */
  attachmentManifestHash?:string;
}
/** 仅独立显式继续入口生成，正文为系统转交的已保存决定摘要，不是用户新业务目标。 */
export interface HumanDecisionsSource {
  kind:'human_decisions';continuationId:string;scopeId:string;waitId:string;
  inputRevision:number;decisionRevision:number;decisionIds:string[];
}
/** 最终验收拒绝的系统反馈；不是用户授权，原主轮与失败指纹用于去重和有界返工。 */
export interface GoalRepairSource {
  kind:'goal-repair';continuationId:string;scopeId:string;sourceRunId:string;
  attempt:number;failureCode:string;fingerprint:string;
}
export type RunInputSource=MemberResultSource|UserContinuationSource|HumanDecisionsSource|GoalRepairSource;

/** 校验并复制可信输入或历史日志中的来源；拒绝空任务、重复标识和额外身份/权限字段。 */
export function checkedRunInputSource(value:unknown):RunInputSource {
  if(!value||typeof value!=='object'||Array.isArray(value))throw Error('无效成员接续来源');
  const source=value as Record<string,unknown>;
  if(source.kind==='goal-repair'){
    if(Object.keys(source).some(key=>!['kind','continuationId','scopeId','sourceRunId','attempt','failureCode','fingerprint'].includes(key))||!['continuationId','scopeId','sourceRunId','failureCode','fingerprint'].every(key=>typeof source[key]==='string')||!Number.isSafeInteger(source.attempt)||(source.attempt as number)<1||(source.attempt as number)>3||!/^GOAL_[A-Z_]+$/.test(source.failureCode as string)||!/^[a-f0-9]{64}$/.test(source.fingerprint as string))throw Error('无效目标返工来源');
    return {kind:'goal-repair',continuationId:safeId(source.continuationId as string),scopeId:safeId(source.scopeId as string),sourceRunId:safeId(source.sourceRunId as string),attempt:source.attempt as number,failureCode:source.failureCode as string,fingerprint:source.fingerprint as string};
  }
  if(source.kind==='human_decisions'){
    if(Object.keys(source).some(key=>!['kind','continuationId','scopeId','waitId','inputRevision','decisionRevision','decisionIds'].includes(key))||!['continuationId','scopeId','waitId'].every(key=>typeof source[key]==='string')||!Number.isSafeInteger(source.inputRevision)||(source.inputRevision as number)<2||(source.inputRevision as number)>32||!Number.isSafeInteger(source.decisionRevision)||(source.decisionRevision as number)<1||(source.decisionRevision as number)>64||!Array.isArray(source.decisionIds)||!source.decisionIds.length||source.decisionIds.length>50||source.decisionIds.some(id=>typeof id!=='string')||new Set(source.decisionIds).size!==source.decisionIds.length)throw Error('无效人工决定接续来源');
    return {kind:'human_decisions',continuationId:safeId(source.continuationId as string),scopeId:safeId(source.scopeId as string),waitId:safeId(source.waitId as string),inputRevision:source.inputRevision as number,decisionRevision:source.decisionRevision as number,decisionIds:(source.decisionIds as string[]).map(safeId)};
  }
  if(source.kind==='user-continuation'){
    if(Object.keys(source).some(key=>!['kind','continuationId','scopeId','waitId','inputRevision','attachmentManifestHash'].includes(key))||!['continuationId','scopeId','waitId'].every(key=>typeof source[key]==='string')||!Number.isSafeInteger(source.inputRevision)||(source.inputRevision as number)<2||(source.inputRevision as number)>32||source.attachmentManifestHash!==undefined&&(typeof source.attachmentManifestHash!=='string'||!/^[a-f0-9]{64}$/.test(source.attachmentManifestHash)))throw Error('无效目标补充来源');
    return {kind:'user-continuation',continuationId:safeId(source.continuationId as string),scopeId:safeId(source.scopeId as string),waitId:safeId(source.waitId as string),inputRevision:source.inputRevision as number,...(source.attachmentManifestHash===undefined?{}:{attachmentManifestHash:source.attachmentManifestHash as string})};
  }
  if(source.kind!=='member-results'||Object.keys(source).some(key=>!['kind','continuationId','messageIds','taskIds'].includes(key)))throw Error('无效成员接续来源');
  if(typeof source.continuationId!=='string')throw Error('缺少成员接续标识');
  const ids=(value:unknown,required:boolean)=>{
    if(!Array.isArray(value)||value.length>100||(required&&!value.length)||value.some(id=>typeof id!=='string')||new Set(value).size!==value.length)throw Error('无效成员接续消息或任务标识');
    return (value as string[]).map(safeId);
  };
  return {kind:'member-results',continuationId:safeId(source.continuationId),messageIds:ids(source.messageIds,false),taskIds:ids(source.taskIds,true)};
}
