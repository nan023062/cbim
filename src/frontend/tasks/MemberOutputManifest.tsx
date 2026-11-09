/**
 * 作用定位：成员指定轮次的声明范围完整清单面板，明确显示根、缺失、集合变化及原删除/移动证明。
 * 设计原因：与旧选定文件面板分开，加载列表不扫描；用户选择后再读全部范围，避免默认最新或误认业务验收。
 */
import {useEffect,useMemo,useRef,useSyncExternalStore} from 'react';
import type {GraphCursor,ScopeSummary,TaskNode} from '../../bridge/contracts/dispatch';
import type {OutputManifestSnapshot} from '../../bridge/contracts/output-manifest';
import {ManifestReportController,manifestSelectionKey,type ManifestReportState,type ManifestSelection} from './output-manifest-state';
import {ArtifactTransitionProofs} from './ArtifactTransitionProofs';
import './artifact-report.css';

export interface ManifestPanelState extends ManifestReportState {stale:boolean;list():Promise<void>;inspect():Promise<void>;select(id:string):void}
/** 不分页截取集合；细节折叠只改变显示，不省略完整根和条目。 */
function Snapshot({label,value}:{label:string;value:OutputManifestSnapshot}){
  return <details><summary>{label}：{value.entries.length} 个条目</summary>
    <ul>{value.roots.map(root=><li key={root.relativePath}>{root.relativePath} · {root.state==='missing'?'根缺失':root.state==='file'?'文件根':'目录根'}</li>)}</ul>
    {value.entries.map(entry=><article key={entry.relativePath} data-manifest-path={entry.relativePath}><strong>{entry.relativePath}</strong><span>{entry.kind==='directory'?'目录':entry.byteLength.toLocaleString()+' 字节'}</span>{entry.kind==='file'&&<code>{entry.sha256}</code>}</article>)}
  </details>;
}
/** 相同清单仅表示声明范围的当前观察相同，不表示整个工作区或业务质量已验收。 */
export function ManifestReportPanel({state,taskId,runId}:{state:ManifestPanelState;taskId:string;runId:string}){
  const {report,selectedId,loading,error,stale}=state,verification=report?.verification,selected=report?.manifests.find(item=>item.manifestId===selectedId);
  return <section className="artifact-report" aria-label="完整产物清单" data-testid="output-manifest-panel" data-task-id={taskId} data-run-id={runId}>
    <header><h4>声明范围内完整产物清单</h4><button data-testid="output-manifest-list" disabled={loading} onClick={()=>void state.list()}>{report?'重新加载清单':'加载清单列表'}</button></header>
    <p className="member-muted">加载列表只读原记录。选择清单后，重新观察声明根下全部受支持文件和目录，包括新增条目与空目录。</p>
    {loading&&<p role="status">正在读取完整产物记录…</p>}{error&&<p className="member-error" role="alert">读取失败：{error}。{report?'保留上次报告，请重新核实。':'请重试，不能据此判断产物未变。'}</p>}
    {report&&<><p className="member-muted">{report.log==='verified'?'原日志已核实':'原日志不可核实'} · {new Date(report.checkedAt).toLocaleString()}</p>
      {(stale||report.consistency==='changed_during_read')&&<p className="member-warning" data-testid="output-manifest-stale">任务或记录版本已变化，请重新核实，本报告不能作为当前依据。</p>}
      {report.scopes&&<ul data-testid="output-manifest-roots">{report.scopes.flatMap(binding=>binding.scope.roots.map(root=><li key={binding.moduleId+':'+root.path}><strong>{root.path}</strong> · {root.kind==='directory'?'完整目录树':'单文件'} · 模块 {binding.moduleId}</li>))}</ul>}
      {!!report.issues.length&&<ul className="artifact-report-issues">{report.issues.map((issue,index)=><li key={issue.code+index}>{issue.message}<small>{issue.code}</small></li>)}</ul>}
      {!report.manifests.length&&<p data-testid="output-manifest-empty">本轮没有可核实的完整清单；不会将旧文件基线转换或自动补采。</p>}
      {!!report.manifests.length&&<><label>选择本轮完整清单<select data-testid="output-manifest-select" value={selectedId} onChange={event=>state.select(event.target.value)}><option value="">请选择，不自动使用最新记录</option>{report.manifests.map(item=><option key={item.manifestId} value={item.manifestId}>{new Date(item.capturedAt).toLocaleTimeString()} · {item.entryCount} 条目 / {item.fileCount} 文件{item.invalidated?' · 后续有操作':''}</option>)}</select></label>
        <button data-testid="output-manifest-inspect" disabled={loading||!selected} onClick={()=>void state.inspect()}>{verification?'重新复核完整范围':'复核所选完整范围'}</button>
        {selected?.invalidated&&<p className="member-warning">此清单之后有副作用或重规划，历史记录不能直接作为当前交付依据。</p>}
        <ArtifactTransitionProofs operations={selected?.operations}/>
      </>}
      {verification&&verification.manifestId===selectedId&&<div data-testid="output-manifest-report" data-state={verification.state}>
        <p className="artifact-report-result">{verification.state==='matches'?'声明范围内的集合与内容一致':verification.state==='changed'?'声明范围内的集合或内容已变化':'当前完整范围无法核实'}</p>{verification.reason&&<p>{verification.reason}</p>}
        {verification.expected&&<Snapshot label="原完整清单" value={verification.expected}/>}{verification.observed&&<Snapshot label="本次完整观察" value={verification.observed}/>}
        <details><summary>范围与内容指纹</summary>{selected&&<><p>范围<code>{selected.scopeHash}</code></p><p>原清单<code>{selected.manifestHash}</code></p></>}{verification.observedHash&&<p>本次观察<code>{verification.observedHash}</code></p>}</details>
      </div>}
      <p className="member-muted">完整仅限上列声明范围。缺失只证明本次未找到，不能证明删除或移动的原因。两次稳定观察不是原子快照，也不代表业务验收或恢复许可。</p>
      <details><summary>本次读取依据</summary><code>{report.basis}</code></details>
    </>}
  </section>;
}
/** 图或任务变化只显示过期，切换运行取消迟到结果；无定时扫描或模型调用。 */
export function MemberOutputManifest({identity,task,graphCursor,scope}:{identity:ManifestSelection;task:TaskNode;graphCursor?:GraphCursor;scope?:ScopeSummary}){
  const version=JSON.stringify([task.revision,task.planRevision,task.status,graphCursor,scope?.status,scope?.goalRevision]),current=useRef(version);current.current=version;
  const key=manifestSelectionKey(identity),controller=useMemo(()=>new ManifestReportController(identity,input=>window.cbim.call('dispatch.manifestReport',input),()=>current.current),[key]);
  const state=useSyncExternalStore(controller.subscribe,()=>controller.snapshot,()=>controller.snapshot);useEffect(()=>()=>controller.cancel(),[controller]);
  return <ManifestReportPanel taskId={identity.taskId} runId={identity.runId} state={{...state,stale:!!state.report&&state.sourceVersion!==version,list:()=>controller.list(),inspect:()=>controller.inspect(),select:id=>controller.select(id)}}/>;
}
