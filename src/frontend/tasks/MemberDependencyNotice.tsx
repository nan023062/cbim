/**
 * 作用定位：在成员动态和任务详情中展示主调度已提交的前置追加/替换原因，以及当时的前置或候选身份。
 * 设计原因：任务、实例与失败来源保持独立历史；按节点版本判断最新审计，不按时间猜顺序，不把改边解释为成功或立即执行，也不新增轮询与操作入口。
 */
import type {TaskNode} from '../../bridge/contracts/dispatch';
import {memberDependencyHistory,memberDependencyAdditionHistory} from './member-dependency-state';
import './member-dependency.css';

/** compact 展示最近记录摘要，完整记录在任务详情可读；参数变化只重绘，不触发执行或读取。 */
export function MemberDependencyNotice({task,compact=false}:{task:TaskNode;compact?:boolean}){
  const history=memberDependencyHistory(task),addition=memberDependencyAdditionHistory(task),all=[...history.records,...addition.records];
  if(history.invalid||addition.invalid||new Set(all.map(record=>record.commandId)).size!==all.length||new Set(all.map(record=>record.previousTaskRevision)).size!==all.length)return <p className="member-warning" role="alert" data-testid="member-dependency-invalid">前置调整记录与任务身份或版本不一致，请重新同步任务图核实。</p>;
  if(!all.length)return null;
  const latest=Math.max(...all.map(record=>record.previousTaskRevision));
  const records=compact?history.records.filter(record=>record.previousTaskRevision===latest):history.records;
  const additions=compact?addition.records.filter(record=>record.previousTaskRevision===latest):addition.records;
  return <>{!!additions.length&&<section className={'member-dependency-notice'+(compact?' compact':'')} data-testid="member-dependency-addition" data-task-id={task.taskId} aria-label="已提交的前置追加记录">
    <strong>已追加前置任务 · {addition.records.length} 次</strong>
    {additions.map(record=><details key={record.commandId} open={!compact} data-addition-id={record.commandId}>
      <summary>{record.reason}</summary>
      <dl><div><dt>新增前置任务</dt><dd><code>{record.dependency.sourceTaskId}</code></dd></div><div><dt>前置计划版本</dt><dd>{record.dependency.sourcePlanRevision}</dd></div><div><dt>提交的主运行</dt><dd><code>{record.mainRunId}</code></dd></div></dl>
      <p>当时保留原任务和成员实例，等待前置结果。此记录只证明依赖已保存，不能证明执行完成或业务验收；当前状态以任务节点为准。</p>
      <time dateTime={record.addedAt}>记录于 {new Date(record.addedAt).toLocaleString()}</time>
    </details>)}
    {compact&&<small>查看任务详情可回顾全部依赖调整记录。</small>}
  </section>}{!!records.length&&<section className={'member-dependency-notice'+(compact?' compact':'')} data-testid="member-dependency-replacement" data-task-id={task.taskId} aria-label="已提交的前置替换记录">
    <strong>前置任务已替换 · {history.records.length} 次</strong>
    {records.map(record=><details key={record.commandId} open={!compact} data-replacement-id={record.commandId}>
      <summary>{record.reason}</summary>
      <dl><div><dt>原前置任务</dt><dd><code>{record.retired.sourceTaskId}</code></dd></div><div><dt>新前置任务</dt><dd><code>{record.replacement.sourceTaskId}</code></dd></div><div><dt>采用的候选</dt><dd><code>{record.replacement.resultId}</code></dd></div><div><dt>候选执行轮次</dt><dd><code>{record.replacement.runId}</code></dd></div></dl>
      <p>原依赖连线已退役，原任务及其失败或求助记录保留。任务仍须等待全部前置，并通过权限、额度与并发检查；本记录不代表业务验收。</p>
      <time dateTime={record.replacedAt}>记录于 {new Date(record.replacedAt).toLocaleString()}</time>
    </details>)}
    {compact&&<small>查看任务详情可回顾全部替换记录。</small>}
  </section>}</>;
}
