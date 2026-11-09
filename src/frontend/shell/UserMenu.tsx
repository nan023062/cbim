/**
 * 作用定位：本地账号菜单、主题与设置入口，以及合并的版本与更新入口、上次检查时间和新版绿点。
 * 设计原因：版本入口不依赖账号登录；菜单只转交显式动作，状态由外壳提供，关闭后将焦点交还稳定的账号按钮。
 */
import {useState,useRef,useEffect} from 'react';
import {Icon} from '../components/Icon';
import type {DesktopUpdateStatus} from '../../bridge/contracts/desktop-updates';
/** 合并入口只打开弹窗，检查/下载由弹窗明确触发；提醒取同一更新快照，不随菜单关闭而清除。 */
export function UserMenu({theme,toggleTheme,openSettings,updateStatus,openUpdates}:{theme:string;toggleTheme:()=>void;openSettings:()=>void;updateStatus?:DesktopUpdateStatus;openUpdates:()=>void}){
  const [open,setOpen]=useState(false),root=useRef<HTMLDivElement>(null),trigger=useRef<HTMLButtonElement>(null),first=useRef<HTMLButtonElement>(null);
  const available=!!updateStatus?.release&&updateStatus.enabled;
  useEffect(()=>{if(!open)return;first.current?.focus();const outside=(e:PointerEvent)=>{if(!root.current?.contains(e.target as Node))setOpen(false)};const escape=(e:KeyboardEvent)=>{if(e.key==='Escape'){setOpen(false);trigger.current?.focus()}};document.addEventListener('pointerdown',outside);document.addEventListener('keydown',escape);return()=>{document.removeEventListener('pointerdown',outside);document.removeEventListener('keydown',escape)}},[open]);
  return <div ref={root} className="user-menu-anchor" onBlur={e=>{if(!e.currentTarget.contains(e.relatedTarget as Node))setOpen(false)}}>
    {open&&<div className="user-menu" role="menu" aria-label="用户菜单" onKeyDown={e=>{if(['ArrowDown','ArrowUp','Home','End'].includes(e.key)){e.preventDefault();const items=Array.from(e.currentTarget.querySelectorAll<HTMLButtonElement>('[role="menuitem"]:not(:disabled)'));const i=items.indexOf(document.activeElement as HTMLButtonElement);items[e.key==='Home'?0:e.key==='End'?items.length-1:(i+(e.key==='ArrowDown'?1:-1)+items.length)%items.length]?.focus()}}}>
      <div className="user-menu-summary"><b>本地用户</b><small>未登录 · 账号登录尚未接入</small><small aria-label="当前版本">CBIM {updateStatus?`v${updateStatus.currentVersion}`:'· 正在读取版本…'}</small></div>
      <button ref={first} role="menuitem" onClick={()=>{setOpen(false);openSettings()}}><Icon name="settings" size={16}/>设置</button>
        <button role="menuitem" onClick={()=>{toggleTheme();setOpen(false);trigger.current?.focus()}}><Icon name={theme==='dark'?'sun':'moon'} size={16}/>{theme==='dark'?'切换浅色模式':'切换深色模式'}</button>
      <div role="separator" className="user-menu-separator"/>
      <button role="menuitem" aria-label="版本与更新" className={available?'user-menu-update available':'user-menu-update'} onClick={()=>{setOpen(false);trigger.current?.focus();openUpdates()}}><Icon name="arrow" size={16}/><span className="user-menu-update-copy"><span>版本与更新</span><small>{updateStatus?.checkedAt?'最近检查：'+new Date(updateStatus.checkedAt).toLocaleString():'尚未检查更新'}</small></span>{available&&<span className="user-menu-update-badge">新版 v{updateStatus!.release!.version}</span>}</button>
      <div role="separator" className="user-menu-separator"/>
      <button role="menuitem" disabled aria-disabled="true" title="账号登录尚未接入"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M9 5H5v14h4M9 12h12m-4-4 4 4-4 4"/></svg>退出登录</button>
    </div>}
    <div className="sidebar-footer"><button ref={trigger} className="user-profile-trigger" aria-label="用户菜单" aria-haspopup="menu" aria-expanded={open} onClick={()=>setOpen(x=>!x)}><span className="profile-badge">C{available&&<span className="user-update-dot" role="img" aria-label="有新版本可更新" title={'有新版本 v'+updateStatus!.release!.version}/>}</span><span className="user-profile-copy"><b>本地用户</b><small>CBIM · 未登录</small></span><span className="user-menu-chevron" aria-hidden="true">⌃</span></button><button className="icon-button" aria-label={theme==='dark'?'切换浅色模式':'切换深色模式'} onClick={toggleTheme}><Icon name={theme==='dark'?'sun':'moon'} size={17}/></button></div>
  </div>
}
