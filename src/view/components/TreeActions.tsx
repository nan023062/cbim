/**
 * 作用定位：树节点行尾的显式操作菜单；由宿主绑定真实对象和可用状态。
 * 设计原因：组织树与模块树共用键盘、关闭和图标行为，菜单不选择节点或拥有业务状态。
 */
import {useEffect,useRef} from 'react';
import {Icon} from './Icon';
export interface TreeAction {id:string;label:string;icon:string;disabled?:boolean;onSelect():void}
/** 操作只在点击后通知宿主；点击外部或 Escape 收起，保留原节点选择。 */
export function TreeActions({name,actions}:{name:string;actions:readonly TreeAction[]}){
 const menu=useRef<HTMLDetailsElement>(null);
 useEffect(()=>{const close=(event:PointerEvent)=>{if(!menu.current?.contains(event.target as Node))menu.current?.removeAttribute('open')};document.addEventListener('pointerdown',close);return()=>document.removeEventListener('pointerdown',close)},[]);
 return <details className="knowledge-row-menu" ref={menu} onKeyDown={event=>{if(event.key==='Escape'){menu.current?.removeAttribute('open');menu.current?.querySelector('summary')?.focus();event.stopPropagation()}}}><summary title={name+'的操作'} aria-label={name+'的操作'}><Icon name="more" size={16}/></summary><div className="knowledge-row-actions" role="group" aria-label={name+'的操作项'}>{actions.map(action=><button type="button" key={action.id} data-tree-action={action.id} title={action.label} aria-label={action.label} disabled={action.disabled} onClick={()=>{menu.current?.removeAttribute('open');action.onSelect()}}><Icon name={action.icon} size={17}/></button>)}</div></details>;
}
