/**
 * 作用定位：工作区唯一的静态业务架构，浏览工程/模块关系，维护模块和专属 Workflow，并发布或应用完整业务模板。
 * 设计原因：知识变更通过语义预览事务提交；已登记模块的治理决定与实施分开，仍由统一知识事务保护。架构复用以整个 workspace 为边界，多个会话共享定义但保持各自执行快照。
 */
import React,{useState,useEffect,useCallback} from 'react';
import type {Snapshot} from '../../bridge/contracts/workspace';
import {Icon} from '../components/Icon';
import {Empty} from '../components/Empty';
import {KnowledgeTools} from '../knowledge/KnowledgeTools';
import {ArchitectureEditor,type EditableKind} from '../knowledge/ArchitectureEditor';
import {WorkspaceResourceTransfer} from '../resources/WorkspaceResourceTransfer';
import {ModuleGovernancePanel} from '../governance/ModuleGovernancePanel';
import './workspace-view.css';
export function BusinessArchitecture({id,tabId,dirty,snapshot,refresh}:{id:string;tabId:string;dirty:React.RefObject<Set<string>>;snapshot?:Snapshot;refresh?:()=>Promise<void>}){
  const [manage,setManage]=useState(false),[query,setQuery]=useState(''),[collapsed,setCollapsed]=useState<Set<string>>(new Set()),[virtual,setVirtual]=useState(true),[chosen,setChosen]=useState(''),[zoom,setZoom]=useState(14);
  const tree=snapshot?.validation?.tree,node=tree?.nodes[chosen];
  const [editor,setEditor]=useState<{kind:EditableKind;id?:string;parentId?:string;mode?:'edit'|'delete'}>(),[transfer,setTransfer]=useState<'publish'|'import'>(),[message,setMessage]=useState(''),[error,setError]=useState('');
  const parse=(path:string)=>{try{return JSON.parse(snapshot?.files.find(file=>file.path===path)?.text??'{}')}catch{return {}}};
  const definition=node?parse(node.id+'/module.json'):undefined;
  const [governance,setGovernance]=useState<string>();
  const people=parse('.cbim/team/people.json').people??[];
  async function saved(objects:string[]){setEditor(undefined);setMessage('静态业务定义已更新。已有会话的任务记录保持独立。');if(objects[0]&&!objects[0].includes('/workflows/'))setChosen(objects[0]);try{await refresh?.()}catch(cause){setError(cause instanceof Error?cause.message:String(cause))}}
  const onDirtyChange=useCallback((value:boolean)=>{value?dirty.current.add(tabId):dirty.current.delete(tabId)},[dirty,tabId]);
  useEffect(()=>()=>{dirty.current.delete(tabId)},[dirty,tabId]);
  function branch(moduleId:string,seen=new Set<string>()):React.ReactNode{const n=tree?.nodes[moduleId];if(!n||seen.has(moduleId))return null;const next=new Set([...seen,moduleId]);return <div className="module-branch" key={moduleId}><div className={'module-card '+(chosen===moduleId?'chosen':'')+(query&&!`${n.name} ${n.summary}`.includes(query)?' dimmed':'')}><button className="module-collapse" aria-label={'展开或折叠 '+n.name} aria-expanded={!collapsed.has(moduleId)} onClick={()=>setCollapsed(old=>{const s=new Set(old);s.has(moduleId)?s.delete(moduleId):s.add(moduleId);return s})}>{collapsed.has(moduleId)?'+':'−'}</button><button className="module-card-content" onClick={()=>setChosen(moduleId)}><Icon name="knowledge"/><span><b>{n.name}</b><small>{n.summary}</small><em>{n.children.length} 个子模块 · {n.sources.length} 个源目录</em></span></button></div>{(!collapsed.has(moduleId)||query)&&<div className="module-children">{virtual&&n.sources.length>0&&<button className="virtual-card" onClick={()=>setChosen(moduleId)}><Icon name="folder" size={15}/><span>直属内容 <small>虚拟节点 · 不独立注册</small></span></button>}{n.children.map(child=>branch(child,next))}</div>}</div>}
  return <div className="knowledge-tools business-management"><div className="view-heading"><div className="knowledge-heading"><p className="overline">工作区 / 静态业务架构</p><h1>业务架构</h1><p>Workspace → 领域工程 → 模块；每个模块使用自己的 Workflow。</p></div><button onClick={()=>setManage(x=>!x)}>{manage?'返回架构图':'高级知识管理'}</button></div>
    {message&&<p role="status">{message}</p>}{error&&<p role="alert" className="error-text">{error}</p>}
    <div className="architecture-actions"><button className="solid-button" disabled={!snapshot} onClick={()=>setEditor({kind:'module',parentId:'.cbim/workspace'})}>新建工程模块</button><button disabled={!snapshot||!tree?.roots.length} onClick={()=>setTransfer('publish')}>发布完整业务架构</button><button disabled={!snapshot} onClick={()=>setTransfer('import')}>使用业务模板</button></div>
    <div hidden={!manage}><KnowledgeTools workspaceId={id} onDirtyChange={onDirtyChange}/></div><div hidden={manage}><div className="graph-toolbar"><div className="inline-search"><Icon name="search" size={16}/><input aria-label="搜索项目模块" placeholder="定位模块或职责…" value={query} onChange={e=>setQuery(e.target.value)}/></div><button onClick={()=>setCollapsed(new Set())}>全部展开</button><button onClick={()=>setCollapsed(new Set(Object.keys(tree?.nodes||{})))}>全部折叠</button><button aria-label="缩小知识图文字" onClick={()=>setZoom(x=>Math.max(12,x-1))}>A−</button><button aria-label="放大知识图文字" onClick={()=>setZoom(x=>Math.min(20,x+1))}>A+</button><label><input type="checkbox" checked={virtual} onChange={e=>setVirtual(e.target.checked)}/>直属内容</label></div>
    {!snapshot?<Empty icon="knowledge" title="正在读取项目知识"/>:!tree?.roots.length?<Empty icon="knowledge" title="还没有定义工程模块"><p>先创建领域工程，或从仓库使用完整业务架构模板。</p><button onClick={()=>setEditor({kind:'module',parentId:'.cbim/workspace'})}>创建第一个工程模块</button></Empty>:<div className="org-layout"><div className="module-canvas" style={{fontSize:zoom}}><p className="overline">Workspace · 静态定义</p>{tree.roots.map(root=>branch(root))}</div>{node&&<section className="inspector"><p className="overline">{tree.roots.includes(node.id)?'领域工程':'模块'} · 静态定义</p><h2>{node.name}</h2><small className="architecture-object-id">{node.id}</small><p>{node.summary}</p><div className="architecture-actions"><button onClick={()=>setEditor({kind:'module',id:node.id})}>编辑模块</button><button onClick={()=>setEditor({kind:'module',parentId:node.id})}>新建子模块</button><button onClick={()=>setEditor({kind:'module',id:node.id,mode:'delete'})}>删除模块</button></div>
      <button data-testid="open-module-governance" onClick={()=>setGovernance(node.id)}>知识治理</button>
      <h3>维护责任</h3><p>{definition?.maintenance?.maintainerPersonIds?.length?definition.maintenance.maintainerPersonIds.map((personId:string)=>people.find((person:any)=>person.id===personId)?.name??personId).join('、'):'尚未确认维护人；派发任务前请编辑模块补齐。'}</p>
      <h3>源目录与 scope</h3>{node.sources.map(source=><div className="skill-item" key={source.location}><b>{source.location}</b><p>{source.scope}</p></div>)}{!node.sources.length&&<p>没有声明源目录。</p>}<details className="module-body architecture-method"><summary>查看模块正文</summary><pre>{snapshot.files.find(file=>file.path===node.id+'/'+(definition?.overview??'module.md'))?.text||'没有模块正文。'}</pre></details>
      <h3>本模块 Workflow</h3><p>不继承父级或兄弟模块的流程。</p><button onClick={()=>setEditor({kind:'workflow',parentId:node.id})}>新建 Workflow</button>{(definition?.workflows??[]).map((workflow:any)=>{const workflowId=node.id+'/'+String(workflow.reference).replace(/\/workflow\.md$/,'');return <article className="architecture-method" key={workflowId}><b>{workflow.name}</b><details><summary>查看流程正文</summary><pre>{snapshot.files.find(file=>file.path===node.id+'/'+workflow.reference)?.text}</pre></details><div className="architecture-actions"><button onClick={()=>setEditor({kind:'workflow',id:workflowId})}>编辑 Workflow</button><button onClick={()=>setEditor({kind:'workflow',id:workflowId,mode:'delete'})}>删除 Workflow</button></div></article>})}
    </section>}</div>}
    <p className="view-footnote">工作区内所有主会话共用此静态架构。连线表示包含关系；各会话的动态任务节点图位于会话任务视图。架构语义仍需团队 review。</p></div>
    {snapshot&&editor&&<ArchitectureEditor key={JSON.stringify(editor)} workspaceId={id} snapshot={snapshot} {...editor} onClose={()=>setEditor(undefined)} onSaved={objects=>void saved(objects)}/>}
    {snapshot&&transfer&&<WorkspaceResourceTransfer workspaceId={id} snapshot={snapshot} mode={transfer} kind="architecture" category="templates" onClose={()=>setTransfer(undefined)} onApplied={()=>void saved([])}/>}
    {snapshot&&governance&&<ModuleGovernancePanel key={snapshot.instanceId+governance} identity={{workspaceId:id,instanceId:snapshot.instanceId}} moduleId={governance} onClose={()=>setGovernance(undefined)} onApplied={refresh}/>}
  </div>
}
