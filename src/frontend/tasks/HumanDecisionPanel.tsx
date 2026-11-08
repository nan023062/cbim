/**
 * 完整候选仅显示原交付清单、固定根及全部条目数量，选择与核实分开；历史显示原清单身份和当时观察。
 * 作用定位：呈现人工验收项的候选、文件观察和三种明确决定，并展示不可变本机记录。
 * 设计原因：普通对话及模型审阅不能代替真人选择；界面解释所选范围与未知限制，保存只记意见，不能暗示已启动或完成目标。
 */
import type {HumanDecisionKind,HumanDecisionPreview} from '../../bridge/contracts/human-decisions';
import type {HumanDecisionsView} from './useHumanDecisions';
import './human-decisions.css';

export const humanDecisionLabels:Record<HumanDecisionKind,string>={accept:'接受',reject:'拒绝',request_evidence:'要求补证'};
const descriptions:Record<HumanDecisionKind,string>={accept:'所述验收项及本次选定成果符合预期',reject:'指出不符合目标之处，保留返工依据',request_evidence:'说明还需提供哪些证据或说明'};
const fileLabels={matches:'内容一致',changed:'文件已变化',missing:'文件缺失',unverifiable:'无法核实'};
const manifestLabels={matches:'完整集合一致',changed:'完整集合已变化',unverifiable:'完整集合无法核实'};
/** 同时展示目录范围与条目数量；不把旧文件子集的观察包装成完整核实。 */
function ManifestSummary({manifest}:{manifest:NonNullable<HumanDecisionPreview['candidates'][number]['manifest']>}){
  return <div data-testid="human-manifest-scope"><p>完整范围：{manifest.entryCount} 个条目，含 {manifest.fileCount} 个文件。目录包含全部后代。</p><ul>{manifest.scopes.flatMap(binding=>binding.scope.roots.map(root=><li key={binding.moduleId+':'+root.path}><code>{root.path}</code> · {root.kind==='directory'?'完整目录':'文件'}</li>))}</ul><details><summary>原清单身份</summary><p>采集于 {new Date(manifest.capturedAt).toLocaleString()}</p><p>清单 <code>{manifest.manifestId}</code></p><p>集合指纹 <code>{manifest.manifestHash}</code></p></details></div>;
}
/** 两处卡片只接收同一个 Hook 视图；点击操作不会通过组件自身创建命令。 */
export function HumanDecisionPanel({state}:{state:HumanDecisionsView}){
  const {record,preview}=state,result=preview?.result,attempt=record?.attempt,history=state.history.filter(value=>value.criterionId===state.criterionId);
  if(!state.criteria.length&&!state.history.length)return null;
  return <section className="human-decisions" aria-label="人工决定" data-testid="human-decision-panel" data-scope-id={state.scopeId} data-criterion-id={state.criterionId} data-basis={state.previewCurrent?result?.basis:undefined} data-phase={attempt?.phase??'draft'}>
    <header><strong>人工决定</strong><span>本机明确提交 · 尚非整体目标完成</span></header>
    <p className="human-muted">选择验收项并核实成果，再记录接受、拒绝或补证意见。保存本身不启动模型；后续工作由独立的继续操作发起。</p>
    <label className="human-field">验收项<select data-testid="human-criterion-select" value={state.criterionId} onChange={event=>state.select(event.target.value)}>{state.criteria.map(value=><option key={value.id} value={value.id}>{value.text}</option>)}</select></label>
    {!state.eligible&&<p className="human-muted">当前为历史或尚未同步的目标；仅安全等待中的当前目标可以提交新决定。</p>}
    {state.eligible&&<>
      <button data-testid="human-preview" disabled={!state.editable||!!preview?.loading} onClick={()=>void state.inspect()}>{preview?.loading?'正在核实…':result?'重新核实当前选择':'查看候选与可选基线'}</button>
      {(!!record?.baselines.length||!!record?.manifests?.length)&&<button data-testid="human-clear-baselines" disabled={!state.editable} onClick={()=>void state.clearBaselines()}>清除旧选择，重新核实</button>}
      {preview?.error&&<p role="alert" data-testid="human-error">{preview.error}</p>}
      {result&&<div className="human-candidates">
        {!state.previewCurrent&&<p className="human-warning">选择或目标已变化；请重新核实，旧观察不能用于提交。</p>}
        {result.candidates.map(candidate=><article key={candidate.taskId} data-testid="human-candidate" data-task-id={candidate.taskId}>
          <strong>{candidate.agentName}</strong><p>{candidate.summary}</p><details><summary>候选来源</summary><div>任务 <code>{candidate.taskId}</code></div><div>运行 <code>{candidate.runId}</code></div><div>结果 <code>{candidate.resultId}</code></div></details>
          {candidate.manifest?<><label className="human-field">明确选择原交付完整清单<select data-testid="human-manifest-select" data-task-id={candidate.taskId} data-run-id={candidate.runId} data-result-id={candidate.resultId} disabled={!state.editable} value={record?.manifests?.find(value=>value.taskId===candidate.taskId)?.manifestId??''} onChange={event=>state.chooseManifest(candidate.taskId,candidate.runId,event.target.value)}><option value="">未选择 · 不自动接受</option><option value={candidate.manifest.manifestId}>{candidate.manifest.entryCount} 个条目 · {candidate.manifest.manifestId.slice(0,8)}</option></select></label><ManifestSummary manifest={candidate.manifest}/>{candidate.selectedManifest&&<p data-testid="human-manifest-state">{manifestLabels[candidate.selectedManifest.state]}</p>}</>:<label className="human-field">明确选择文件基线<select data-testid="human-baseline-select" data-task-id={candidate.taskId} data-run-id={candidate.runId} data-result-id={candidate.resultId} disabled={!state.editable} value={record?.baselines.find(value=>value.taskId===candidate.taskId)?.baselineId??''} onChange={event=>state.chooseBaseline(candidate.taskId,candidate.runId,event.target.value)}><option value="">未选择 · 不自动取最新</option>{candidate.baselines.map(baseline=><option key={baseline.baselineId} value={baseline.baselineId}>{new Date(baseline.capturedAt).toLocaleString()} · {baseline.fileCount} 个文件 · {baseline.baselineId.slice(0,8)}</option>)}</select></label>}
          {candidate.selected&&<ul>{candidate.selected.files.map(file=><li key={file.relativePath}><code>{file.relativePath}</code> <span>{fileLabels[file.state]??'无法核实'}</span></li>)}</ul>}
          {!candidate.manifest&&!candidate.baselines.length&&<p className="human-muted">该候选没有可选文件基线；可说明缺口，不可凭正文接受。</p>}
        </article>)}
        {result.issues.map((issue,index)=><p className="human-warning" key={index}>{issue.message}</p>)}
        <div className="human-limitations">{result.limitations.map((limitation,index)=><p key={index}>{limitation}</p>)}</div>
      </div>}
      <div className="human-options" role="group" aria-label="选择人工决定">{(['accept','reject','request_evidence'] as HumanDecisionKind[]).map(decision=><button key={decision} type="button" data-testid={'human-decision-'+decision} aria-pressed={record?.decision===decision} disabled={!state.editable} onClick={()=>state.chooseDecision(decision)}><strong>{humanDecisionLabels[decision]}</strong><span>{descriptions[decision]}</span></button>)}</div>
      <label className="human-field">意见或补充说明<textarea data-testid="human-comment" disabled={!state.editable} value={record?.comment??''} maxLength={4000} placeholder="拒绝或要求补证时请写明原因；接受也可补充说明。" onChange={event=>state.comment(event.target.value)}/></label>
      {record?.decision&&state.previewCurrent&&!result?.allowedDecisions.includes(record.decision)&&<p className="human-warning">当前依据不支持“{humanDecisionLabels[record.decision]}”；请查看缺口并重新核实。</p>}
      <button data-testid="human-submit" disabled={!state.canSubmit} onClick={()=>void state.submit()}>{state.pending?'正在记录…':record?.decision?'记录'+humanDecisionLabels[record.decision]:'请选择决定'}</button>
    </>}
    {attempt?.error&&<p role="alert" data-testid="human-error">{attempt.error}</p>}
    {state.error&&<p role="alert" data-testid="human-error">{state.error}</p>}
    {attempt?.phase==='unknown'&&<div className="human-request-state"><p>提交结果尚未确认，保留原命令和意见。请查询或重试原请求，不会自动发送。</p><button data-testid="human-query" disabled={state.pending} onClick={()=>void state.query()}>查询提交结果</button><button data-testid="human-retry" disabled={!state.canRetry} onClick={()=>void state.retry()}>重试原请求</button></div>}
    {attempt?.phase==='accepted'&&attempt.receipt&&<p role="status" data-testid="human-receipt" data-decision-id={attempt.receipt.record.decisionId}>已记录“{humanDecisionLabels[attempt.receipt.record.decision]}”。本次保存未完成目标或启动工作；后续状态以当前目标为准。</p>}
    {!!history.length&&<details className="human-history" open data-testid="human-history"><summary>本项决定记录 · {history.length}</summary>{[...history].reverse().map(value=><article key={value.decisionId} data-decision-id={value.decisionId}><strong>{humanDecisionLabels[value.decision]} · 第 {value.revision} 次记录</strong><time>{new Date(value.recordedAt).toLocaleString()}</time><p>{value.comment||'未附加意见'}</p><small>本机明确提交；仅代表当时依据，不自动沿用于当前成果。</small>{value.supersedesDecisionId&&<p className="human-muted">替代同一依据上的前次决定 <code>{value.supersedesDecisionId}</code></p>}<details><summary>查看范围与依据</summary><p>{value.proof.source.criterion.text}</p><p>计划第 {value.proof.source.planRevision} 版 · 审阅第 {value.proof.source.reviewRevision} 版</p>{value.proof.candidates.map(candidate=><div key={candidate.taskId}>任务 <code>{candidate.taskId}</code>{candidate.selectedManifest&&<><ManifestSummary manifest={candidate.selectedManifest.manifest}/><p>{manifestLabels[candidate.selectedManifest.state]}</p></>}{candidate.selected?.files.map(file=><p key={file.relativePath}><code>{file.relativePath}</code> · {fileLabels[file.state]??'无法核实'}</p>)}</div>)}{value.proof.limitations.map((limitation,index)=><p key={index}>{limitation}</p>)}</details></article>)}</details>}
  </section>;
}
