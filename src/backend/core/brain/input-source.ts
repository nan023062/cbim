/**
 * 作用定位：定义普通用户输入之外、由调度器提交的成员结果接续来源。
 * 设计原因：结果消息与业务任务标识必须随运行持久化，便于去重及恢复核实；来源只说明事实，不授予权限或将候选标为验收通过。
 */
import {safeId} from '../foundation/identity';

/** 可信调度接续元数据；正文单独传入，模型和公开聊天参数不能构造此来源。 */
export interface RunInputSource {
  kind:'member-results';
  /** 同一主会话的一批回传使用稳定标识；启动后重试应核实原运行，不重复注入。 */
  continuationId:string;
  /** 已提交的结果信封集合；失败或受阻任务没有候选信封时可以为空。 */
  messageIds:string[];
  /** 本次回注涉及的派发任务集合，与 messageIds 不要求逐项对应。 */
  taskIds:string[];
}

/** 校验并复制可信输入或历史日志中的来源；拒绝空任务、重复标识和额外身份/权限字段。 */
export function checkedRunInputSource(value:unknown):RunInputSource {
  if(!value||typeof value!=='object'||Array.isArray(value))throw Error('无效成员接续来源');
  const source=value as Record<string,unknown>;
  if(source.kind!=='member-results'||Object.keys(source).some(key=>!['kind','continuationId','messageIds','taskIds'].includes(key)))throw Error('无效成员接续来源');
  if(typeof source.continuationId!=='string')throw Error('缺少成员接续标识');
  const ids=(value:unknown,required:boolean)=>{
    if(!Array.isArray(value)||value.length>100||(required&&!value.length)||value.some(id=>typeof id!=='string')||new Set(value).size!==value.length)throw Error('无效成员接续消息或任务标识');
    return (value as string[]).map(safeId);
  };
  return {kind:'member-results',continuationId:safeId(source.continuationId),messageIds:ids(source.messageIds,false),taskIds:ids(source.taskIds,true)};
}
