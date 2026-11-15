/**
 * 作用定位：从静态团队模型显示团队、小组和自定义 Agent，配置文件只在详情查看。
 * 设计原因：组织身份独立于磁盘辅助文件；搜索保留祖先，展开折叠只影响本地查看。
 */
import {useState} from 'react';
import {Icon} from '../components/Icon';
import {TreeActions,type TreeAction} from '../components/TreeActions';
import {TEAM_ROOT,visibleTeamNodes,type TeamModel} from './team-model';
import '../knowledge/knowledge-files.css';
export function TeamTree({model,query,selected,onSelect,actions}:{model:TeamModel;query:string;selected:string;onSelect:(id:string)=>void;actions:(id:string)=>TreeAction[]}){
 const [closed,setClosed]=useState(new Set<string>()),visible=visibleTeamNodes(model,query,false);
 const branch=(id:string):React.ReactNode=>{
  const node=model.nodes[id];if(!node||node.kind==='builtin'||(id!==TEAM_ROOT&&!visible.has(id)))return null;
  const children=node.children.filter(child=>visible.has(child)&&model.nodes[child]?.kind!=='builtin'),open=!!query||!closed.has(id);
  return <li key={id}><div className={'knowledge-file-row'+(selected===id?' selected':'')}>
   <button className="knowledge-file-name" data-team-id={id} title={node.name} onClick={()=>onSelect(id)}><Icon name={node.kind==='agent'?'agent':'team'} size={15}/><span>{node.kind==='team'?'团队架构':node.name}</span></button>
   {!!children.length&&<button className="knowledge-file-toggle" aria-label={(open?'折叠 ':'展开 ')+node.name} aria-expanded={open} onClick={()=>setClosed(old=>{const next=new Set(old);next.has(id)?next.delete(id):next.add(id);return next})}><Icon name="chevron" size={13}/></button>}
   <TreeActions name={node.kind==='team'?'团队架构':node.name} actions={actions(id)}/>
  </div>{open&&!!children.length&&<ul>{children.map(branch)}</ul>}</li>;
 };
 return <nav className="knowledge-file-tree" aria-label="团队组织树"><div className="knowledge-file-actions"><button title="展开全部" aria-label="展开全部" onClick={()=>setClosed(new Set())}><Icon name="expand" size={17}/></button><button title="折叠全部" aria-label="折叠全部" onClick={()=>setClosed(new Set(Object.keys(model.nodes)))}><Icon name="collapse" size={17}/></button></div><ul>{branch(TEAM_ROOT)}</ul>{query&&!visible.size&&<p>没有匹配的团队或 Agent。</p>}</nav>;
}
