/**
 * 作用定位：在任务节点详情中展示一次显式核实的派发、日志与工具回执报告，独立于成员流式正文。
 * 设计原因：坏日志也必须能查看核实诊断；仓库 scope 保留独立来源，不当作文件基线或恢复证据。独立表单才可显式新建只读核实周期，不恢复旧任务或提供业务验收。
 */
import type {ExecutionReport,GraphCursor,ScopeSummary,TaskNode} from '../../bridge/contracts/dispatch';
import {useExecutionReport} from './useExecutionReport';
import type {ExecutionReportState} from './execution-report-state';
import {useExecutionRecovery,type ExecutionRecoveryContext} from './useExecutionRecovery';
import {ExecutionRecoveryForm} from './ExecutionRecoveryForm';
import {MemberArtifactReport} from './MemberArtifactReport';
import {RepositoryScopeDetails} from '../components/RepositoryScopeDetails';
import './execution-report.css';

export interface ExecutionReportView extends ExecutionReportState {stale:boolean;inspect:()=>Promise<void>;more:()=>Promise<void>}
const executionLabels:Record<ExecutionReport['execution'],string>={not_started:'尚未领取执行',in_flight:'有在途执行记录',settled:'执行轮次已结算',unknown:'执行结果未知'};
const logLabels:Record<ExecutionReport['log']['state'],string>={not_expected:'没有已登记的运行日志',not_selected:'尚未选择执行轮次',verified:'运行日志已通过核对',missing:'运行日志缺失',incomplete:'运行日志不完整',invalid:'运行日志无效',identity_mismatch:'运行日志身份不匹配',unavailable:'运行日志暂时无法读取'};
const toolLabels={succeeded:'收到成功回执',failed:'收到失败回执',denied:'已拒绝授权',unknown:'结果尚未确认',not_authorized:'未记录执行授权'};
const effectLabels:Record<string,string>={read:'读取',preview:'预览',maintenance:'维护', 'business-write':'业务写入','knowledge-write':'知识写入',command:'命令'};
const scopeLabels:Record<string,string>={workspace:'业务工作区',knowledge:'知识库',unknown:'范围未知',repository:'资源仓库'};
const runLabels={starting:'启动意图已登记',running:'执行中',completed:'本轮结束',failed:'执行失败',cancelled:'已停止',interrupted:'执行中断'};

