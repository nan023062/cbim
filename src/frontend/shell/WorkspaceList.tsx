/**
 * 作用定位：左侧工作区树及其对话列表，承载新对话、项目重命名和移除入口。
 * 设计原因：项目行与操作按钮分离，避免嵌套按钮；对话属于工作区，不再占用顶部视图页签。
 */
import {useState} from 'react';
import type {WorkspaceView} from '../../bridge/contracts/workspace';
import type {Layouts,ViewTab} from './tabs';
import {Icon} from '../components/Icon';
import {McpSummary} from '../diagnostics/McpStatus';
import {stateLabels} from './state-labels';
import './workspace-list.css';
export function WorkspaceList({workspaces,layouts,selected,onSelect,onChat,onNew,onRename,onRemove,busy}:{workspaces:WorkspaceView[];layouts:Layouts;selected:string;onSelect:(id:string)=>void;onChat:(id:string,tab:ViewTab)=>void;onNew:(id:string)=>void;onRename:(id:string,name:string)=>Promise<void>;onRemove:(id:string)=>Promise<void>;busy:boolean}){
 const [menu,setMenu]=useState(''),[editing,setEditing]=useState(''),[name,setName]=useState(''),[removing,setRemoving]=useState(''),[collapsed,setCollapsed]=useState<string[]>([]);
 return <>{workspaces.map(w=><section className="workspace-group" key={w.id}>
  <div className={'workspace-row '+(selected===w.id?'selected':'')}>
   <button title={w.path} aria-label={`${w.name} · ${stateLabels[w.state]||w.state}`} aria-current={selected===w.id?'page':undefined} className="workspace-item" onClick={()=>{onSelect(w.id);setCollapsed(old=>old.filter(id=>id!==w.id))}}><Icon name="folder" size={17}/><span>{w.name}<small>{w.knowledgeErrors?`知识校验：${w.knowledgeErrors} 条错误`:w.error?'工作区读取异常':''}</small><McpSummary workspace={w}/></span></button>
   <div className="workspace-row-actions"><button className="icon-button" aria-label={'更多操作 '+w.name} aria-expanded={menu===w.id} onClick={()=>setMenu(menu===w.id?'':w.id)}>···</button><button className="icon-button" aria-label={'新对话 '+w.name} title="在此工作区新建对话" disabled={busy} onClick={()=>{setCollapsed(old=>old.filter(id=>id!==w.id));onNew(w.id)}}><Icon name="plus" size={16}/></button><button className="icon-button" aria-label={'展开或收起 '+w.name} aria-expanded={!collapsed.includes(w.id)} onClick={()=>setCollapsed(old=>old.includes(w.id)?old.filter(id=>id!==w.id):[...old,w.id])}>⌄</button></div>
  </div>
  {menu===w.id&&<div className="workspace-more" role="menu" aria-label={w.name+' 更多操作'} onKeyDown={e=>{if(e.key==='Escape')setMenu('')}}><button role="menuitem" onClick={()=>{setName(w.name);setEditing(w.id);setMenu('')}}>重命名项目</button><button role="menuitem" onClick={()=>{setRemoving(w.id);setMenu('')}}>移除项目</button><button role="menuitem" disabled>其它操作（预留）</button><button role="menuitem" onClick={()=>setMenu('')}>关闭菜单</button></div>}
  {editing===w.id&&<form className="workspace-inline-form" onSubmit={async e=>{e.preventDefault();await onRename(w.id,name);setEditing('')}}><input aria-label="项目名称" autoFocus maxLength={80} value={name} onChange={e=>setName(e.target.value)}/><button disabled={busy||!name.trim()}>保存名称</button><button type="button" onClick={()=>setEditing('')}>取消</button></form>}
  {removing===w.id&&<div className="workspace-inline-form"><p>移除此项目登记并停止其任务和服务？项目文件与对话历史保留。</p><button disabled={busy} onClick={async()=>{await onRemove(w.id);setRemoving('')}}>确认移除</button><button onClick={()=>setRemoving('')}>取消</button></div>}
  {!collapsed.includes(w.id)&&<div className="workspace-conversations" aria-label={w.name+' 的对话'}>{layouts[w.id]?.tabs.filter(t=>t.kind==='chat').map(t=><button key={t.id} className={selected===w.id&&layouts[w.id].active===t.id?'active':''} aria-current={selected===w.id&&layouts[w.id].active===t.id?'page':undefined} title={t.title} onClick={()=>onChat(w.id,t)}><Icon name="chat" size={14}/><span>{t.title==='对话'?'新对话':t.title}</span></button>)}</div>}
 </section>)}</>;
}
