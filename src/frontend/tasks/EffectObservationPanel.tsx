/**
 * 作用定位：展示原调用状态、当前文件、原控制面/知识事务、原治理/责任记录、受控写/补偿阶段、本机处置和后续独立周期关系。
 * 设计原因：用户可以核实影响并明确决定下一步，但这些观察不能覆盖旧失败、签署业务验收或自动启动修复。主与成员共用面板，身份不互相伪装。
 */
import {useState} from 'react';
import type {EffectObservationInput,EffectDispositionRecord} from '../../bridge/contracts/effect-observation';
import type {ExecutionReport} from '../../bridge/contracts/dispatch';
import {effectSelectionKey,type EffectDecision} from './effect-observation-state';
import {useEffectObservation} from './useEffectObservation';
import {effectRecoveryTarget} from './effect-recovery-state';
import {useRecoverySource,type ExecutionRecoveryContext} from './useExecutionRecovery';
import {ExecutionRecoveryForm} from './ExecutionRecoveryForm';
import './effect-observation.css';

const decisions:Record<EffectDecision,string>={inspect_more:'继续核实',repair_in_new_cycle:'新业务修复',leave_unresolved:'保留未解决'};
const outcomes={succeeded:'原工具成功',failed:'原工具失败',denied:'原操作被拒绝',unknown:'原结果未知',not_authorized:'未记录授权'};
const knowledgeStates={absent:'未查到原知识事务',prepared:'原事务保存到准备阶段',committing:'原事务记录停留在提交阶段',committed:'原知识事务已提交',rolled_back:'原事务记录为已回滚',recovery_required:'原知识事务仍需人工核实',unverifiable:'原知识事务不可核实'};
const controlledPhases={prepared:'已保存准备记录',executing:'停留在执行阶段',applied:'已记录写入完成',not_applied:'已确认未发出写入',unknown:'写入结果未知'};
/** 所选处置明确显示本机来源，不能被误读为账号签名或专业验收。 */
export function EffectDispositionSummary({record}:{record:EffectDispositionRecord}){return <div className="effect-disposition-summary" data-testid="effect-selected-disposition"><strong>{decisions[record.request.decision]}</strong><p>{record.request.reason}</p><small>本机明确保存 · {new Date(record.recordedAt).toLocaleString()} · 非业务验收</small><code>{record.dispositionId}</code></div>}

