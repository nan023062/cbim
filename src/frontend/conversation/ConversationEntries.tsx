/**
 * 作用定位：侧栏与历史菜单共用的对话条目、重命名和移除入口。
 * 设计原因：两处展示共用上层本机布局；这里只提交条目选择，不修改运行日志或停止后台任务，运行灯由真实运行索引提供。
 */
import {useState} from 'react';
import {Icon} from '../components/Icon';
import './conversation-entries.css';
/** id 是本机条目身份，运行态是即时观察，不写入布局持久化。 */
export interface ConversationEntry {id:string;title:string;running?:boolean}
export function ConversationEntries({items,selected,disabled=false,onSelect,onRename,onRemove}:{items:ConversationEntry[];selected?:string;disabled?:boolean;onSelect:(id:string)=>void;onRename:(id:string,title:string)=>void;onRemove:(id:string)=>void}){
  const [editing,setEditing]=useState(''),[name,setName]=useState('');
  return <div className="conversation-entries">{items.map(item=><div className="conversation-entry" key={item.id} data-entry-id={item.id}>
    {editing===item.id?<form className="conversation-rename" onSubmit={event=>{event.preventDefault();if(name.trim()){onRename(item.id,name.trim());setEditing('')}}}>
      <input autoFocus aria-label="对话名称" maxLength={60} value={name} onChange={event=>setName(event.target.value)} onKeyDown={event=>{if(event.key==='Escape'){event.preventDefault();event.stopPropagation();setEditing('')}}}/>
      <button disabled={disabled||!name.trim()}>保存</button><button type="button" onClick={()=>setEditing('')}>取消</button>
    </form>:<><button className={'conversation-entry-select'+(selected===item.id?' active':'')} aria-current={selected===item.id?'page':undefined} title={item.title} aria-label={item.title} disabled={disabled} onClick={()=>onSelect(item.id)}>
      <span className={'conversation-entry-icon'+(item.running?' running':'')} role={item.running?'status':undefined} aria-label={item.running?'对话正在运行':undefined}><Icon name="chat" size={14}/></span><span>{item.title}</span>
    </button><div className="conversation-entry-actions"><button className="icon-button" disabled={disabled} aria-label={'重命名对话 '+item.title} title="重命名对话" onClick={()=>{setName(item.title);setEditing(item.id)}}><Icon name="edit" size={13}/></button><button className="icon-button" disabled={disabled} aria-label={'删除对话 '+item.title} title="从列表删除；执行记录保留，后台任务不会停止" onClick={()=>onRemove(item.id)}><Icon name="close" size={13}/></button></div></>}
  </div>)}</div>;
}
