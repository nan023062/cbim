/**
 * 作用定位：在主对话成员卡和任务详情中显示主调度已经提交的未启动撤销事实。
 * 设计原因：撤销不产生执行日志，记录必须独立于正文加载显示；保留原因与时间，不提供重放、恢复或验收操作。
 */
import type {TaskNode} from '../../bridge/contracts/dispatch';
import {committedMemberCancellation,memberCancellationLabel} from './member-cancellation-state';
import './member-activity.css';

/** compact 只限制原因摘要高度；完整原因仍在任务详情可读，不新增请求与轮询。 */
export function MemberCancellationNotice({task,compact=false}:{task:TaskNode;compact?:boolean}){
  const record=committedMemberCancellation(task);if(!record)return null;
  return <section className={'member-cancellation-notice'+(compact?' compact':'')} data-testid="member-cancellation" data-task-id={task.taskId} data-cancel-id={record.commandId} aria-label="未启动任务撤销记录">
    <strong>{memberCancellationLabel}</strong>
    <p className="member-cancellation-reason" data-testid="member-cancellation-reason">{record.reason}</p>
    <p className="member-muted">主调度在任务启动前撤销了此项安排；原目标和节点记录保留，撤销不代表任务完成。</p>
    <time className="member-cancellation-time" data-testid="member-cancellation-time" dateTime={record.cancelledAt}>记录于 {new Date(record.cancelledAt).toLocaleString()}</time>
  </section>;
}
