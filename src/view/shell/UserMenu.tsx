/**
 * 作用定位：本地账号、主题与设置菜单；用户栏右侧装配独立的版本更新图标。
 * 设计原因：菜单提供外观快捷切换与账号设置直达；外观和更新状态仍由外壳唯一持有。
 */
import {useState,useRef,useEffect} from 'react';
import {Icon} from '../components/Icon';
import type {SettingsSectionId} from '../settings/settings-sections';
import {SoftwareUpdateButton} from '../updates/SoftwareUpdateButton';
import type {SoftwareUpdateController} from '../updates/useSoftwareUpdates';
/** 菜单不再提供更新项；常驻图标仅在就绪时安装，悬停或聚焦只读取共享状态。 */
export function UserMenu({theme,toggleTheme,openSettings,updates}:{theme:string;toggleTheme:()=>void;openSettings:(section?:SettingsSectionId)=>void;updates:SoftwareUpdateController}){
  const [open,setOpen]=useState(false),root=useRef<HTMLDivElement>(null),trigger=useRef<HTMLButtonElement>(null),first=useRef<HTMLButtonElement>(null);
  const updateStatus=updates.status;
  useEffect(()=>{if(!open)return;first.current?.focus();const outside=(e:PointerEvent)=>{if(!root.current?.contains(e.target as Node))setOpen(false)};const escape=(e:KeyboardEvent)=>{if(e.key==='Escape'){setOpen(false);trigger.current?.focus()}};document.addEventListener('pointerdown',outside);document.addEventListener('keydown',escape);return()=>{document.removeEventListener('pointerdown',outside);document.removeEventListener('keydown',escape)}},[open]);
  return <div ref={root} className="user-menu-anchor" onBlur={e=>{if(!e.currentTarget.contains(e.relatedTarget as Node))setOpen(false)}}>
    {open&&<div className="user-menu" role="menu" aria-label="用户菜单" onKeyDown={e=>{if(['ArrowDown','ArrowUp','Home','End'].includes(e.key)){e.preventDefault();const items=Array.from(e.currentTarget.querySelectorAll<HTMLButtonElement>('[role="menuitem"]:not(:disabled)'));const i=items.indexOf(document.activeElement as HTMLButtonElement);items[e.key==='Home'?0:e.key==='End'?items.length-1:(i+(e.key==='ArrowDown'?1:-1)+items.length)%items.length]?.focus()}}}>
      <div className="user-menu-summary"><b>本地用户</b><small>本地使用 · 数据保存在本机</small><small aria-label="当前版本">CBIM {updateStatus?`v${updateStatus.currentVersion}`:'· 正在读取版本…'}</small></div>
      <button ref={first} role="menuitem" onClick={()=>{setOpen(false);openSettings()}}><Icon name="settings" size={16}/>设置</button>
        <button role="menuitem" onClick={()=>{toggleTheme();setOpen(false);trigger.current?.focus()}}><Icon name={theme==='dark'?'sun':'moon'} size={16}/>{theme==='dark'?'切换浅色模式':'切换深色模式'}</button>
      <div role="separator" className="user-menu-separator"/>
      <button role="menuitem" onClick={()=>{setOpen(false);openSettings('accounts')}}><Icon name="team" size={16}/>账号与连接</button>
      <button role="menuitem" onClick={()=>{setOpen(false);openSettings('appearance')}}><Icon name="sun" size={16}/>主题与个性化</button>
    </div>}
    <div className="sidebar-footer"><button ref={trigger} className="user-profile-trigger" aria-label="用户菜单" aria-haspopup="menu" aria-expanded={open} onClick={()=>setOpen(x=>!x)}><span className="profile-badge">C</span><span className="user-profile-copy"><b>本地用户</b><small>CBIM · 本地使用</small></span><span className="user-menu-chevron" aria-hidden="true">⌃</span></button><SoftwareUpdateButton updates={updates}/></div>
  </div>
}
