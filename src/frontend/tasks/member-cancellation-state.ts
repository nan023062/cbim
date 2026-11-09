/**
 * 作用定位：为成员卡、任务节点和详情提供未启动撤销的统一只读投影。
 * 设计原因：普通 cancelled 可能来自运行停止或周期关闭，不能证明未执行；只有后端明确保存且与节点版本一致的撤销记录才使用该语义。
 */
import type {TaskNode} from '../../bridge/contracts/dispatch';

export type MemberCancellation=NonNullable<TaskNode['cancelledBeforeStart']>;
export const memberCancellationLabel='已撤销（未启动）';

/** 消费已通过图身份校验的节点；不根据模型文字或空日志推导撤销，不请求后端或改变任务。 */
export function committedMemberCancellation(task:TaskNode):MemberCancellation|undefined{
  const record=task.cancelledBeforeStart;
  if(!record||task.status!=='cancelled'||task.runIds.length||task.activeRunId||task.result||task.help||task.awaitedChildren.length)return;
  if(!task.scopeId||record.scopeId!==task.scopeId||record.previousRevision+1!==task.revision||record.cancelledAt!==task.updatedAt)return;
  return record;
}
