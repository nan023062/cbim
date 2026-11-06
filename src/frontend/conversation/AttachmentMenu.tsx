/**
 * 作用定位：Cindy 风格的加号上下文菜单，接入 CBIM 原生选择器与附件快照服务。
 * 设计原因：选择文件/目录与抓取网页均经主进程；链接器只引用已登记定义，不假装完成外部插件连接。
 */
import {useEffect,useRef,useState} from 'react';
import {Icon} from '../components/Icon';
import type {ChatAttachment} from '../../bridge/contracts/chat';
export function AttachmentMenu({workspaceId,disabled,onAdd,onBusy}:{workspaceId:string;disabled:boolean;onAdd:(items:ChatAttachment[])=>void;onBusy:(busy:boolean)=>void}){
  const [kind,setKind]=useState<'link'|'web'|'connector'>(),[value,setValue]=useState(''),[connectors,setConnectors]=useState<{id:string;name:string}[]>([]),[busy,setBusy]=useState(false),[error,setError]=useState('');
  const menu=useRef<HTMLDetailsElement>(null),lock=useRef(false);
  useEffect(()=>{const close=(e:PointerEvent)=>{if(!menu.current?.contains(e.target as Node))menu.current?.removeAttribute('open')};document.addEventListener('pointerdown',close);return()=>document.removeEventListener('pointerdown',close)},[]);
  async function run(fn:()=>Promise<ChatAttachment[]>){if(lock.current)return;lock.current=true;setBusy(true);onBusy(true);setError('');try{onAdd(await fn());setKind(undefined);setValue('');menu.current?.removeAttribute('open')}catch(e:any){setError(e.message)}finally{lock.current=false;setBusy(false);onBusy(false)}}
  function select(next:'link'|'web'|'connector'){setKind(next);setValue('');setError('');if(next==='connector')void window.cbim.call('chat.connectors',{id:workspaceId}).then(setConnectors).catch((e:Error)=>setError(e.message))}
  return <details ref={menu} className="chat-menu chat-add-menu" onKeyDown={e=>{if(e.key==='Escape')e.currentTarget.removeAttribute('open')}}><summary aria-label="添加上下文" title="添加文件、链接、网页、链接器或文件夹">＋</summary><div className="chat-menu-content"><div className="composer-menu-heading">添加到对话</div>
    <button disabled={disabled||busy} onClick={()=>void run(()=>window.cbim.call('chat.pick',{id:workspaceId,kind:'file'}))}><Icon name="knowledge" size={16}/>文件</button>
    <button disabled={disabled||busy} onClick={()=>void run(()=>window.cbim.call('chat.pick',{id:workspaceId,kind:'folder'}))}><Icon name="folder" size={16}/>文件夹</button>
    <button disabled={disabled||busy} onClick={()=>select('link')}><Icon name="plug" size={16}/>链接</button><button disabled={disabled||busy} onClick={()=>select('web')}><Icon name="search" size={16}/>网页</button><button disabled={disabled||busy} onClick={()=>select('connector')}><Icon name="plug" size={16}/>链接器</button>
    {kind&&<form className="chat-attach-form" onSubmit={e=>{e.preventDefault();void run(async()=>[await window.cbim.call('chat.attach',{id:workspaceId,attachment:{kind,value}})])}}>
      {kind==='connector'?<><label>已登记链接器<select aria-label="已登记链接器" value={value} onChange={e=>setValue(e.target.value)}><option value="">选择链接器</option>{connectors.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</select></label><small>引用链接器定义；外部插件调用能力尚未接入。</small></>:<label>{kind==='web'?'网页地址':'链接地址'}<input type="url" required aria-label={kind==='web'?'网页地址':'链接地址'} placeholder="https://…" value={value} onChange={e=>setValue(e.target.value)}/></label>}
      <button disabled={disabled||busy||!value} type="submit">{busy?'读取中…':'添加到对话'}</button>
    </form>}<div className="composer-menu-hint">可拖入文件或文件夹 · 最多 12 项</div>{busy&&<p role="status">正在准备附件…</p>}{error&&<p role="alert">{error}</p>}
  </div></details>;
}
