/**
 * 作用定位：三类资源共用的定义列表与编辑器；链接器页附带独立工作区仓库连接，人才包/完整业务架构有明确应用入口。
 * 设计原因：资源保存、应用和授权分离；静态包按目标快照预览提交，HTTP 连接由独立组件核验，旧文本不伪装成可执行链接器。
 */
import {useEffect,useRef,useState} from 'react';
import {resourceKinds,resourceCategories,type ResourceCategory,type ResourceKind,type ResourceDefinition,type ResourceLibrarySnapshot,type RepositoryStatus} from '../../bridge/contracts/resources';
import type {Snapshot,WorkspaceView} from '../../bridge/contracts/workspace';
import {WorkspaceResourceTransfer} from './WorkspaceResourceTransfer';
import {RepositoryConnections} from './RepositoryConnections';
import {applicableResourceKind,creatableResourceKinds,type ApplicableResourceKind} from './resource-application';

type Draft={id?:string;kind:ResourceKind;name:string;summary:string;content:string;repositoryId:string;revision:string};
const api=window.cbim;
export function ResourceRepositoryView({category,onSettings}:{category:ResourceCategory;onSettings:()=>void}){
  const meta=resourceCategories[category],kinds=(Object.keys(resourceKinds) as ResourceKind[]).filter(k=>resourceKinds[k].category===category);
  const createKinds=creatableResourceKinds(category);
  const [status,setStatus]=useState<RepositoryStatus>(),[data,setData]=useState<ResourceLibrarySnapshot>(),[error,setError]=useState(''),[busy,setBusy]=useState(false);
  const [filter,setFilter]=useState<ResourceKind|'all'>('all'),[query,setQuery]=useState(''),[draft,setDraft]=useState<Draft>(),[dirty,setDirty]=useState(false);
  const [apply,setApply]=useState<{item:ResourceDefinition;kind:ApplicableResourceKind;entries:WorkspaceView[];targetId:string}>();
  const [transfer,setTransfer]=useState<{resourceId:string;kind:ApplicableResourceKind;snapshot:Snapshot;workspaceId:string}>();
  const alive=useRef(true),targetRequest=useRef(0);
  async function refresh(){setBusy(true);try{const s:RepositoryStatus=await api.call('resources.status');const library=s.config?await api.call('resources.list'):undefined;if(alive.current){setStatus(s);setData(library);setError(s.error||'')}}catch(e:any){if(alive.current){setData(undefined);setError(e.message)}}finally{if(alive.current)setBusy(false)}}
  useEffect(()=>{alive.current=true;void refresh();return()=>{alive.current=false;targetRequest.current++}},[]);
  useEffect(()=>{targetRequest.current++;setFilter('all');setQuery('');setDraft(undefined);setDirty(false);setApply(undefined);setTransfer(undefined);setError('');setBusy(false)},[category]);
  function edit(item?:ResourceDefinition,copy=false){if(!data||(copy&&item&&!createKinds.includes(item.kind)))return;setDirty(false);setDraft({id:copy?undefined:item?.id,kind:item?.kind||createKinds[0],name:item?(copy?item.name+' 副本':item.name):'',summary:item?.summary||'',content:item?.content||'',repositoryId:data.repositoryId,revision:data.revision})}
  /** 选择目标只读取登记清单与该工作区快照；不切换全局选中项、不自动创建成员实例。 */
  async function chooseWorkspace(item:ResourceDefinition){
    const kind=applicableResourceKind(item);if(!kind)return;
    const request=++targetRequest.current;setBusy(true);setError('');
    try{const list:{entries:WorkspaceView[]}=await api.call('list');if(alive.current&&targetRequest.current===request)setApply({item,kind,entries:list.entries,targetId:list.entries.find(entry=>entry.state==='running')?.id??''})}
    catch(cause){if(alive.current&&targetRequest.current===request)setError(cause instanceof Error?cause.message:String(cause))}
    finally{if(alive.current&&targetRequest.current===request)setBusy(false)}
  }
  async function continueApply(){
    if(!apply?.targetId||busy)return;const selected=apply,request=++targetRequest.current;setBusy(true);setError('');
    try{const snapshot:Snapshot=await api.call('snapshot',{id:selected.targetId});if(!alive.current||targetRequest.current!==request)return;if(snapshot.workspaceId!==selected.targetId)throw Error('工作区身份已改变，请重新选择目标');setTransfer({workspaceId:selected.targetId,snapshot,resourceId:selected.item.id,kind:selected.kind});setApply(undefined)}
    catch(cause){if(alive.current&&targetRequest.current===request)setError(cause instanceof Error?cause.message:String(cause))}
    finally{if(alive.current&&targetRequest.current===request)setBusy(false)}
  }
  async function save(){if(!draft)return;setBusy(true);setError('');try{const {repositoryId,revision,id,...item}=draft;setData(await api.call('resources.save',{repositoryId,revision,...(id?{id}:{}),item}));setDraft(undefined);setDirty(false)}catch(e:any){setError(e.message)}finally{setBusy(false)}}
  async function remove(item:ResourceDefinition){if(!data||!confirm(`从当前仓库删除「${item.name}」？已存在的工作区知识不会被修改。`))return;setBusy(true);try{setData(await api.call('resources.remove',{repositoryId:data.repositoryId,revision:data.revision,id:item.id}));setError('')}catch(e:any){setError(e.message)}finally{setBusy(false)}}
  const items=(data?.items||[]).filter(i=>kinds.includes(i.kind)&&(filter==='all'||i.kind===filter)&&`${i.name} ${i.summary}`.toLowerCase().includes(query.toLowerCase()));
  // 静态包有指纹与引用关系，正文在工作区语义编辑器中定制后重新发布；这里仅维护仓库展示信息。
  const packagedDraft=draft&&applicableResourceKind({kind:draft.kind,content:draft.content});
  return <div className="view-page resource-library"><div className="view-heading"><div><p className="overline">CBIM / 团队资源仓库</p><h1>{meta.label}</h1><p>{meta.description}</p></div><button className="solid-button" disabled={!data||busy} onClick={()=>edit()}>新建自定义资源</button></div>
    <div className="repository-bar"><div><b>{status?.source==='server'?'服务器仓库':status?.config?'本地仓库（未登录）':'本地仓库未配置'}</b><small>{status?.config?.location||'未登录时请在设置中选择本地目录'}</small></div><button disabled={busy} onClick={onSettings}>前往设置</button>{status?.config&&<button disabled={busy} onClick={()=>void refresh()}>刷新资源</button>}</div>
    {error&&<div className="shell-alert" role="alert">{error}</div>}
    <p className="inline-note">链接器、人才市场、业务模板共用一个资源仓库。未登录时使用本地目录，登录后统一自动切换到账号服务器仓库。</p>
    {category==='connectors'&&<RepositoryConnections onSettings={onSettings}/>}
    <div className="resource-kind-overview">{kinds.map(k=><button key={k} className={filter===k?'active':''} onClick={()=>setFilter(f=>f===k?'all':k)}><b>{resourceKinds[k].label}</b><small>{resourceKinds[k].description}</small></button>)}</div>
    <div className="inline-note">{category==='connectors'?'下面是可定制的静态文本资源，保存不安装或运行外部工具。上方的工作区仓库连接独立登记与授权。':category==='templates'?'完整业务架构资源包可选择目标工作区，预览后整体应用。旧单模块与 Workflow 文本资源仅保留浏览编辑。':'静态团队、Agent 和 Skill 资源包可选择目标工作区，预览后应用；不会创建运行实例或启动任务。'}旧文本定义不会自动转成可应用资源包。</div>
    {status?.config&&<div className="graph-toolbar"><input aria-label="搜索自定义资源" placeholder="搜索名称或说明…" value={query} onChange={e=>setQuery(e.target.value)}/><span className="subtle-badge">{items.length} 项资源</span></div>}
    {!status?.config?<div className="view-empty"><h2>{status?.source==='server'?'服务器仓库待接入':'先设置本地仓库'}</h2><p>账号登录尚未接入，当前可使用本地文件夹保存资源。</p></div>:!data?<div className="view-empty"><h2>{busy?'正在加载仓库':'仓库暂不可用'}</h2><p>请检查设置并重新连接。</p></div>:!items.length?<div className="view-empty"><h2>{query?'没有匹配的资源':'仓库中还没有此类资源'}</h2><p>{category==='connectors'?'从团队需要的能力开始定制。':'从工作区的团队或业务架构页发布静态定义，即可在这里复用。'}</p></div>:<div className="definition-grid">{items.map(i=><article className="definition-card" key={i.id}><span className="subtle-badge">{resourceKinds[i.kind].label}</span><h3>{i.name}</h3><p>{i.summary||'暂无说明'}</p><small>{applicableResourceKind(i)?'静态资源包 · 应用前需预览':'文本定义 · 仅浏览编辑'}</small><div className="resource-actions">{applicableResourceKind(i)&&<button disabled={busy} onClick={()=>void chooseWorkspace(i)}>应用到工作区</button>}<button disabled={busy} onClick={()=>edit(i)}>编辑</button>{createKinds.includes(i.kind)&&<button disabled={busy} onClick={()=>edit(i,true)}>复制定制</button>}<button disabled={busy} onClick={()=>void remove(i)}>删除</button></div></article>)}</div>}
    {draft&&<div className="modal-backdrop resource-modal-backdrop"><form role="dialog" aria-modal="true" aria-label="自定义资源编辑器" className="modal resource-editor" onSubmit={e=>{e.preventDefault();void save()}}><header><h2>{draft.id?'编辑自定义资源':'新建自定义资源'}</h2><button type="button" disabled={busy} onClick={()=>{if(!dirty||confirm('放弃尚未保存的资源修改？'))setDraft(undefined)}}>关闭</button></header><label>资源类型<select aria-label="资源类型" disabled={busy||!!draft.id} value={draft.kind} onChange={e=>{setDraft({...draft,kind:e.target.value as ResourceKind});setDirty(true)}}>{(draft.id?[draft.kind]:createKinds).map(k=><option key={k} value={k}>{resourceKinds[k].label}</option>)}</select></label><label>名称<input autoFocus aria-label="资源名称" disabled={busy} required maxLength={100} value={draft.name} onChange={e=>{setDraft({...draft,name:e.target.value});setDirty(true)}}/></label><label>说明<input aria-label="资源说明" disabled={busy} maxLength={1000} value={draft.summary} onChange={e=>{setDraft({...draft,summary:e.target.value});setDirty(true)}}/></label><label>定义内容<textarea aria-label="资源定义" disabled={busy} required readOnly={!!packagedDraft} maxLength={2*1024*1024} spellCheck={false} placeholder="填写 Markdown / JSON 定义，不要保存账号密码或令牌。" value={draft.content} onChange={e=>{setDraft({...draft,content:e.target.value});setDirty(true)}}/></label><p>保存到当前{status?.config?.mode==='local'?'本地仓库':'远端仓库'}，不会改写工作区知识。{packagedDraft?'包正文只读；需定制时先应用到工作区，在架构页编辑后重新发布。':'可应用资源包请从工作区架构页发布。'}</p>{error&&<p role="alert" className="error-text">{error}</p>}<button className="solid-button" type="submit" disabled={busy||!draft.name.trim()||!draft.content.trim()}>{busy?'正在保存…':'保存定义'}</button></form></div>}
    {apply&&<div className="modal-backdrop resource-modal-backdrop"><form className="modal resource-editor" role="dialog" aria-modal="true" aria-label="选择应用目标工作区" onSubmit={event=>{event.preventDefault();void continueApply()}}><header><h2>选择目标工作区</h2><button type="button" disabled={busy} onClick={()=>{targetRequest.current++;setApply(undefined);setError('')}}>关闭</button></header><p>将「{apply.item.name}」的静态定义应用到选定项目。下一步先审阅归属和变更，不会立即写入或启动成员。</p><label>目标工作区<select aria-label="应用目标工作区" disabled={busy} value={apply.targetId} onChange={event=>setApply({...apply,targetId:event.target.value})}><option value="">请选择已打开的工作区</option>{apply.entries.map(entry=><option key={entry.id} value={entry.id} disabled={entry.state!=='running'}>{entry.name}{entry.state==='running'?'':' · 尚未就绪'}</option>)}</select></label>{!apply.entries.some(entry=>entry.state==='running')&&<p>暂无已就绪的工作区。请先在侧边栏打开目标项目，再回来应用资源。</p>}{error&&<p role="alert" className="error-text">{error}</p>}<button className="solid-button" type="submit" disabled={busy||!apply.targetId}>{busy?'正在读取目标知识…':'继续并预览'}</button></form></div>}
    {transfer&&<WorkspaceResourceTransfer key={transfer.workspaceId+':'+transfer.resourceId} mode="import" {...transfer} category={transfer.kind==='architecture'?'templates':'talent'} onClose={()=>setTransfer(undefined)}/>}
  </div>
}
