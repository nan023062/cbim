/**
 * 作用定位：团队与业务架构共用的语义对象编辑器，负责表单、删除影响预览和显式事务提交。
 * 设计原因：界面填写领域字段，不让用户手工拼目录/索引；固定打开时的知识版本，后端校验并保存计划，避免后台刷新覆盖草稿或跨版本误提交。
 * Agent 编辑独立选择内置引擎，再按协议从统一模型目录筛选，失效选型不能提交；删除不依赖模型配置仍然存在。
 * IPC 边界：动态架构表单先按对应IPC Schema核实；本地数据选择为封闭类别。
 */
import {checkedIpcCall} from '../../bridge/contracts/ipc-call';
import {useEffect,useRef,useState} from 'react';
import {EngineModelPicker} from '../components/EngineModelPicker';
import {engineSupportsApi,type LlmSettings,type AgentModelSelection} from '../../bridge/contracts/models';
import {createPortal} from 'react-dom';
import type {Snapshot,Preview} from '../../bridge/contracts/workspace';
import {moduleBodyTemplate} from '../../bridge/contracts/architecture';
import {teamGroupIds} from './static-owners';
import './architecture-editor.css';

export type EditableKind='agent'|'module'|'skill'|'workflow';
const labels:Record<EditableKind,string>={agent:'Agent',module:'模块',skill:'Skill',workflow:'Workflow'};
function read(snapshot:Snapshot,path:string){try{return JSON.parse(snapshot.files.find(file=>file.path===path)?.text??'{}')}catch{return {}}}
/** 读取自身定义及正文；继承 Skill 由调用者传原 owner 的 id，不把副本写到当前 Agent。 */
export function editableObject(snapshot:Snapshot,kind:EditableKind,id?:string){
  if(!id)return {data:{},body:''};
  if(kind==='agent'||kind==='module'){
    const data=read(snapshot,id+(kind==='agent'?'/agent.json':'/module.json'));
    return {data,body:snapshot.files.find(file=>file.path===id+'/'+(kind==='agent'?data.work_principles:data.overview))?.text??''};
  }
  const segment=kind==='skill'?'/skills/':'/workflows/',owner=id.slice(0,id.lastIndexOf(segment));
  const agent=snapshot.files.some(file=>file.path===owner+'/agent.json');
  const inventory=read(snapshot,owner+(kind==='workflow'?'/module.json':agent?'/agent.json':'/skills.json'));
  const reference=id.slice(owner.length+1)+(kind==='skill'?'/SKILL.md':'/workflow.md');
  return {data:(inventory[kind==='skill'?'skills':'workflows']??[]).find((item:any)=>item.reference===reference)??{},body:snapshot.files.find(file=>file.path===owner+'/'+reference)?.text??''};
}
// 与后端诊断共用结构；占位内容须由用户按实际业务填写。
const moduleScaffold=moduleBodyTemplate();
export interface ArchitectureEditorProps {workspaceId:string;snapshot:Snapshot;kind:EditableKind;id?:string;parentId?:string;mode?:'edit'|'delete';onClose:()=>void;onSaved:(objects:string[])=>void}
/** 删除始终先预览，级联必须单独勾选；不再登记真人或签署旧维护声明，岗位负责人通过独立入口配置。 */
export function ArchitectureEditor({workspaceId,snapshot,kind,id,parentId,mode='edit',onClose,onSaved}:ArchitectureEditorProps){
  const base=useRef(snapshot).current,initial=useRef(editableObject(base,kind,id)).current,removing=mode==='delete';
  const [owner,setOwner]=useState(parentId??(kind==='agent'?'.cbim/team':kind==='module'?'.cbim/workspace':''));
  const [slug,setSlug]=useState(''),[name,setName]=useState(initial.data.name??''),[summary,setSummary]=useState(initial.data.summary??'');
  const [body,setBody]=useState(initial.body||(kind==='module'?moduleScaffold:'')),[purpose,setPurpose]=useState(initial.data.purpose??'');
  const [capabilities,setCapabilities]=useState((initial.data.capabilities??[]).join('\n')),[limitations,setLimitations]=useState((initial.data.limitations??[]).join('\n'));
  const [sources,setSources]=useState<{location:string;scope:string}[]>(initial.data.sources??[]);
  const [models,setModels]=useState<LlmSettings>(),[runtime,setRuntime]=useState<AgentModelSelection|null>(initial.data.runtime??null);
  useEffect(()=>{if(kind!=='agent'||removing)return;let cancelled=false;void window.cbim.call('models.list').then(value=>{if(!cancelled)setModels(value)}).catch(cause=>{if(!cancelled)setError(cause.message)});return()=>{cancelled=true}},[kind,removing]);
  const [cascade,setCascade]=useState(false),[changed,setChanged]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState('');
  const [preview,setPreview]=useState<(Preview&{planId:string;objects:string[]})>();
  const lock=useRef(false),length=Array.from(summary.replace(/\s/g,'')).length;
  function edit(action:()=>void){action();setChanged(true);setPreview(undefined);setError('')}
  function close(){if(!busy&&(!changed||confirm('放弃尚未提交的修改？')))onClose()}
  const lines=(value:string)=>value.split('\n').map(item=>item.trim()).filter(Boolean);
  const moduleParents=['.cbim/workspace',...Object.keys(base.validation?.tree.nodes??{})];
  const teamParents=teamGroupIds(base);
  async function prepare(){
    if(lock.current)return;lock.current=true;setBusy(true);setError('');
    try{
      if(base.workspaceId!==workspaceId)throw Error('工作区身份已改变，请关闭后重新打开编辑器');
      if(!removing&&(kind==='agent'||kind==='module')&&(length<100||length>250))throw Error('摘要需要 100～250 个非空白字符，请具体描述职责、边界和适用场景');
      if(!removing&&kind==='agent'&&runtime&&!models?.profiles.some(p=>p.id===runtime.profileId&&engineSupportsApi(runtime.engine,p.api)&&p.models.some(m=>m.id===runtime.modelId&&m.enabled)))throw Error('所选引擎或模型不可用，请重新选择');
      const data=kind==='agent'?{name,summary,capabilities:lines(capabilities),limitations:lines(limitations),runtime}:kind==='module'?{summary,sources}:kind==='skill'?{name,purpose}:{name};
      const operation=removing?{kind,action:'delete',id,cascade}:{kind,action:id?'update':'create',...(id?{id}:{parentId:owner,slug}),data,body};
      const request={workspaceId,instanceId:base.instanceId,revision:base.revision,operations:[operation]};
      setPreview(await window.cbim.call(...checkedIpcCall('architecture.preview',request)));
    }catch(cause){setError(cause instanceof Error?cause.message:String(cause))}finally{lock.current=false;setBusy(false)}
  }
  async function commit(){
    if(!preview||lock.current)return;lock.current=true;setBusy(true);setError('');
    try{await window.cbim.call('architecture.commit',{workspaceId,instanceId:base.instanceId,planId:preview.planId});setChanged(false);onSaved(preview.objects)}
    catch(cause){setError(cause instanceof Error?cause.message:String(cause))}finally{lock.current=false;setBusy(false)}
  }
  return createPortal(<div className="modal-backdrop architecture-editor-backdrop"><form className="modal architecture-editor" role="dialog" aria-modal="true" aria-label={removing?'删除'+labels[kind]:(id?'编辑':'新建')+labels[kind]} onSubmit={event=>{event.preventDefault();void prepare()}}>
    <header><div><small>工作区知识 · {base.workspaceId.slice(0,8)}</small><h2>{removing?'删除':id?'编辑':'新建'}{labels[kind]}</h2></div><button type="button" disabled={busy} onClick={close}>关闭</button></header>
    {id&&<p className="architecture-object-id">{id}</p>}
    {removing?<><p>先检查删除范围与引用影响。仅删除正式知识，项目业务源码不会被删除；已有执行记录会保留。</p><label className="architecture-checkbox"><input type="checkbox" aria-label="同时删除下级知识" disabled={busy} checked={cascade} onChange={event=>edit(()=>setCascade(event.target.checked))}/>同时删除下级模块或所属方法（如有）</label></>:<fieldset disabled={busy} className="architecture-fields">
      {!id&&<><label>归属{kind==='module'?'工程 / 模块':'节点'}{kind==='agent'||kind==='module'?<select aria-label="归属节点" value={owner} onChange={event=>edit(()=>setOwner(event.target.value))}>{(kind==='module'?moduleParents:teamParents).map(value=><option key={value} value={value}>{value}</option>)}</select>:<input aria-label="归属节点" readOnly value={owner}/>}</label><label>目录标识<input autoFocus aria-label="目录标识" required pattern={kind==='module'||kind==='workflow'?'[a-z][a-z0-9]*(_[a-z0-9]+)*':'[a-z][a-z0-9]*([_-][a-z0-9]+)*'} placeholder="如 gameplay / developer / code_review" value={slug} onChange={event=>edit(()=>setSlug(event.target.value))}/><small>标识创建后保持固定；模块使用小写 snake_case。</small></label></>}
      {kind!=='module'&&<label>名称<input aria-label="对象名称" required value={name} onChange={event=>edit(()=>setName(event.target.value))}/></label>}
      {(kind==='agent'||kind==='module')&&<label>职责摘要<textarea aria-label="职责摘要" rows={3} required value={summary} onChange={event=>edit(()=>setSummary(event.target.value.replace(/[\r\n]/g,' ')))}/><small>{length} / 100～250 个非空白字符；描述职责、边界和适用场景。</small></label>}
      {kind==='agent'&&<><label>专业能力（每行一项）<textarea aria-label="专业能力" required rows={3} value={capabilities} onChange={event=>edit(()=>setCapabilities(event.target.value))}/></label><label>能力限制（每行一项）<textarea aria-label="能力限制" rows={2} value={limitations} onChange={event=>edit(()=>setLimitations(event.target.value))}/></label></>}
      {kind==='agent'&&<><EngineModelPicker models={models} value={runtime} onChange={value=>edit(()=>setRuntime(value))}/><small>新登记岗位采用此选型；已有岗位在岗位配置中独立修改或采纳。模型目录在设置中管理。</small></>}
      {kind==='skill'&&<label>适用目的<input aria-label="适用目的" required value={purpose} onChange={event=>edit(()=>setPurpose(event.target.value))}/></label>}
      {kind==='module'&&<><div className="architecture-sources"><b>业务源目录</b><small>可留空；目录应真实存在且位于项目内。</small>{sources.map((source,index)=><div className="architecture-source" key={index}><input aria-label={'源目录 '+(index+1)} placeholder="如 src/game" value={source.location} onChange={event=>edit(()=>setSources(old=>old.map((item,i)=>i===index?{...item,location:event.target.value}:item)))}/><input aria-label={'目录职责 '+(index+1)} placeholder="该目录的职责范围" value={source.scope} onChange={event=>edit(()=>setSources(old=>old.map((item,i)=>i===index?{...item,scope:event.target.value}:item)))}/><button type="button" aria-label={'移除源目录 '+(index+1)} onClick={()=>edit(()=>setSources(old=>old.filter((_,i)=>i!==index)))}>移除</button></div>)}<button type="button" onClick={()=>edit(()=>setSources(old=>[...old,{location:'',scope:''}]))}>添加源目录</button></div>
      </>}
      <label>{kind==='agent'?'工作原则':kind==='skill'?'Skill 正文':kind==='workflow'?'Workflow 正文':'模块知识正文'}<textarea className="architecture-body" aria-label="知识正文" required spellCheck={false} value={body} onChange={event=>edit(()=>setBody(event.target.value))}/></label>
      {kind==='module'&&!id&&<small>正文提供章节框架，请在提交前填写实际业务内容；结构校验不代替架构 review。</small>}
    </fieldset>}
    {error&&<p role="alert" className="error-text">{error}</p>}
    <div className="architecture-dialog-actions"><button type="submit" disabled={busy}>{busy?'正在处理…':removing?'预览删除影响':'校验并预览'}</button></div>
    {preview&&<section className="architecture-preview" aria-label="知识变更预览"><h3>{preview.validation.structural?'结构检查通过':'结构检查未通过'} · {preview.changes.length} 个文件</h3><ul>{preview.validation.issues.map((issue,index)=><li key={index} className={issue.severity==='error'?'error-text':''}>{issue.path} · {issue.message}</li>)}</ul><details open><summary>文件变化与引用影响</summary><pre>{preview.diff}</pre></details><button className="solid-button" type="button" disabled={busy||!preview.validation.structural} onClick={()=>void commit()}>{removing?'确认删除知识':'确认提交到工作区'}</button></section>}
  </form></div>,document.body);
}