/** 呈现后端核实事实；纯组件不读取数据，测试和桌面入口使用相同安全文案。 */
export function ExecutionReportPanel({state,taskId,runId}:{state:ExecutionReportView;taskId:string;runId?:string}){
  const {report,loading,error,stale}=state,phase=loading?'loading':error?'error':report?'ready':'idle';
  return <section className="execution-report" aria-label="成员执行记录核实" data-testid="member-execution-report" data-task-id={taskId} data-run-id={runId??''} data-report-state={phase} data-execution={report?.execution} data-log-state={report?.log.state}>
    <header><h4>执行记录核实</h4><button data-testid={report?'execution-report-refresh':'execution-report-inspect'} disabled={loading} onClick={()=>void state.inspect()}>{report?'重新核实':'核实执行记录'}</button></header>
    <p className="member-muted">只读取派发记录、运行日志和工具回执，不恢复执行或重试操作。</p>
    {loading&&<p role="status" className="member-muted" data-testid="execution-report-loading">正在核实所选执行记录…</p>}
    {error&&<p role="alert" className="member-error" data-testid="execution-report-error">核实失败：{error}{report?'；保留上次报告，请重新核实。':'；不能据此判定任务未执行。'}</p>}
    {report&&<>
      <p className={'execution-report-state '+(report.execution==='unknown'?'warning':'')} data-testid="execution-report-status">{executionLabels[report.execution]}</p>
      {report.basis.runStatus&&<p>登记状态：{runLabels[report.basis.runStatus]}</p>}
      <p className="member-muted">核实于 {new Date(report.checkedAt).toLocaleString()}；结算或工具返回成功不代表业务验收通过。</p>
      {stale&&<p className="member-warning" role="status" data-testid="execution-report-stale">{report.consistency==='changed_during_read'?'读取期间记录发生变化，结果仍待核实。':'任务或周期记录与本报告版本不同。'}请重新核实后查看最新结果。</p>}
      <div data-testid="execution-report-log"><strong>{logLabels[report.log.state]}</strong>{report.log.hasTerminal===false&&<p className="member-muted">没有核实到完整终态；此前操作可能已有实际影响。</p>}</div>
      {!!report.issues.length&&<ul className="execution-report-issues" data-testid="execution-report-issues">{report.issues.map((issue,index)=><li key={issue.code+':'+index} className={issue.severity}><span>{issue.message}</span><small>{issue.code}</small></li>)}</ul>}
      <div className="execution-report-tools" data-testid="execution-report-tools">
        <h5>工具记录</h5>
        {report.tools.available?<>
          <dl className="execution-report-counts">{Object.entries(toolLabels).map(([status,label])=><div key={status}><dt>{label}</dt><dd>{report.tools.counts[status as keyof typeof toolLabels]}</dd></div>)}</dl>
          <p className="member-muted">已显示 {report.tools.items.length} / {report.tools.total} 项。失败回执也可能伴随已发生的改动；未确认结果不能当作未执行。</p>
          {report.tools.items.map(item=><details className="execution-report-tool" key={item.toolCallId} data-testid="execution-report-tool" data-tool-status={item.status}><summary><strong>{item.toolName||'未记录工具名称'}</strong><span>{toolLabels[item.status]}</span></summary>
            <p><code>{item.toolCallId}</code></p><p>{item.effects.map(effect=>effectLabels[effect]??effect).join('、')||'未记录副作用分类'} · {scopeLabels[item.scope.kind]??'范围未知'}</p>
            <RepositoryScopeDetails scope={item.scope}/>
            <p className="member-muted">提议记录：{item.proposedSeq??'未知'} · 授权记录：{item.allowedSeq??'未知'} · 结果记录：{item.finishedSeq??'未知'}</p>
            {item.receipt?<><p className="member-muted">回执时间：{new Date(item.receipt.recordedAt).toLocaleString()}</p><p className="member-muted">输入记录哈希：<code>{item.receipt.inputHash}</code>{item.receipt.resultHash&&<> · 结果记录哈希：<code>{item.receipt.resultHash}</code></>}</p><p className="member-muted">这些哈希对应调用记录，不是业务产物指纹。</p></>:<p className="member-warning">没有可核实的完整回执。</p>}
          </details>)}
          {report.tools.nextCursor&&<button data-testid="execution-report-more" disabled={loading||stale} onClick={()=>void state.more()}>加载更多工具记录</button>}
        </>:report.execution==='not_started'?<p className="member-muted">未登记成员运行，本报告没有可展示的工具回执。</p>:<p className="member-warning">工具记录不可完整核实；这不表示没有执行任何操作。</p>}
      </div>
      {report.candidate&&<div className="execution-report-candidate" data-testid="execution-report-candidate"><h5>本轮交付候选 · 尚未验收</h5><p>计划第 {report.candidate.planRevision} 版 · <code>{report.candidate.resultId}</code></p></div>}
      <p className="member-muted" data-testid="execution-report-next">{report.next.reason}</p>
      <details className="execution-report-basis"><summary>核实依据版本</summary><p>任务第 {report.basis.taskRevision} 版 · 计划第 {report.basis.planRevision} 版</p><p>图记录 {report.basis.graphCursor.seq} · 运行日志 {report.basis.logSeq??'未知'}</p><code>{report.basis.key}</code></details>
    </>}
  </section>;
}

/** 独立挂载在轮次选择器之后，即使流式日志损坏也能通过该只读入口检查登记事实。 */
export function MemberExecutionReport({workspaceId,rootSessionId,task,runId,graphCursor,scope,recovery}:{workspaceId:string;rootSessionId:string;task:TaskNode;runId?:string;graphCursor?:GraphCursor;scope?:ScopeSummary;recovery?:ExecutionRecoveryContext}){
  const state=useExecutionReport({workspaceId,rootSessionId,taskId:task.taskId,scopeId:task.scopeId,runId},task,graphCursor,scope);
  const creation=useExecutionRecovery(workspaceId,rootSessionId,task,runId,state.report,state.stale||state.loading||!!state.error,recovery,state.invalidate);
  return <><ExecutionReportPanel state={state} taskId={task.taskId} runId={runId}/>{runId&&<MemberArtifactReport identity={{workspaceId,rootSessionId,taskId:task.taskId,runId}} task={task} graphCursor={graphCursor} scope={scope}/>}<ExecutionRecoveryForm state={creation}/></>;
}
