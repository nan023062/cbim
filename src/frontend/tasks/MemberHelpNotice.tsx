/**
 * 作用定位：在主对话成员卡和任务详情中只读呈现已经结算的求助交接记录。
 * 设计原因：求助独立于日志正文加载，可在日志读取失败时仍查看已提交事实；工具引用只说明尝试，不代表成功、人工批准或可恢复原实例。
 */
import type {TaskNode} from '../../bridge/contracts/dispatch';
import {committedMemberHelp,memberHelpKindLabels} from './member-help-state';
import './member-activity.css';

/** compact 仅收起问题和引用；不改变事实来源，不请求日志或触发调度。 */
export function MemberHelpNotice({task,runId,compact=false}:{task:TaskNode;runId?:string;compact?:boolean}){
  const help=committedMemberHelp(task,runId);if(!help)return null;
  const content=<>
    <h5>需要主调度处理的问题</h5><p className="member-help-text" data-testid="member-help-question">{help.input.question}</p>
    <h5>尝试过的工具引用</h5><div data-testid="member-help-attempts">{help.input.attemptedToolCallIds.length?<ul>{help.input.attemptedToolCallIds.map(id=><li key={id}><code>{id}</code></li>)}</ul>:<p className="member-muted">本次求助没有登记尝试工具引用。</p>}</div>
    <p className="member-muted">工具引用不是成功证明；求助不构成交付候选、权限提升或人工验收。</p>
    <p className="member-muted">记录于 {new Date(help.requestedAt).toLocaleString()} · 任务计划第 {help.binding.planRevision} 版</p>
  </>;
  return <section className={'member-help-notice'+(compact?' compact':'')} data-testid="member-help" data-help-id={help.helpId} data-task-id={task.taskId} data-run-id={help.binding.runId} aria-label="成员求助交接">
    <header><strong>需要主调度协助</strong><span data-testid="member-help-kind">{memberHelpKindLabels[help.input.kind]}</span></header>
    <p className="member-help-handoff">本轮成员执行已结束，求助已交接主调度；后续任务由主调度重新安排。</p>
    <h5>求助原因</h5><p className="member-help-text" data-testid="member-help-reason">{help.input.reason}</p>
    {compact?<details><summary>查看求助内容</summary>{content}</details>:content}
  </section>;
}
