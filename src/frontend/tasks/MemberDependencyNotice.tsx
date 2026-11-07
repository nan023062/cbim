/**
 * 作用定位：在成员动态和任务详情中展示主调度已提交的前置替换原因、原来源与新候选身份。
 * 设计原因：原任务和失败来源仍保留；审计独立于成员流式日志，运行后仍可回看，不把换边解释为成功或立即执行，也不新增轮询与操作入口。
 */
import type {TaskNode} from '../../bridge/contracts/dispatch';
import {memberDependencyHistory} from './member-dependency-state';
import './member-dependency.css';

/** compact 展示最近记录摘要，完整记录在任务详情可读；参数变化只重绘，不触发执行或读取。 */
export function MemberDependencyNotice({task,compact=false}:{task:TaskNode;compact?:boolean}){
  const history=memberDependencyHistory(task);
  if(history.invalid)return <p className="member-warning" role="alert" data-testid="member-dependency-invalid">前置替换记录与任务身份或版本不一致，请重新同步任务图核实。</p>;
  if(!history.records.length)return null;
  const records=compact?history.records.slice(-1):history.records;
  return <section className={'member-dependency-notice'+(compact?' compact':'')} data-testid="member-dependency-replacement" data-task-id={task.taskId} aria-label="已提交的前置替换记录">
    <strong>前置任务已替换 · {history.records.length} 次</strong>
    {records.map(record=><details key={record.commandId} open={!compact} data-replacement-id={record.commandId}>
      <summary>{record.reason}</summary>
      <dl><div><dt>原前置任务</dt><dd><code>{record.retired.sourceTaskId}</code></dd></div><div><dt>新前置任务</dt><dd><code>{record.replacement.sourceTaskId}</code></dd></div><div><dt>采用的候选</dt><dd><code>{record.replacement.resultId}</code></dd></div><div><dt>候选执行轮次</dt><dd><code>{record.replacement.runId}</code></dd></div></dl>
      <p>原依赖连线已退役，原任务及其失败或求助记录保留。任务仍须等待全部前置，并通过权限、额度与并发检查；本记录不代表业务验收。</p>
      <time dateTime={record.replacedAt}>记录于 {new Date(record.replacedAt).toLocaleString()}</time>
    </details>)}
    {compact&&<small>查看任务详情可回顾全部替换记录。</small>}
  </section>;
}