/** 仅按钮读取当前影响；原失败提示位于面板之外，后续结果独立列出。 */
export function EffectObservationPanel({identity,anchor,context}:{identity:EffectObservationInput;anchor:string;context?:ExecutionRecoveryContext}){
  const {controller,snapshot,read,draft,attempt,selected,fresh}=useEffectObservation(identity,anchor);
  const report=read?.report,pending=controller.isPending(draft?.commandId),locked=!!draft?.commandId&&attempt?.phase!=='rejected';
  const eligible=context?effectRecoveryTarget(identity,report,fresh,selected,context.state):{reason:'当前视图没有主会话恢复上下文。'};
  const creation=useRecoverySource(identity.workspaceId,identity.rootSessionId,identity.subject,eligible,context?.state.openScope?'当前目标尚未结束。':'',!!selected,context);
  return <section className="effect-observation" data-testid="effect-observation-panel" data-run-id={identity.subject.runId} data-source-kind={identity.subject.kind} data-call-ids={identity.subject.toolCallIds.join(',')}>
    <header><strong>核实原调用影响</strong><button title="只读、不重跑、不写库" data-testid="effect-observe" disabled={read?.loading} onClick={()=>void controller.observe(identity)}>{read?.loading?'正在读取…':report?'重新核实影响（只读）':'核实当前影响（只读）'}</button></header>
    <p>只读核对原记录和明确文件；不重发旧操作，也不更改原结果。</p>
    {(read?.error||snapshot.error)&&<p role="alert">{read?.error||snapshot.error}{report?'；上次报告保留。':''}</p>}
    {report&&<>
      <p className="effect-muted">观察于 {new Date(report.checkedAt).toLocaleString()} · {report.source.scopeStatus==='closed'?'原周期已关闭':'原周期未核实关闭'} · 不判定业务验收</p>
      {!fresh&&<p role="status" data-testid="effect-stale">依据需要重新核实，不能沿用旧观察创建新的处置或任务。</p>}
      {report.calls.map(call=><article className="effect-call" key={call.toolCallId} data-tool-call-id={call.toolCallId} data-coverage={call.coverage}>
        <strong>{call.toolName??'原调用'} · {outcomes[call.outcome]}</strong>
        {call.coverage==='control_commit_only'&&<p>{call.command?.state==='committed'?'原控制面事务已保存':call.command?.state==='absent'?'未查到原保存回执':'原事务仍不可核实'}；不表示业务工作已完成。</p>}
        {call.coverage==='unsupported'&&<p>本项影响暂不支持结构化核实，未知状态保留。</p>}
        {call.controlled&&<div data-testid="effect-controlled-file" data-state={call.controlled.state}>
          {call.controlled.state==='recorded'?<><p>原受控写入：{controlledPhases[call.controlled.operation.phase]}</p><p><code>{call.controlled.operation.relativePath}</code></p><p>原操作 <code>{call.controlled.operation.operationId}</code></p>
            <p>原字节 {call.controlled.operation.before.byteLength} 字节 → 预期 {call.controlled.operation.intendedAfter.byteLength} 字节</p>
            <p>独立补偿 {call.controlled.compensationRevision} 次；补偿不改写原操作与工具结果。</p>
            {call.controlled.compensations.map(item=><p key={item.compensationId}>补偿命令 <code>{item.commandId}</code> · {controlledPhases[item.phase]}</p>)}
          </>:<><p>{call.controlled.state==='absent'?'未查到原受控记录；不证明未写入。':'原受控记录不可核实。'}</p>{call.controlled.issues.map((item,i)=><p key={i}>{item.message}</p>)}</>}
          <p>当前字节和补偿资格仍需通过原受控操作的预览核实；本观察不执行补偿。</p>
        </div>}
        {call.persistent&&<div data-testid="effect-persistent-record" data-state={call.persistent.state}>
          <p>{call.persistent.state==='recorded'?(call.persistent.record?.kind==='observation'?'原治理观察已保存':call.persistent.record?.kind==='proposal'?'原治理提案已保存':'原负责人变更已保存'):call.persistent.state==='absent'?'未查到原保存记录':'原保存记录不可核实'}</p>
          <p>原命令 <code>{call.persistent.identity.commandId}</code></p>
          {call.persistent.record&&<><p>原记录 <code>{call.persistent.record.recordId}</code></p><small>保存于 {new Date(call.persistent.record.recordedAt).toLocaleString()}{call.persistent.record.kind==='ownership'?` · 原责任第 ${call.persistent.record.revision} 版`:''}</small></>}
          {call.persistent.reason&&<p>{call.persistent.reason==='original_record_unverifiable'?'原记录、输入或来源未通过完整性核实。':'当前无法可靠查询原记录。'}</p>}
          <p>保存不等于批准、实施或任务交接，也不改变原工具结果。</p>
        </div>}
        {call.knowledge&&<div data-testid="effect-knowledge-transaction" data-state={call.knowledge.state}>
          <p>{knowledgeStates[call.knowledge.state]}</p><p>原请求 <code>{call.knowledge.identity.requestId}</code></p>
          {call.knowledge.revision&&<p>原提交版本 <code>{call.knowledge.revision}</code> · {call.knowledge.changedCount} 项变更</p>}
          {call.knowledge.reason&&<p>{{original_plan_unavailable:'原对象计划缺失、损坏或身份不匹配。',original_record_unverifiable:'原事务记录未通过完整性核实。',query_unavailable:'当前无法可靠查询原事务。'}[call.knowledge.reason]}</p>}
          <p>这是原事务记录，不表示当前知识仍相同，也不改变原工具结果或业务验收。</p>
        </div>}
        {call.file&&<div data-testid="effect-current-file" data-state={call.file.state}><p><code>{call.file.relativePath}</code> · {{present:'当前文件存在',missing:'当前文件缺失',unverifiable:'当前文件不可核实'}[call.file.state]}</p>{call.file.byteLength!==undefined&&<small>{call.file.byteLength.toLocaleString()} 字节</small>}{call.file.sha256&&<code>{call.file.sha256}</code>}{call.file.reason&&<p>{call.file.reason}</p>}<p>这是当前观察，不是原操作的成功基线或完整影响证明。</p></div>}
        {!!call.baselineChecks?.length&&<details><summary>已有文件基线对照</summary>{call.baselineChecks.map(item=><p key={item.baselineId}><code>{item.baselineId}</code> · {{matches:'当前一致',changed:'已变化',missing:'文件缺失',unverifiable:'不可核实'}[item.file.state]}{item.invalidated?' · 原基线之后有操作':''}</p>)}</details>}
        {!!call.limitations.length&&<ul>{call.limitations.map((v,i)=><li key={i}>{v}</li>)}</ul>}
      </article>)}
      {!!report.limitations.length&&<ul>{report.limitations.map((v,i)=><li key={i}>{v}</li>)}</ul>}
      <details><summary>观察依据</summary><code>{report.basis}</code><p>原运行 <code>{report.identity.subject.runId}</code> · 原日志序号 {report.source.throughSeq??'未知'}</p></details>
      <div className="effect-disposition-form" data-testid="effect-disposition-form" data-phase={attempt?.phase??'draft'}>
        <h4>记录明确处置</h4><p>保存本机决定，不启动模型或授权写入；未知影响和原记录保留。</p>
        <label>下一步<select aria-label="异常处置" data-testid="effect-decision" disabled={locked||pending} value={draft?.decision??'inspect_more'} onChange={e=>controller.edit(identity,draft?.reason??'',e.target.value as EffectDecision)}>{Object.entries(decisions).map(([v,label])=><option key={v} value={v}>{label}</option>)}</select></label>
        <label>处置理由<textarea aria-label="处置理由" data-testid="effect-reason" maxLength={4096} readOnly={locked||pending} value={draft?.reason??''} onChange={e=>controller.edit(identity,e.target.value,draft?.decision??'inspect_more')}/></label>
        {!locked&&<button data-testid="effect-save" disabled={!fresh||!draft?.reason.trim()||!controller.available||pending} onClick={()=>void controller.submit(identity)}>保存处置</button>}
        {attempt&&<><p role="status">{attempt.phase==='accepted'?'本机处置已保存':attempt.phase==='submitting'?'正在保存处置…':attempt.phase==='rejected'?'本次请求尚未受理，可重新核实并修改草稿。':'保存结果尚未确认，仅查询原命令。'}</p>{attempt.error&&<p role="alert">{attempt.error}</p>}<button data-testid="effect-query" disabled={pending} onClick={()=>void controller.query(identity,attempt.request.commandId)}>查询原处置命令</button>{attempt.phase==='accepted'&&<button data-testid="effect-prepare" disabled={pending} onClick={()=>controller.prepare(identity)}>记录新的处置</button>}</>}
      </div>
    </>}
    <div className="effect-actions"><button title="只读、不重跑、不写库" data-testid="effect-history-load" disabled={read?.loading} onClick={()=>void controller.list(identity)}>读取处置历史（只读）</button>{selected&&<button data-testid="effect-relations-load" disabled={read?.loading} onClick={()=>void controller.relations(identity)}>查看后续任务状态</button>}</div>
    {read?.list&&<div data-testid="effect-history">{read.list.records.length?read.list.records.map(item=><button key={item.dispositionId} data-disposition-id={item.dispositionId} disabled={controller.isPending(item.dispositionId)} onClick={()=>void controller.query(identity,item.dispositionId)}>{decisions[item.decision]} · {new Date(item.recordedAt).toLocaleString()} · 第{item.revision}次</button>):<p>此来源尚无已保存处置。</p>}</div>}
    {selected&&<EffectDispositionSummary record={selected}/>}
    {selected&&<ExecutionRecoveryForm state={creation}/>}
    {read?.relations&&read.relations.identity.dispositionId===selected?.dispositionId&&<div data-testid="effect-relations"><h4>由本处置关联的后续周期</h4>{read.relations.links.length?read.relations.links.map(link=><article key={link.scopeId}><strong>{link.kind==='inspection'?'独立只读核实':'独立业务修复'}</strong><p>{link.status==='closed'?({completed:'新目标已结束',failed:'新任务失败',cancelled:'新任务已停止',interrupted:'新任务中断'}[link.outcome!]):link.status==='waiting'?'等待补充':'新任务进行中'} · {link.taskIds.length} 个任务节点</p><code>{link.scopeId}</code>{context&&<button onClick={()=>context.showScope(link.scopeId)}>查看新周期</button>}</article>):<p>尚无关联周期；保存处置不会自动创建任务。</p>}<p>新任务的结果不改变原工具的成功、失败或未知状态。</p></div>}
  </section>;
}

