/**
 * 作用定位：在成员原调用下分别显示工具结果、受控文件操作和独立补偿状态。
 * 设计原因：真实 before 只留在后端；用户先看当前文件核对与恢复摘要，再明确提交，未知只查原命令，不把补偿当成业务验收。
 */
import {controlledFileWriteToolName} from '../../bridge/contracts/controlled-files';
import type {ControlledFileReportInput,ControlledFilePhase,FileCompensationReceipt} from '../../bridge/contracts/controlled-files';
import type {ExecutionReport} from '../../bridge/contracts/dispatch';
import {useControlledFiles} from './useControlledFiles';
import './controlled-file.css';

const phaseLabels:Record<ControlledFilePhase,string>={prepared:'准备记录已保存',executing:'已准入执行，结果未结算',applied:'内容已应用',not_applied:'已确认未发出内容写入',unknown:'结果未知，可能已部分写入'};
const toolLabels={succeeded:'原工具成功',failed:'原工具失败',denied:'原工具被拒绝',unknown:'原工具结果未知',not_authorized:'未记录原工具授权'};

/** 补偿事实不覆盖旧工具或写入记录，不借恢复内容签署业务接受。 */
function CompensationReceipt({receipt}:{receipt:FileCompensationReceipt}){return <div data-testid="file-compensation-receipt" data-phase={receipt.phase} data-command-id={receipt.commandId}>
  <strong>独立补偿：{phaseLabels[receipt.phase]}</strong><p>{receipt.request.reason}</p><p className="controlled-muted">本机明确操作 · {new Date(receipt.updatedAt).toLocaleString()} · 第 {receipt.revision} 阶段</p>
  {receipt.issue&&<p role="alert">{receipt.issue.message}（{receipt.issue.code}）</p>}<code>{receipt.commandId}</code><p>原工具与原写入记录保留；恢复文件内容不表示任务已验收。</p>
</div>}

