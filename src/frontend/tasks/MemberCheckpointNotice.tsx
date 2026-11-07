/**
 * 作用定位：在主对话和任务详情展示检查点、续执行预约、显式放弃与新旧轮次关系。
 * 设计原因：原任务与执行证据保留，显式放弃和普通封存分开；只读提示不依赖流式正文，不创建绕过主调度的处置或恢复入口。
 */
import type {TaskNode} from '../../bridge/contracts/dispatch';
import {checkpointPhaseLabels,memberCheckpointView} from './member-checkpoint-state';
import './member-checkpoint.css';

/** compact 只收起引用；查询原文件和实际续执行仍由各自受控入口负责，不在渲染中触发。 */
export function MemberCheckpointNotice({task,runId,compact=false}:{task:TaskNode;runId?:string;compact?:boolean}){
  const view=memberCheckpointView(task,runId);
  if(view.invalid)return <p className="member-warning" role="alert" data-testid="member-checkpoint-invalid">检查点记录与任务身份或运行不一致，请重新同步核实。</p>;
  if(!view.record||!view.phase)return null;
  const {record,phase,resumedRunId,abandonment}=view,request=task.resumeRequest;
  const explanation=phase==='abandoned'?'主调度已明确结束原检查点待办，未启动续执行；原成员、运行和成果记录保留。新负责人须另建任务并重新验证，放弃不代表业务完成或回滚。':phase==='sealed'?'该任务已结束或中断，检查点仅作历史记录，不能沿此恢复。':phase==='resumed'?'同一任务和成员通道已登记新的执行轮次；旧运行冻结，后续交付须重新验证。':phase==='queued'?'主调度已提出续执行请求，尚未登记新轮次；仍须核实文件、知识、权限、额度和执行名额。':'本轮已正常关闭，检查点已交接主调度；任务尚未完成，等待后续安排。';
  const references=<><dl><div><dt>检查点来源轮次</dt><dd><code>{record.binding.runId}</code></dd></div>{resumedRunId&&<div><dt>续执行轮次</dt><dd><code>{resumedRunId}</code></dd></div>}<div><dt>文件基线</dt><dd><code>{record.input.baselineId}</code></dd></div><div><dt>计划 / 进度版本</dt><dd>{record.binding.planRevision} / {record.input.expectedTaskProgressVersion}</dd></div></dl><time dateTime={record.requestedAt}>请求记录于 {new Date(record.requestedAt).toLocaleString()}</time><p className="member-muted">只支持同一活动周期内一次有界文件任务续执行；检查点不是交付候选或人工验收。</p></>;
  return <section className={'member-checkpoint-notice'+(compact?' compact':'')} data-testid="member-checkpoint" data-checkpoint-id={record.checkpointId} data-task-id={task.taskId} data-run-id={record.binding.runId} data-phase={phase} aria-label="成员检查点记录">
    <strong>{checkpointPhaseLabels[phase]}</strong><p>{explanation}</p>
    <p className="member-checkpoint-reason" data-testid="member-checkpoint-reason">{record.input.reason}</p>
    {abandonment&&<div data-testid="member-checkpoint-abandonment" data-command-id={abandonment.commandId}><strong>交接处置原因</strong><p>{abandonment.reason}</p><time dateTime={abandonment.abandonedAt}>放弃于 {new Date(abandonment.abandonedAt).toLocaleString()}</time><details><summary>查看处置记录</summary><dl><div><dt>原主调度运行</dt><dd><code>{abandonment.mainRunId}</code></dd></div><div><dt>处置命令</dt><dd><code>{abandonment.commandId}</code></dd></div><div><dt>目标 / 原任务版本</dt><dd>{abandonment.goalRevision} / {abandonment.previousTaskRevision}</dd></div><div><dt>本次租约变更</dt><dd>{abandonment.previousLeaseEpoch} → {abandonment.nextLeaseEpoch}</dd></div></dl></details></div>}
    {request&&<div data-testid="member-checkpoint-resume" data-request-id={request.requestId} data-resumed-run-id={resumedRunId}><span>主调度续执行说明</span><p>{request.reason}</p><small>{abandonment?'原预约已随交接处置，未启动；此处保留原预约说明。':'已提交预约；是否启动以独立运行记录为准。'}</small></div>}
    {compact?<details><summary>查看检查点引用</summary>{references}</details>:references}
  </section>;
}
