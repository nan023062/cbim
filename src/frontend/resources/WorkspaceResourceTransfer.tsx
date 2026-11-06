/**
 * 作用定位：静态团队能力与完整业务架构在当前工作区和共用仓库之间的发布、下载及应用界面。
 * 设计原因：人才按 team/agent/skill 复用，业务只按整套架构应用；冻结目标知识版本与源仓库版本，替换必须显式选择并审阅后端预览。
 */
import {useEffect,useRef,useState} from 'react';
import {createPortal} from 'react-dom';
import type {Snapshot,Preview} from '../../bridge/contracts/workspace';
import {resourceKinds,type ResourceLibrarySnapshot,type RepositoryStatus} from '../../bridge/contracts/resources';
import {teamGroupIds} from '../knowledge/static-owners';
import {applicableResourceKind} from './resource-application';
import '../knowledge/architecture-editor.css';
import './workspace-transfer.css';

type PackageKind='team'|'agent'|'skill'|'architecture';
type ImportPreview=Preview&{planId:string;kind:PackageKind;mode:'add'|'replace';targetRoot:string;files:{path:string;action:string}[];warnings:string[];removedBindings:string[]};
export interface WorkspaceResourceTransferProps {workspaceId:string;snapshot:Snapshot;mode:'publish'|'import';kind?:PackageKind;objectId?:string;targetParentId?:string;category?:'talent'|'templates';resourceId?:string;onClose:()=>void;onApplied?:()=>void}
/** 仓库是本地或已连接的服务器来源；“发布”只保存静态资源包，不启动 Agent 或安装链接器。 */
export function WorkspaceResourceTransfer({workspaceId,snapshot,mode,kind,objectId,targetParentId,category='talent',resourceId,onClose,onApplied}:WorkspaceResourceTransferProps){
  const base=useRef(snapshot).current;
  const [status,setStatus]=useState<RepositoryStatus>(),[library,setLibrary]=useState<ResourceLibrarySnapshot>(),[busy,setBusy]=useState(false),[error,setError]=useState('');
  const [selected,setSelected]=useState(resourceId??''),[name,setName]=useState(kind==='architecture'?'业务架构':kind==='team'?'团队定义':objectId?.split('/').at(-1)??''),[summary,setSummary]=useState('');
  const [parent,setParent]=useState(targetParentId??'.cbim/team'),[slug,setSlug]=useState(''),[replace,setReplace]=useState(false),[preview,setPreview]=useState<ImportPreview>(),[result,setResult]=useState<{message:string;warnings:string[];removedBindings:string[]}>();
  const lock=useRef(false),alive=useRef(true);
  useEffect(()=>{alive.current=true;void load();return()=>{alive.current=false}},[]);
  async function load(){setBusy(true);setError('');try{const current:RepositoryStatus=await window.cbim.call('resources.status');if(!alive.current)return;setStatus(current);const value=current.config?await window.cbim.call('resources.list'):undefined;if(alive.current){setLibrary(value);setPreview(undefined);setError(current.error??'')}}catch(cause){if(alive.current)setError(cause instanceof Error?cause.message:String(cause))}finally{if(alive.current)setBusy(false)}}
  const eligible=(library?.items??[]).filter(item=>applicableResourceKind(item)).filter(item=>category==='templates'||kind==='architecture'?item.kind==='architecture':['team','agent','skill'].includes(item.kind)).filter(item=>!kind||item.kind===kind);
  const item=eligible.find(item=>item.id===selected),selectedKind=item?.kind as PackageKind|undefined;
  const whole=selectedKind==='team'||selectedKind==='architecture';
  const groups=teamGroupIds(base);
  const agentOwners=base.files.filter(file=>file.path.startsWith('.cbim/team/')&&file.path.endsWith('/agent.json')).map(file=>file.path.slice(0,-11));
  const parents=selectedKind==='skill'?[...groups,...agentOwners]:groups;
  function change(action:()=>void){action();setPreview(undefined);setError('')}
  async function perform(action:()=>Promise<void>){if(lock.current)return;lock.current=true;setBusy(true);setError('');try{if(base.workspaceId!==workspaceId)throw Error('工作区身份已改变，请重新打开资源操作');await action()}catch(cause){if(alive.current)setError(cause instanceof Error?cause.message:String(cause))}finally{lock.current=false;if(alive.current)setBusy(false)}}
  const identity={workspaceId,instanceId:base.instanceId,revision:base.revision};
  async function publish(){if(!library||!kind)return;await perform(async()=>{const receipt=await window.cbim.call('resources.publishWorkspace',{...identity,repositoryId:library.repositoryId,repositoryRevision:library.revision,kind,...(objectId?{objectId}:{}),name,summary});if(alive.current){setLibrary(receipt.repository);setResult({message:'静态定义已发布到当前仓库。',warnings:receipt.warnings??[],removedBindings:receipt.removedBindings??[]})}})}
  async function prepare(){if(!library||!item)return;await perform(async()=>{const receipt:ImportPreview=await window.cbim.call('resources.importPreview',{...identity,repositoryId:library.repositoryId,repositoryRevision:library.revision,resourceId:item.id,mode:whole&&replace?'replace':'add',...(selectedKind!=='architecture'&&!(selectedKind==='team'&&replace)?{targetParentId:parent,slug}: {})});if(alive.current)setPreview(receipt)})}
  async function commit(){if(!preview)return;await perform(async()=>{await window.cbim.call('resources.importCommit',{workspaceId,instanceId:base.instanceId,planId:preview.planId});if(alive.current){setResult({message:'资源包已应用到此工作区。',warnings:preview.warnings,removedBindings:preview.removedBindings});setPreview(undefined);onApplied?.()}})}
  return createPortal(<div className="modal-backdrop architecture-editor-backdrop"><section className="modal architecture-editor workspace-transfer" role="dialog" aria-modal="true" aria-label={mode==='publish'?'发布静态资源':'使用仓库资源'}><header><div><small>{mode==='publish'?'分享静态定义':'下载并应用静态定义'}</small><h2>{mode==='publish'?kind==='architecture'?'发布完整业务架构':'发布到人才市场':category==='templates'||kind==='architecture'?'使用业务模板':'从人才市场添加'}</h2></div><button disabled={busy} onClick={onClose}>关闭</button></header>
    <p className="transfer-source">{status?.source==='server'?'账号服务器仓库':'本地仓库'} · {status?.config?.location??'尚未配置'}</p>
    {error&&<p role="alert" className="error-text">{error}</p>}
    {!status?.config?<p>请先在左下角用户栏的“设置”中选择本地仓库。账号服务器来源需等待登录服务接入。</p>:!library?<button disabled={busy} onClick={()=>void load()}>重新读取仓库</button>:result?<section className="transfer-result" role="status"><h3>{result.message}</h3><p>只改变静态定义，不启动成员或任务。</p>{result.warnings.map((warning,index)=><p key={index}>{warning}</p>)}{!!result.removedBindings.length&&<details><summary>已移除的项目绑定（{result.removedBindings.length}）</summary><ul>{result.removedBindings.map((binding,index)=><li key={index}>{binding}</li>)}</ul></details>}<button className="solid-button" onClick={onClose}>完成</button></section>:mode==='publish'?<form onSubmit={event=>{event.preventDefault();void publish()}}><fieldset className="architecture-fields" disabled={busy}><p>{kind==='architecture'?'发布当前完整业务架构及其模块、Workflow，不能拆成单个模块应用。':'发布所选团队、Agent 或 Skill 的静态能力定义，可在其他项目复用。'}</p><p>不包含实例、任务、会话或登录信息；项目人员、维护关系和工具绑定会移除。原项目知识保持不变。</p><label>资源名称<input aria-label="发布资源名称" required maxLength={100} value={name} onChange={event=>setName(event.target.value)}/></label><label>资源说明<textarea aria-label="发布资源说明" maxLength={1000} value={summary} onChange={event=>setSummary(event.target.value)}/></label></fieldset><button className="solid-button" disabled={busy||!name.trim()}>{busy?'正在发布…':'确认发布到当前仓库'}</button></form>:<>
      <div className="transfer-resource-list" role="list" aria-label="可用静态资源">{eligible.map(resource=><button key={resource.id} disabled={busy} className={selected===resource.id?'selected':''} onClick={()=>change(()=>{setSelected(resource.id);setReplace(false);if(resource.kind!=='skill'&&agentOwners.includes(parent))setParent('.cbim/team')})}><span>{resourceKinds[resource.kind].label}</span><b>{resource.name}</b><small>{resource.summary||'暂无说明'}</small></button>)}{!eligible.length&&<p>仓库暂无可用{category==='templates'?'完整业务架构':'人才'}资源。先从已有项目的架构页发布静态定义。</p>}</div>
      {item&&<form onSubmit={event=>{event.preventDefault();void prepare()}}><fieldset disabled={busy} className="architecture-fields">
        {whole&&<label className="architecture-checkbox"><input type="checkbox" aria-label="替换整个静态架构" checked={replace} onChange={event=>change(()=>setReplace(event.target.checked))}/>{selectedKind==='architecture'?'替换当前整个业务架构':'替换当前整个团队定义'}</label>}
        {selectedKind==='architecture'?<p>始终应用完整业务架构。目标已有模块时必须明确选择替换，预览将列出全部删除与新增；不删除项目业务源码。应用后需要重新指定维护人和源目录。</p>:selectedKind==='team'&&replace?<p>整体替换当前 Team、组、Agent 与 Skill，真人花名册保留。请仔细核对变更清单。</p>:<><label>目标归属<select aria-label="资源目标归属" value={parent} onChange={event=>change(()=>setParent(event.target.value))}>{parents.map(value=><option key={value} value={value}>{value}</option>)}</select></label><label>新目录标识<input aria-label="资源目录标识" required pattern="[a-z][a-z0-9]*([_-][a-z0-9]+)*" value={slug} onChange={event=>change(()=>setSlug(event.target.value))}/><small>{selectedKind==='team'?'整个团队作为一个完整子组加入。':'新增到目标节点；同名知识不会被覆盖。'}</small></label></>}
      </fieldset><button disabled={busy}>{busy?'正在处理…':'预览应用到工作区'}</button><button type="button" disabled={busy} onClick={()=>void load()}>刷新仓库</button></form>}
      {preview&&<section className="architecture-preview" aria-label="资源应用预览"><h3>{preview.validation.structural?'结构检查通过':'结构检查未通过'} · {preview.files.length} 个文件</h3><p>{preview.targetRoot}</p>{preview.warnings.map((warning,index)=><p key={index}>{warning}</p>)}<ul>{preview.validation.issues.map((issue,index)=><li key={index} className={issue.severity==='error'?'error-text':''}>{issue.path} · {issue.message}</li>)}</ul><details open><summary>完整变更预览</summary><pre>{preview.diff}</pre></details><button className="solid-button" disabled={busy||!preview.validation.structural} onClick={()=>void commit()}>确认应用到此工作区</button></section>}
    </>}
  </section></div>,document.body);
}
