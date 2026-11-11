/**
 * 作用定位：在业务和团队架构中预览实际知识文件，并通过原知识事务编辑。
 * 设计原因：完整快照自动提供格式诊断；草稿固定起始版本、延迟完整预览，迟到结果不覆盖新编辑。提交后未知结果锁定原请求，不能换 ID 猜测重做。
 */
import {useEffect,useRef,useState} from 'react';
import type {Snapshot,Preview} from '../../bridge/contracts/workspace';
import {MarkdownMessage} from '../execution-view/MarkdownMessage';
import './knowledge-files.css';

/** 展示当前快照的完整诊断，编辑由用户显式打开；派生注册表只读。 */
export function KnowledgeFilePreview({snapshot,path,onSaved,onDirtyChange}:{snapshot:Snapshot;path:string;onSaved?:()=>Promise<void>;onDirtyChange?:(dirty:boolean)=>void}){
 const file=snapshot.files.find(item=>item.path===path),[editing,setEditing]=useState(false);
 if(!file)return <p>请选择知识文件。</p>;
 const issues=snapshot.validation?.issues.filter(issue=>issue.path===path||issue.path===path.replace(/\/[^/]+$/,''))??[];
 return <section className="knowledge-file-preview" aria-label="知识文件预览"><header><code>{path}</code><button disabled={path.endsWith('/registry.json')} onClick={()=>setEditing(true)}>编辑文件</button></header>
 <p className={issues.some(i=>i.severity==='error')?'knowledge-file-warning':''}>{!snapshot.validation?'格式尚未核实':issues.length?`${issues.length} 项格式或引用问题`:'当前文件未发现格式问题'} · 结构检查不代表业务验收</p>
 {issues.map((issue,index)=><p key={index} className="knowledge-file-warning">{issue.code} · {issue.message}</p>)}
 {path.endsWith('.md')?<MarkdownMessage text={file.text} workspaceId={snapshot.workspaceId}/>:<pre>{file.text}</pre>}
 {editing&&<FileEditor key={path} snapshot={snapshot} path={path} onDirtyChange={onDirtyChange} onClose={()=>setEditing(false)} onSaved={onSaved}/>}
 </section>;
}
/** 任何已发送提交只保留同一请求；显式重查/重送使用事务幂等身份，不重新预览制造新命令。 */
function FileEditor({snapshot,path,onDirtyChange,onClose,onSaved}:{snapshot:Snapshot;path:string;onDirtyChange?:(dirty:boolean)=>void;onClose:()=>void;onSaved?:()=>Promise<void>}){
 const base=useRef(snapshot).current,original=base.files.find(file=>file.path===path)!.text;
 const [draft,setDraft]=useState(original),[preview,setPreview]=useState<Preview>(),[checking,setChecking]=useState(true),[error,setError]=useState(''),[saving,setSaving]=useState(false),[attempt,setAttempt]=useState<Preview>();
 const dirty=draft!==original,version=useRef(0),alive=useRef(true);
 useEffect(()=>{alive.current=true;return()=>{alive.current=false;onDirtyChange?.(false)}},[]);
 useEffect(()=>{onDirtyChange?.(dirty||!!attempt)},[dirty,attempt,onDirtyChange]);
 useEffect(()=>{
  if(attempt)return;const seq=++version.current;setChecking(true);setPreview(undefined);setError('');
  const timer=setTimeout(()=>{void window.cbim.call('preview',{workspaceId:base.workspaceId,instanceId:base.instanceId,revision:base.revision,requestId:crypto.randomUUID(),changes:[{path,text:draft}]}).then((result:Preview)=>{if(alive.current&&version.current===seq)setPreview(result)}).catch(cause=>{if(alive.current&&version.current===seq)setError(cause.message)}).finally(()=>{if(alive.current&&version.current===seq)setChecking(false)})},350);
  return()=>{clearTimeout(timer);version.current++};
 },[draft,attempt]);
 async function save(){const selected=attempt??preview;if(!selected||saving)return;setAttempt(selected);setSaving(true);setError('');try{await window.cbim.call('commit',selected.request);onDirtyChange?.(false);onClose();await onSaved?.()}catch(cause){if(alive.current)setError(`提交或刷新未确认：${cause instanceof Error?cause.message:String(cause)}。保留原请求 ${selected.request.requestId}，请核实后使用原事务重试。`)}finally{if(alive.current)setSaving(false)}}
 return <div className="modal-backdrop"><section className="modal knowledge-file-editor" role="dialog" aria-label="编辑知识文件"><header><h2>编辑知识文件</h2><button disabled={saving} onClick={()=>{if(!dirty&&!attempt||confirm('保留已有提交事实，关闭并丢弃本机草稿？'))onClose()}}>关闭</button></header><code>{path}</code><textarea aria-label="知识文件正文" spellCheck={false} value={draft} disabled={!!attempt} onChange={event=>{version.current++;setPreview(undefined);setChecking(true);setDraft(event.target.value)}}/>
 <p role="status">{checking?'正在自动校验…':preview?.validation.structural?'结构校验通过':'结构校验未通过'}</p>{preview?.validation.issues.map((issue,index)=><p className="knowledge-file-warning" key={index}>{issue.path} · {issue.message}</p>)}{error&&<p role="alert">{error}</p>}
 {preview&&<details><summary>查看实际修改预览</summary><pre>{preview.diff}</pre></details>}<button disabled={saving||!attempt&&(!dirty||checking||!preview?.validation.structural)} onClick={()=>void save()}>{saving?'正在提交…':attempt?'使用原事务重试':'提交已校验修改'}</button>
 </section></div>;
}