/** 从已经明确加载的成员报告选择原调用；不默认选最新，不使用模型自报的文件路径。 */
export function MemberEffectObservation({report,anchor,context}:{report:ExecutionReport;anchor:string;context?:ExecutionRecoveryContext}){
  const [ids,setIds]=useState<string[]>([]),runId=report.identity.runId;
  const valid=ids.filter(id=>report.tools.items.some(x=>x.toolCallId===id));
  if(!runId||!report.tools.available)return null;
  const identity:EffectObservationInput={workspaceId:report.identity.workspaceId,rootSessionId:report.identity.rootSessionId,subject:{kind:'member_run',taskId:report.identity.taskId,runId,toolCallIds:valid}};
  return <section className="effect-member-select"><details><summary>选择要核实影响的原调用</summary>{report.tools.items.map(call=><label key={call.toolCallId}><input type="checkbox" data-effect-call={call.toolCallId} checked={valid.includes(call.toolCallId)} disabled={!valid.includes(call.toolCallId)&&valid.length>=16} onChange={e=>setIds(e.target.checked?[...valid,call.toolCallId]:valid.filter(id=>id!==call.toolCallId))}/>{call.toolName} · {outcomes[call.status]} · <code>{call.toolCallId}</code></label>)}</details>{valid.length>0&&<EffectObservationPanel key={effectSelectionKey(identity)} identity={identity} anchor={anchor} context={context}/>}</section>;
}
