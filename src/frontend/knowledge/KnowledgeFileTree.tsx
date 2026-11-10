/**
 * 作用定位：业务/团队共用的可展开知识目录与文件导航。
 * 设计原因：折叠是局部查看状态，选择只通知宿主；树本身不查询、编辑或登记负责人。
 */
import {useMemo,useState} from 'react';
import type {Snapshot} from '../../bridge/contracts/workspace';
import {Icon} from '../components/Icon';
import {knowledgeFileTree,type KnowledgeTreeNode} from './knowledge-file-tree';
import './knowledge-files.css';
export function KnowledgeFileTree({snapshot,root,label,selected,onSelect,query='',labels={}}:{snapshot:Snapshot;root:string;label:string;selected?:string;onSelect:(path:string,kind:'folder'|'file')=>void;query?:string;labels?:Record<string,string>}){
 const tree=useMemo(()=>knowledgeFileTree(snapshot.files,root,query,labels),[snapshot,root,query,labels]);
 const [closed,setClosed]=useState<Set<string>>(new Set());
 const folders=(node:KnowledgeTreeNode):string[]=>node.kind==='folder'?[node.path,...node.children.flatMap(folders)]:[];
 const branch=(node:KnowledgeTreeNode)=>{
  const open=!closed.has(node.path)||!!query;
  return <li key={node.path}><div className={'knowledge-file-row'+(selected===node.path?' selected':'')}>
   {node.kind==='folder'?<button aria-label={(open?'折叠 ':'展开 ')+node.name} aria-expanded={open} onClick={()=>setClosed(old=>{const next=new Set(old);next.has(node.path)?next.delete(node.path):next.add(node.path);return next})}>{open?'▾':'▸'}</button>:<span className="knowledge-file-indent"/>}
   <button title={node.path} data-knowledge-path={node.path} onClick={()=>onSelect(node.path,node.kind)}><Icon name={node.kind==='folder'?'folder':'knowledge'} size={15}/>{node.path===root?label:node.name}</button>
  </div>{node.kind==='folder'&&open&&<ul>{node.children.map(branch)}</ul>}</li>;
 };
 return <nav className="knowledge-file-tree" aria-label={label+'知识文件树'}><div className="knowledge-file-actions"><button onClick={()=>setClosed(new Set())}>展开全部</button><button onClick={()=>setClosed(new Set(folders(tree)))}>折叠全部</button></div><ul>{branch(tree)}</ul>{!tree.children.length&&<p>没有匹配的知识文件。</p>}</nav>;
}
