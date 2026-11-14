/**
 * 作用定位：侧栏与历史菜单共用的对话条目、重命名和移除入口。
 * 设计原因：主条目始终可见，已登记子 Session 以可直接选择的角色名按钮展示；这里只提交查看选择，不创建、删除子会话或改变执行。
 */
import {useState} from 'react';
import {Icon} from '../components/Icon';
import './conversation-entries.css';
/** id 是本机条目身份，运行态是即时观察，不写入布局持久化。 */
export interface ConversationEntry {id:string;title:string;running?:boolean;children?:{id:string;title:string;running?:boolean}[]}
/** 点击条目仅提交原主条目/成员身份；缺少成员选择回调或页面忙碌时禁用，不在本组件切换模式或启动运行。 */
export function ConversationEntries({items,selected,selectedChild,disabled=false,onSelect,onSelectChild,onRename,onRemove}:{items:ConversationEntry[];selected?:string;selectedChild?:string;disabled?:boolean;onSelect:(id:string)=>void;onSelectChild?:(id:string,childId:string)=>void;onRename:(id:string,title:string)=>void;onRemove:(id:string)=>void}){
  const [editing,setEditing]=useState(''),[name,setName]=useState('');
  return <div className="conversation-entries">{items.map(item=><div className="conversation-entry-group" key={item.id}><div className="conversation-entry" data-entry-id={item.id}>
    {editing===item.id?<form className="conversation-rename" onSubmit={event=>{event.preventDefault();if(name.trim()){onRename(item.id,name.trim());setEditing('')}}}>
      <input autoFocus aria-label="对话名称" maxLength={60} value={name} onChange={event=>setName(event.target.value)} onKeyDown={event=>{if(event.key==='Escape'){event.preventDefault();event.stopPropagation();setEditing('')}}}/>
      <button disabled={disabled||!name.trim()}>保存</button><button type="button" onClick={()=>setEditing('')}>取消</button>
    </form>:<><button className={'conversation-entry-select'+(selected===item.id&&!selectedChild?' active':'')} aria-current={selected===item.id&&!selectedChild?'page':undefined} title={item.title} aria-label={item.title} disabled={disabled} onClick={()=>onSelect(item.id)}>
      <span className={'conversation-entry-icon'+(item.running?' running':'')} role={item.running?'status':undefined} aria-label={item.running?'对话正在运行':undefined}><Icon name="chat" size={14}/></span><span>{item.title}</span>
    </button><div className="conversation-entry-actions"><button className="icon-button" disabled={disabled} aria-label={'重命名对话 '+item.title} title="重命名对话" onClick={()=>{setName(item.title);setEditing(item.id)}}><Icon name="edit" size={13}/></button><button className="icon-button" disabled={disabled} aria-label={'删除对话 '+item.title} title="从列表删除；执行记录保留，后台任务不会停止" onClick={()=>onRemove(item.id)}><Icon name="close" size={13}/></button></div></>}
  </div>{item.children?.map(child=><button className="conversation-child" type="button" key={child.id} title={child.title} aria-label={child.title} disabled={disabled||!onSelectChild} aria-current={selected===item.id&&selectedChild===child.id?'page':undefined} onClick={()=>onSelectChild?.(item.id,child.id)}><span className={'conversation-entry-icon'+(child.running?' running':'')} aria-label={child.running?'成员正在执行':'成员当前空闲'}><Icon name="team" size={13}/></span><span>{child.title}</span></button>)}</div>)}</div>;
}
