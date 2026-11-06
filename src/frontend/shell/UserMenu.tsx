/**
 * 作用定位：本地用户栏菜单、主题切换与设置入口。
 * 设计原因：菜单独立维护焦点和关闭行为；账号登录与退出仍是占位。
 */
import {useState,useRef,useEffect} from 'react';
import {Icon} from '../components/Icon';
export function UserMenu({theme,toggleTheme,openSettings}:{theme:string;toggleTheme:()=>void;openSettings:()=>void}){
  const [open,setOpen]=useState(false),root=useRef<HTMLDivElement>(null),trigger=useRef<HTMLButtonElement>(null),first=useRef<HTMLButtonElement>(null);
  useEffect(()=>{if(!open)return;first.current?.focus();const outside=(e:PointerEvent)=>{if(!root.current?.contains(e.target as Node))setOpen(false)};const escape=(e:KeyboardEvent)=>{if(e.key==='Escape'){setOpen(false);trigger.current?.focus()}};document.addEventListener('pointerdown',outside);document.addEventListener('keydown',escape);return()=>{document.removeEventListener('pointerdown',outside);document.removeEventListener('keydown',escape)}},[open]);
  return <div ref={root} className="user-menu-anchor" onBlur={e=>{if(!e.currentTarget.contains(e.relatedTarget as Node))setOpen(false)}}>
    {open&&<div className="user-menu" role="menu" aria-label="用户菜单" onKeyDown={e=>{if(['ArrowDown','ArrowUp','Home','End'].includes(e.key)){e.preventDefault();const items=Array.from(e.currentTarget.querySelectorAll<HTMLButtonElement>('[role="menuitem"]:not(:disabled)'));const i=items.indexOf(document.activeElement as HTMLButtonElement);items[e.key==='Home'?0:e.key==='End'?items.length-1:(i+(e.key==='ArrowDown'?1:-1)+items.length)%items.length]?.focus()}}}>
      <div className="user-menu-summary"><b>本地用户</b><small>未登录 · 账号登录尚未接入</small></div>
      <button ref={first} role="menuitem" onClick={()=>{setOpen(false);openSettings()}}><Icon name="settings" size={16}/>设置</button>
        <button role="menuitem" onClick={()=>{toggleTheme();setOpen(false);trigger.current?.focus()}}><Icon name={theme==='dark'?'sun':'moon'} size={16}/>{theme==='dark'?'切换浅色模式':'切换深色模式'}</button>
      <div role="separator" className="user-menu-separator"/>
      <button role="menuitem" disabled aria-disabled="true" title="账号登录尚未接入"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M9 5H5v14h4M9 12h12m-4-4 4 4-4 4"/></svg>退出登录</button>
    </div>}
    <div className="sidebar-footer"><button ref={trigger} className="user-profile-trigger" aria-label="用户菜单" aria-haspopup="menu" aria-expanded={open} onClick={()=>setOpen(x=>!x)}><span className="profile-badge">C</span><span className="user-profile-copy"><b>本地用户</b><small>CBIM · 未登录</small></span><span className="user-menu-chevron" aria-hidden="true">⌃</span></button><button className="icon-button" aria-label={theme==='dark'?'切换浅色模式':'切换深色模式'} onClick={toggleTheme}><Icon name={theme==='dark'?'sun':'moon'} size={17}/></button></div>
  </div>
}
