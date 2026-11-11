/**
 * 作用定位：把快照中真实知识文件投影为相对目录树，供业务与团队界面共用。
 * 设计原因：目录/文件只反映知识路径，不伪造业务继承；限定根和安全分段，搜索保留匹配项的父链，坏 JSON 仍能定位修正。
 */
import type {KnowledgeFile} from '../../bridge/contracts/workspace';
export interface KnowledgeTreeNode {path:string;name:string;kind:'folder'|'file';children:KnowledgeTreeNode[]}
/** 无磁盘访问或缓存；文件与目录排序稳定，快照刷新后重新派生。 */
export function knowledgeFileTree(files:readonly KnowledgeFile[],root:string,query='',labels:Readonly<Record<string,string>>={}):KnowledgeTreeNode{
 const tree:KnowledgeTreeNode={path:root,name:labels[root]??root.split('/').at(-1)!,kind:'folder',children:[]},needle=query.trim().toLocaleLowerCase();
 for(const file of files){
  if(!file.path.startsWith(root+'/')||file.path.includes('\\'))continue;
  const parts=file.path.slice(root.length+1).split('/');if(parts.some(part=>!part||part==='.'||part==='..'))continue;
  if(needle&&!`${file.path} ${Object.entries(labels).filter(([path])=>file.path.startsWith(path+'/')).map(([,name])=>name).join(' ')}`.toLocaleLowerCase().includes(needle))continue;
  let parent=tree;
  parts.forEach((name,index)=>{const path=parent.path+'/'+name;let node=parent.children.find(child=>child.path===path);if(!node){node={path,name:labels[path]??name,kind:index===parts.length-1?'file':'folder',children:[]};parent.children.push(node)}parent=node});
 }
 const sort=(node:KnowledgeTreeNode)=>{node.children.sort((a,b)=>a.kind===b.kind?a.name.localeCompare(b.name):a.kind==='folder'?-1:1);node.children.forEach(sort)};sort(tree);return tree;
}
