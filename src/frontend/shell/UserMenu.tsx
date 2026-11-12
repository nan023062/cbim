/**
 * 作用定位：本地账号、主题与设置菜单；用户栏右侧装配独立的版本更新图标。
 * 设计原因：主题只保留菜单入口，版本进度常驻原主题按钮位置；更新状态仍由外壳统一持有。
 */
import {useState,useRef,useEffect} from 'react';
import {Icon} from '../components/Icon';
import {SoftwareUpdateButton} from '../updates/SoftwareUpdateButton';
import type {SoftwareUpdateController} from '../updates/useSoftwareUpdates';
/** 菜单不再提供更新项；常驻图标仅在就绪时安装，悬停或聚焦只读取共享状态。 */
export function UserMenu({theme,toggleTheme,openSettings,updates}:{theme:string;toggleTheme:()=>void;openSettings:()=>void;updates:SoftwareUpdateController}){
  const [open,setOpen]=useState(false),root=useRef<HTMLDivElement>(null),trigger=useRef<HTMLButtonElement>(null),first=useRef<HTMLButtonElement>(null);
  const updateStatus=updates.status;
  useEffect(()=>{if(!open)return;first.current?.focus();const outside=(e:PointerEvent)=>{if(!root.current?.contains(e.target as Node))setOpen(false)};const escape=(e:KeyboardEvent)=>{if(e.key==='Escape'){setOpen(false);trigger.current?.focus()}};document.addEventListener('pointerdown',outside);document.addEventListener('keydown',escape);return()=>{document.removeEventListener('pointerdown',outside);document.removeEventListener('keydown',escape)}},[open]);
  return <div ref={root} className="user-menu-anchor" onBlur={e=>{if(!e.currentTarget.contains(e.relatedTarget as Node))setOpen(false)}}>
    {open&&<div className="user-menu" role="menu" aria-label="用户菜单" onKeyDown={e=>{if(['ArrowDown','ArrowUp','Home','End'].includes(e.key)){e.preventDefault();const items=Array.from(e.currentTarget.querySelectorAll<HTMLButtonElement>('[role="menuitem"]:not(:disabled)'));const i=items.indexOf(document.activeElement as HTMLButtonElement);items[e.key==='Home'?0:e.key==='End'?items.length-1:(i+(e.key==='ArrowDown'?1:-1)+items.length)%items.length]?.focus()}}}>
      <div className="user-menu-summary"><b>本地用户</b><small>未登录 · 账号登录尚未接入</small><small aria-label="当前版本">CBIM {updateStatus?`v${updateStatus.currentVersion}`:'· 正在读取版本…'}</small></div>
      <button ref={first} role="menuitem" onClick={()=>{setOpen(false);openSettings()}}><Icon name="settings" size={16}/>设置</button>
        <button role="menuitem" onClick={()=>{toggleTheme();setOpen(false);trigger.current?.focus()}}><Icon name={theme==='dark'?'sun':'moon'} size={16}/>{theme==='dark'?'切换浅色模式':'切换深色模式'}</button>
      <div role="separator" className="user-menu-separator"/>
      <button role="menuitem" disabled aria-disabled="true" title="账号登录尚未接入"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M9 5H5v14h4M9 12h12m-4-4 4 4-4 4"/></svg>退出登录</button>
    </div>}
    <div className="sidebar-footer"><button ref={trigger} className="user-profile-trigger" aria-label="用户菜单" aria-haspopup="menu" aria-expanded={open} onClick={()=>setOpen(x=>!x)}><span className="profile-badge">C</span><span className="user-profile-copy"><b>本地用户</b><small>CBIM · 未登录</small></span><span className="user-menu-chevron" aria-hidden="true">⌃</span></button><SoftwareUpdateButton updates={updates}/></div>
  </div>
}
