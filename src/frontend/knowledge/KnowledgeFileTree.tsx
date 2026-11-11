/**
 * 作用定位：业务/团队共用的可展开知识目录与文件导航。
 * 设计原因：折叠是局部查看状态，选择只通知宿主；树本身不查询、编辑或登记负责人。
 * 节点动作由宿主按真实路径绑定，更多菜单不改变当前选择；名称后的箭头与行尾动作各自可键盘操作。
 * 每棵树只渲染一个根；右上角展开/折叠图标只管理本地 closed 集合，不提交知识或运行。
 */
import {useEffect,useMemo,useRef,useState} from 'react';
import type {Snapshot} from '../../bridge/contracts/workspace';
import {Icon} from '../components/Icon';
import {knowledgeFileTree,type KnowledgeTreeNode} from './knowledge-file-tree';
import './knowledge-files.css';
/** 只声明显示与回调；disabled 来自宿主状态，不替代后端权限或确认。 */
export interface KnowledgeTreeAction {id:string;label:string;icon:string;disabled?:boolean;onSelect():void}
function RowActions({name,actions}:{name:string;actions:readonly KnowledgeTreeAction[]}){
 const menu=useRef<HTMLDetailsElement>(null);
 useEffect(()=>{const close=(event:PointerEvent)=>{if(!menu.current?.contains(event.target as Node))menu.current?.removeAttribute('open')};document.addEventListener('pointerdown',close);return()=>document.removeEventListener('pointerdown',close)},[]);
 return <details className="knowledge-row-menu" ref={menu} onKeyDown={event=>{if(event.key==='Escape'){menu.current?.removeAttribute('open');menu.current?.querySelector('summary')?.focus();event.stopPropagation()}}}><summary title={name+'的操作'} aria-label={name+'的操作'}><Icon name="more" size={16}/></summary><div className="knowledge-row-actions" role="group" aria-label={name+'的操作项'}>{actions.map(action=><button type="button" key={action.id} data-tree-action={action.id} title={action.label} aria-label={action.label} disabled={action.disabled} onClick={()=>{menu.current?.removeAttribute('open');action.onSelect()}}><Icon name={action.icon} size={17}/></button>)}</div></details>;
}
export function KnowledgeFileTree({snapshot,root,label,selected,onSelect,query='',labels={},actions}:{snapshot:Snapshot;root:string;label:string;selected?:string;onSelect:(path:string,kind:'folder'|'file')=>void;query?:string;labels?:Record<string,string>;actions?:(node:KnowledgeTreeNode)=>readonly KnowledgeTreeAction[]}){
 const tree=useMemo(()=>knowledgeFileTree(snapshot.files,root,query,labels),[snapshot,root,query,labels]);
 const [closed,setClosed]=useState<Set<string>>(new Set());
 const folders=(node:KnowledgeTreeNode):string[]=>node.kind==='folder'?[node.path,...node.children.flatMap(folders)]:[];
 const branch=(node:KnowledgeTreeNode)=>{
  const open=!closed.has(node.path)||!!query,name=node.path===root?label:node.name,items=node.kind==='folder'?actions?.(node)??[]:[];
  return <li key={node.path}><div className={'knowledge-file-row'+(selected===node.path?' selected':'')}>
   <button className="knowledge-file-name" title={name+' · '+node.path} data-knowledge-path={node.path} onClick={()=>onSelect(node.path,node.kind)}><Icon name={node.kind==='folder'?'folder':'knowledge'} size={15}/><span>{name}</span></button>
   {node.kind==='folder'&&<button className="knowledge-file-toggle" title={(open?'折叠 ':'展开 ')+name} aria-label={(open?'折叠 ':'展开 ')+name} aria-expanded={open} onClick={()=>setClosed(old=>{const next=new Set(old);next.has(node.path)?next.delete(node.path):next.add(node.path);return next})}><Icon name="chevron" size={13}/></button>}
   {!!items.length&&<RowActions name={name} actions={items}/>}
  </div>{node.kind==='folder'&&open&&<ul>{node.children.map(branch)}</ul>}</li>;
 };
 return <nav className="knowledge-file-tree" aria-label={label+'知识文件树'}><div className="knowledge-file-actions" role="group" aria-label={label+'视图操作'}><button type="button" title="展开全部" aria-label="展开全部" onClick={()=>setClosed(new Set())}><Icon name="expand" size={17}/></button><button type="button" title="折叠全部" aria-label="折叠全部" onClick={()=>setClosed(new Set(folders(tree)))}><Icon name="collapse" size={17}/></button></div><ul>{branch(tree)}</ul>{!tree.children.length&&<p>没有匹配的知识文件。</p>}</nav>;
}