/** 仅展示已核实工具名的入口；挂载不会查询原账本或读取当前文件。 */
export function ControlledFilePanel({identity,instanceId,anchor,toolStatus}:{identity:ControlledFileReportInput;instanceId?:string;anchor:string;toolStatus:keyof typeof toolLabels}){
  const {controller,snapshot,read,draft,attempt,fresh}=useControlledFiles(identity,instanceId,anchor);
  const ledger=read?.report?.ledger,operation=ledger?.state==='recorded'?ledger.operation:undefined,preview=read?.preview;
  const pending=controller.isPending(draft?.commandId),locked=!!draft?.commandId&&attempt?.state!=='rejected';
  const attempts=snapshot.attempts.filter(v=>v.identity.taskId===identity.taskId&&v.identity.runId===identity.runId&&v.identity.toolCallId===identity.toolCallId);
  const known=new Set(attempts.map(v=>v.request.commandId));
  return <section className="controlled-file" data-testid="controlled-file-panel" data-run-id={identity.runId} data-tool-call-id={identity.toolCallId} data-operation-phase={operation?.phase}>
    <header><strong>受控文件操作</strong><button data-testid="controlled-file-inspect" disabled={read?.loading} onClick={()=>void controller.inspect(identity)}>{read?.loading?'正在读取…':read?.report?'重新核实原操作':'核实原文件操作'}</button></header>
    <p>{toolLabels[toolStatus]}；文件操作和补偿分别保留，不重试原工具。</p>
    {(read?.error||snapshot.error)&&<p role="alert">{read?.error||snapshot.error}{read?.report?'；原报告保留。':''}</p>}
    {ledger&&ledger.state!=='recorded'&&<div data-testid="controlled-file-unavailable"><p>{ledger.state==='absent'?'尚未查到受控写入记录；不能据此判断没有执行。':'原受控操作暂不可核实。'}</p>{ledger.issues.map((issue,index)=><p key={index}>{issue.message}（{issue.code}）</p>)}</div>}
    {operation&&<>
      <div data-testid="controlled-file-original"><strong>原写入：{phaseLabels[operation.phase]}</strong><p><code>{operation.relativePath}</code></p>{operation.issue&&<p role="alert">{operation.issue.message}（{operation.issue.code}）</p>}
        <details><summary>原操作与字节摘要</summary><code>{operation.operationId}</code><p>写前 {operation.before.byteLength.toLocaleString()} 字节</p><code>{operation.before.sha256}</code><p>计划写入 {operation.intendedAfter.byteLength.toLocaleString()} 字节</p><code>{operation.intendedAfter.sha256}</code></details>
      </div>
      {operation.phase==='applied'?<div className="file-compensation-form">
        <h4>显式恢复写前内容</h4><p>只恢复原文件默认数据流。文件须仍是同一对象、当前字节与原写后一致，且原周期已关闭；实际提交时会再次核对。</p>
        <button data-testid="file-compensation-preview" disabled={!instanceId||read?.loading||pending} onClick={()=>instanceId&&void controller.preview(identity,instanceId)}>预览文件补偿</button>
        {!instanceId&&<p role="status">当前工作区实例尚未就绪，仅可查询原操作。</p>}
        {preview&&<div data-testid="file-compensation-preview-result" data-eligible={preview.eligible}>
          <p>当前文件：{{matches:'与原写后字节一致',changed:'字节已变化',missing:'文件缺失',unverifiable:'不可核实'}[preview.observed.state]}</p>
          <p>恢复目标：原写前 {preview.restore.byteLength.toLocaleString()} 字节</p><code>{preview.restore.sha256}</code>
          {preview.issues.map((issue,index)=><p role="status" key={index}>{issue.message}（{issue.code}）</p>)}
          {preview.limitations.length>0&&<details><summary>恢复范围与限制</summary><ul>{preview.limitations.map((item,index)=><li key={index}>{item}</li>)}</ul></details>}
          {!fresh&&<p role="status" data-testid="file-compensation-stale">{preview.eligible?'当前预览已过期，请重新预览后提交。':'当前条件不允许补偿；原结果保留，可通过异常核实安排新修复。'}</p>}
          <label>补偿理由<textarea data-testid="file-compensation-reason" aria-label="文件补偿理由" readOnly={locked||pending} maxLength={4096} value={draft?.reason??''} onChange={e=>controller.edit(identity,e.target.value)}/></label>
          {!locked&&<button data-testid="file-compensation-submit" disabled={!fresh||!draft?.reason.trim()||!controller.available||pending} onClick={()=>instanceId&&void controller.submit(identity,instanceId)}>确认恢复写前内容</button>}
        </div>}
      </div>:<p data-testid="file-compensation-not-supported">本片仅允许对已可靠应用的受控写入补偿；准备、未结算或未知操作须先核实，不能自动恢复。</p>}
    </>}
    {attempts.length>0&&<div className="file-compensation-history" data-testid="file-compensation-history"><h4>原补偿命令</h4>{attempts.map(item=><article key={item.request.commandId} data-command-id={item.request.commandId} data-state={item.state}>
      {item.receipt?<CompensationReceipt receipt={item.receipt}/>:<><p role="status">{item.state==='sending'?'正在提交补偿…':item.state==='rejected'?'该请求尚未进入写入流程。':'补偿结果尚未确认，仅查询原命令。'}</p><code>{item.request.commandId}</code></>}
      {item.error&&<p role="alert">{item.error}</p>}<button data-testid="file-compensation-query" disabled={controller.isPending(item.request.commandId)} onClick={()=>void controller.query(identity,item.request.commandId)}>查询原补偿命令</button>
      {item.request.commandId===draft?.commandId&&item.receipt?.phase==='not_applied'&&<button data-testid="file-compensation-prepare" disabled={pending} onClick={()=>controller.prepare(identity)}>准备新的补偿请求</button>}
    </article>)}</div>}
    {ledger?.state==='recorded'&&ledger.compensations.some(v=>!known.has(v.commandId))&&<div className="controlled-actions" data-testid="file-compensation-server-history"><h4>已保存补偿历史</h4>{ledger.compensations.filter(v=>!known.has(v.commandId)).map(item=><button key={item.commandId} data-command-id={item.commandId} disabled={controller.isPending(item.commandId)} onClick={()=>void controller.query(identity,item.commandId)}>{phaseLabels[item.phase]} · {new Date(item.preparedAt).toLocaleString()}</button>)}</div>}
  </section>;
}

/** 原工具选择来自已加载的真实执行报告，旧 native 操作不会因此获得补偿入口。 */
export function MemberControlledFiles({report,instanceId,anchor}:{report:ExecutionReport;instanceId?:string;anchor:string}){
  if(!report.identity.runId)return null;
  return <>{report.tools.items.filter(item=>item.toolName===controlledFileWriteToolName).map(item=><ControlledFilePanel key={item.toolCallId} identity={{workspaceId:report.identity.workspaceId,rootSessionId:report.identity.rootSessionId,taskId:report.identity.taskId,runId:report.identity.runId!,toolCallId:item.toolCallId}} instanceId={instanceId} anchor={anchor} toolStatus={item.status}/>)}</>;
}
