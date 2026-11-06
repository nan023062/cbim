/**
 * 作用定位：定义可信入口提交的成员结果与用户目标补充来源，供运行日志和引擎识别。
 * 设计原因：两种接续都需持久化身份以防重复启动；成员结果是任务资料，显式用户补充仍是真实用户消息，两者均不能伪造人工验收。
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
}
export type RunInputSource=MemberResultSource|UserContinuationSource;

/** 校验并复制可信输入或历史日志中的来源；拒绝空任务、重复标识和额外身份/权限字段。 */
export function checkedRunInputSource(value:unknown):RunInputSource {
  if(!value||typeof value!=='object'||Array.isArray(value))throw Error('无效成员接续来源');
  const source=value as Record<string,unknown>;
  if(source.kind==='user-continuation'){
    if(Object.keys(source).some(key=>!['kind','continuationId','scopeId','waitId','inputRevision'].includes(key))||!['continuationId','scopeId','waitId'].every(key=>typeof source[key]==='string')||!Number.isSafeInteger(source.inputRevision)||(source.inputRevision as number)<2||(source.inputRevision as number)>32)throw Error('无效目标补充来源');
    return {kind:'user-continuation',continuationId:safeId(source.continuationId as string),scopeId:safeId(source.scopeId as string),waitId:safeId(source.waitId as string),inputRevision:source.inputRevision as number};
  }
  if(source.kind!=='member-results'||Object.keys(source).some(key=>!['kind','continuationId','messageIds','taskIds'].includes(key)))throw Error('无效成员接续来源');
  if(typeof source.continuationId!=='string')throw Error('缺少成员接续标识');
  const ids=(value:unknown,required:boolean)=>{
    if(!Array.isArray(value)||value.length>100||(required&&!value.length)||value.some(id=>typeof id!=='string')||new Set(value).size!==value.length)throw Error('无效成员接续消息或任务标识');
    return (value as string[]).map(safeId);
  };
  return {kind:'member-results',continuationId:safeId(source.continuationId),messageIds:ids(source.messageIds,false),taskIds:ids(source.taskIds,true)};
}
