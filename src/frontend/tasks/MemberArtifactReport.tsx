/**
 * 作用定位：成员节点详情中的独立文件基线面板，手动列出记录并复核明确选择的一份。
 * 设计原因：文件观察与执行日志核实采用不同依据；不自动选最新、不定时扫描，不因字节一致签署验收或恢复运行。
 */
import {useEffect,useMemo,useRef,useSyncExternalStore} from 'react';
import type {GraphCursor,ScopeSummary,TaskNode} from '../../bridge/contracts/dispatch';
import {ArtifactReportController,artifactSelectionKey,type ArtifactReportState,type ArtifactSelection} from './artifact-report-state';
import './artifact-report.css';

export interface ArtifactPanelState extends ArtifactReportState {stale:boolean;list:()=>Promise<void>;inspect:()=>Promise<void>;select:(id:string)=>void}
const fileLabels={matches:'内容一致',changed:'内容已变化',missing:'文件缺失',unverifiable:'不可核实'};
const logLabels={verified:'日志已核实',missing:'运行日志缺失',incomplete:'运行日志不完整',invalid:'运行日志无效',identity_mismatch:'运行身份不匹配',unavailable:'日志暂时不可读'};

/** 纯展示真实观察；任何读取都由用户点击，原始文件内容与绝对路径不进入面板。 */
export function ArtifactReportPanel({state,taskId,runId}:{state:ArtifactPanelState;taskId:string;runId:string}){
  const {report,selectedId,loading,error,stale}=state,verification=report?.verification;
  const selected=report?.baselines.find(item=>item.baselineId===selectedId);
  return <section className="artifact-report" aria-label="文件基线核实" data-testid="artifact-baseline-panel" data-task-id={taskId} data-run-id={runId} data-baseline-id={selectedId}>
    <header><h4>文件基线核实</h4><button data-testid="artifact-baseline-list-load" disabled={loading} onClick={()=>void state.list()}>{report?'重新加载列表':'加载基线列表'}</button></header>
    <p className="member-muted">只核实执行成员显式采集的文件。加载列表不读取业务文件，选择后点击复核。</p>
    {loading&&<p role="status">正在读取{selectedId?'所选文件基线':'基线列表'}…</p>}
    {error&&<p className="member-error" role="alert">读取失败：{error}。{report?'保留上次报告，请重新核实。':'请重试，不能据此判断文件未变。'}</p>}
    {report&&<>
      <p className="member-muted">{logLabels[report.log.state]} · {new Date(report.checkedAt).toLocaleString()}</p>
      {(stale||report.consistency==='changed_during_read')&&<p className="member-warning" data-testid="artifact-baseline-stale">任务或记录版本已变化，本次报告不能作为当前依据，请重新核实。</p>}
      {!!report.issues.length&&<ul className="artifact-report-issues">{report.issues.map((issue,index)=><li key={issue.code+index}>{issue.message}<small>{issue.code}</small></li>)}</ul>}
      {report.log.state==='verified'&&!report.baselines.length&&<p data-testid="artifact-baseline-empty">本轮没有可核实的显式文件基线；不表示没有文件或改动。</p>}
      {!!report.baselines.length&&<>
        <label>选择本轮基线<select data-testid="artifact-baseline-select" value={selectedId} onChange={event=>state.select(event.target.value)}><option value="">请选择，不自动使用最新记录</option>{report.baselines.map(item=><option key={item.baselineId} value={item.baselineId}>{new Date(item.capturedAt).toLocaleTimeString()} · {item.fileCount} 个文件 · 进度第 {item.progressVersion} 版{item.invalidated?' · 后续有操作':''}</option>)}</select></label>
        <button data-testid={verification?'artifact-baseline-refresh':'artifact-baseline-inspect'} disabled={loading||!selected} onClick={()=>void state.inspect()}>{verification?'重新复核文件':'复核所选文件'}</button>
        {selected?.invalidated&&<p className="member-warning">采集后还有操作或计划变化，此历史基线不能直接用于恢复执行。</p>}
      </>}
      {verification&&verification.baselineId===selectedId&&<div data-testid="artifact-baseline-report" data-baseline-id={verification.baselineId} data-state={verification.state}>
        <p className="artifact-report-result">{verification.state==='matches'?'所列文件当前字节一致':verification.state==='changed'?'检测到文件变化或缺失':'当前文件状态无法完整核实'}</p>
        {verification.files.map(file=><article key={file.relativePath} data-relative-path={file.relativePath} data-status={file.state}>
          <strong>{file.relativePath}</strong><span className={file.state==='matches'?'member-muted':'member-warning'}>{fileLabels[file.state]}</span>
          {file.reason&&<p>{file.reason}</p>}
          <details><summary>字节与指纹</summary><p>采集时：{file.expected.byteLength.toLocaleString()} 字节<code>{file.expected.sha256}</code></p>{file.observed&&<p>本次观察：{file.observed.byteLength.toLocaleString()} 字节<code>{file.observed.sha256}</code></p>}</details>
        </article>)}
      </div>}
      <p className="member-muted">仅覆盖所列文件，不代表整个工作区未变、之前测试使用了这些字节或业务已验收。{report.impact==='unknown'?'仍有范围不明的操作影响。':''}此操作不会恢复任务。</p>
      <details className="artifact-report-basis"><summary>本次读取依据</summary><code>{report.basis}</code></details>
    </>}
  </section>;
}

/** 绑定所选真实轮次；图变化只提示报告过期，没有轮询、模型调用或磁盘写入。 */
export function MemberArtifactReport({identity,task,graphCursor,scope}:{identity:ArtifactSelection;task:TaskNode;graphCursor?:GraphCursor;scope?:ScopeSummary}){
  const version=JSON.stringify([task.revision,task.planRevision,task.status,graphCursor,scope?.status,scope?.goalRevision]);
  const current=useRef(version);current.current=version;
  const key=artifactSelectionKey(identity);
  const controller=useMemo(()=>new ArtifactReportController(identity,input=>window.cbim.call('dispatch.artifactReport',input),()=>current.current),[key]);
  const state=useSyncExternalStore(controller.subscribe,()=>controller.snapshot,()=>controller.snapshot);
  useEffect(()=>()=>controller.cancel(),[controller]);
  return <ArtifactReportPanel taskId={identity.taskId} runId={identity.runId} state={{...state,stale:!!state.report&&state.sourceVersion!==version,list:()=>controller.list(),inspect:()=>controller.inspect(),select:id=>controller.select(id)}}/>;
}
