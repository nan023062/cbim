/**
 * 作用定位：在主对话的原工具记录中展示显式核实入口，分别呈现原工具结果、事务保存事实与验收边界。
 * 设计原因：通信失败不等于事务未提交；只展示有界公共身份与版本，挂载不请求、查询不恢复、不改写原工具失败或普通输入草稿。
 */
import {useEffect,useMemo,useSyncExternalStore} from 'react';
import type {CommandResultSummary,CommandVerificationReport} from '../../bridge/contracts/command-verification';
import {CommandVerificationController,commandVerificationKey,commandVerificationStale,type CommandVerificationSelection,type CommandVerificationState} from './command-verification-state';
import './command-verification.css';

export interface CommandVerificationView extends CommandVerificationState {stale:boolean;inspect:()=>Promise<void>}
const outcomeLabels={succeeded:'原工具已返回成功',failed:'原工具已返回失败',denied:'原工具已拒绝',unknown:'原工具结果尚未确认',not_authorized:'原调用未记录执行授权'};
const commandLabels={committed:'原事务已保存',absent:'未查到原命令的已保存回执',unverifiable:'原事务仍无法核实',not_applicable:'该工具不适用本项核实'};
const sourceLabels:Record<CommandVerificationReport['source']['state'],string>={verified:'原调用已核对',missing:'原调用记录缺失',invalid:'原调用记录无效',incomplete:'原调用记录不完整',legacy_unverified:'旧调用格式无法核实',unavailable:'原调用暂时无法读取'};
const reasonLabels:Record<string,string>={source_unverified:'原调用尚未核实',scope_unverified:'原调度周期尚未核实',unsupported_input:'原输入格式尚不支持',missing_prestate:'缺少原事务前态',fingerprint_mismatch:'原输入与已保存指纹不一致',receipt_invalid:'已保存回执未通过校验',store_unavailable:'原命令记录暂时无法读取',changed_during_read:'读取期间记录发生变化',readonly_tool:'原工具是只读查询，没有写命令',unsupported_family:'该工具尚未接入此核实协议'};

/** 只说明原控制面结果；排队、预约、审阅提交均不伪装成已执行或业务验收。 */
function ResultSummary({result}:{result:CommandResultSummary}){
  switch(result.toolName){
    case 'cbim_goal_plan':return <p>已保存计划第 {result.planRevision} 版，{result.criterionCount} 项验收条件、{result.assignmentCount} 项分工。</p>;
    case 'cbim_goal_review':return <p>已保存审阅第 {result.reviewRevision} 版，决定：{({complete:'完成',replan:'重新规划',blocked:'阻塞',awaiting_user:'等待用户'})[result.decision]}。本次查询不重新验收。</p>;
    case 'cbim_dispatch_task':return <p>已登记任务 <code>{result.taskId}</code>（原状态：{result.disposition==='queued'?'排队':'等待前置'}），不代表成员已经执行。</p>;
    case 'cbim_dispatch_cancel':return <p>原撤销事务包含 {result.cancelled.total} 个待执行任务；不表示撤回已有业务影响。</p>;
    case 'cbim_dispatch_replace_dependency':return <p>已保存任务 <code>{result.taskId}</code> 的前置替换，原结果来自 <code>{result.sourceTaskId}</code>。</p>;
    case 'cbim_dispatch_add_dependency':return <p>已为任务 <code>{result.taskId}</code> 追加前置 <code>{result.sourceTaskId}</code>，原状态为等待。</p>;
    case 'cbim_dispatch_resume':return <p>已保存任务 <code>{result.taskId}</code> 的检查点续执行预约；预约不代表已经启动。</p>;
    case 'cbim_dispatch_abandon_checkpoint':return <p>已放弃任务 <code>{result.taskId}</code> 的原检查点，原租约 {result.previousLeaseEpoch} → {result.nextLeaseEpoch}；不是回滚或交付成功。</p>;
  }
}

/** 纯展示层与桌面装配共用，原工具失败始终保留，不提供重试或恢复按钮。 */
export function CommandVerificationPanel({selection,state}:{selection:CommandVerificationSelection;state:CommandVerificationView}){
  const {report,loading,error,stale}=state;
  return <section className="command-verification" aria-label="原命令核实" data-testid="command-verification-panel" data-run-id={selection.runId} data-tool-call-id={selection.toolCallId} data-command-state={report?.command.state??'idle'}>
    <header><strong>原命令核实</strong><button type="button" aria-label={report?'重新核实原命令':'核实原命令'} disabled={loading} onClick={()=>void state.inspect()}>{loading?'正在核实…':report?'重新核实':'核实原命令'}</button></header>
    {!report&&<p>只读取原调用及保存记录，不重发操作。</p>}
    {error&&<p className="command-verification-error" role="alert">核实失败：{error}{report?'；保留上次报告，请重新核实。':'；不能据此判断操作未执行。'}</p>}
    {report&&<>
      <p data-testid="command-verification-source">{report.source.outcome?outcomeLabels[report.source.outcome]:sourceLabels[report.source.state]}</p>
      <p className={'command-verification-state '+(report.command.state==='committed'?'saved':'uncertain')} data-testid="command-verification-result"><strong>{commandLabels[report.command.state]}</strong></p>
      {report.command.state==='committed'?<ResultSummary result={report.command.result}/>:<p>{report.command.state==='absent'?'查无回执不表示没有执行，也不构成重新执行的许可。':reasonLabels[report.command.reason]}</p>}
      <p>核实于 {new Date(report.checkedAt).toLocaleString()}；本报告不判定业务验收，不改变原执行结果。</p>
      {stale&&<p className="command-verification-warning" role="status">{report.consistency==='changed_during_read'?'读取期间记录发生变化，仍需重新核实。':'核实后原运行记录已有更新，可重新核实最新情况；已保存事实不会因新日志自动撤回。'}</p>}
      {!!report.issues.length&&<ul>{report.issues.map((issue,index)=><li key={issue.code+index} className={'command-verification-'+issue.severity}>{issue.message}<small>{issue.code}</small></li>)}</ul>}
      <details><summary>原命令依据</summary><dl><dt>主运行</dt><dd><code>{report.identity.runId}</code></dd><dt>原工具调用</dt><dd><code>{report.identity.toolCallId}</code></dd><dt>原记录</dt><dd>{sourceLabels[report.source.state]} · 日志序号 {report.basis.throughSeq??'无法核实'}</dd>
        {'commandId' in report.command&&<><dt>命令</dt><dd><code>{report.command.commandId}</code></dd></>}
        {report.command.state==='committed'&&<><dt>保存事务</dt><dd>{report.command.commit.transactionSeq}</dd><dt>回执摘要</dt><dd><code>{report.command.receiptHash}</code></dd></>}
      </dl></details>
    </>}
  </section>;
}

/** 原身份改变才建立新控制器；轮询只更新日志序号提示，不读回原报告。 */
export function MainCommandVerification({selection,latestSeq}:{selection:CommandVerificationSelection;latestSeq:number}){
  const key=commandVerificationKey(selection),controller=useMemo(()=>new CommandVerificationController(selection,request=>window.cbim.call('dispatch.commandReport',request)),[key]);
  const state=useSyncExternalStore(controller.subscribe,()=>controller.snapshot,()=>controller.snapshot);
  useEffect(()=>()=>controller.cancel(),[controller]);
  return <CommandVerificationPanel selection={selection} state={{...state,stale:commandVerificationStale(state.report,latestSeq)||!!state.error,inspect:()=>controller.inspect()}}/>;
}
