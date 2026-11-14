/**
 * 作用定位：冻结会话插入动作的主运行身份，共用新草稿入队后插入与已有队列项插入。
 * 设计原因：入队及附件处理期间主运行可能结束；始终使用点击时的 runId，已入队后插入失败不恢复草稿或重发消息。
 * 职责边界：不推断引擎是否接受、不删除队列、不自动重试；错误由会话显示并刷新权威队列。
 */
import type {QueueInsertRequest,RunSummary} from '../../bridge/contracts/execution';

export type QueueInsertTarget=Readonly<Omit<QueueInsertRequest,'queueId'>>;
type QueuedReceipt={taskId:string;id:string};
type InsertPort=(request:QueueInsertRequest)=>Promise<unknown>;

/** 当前主头必须属于正在操作的会话；成员活动或持久等待不能借旧 running 日志取得插入口。 */
export function captureQueueInsertTarget(id:string,taskId:string|undefined,run:Pick<RunSummary,'runId'|'task'|'status'>|undefined,canInsert:boolean):QueueInsertTarget|undefined{
  if(!canInsert||!taskId||!run?.runId||run.status!=='running'||run.task.workspaceId!==id||run.task.taskId!==taskId)return;
  return Object.freeze({id,taskId,expectedRunId:run.runId});
}

/** 明确选择已有消息只发送一次；传输失败不根据新的主轮重新构造请求。 */
export function insertQueuedMessage(target:QueueInsertTarget,queueId:string,insert:InsertPort):Promise<unknown>{
  return insert({id:target.id,taskId:target.taskId,expectedRunId:target.expectedRunId,queueId});
}

/** 真实入队成功即确认草稿已保存；后续插入失败保留该事实，不再入队、不移除原消息。 */
export async function enqueueConversationMessage<T extends QueuedReceipt>(ports:{enqueue():Promise<T>;accepted(receipt:T):void;insert:InsertPort},target?:QueueInsertTarget):Promise<T>{
  const fixed=target?{...target}:undefined;
  const receipt=await ports.enqueue();
  if(fixed&&(receipt.taskId!==fixed.taskId||typeof receipt.id!=='string'||!receipt.id))throw Error('入队回执归属未确认，请先核实原消息队列，不要重复发送。');
  ports.accepted(receipt);
  if(fixed)await insertQueuedMessage(fixed,receipt.id,ports.insert);
  return receipt;
}
