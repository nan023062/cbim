/**
 * 作用定位：Cindy 风格的权限和模型 chip，向上展开可搜索、键盘可操作的选择面板。
 * 设计原因：保留 PermissionSelector 的 30px 无边框触发器与说明行；所有选项映射真实 CBIM 能力。
 * 参考：Cindy PermissionSelector / ModelSelector，Apache-2.0，许可见 legal。
 */
import {useEffect,useId,useRef,useState} from 'react';
import {Icon} from '../components/Icon';
export interface ComposerOption {value:string;label:string;description?:string;group?:string;icon?:string}
export function ComposerPicker({label,value,options,onChange,disabled=false,searchable=false,warning=false,align='left',fallbackLabel='所选模型不可用'}:{label:string;value:string;options:ComposerOption[];onChange:(value:string)=>void;disabled?:boolean;searchable?:boolean;warning?:boolean;align?:'left'|'right';fallbackLabel?:string}){
  const [open,setOpen]=useState(false),[query,setQuery]=useState('');const root=useRef<HTMLDivElement>(null),trigger=useRef<HTMLButtonElement>(null);const id=useId();
  const current=options.find(o=>o.value===value),filtered=options.filter(o=>(o.label+' '+o.description+' '+o.group).toLowerCase().includes(query.toLowerCase()));
  useEffect(()=>{if(!open)return;const outside=(e:PointerEvent)=>{if(!root.current?.contains(e.target as Node))setOpen(false)};document.addEventListener('pointerdown',outside);root.current?.querySelector<HTMLElement>(searchable?'input':'[aria-selected="true"], [role="option"]')?.focus();return()=>document.removeEventListener('pointerdown',outside)},[open,searchable]);
  useEffect(()=>{if(disabled)setOpen(false)},[disabled]);
  function close(){setOpen(false);trigger.current?.focus()}
  return <div ref={root} className={'composer-picker '+align+(warning?' warning':'')} onKeyDown={e=>{
    if(e.key==='Escape'&&open){e.preventDefault();e.stopPropagation();close()}
    if(!open)return;
    if(['ArrowDown','ArrowUp','Home','End'].includes(e.key)){const nodes=[...root.current!.querySelectorAll<HTMLButtonElement>('[role="option"]')];if(!nodes.length)return;e.preventDefault();const i=nodes.indexOf(document.activeElement as HTMLButtonElement);nodes[e.key==='Home'?0:e.key==='End'?nodes.length-1:(i+(e.key==='ArrowDown'?1:-1)+nodes.length)%nodes.length]?.focus()}
    if(e.key==='Tab')setOpen(false);
  }}>
    <button ref={trigger} type="button" role="combobox" aria-label={label} aria-haspopup="listbox" aria-controls={id} aria-expanded={open} disabled={disabled} title={current?.description||label} onClick={()=>{setQuery('');setOpen(x=>!x)}} onKeyDown={e=>{if(!open&&['ArrowDown','ArrowUp'].includes(e.key)){e.preventDefault();setOpen(true)}}} className="composer-chip"><Icon name={current?.icon||'team'} size={14}/><span>{current?.label||fallbackLabel}</span><span className="chip-chevron">⌄</span></button>
    {open&&<div className="composer-picker-panel">{searchable&&<div className="composer-picker-search"><Icon name="search" size={14}/><input aria-label="搜索模型" placeholder="搜索模型…" value={query} onChange={e=>setQuery(e.target.value)}/></div>}<div id={id} role="listbox" aria-label={label+'选项'}>{filtered.map((option,i)=><div key={option.value}>{option.group&&option.group!==filtered[i-1]?.group&&<div className="composer-picker-group">{option.group}</div>}<button type="button" role="option" aria-selected={value===option.value} onClick={()=>{onChange(option.value);close()}}><Icon name={option.icon||'team'} size={16}/><span><b>{option.label}</b>{option.description&&<small>{option.description}</small>}</span>{value===option.value&&<Icon name="check" size={14}/>}</button></div>)}{!filtered.length&&<p className="composer-no-options">没有匹配项</p>}</div></div>}
  </div>;
}
