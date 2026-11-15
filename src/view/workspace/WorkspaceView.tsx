/**
 * 业务模块是唯一可见树根，移除重复项目根按钮；根操作仍由文件树提供。
 * 文件树行尾动作捕获本行真实对象，图标配 title/aria-label；原编辑、删除、传输和草稿保护保持。
 * 作用定位：业务模块与绑定源码的目录树、只读源码预览及配置治理入口。
 * 设计原因：模块选择展示业务职责，文件选择复用知识事务；负责人默认隐式解析，显式设置留在详情。旧岗位、责任及会话证据不随目录浏览改变。
 */
import React,{useState,useEffect,useCallback,useMemo} from 'react';
import type {Snapshot,WorkspaceView} from '../../bridge/contracts/workspace';
import {projectRootModuleId} from '../../bridge/contracts/workspace';
import {Icon} from '../components/Icon';
import {Empty} from '../components/Empty';
import type {TreeAction as KnowledgeTreeAction} from '../components/TreeActions';
import {ModuleSourceTree} from './ModuleSourceTree';
import {SourceFilePreview} from './SourceFilePreview';
import type {SourceTarget} from '../../bridge/contracts/ipc-workspace';
import {KnowledgeFilePreview} from '../knowledge/KnowledgeFilePreview';
import {useGovernanceLaunch,GovernanceStatus} from '../knowledge/GovernanceLaunch';
import {ArchitectureEditor,type EditableKind} from '../knowledge/ArchitectureEditor';
import {WorkspaceResourceTransfer} from '../resources/WorkspaceResourceTransfer';
import {ModuleGovernancePanel} from '../governance/ModuleGovernancePanel';
import {ModuleOwnershipPanel} from './ModuleOwnershipPanel';
import {WorkspaceMembers} from '../team/WorkspaceMembers';
import {buildTeamModel} from '../team/team-model';
import {InlineModuleOwner,useInlineModuleOwners} from './InlineModuleOwner';
import './workspace-view.css';
/** 浏览不保存负责人；文件提交后刷新同一工作区快照，草稿由扩展页签统一保护。 */
export function BusinessArchitecture({workspace,tabId,dirty,snapshot,refresh,onStarted}:{workspace:WorkspaceView;tabId:string;dirty:React.RefObject<Set<string>>;snapshot?:Snapshot;refresh?:()=>Promise<void>;onStarted?:(taskId:string,title:string)=>void}){
 const id=workspace.id,[query,setQuery]=useState(''),[chosen,setChosen]=useState(projectRootModuleId),[file,setFile]=useState('');
 const [source,setSource]=useState<SourceTarget>();
 const current=snapshot?.workspaceId===id?snapshot:undefined,tree=current?.validation?.tree,node=tree?.nodes[chosen];
 const [editor,setEditor]=useState<{kind:EditableKind;id?:string;parentId?:string;mode?:'edit'|'delete'}>(),[transfer,setTransfer]=useState<'publish'|'import'>(),[message,setMessage]=useState(''),[error,setError]=useState('');
 const [governance,setGovernance]=useState<string>(),[ownership,setOwnership]=useState<{moduleId?:string;memberId?:string}>(),[registration,setRegistration]=useState<{moduleId:string;agentId:string}>();
 const agents=useMemo(()=>Object.values(buildTeamModel(current,workspace.name).nodes).filter(item=>item.kind==='agent').map(item=>({id:item.id,name:item.name,runtime:item.runtime})),[current,workspace.name]);
 const owners=useInlineModuleOwners(current?{workspaceId:id,instanceId:current.instanceId}:undefined,agents,current?.revision);
 const onDirtyChange=useCallback((value:boolean)=>{value?dirty.current.add(tabId):dirty.current.delete(tabId)},[dirty,tabId]);
 useEffect(()=>()=>{dirty.current.delete(tabId)},[dirty,tabId]);
 const launch=useGovernanceLaunch({workspaceId:id,kind:'business',disabled:!current||workspace.state!=='running',onStarted});
 useEffect(()=>{setSource(undefined);setFile('');setChosen(projectRootModuleId)},[id]);
 useEffect(()=>{setSource(undefined)},[current?.revision,current?.instanceId]);
 function selectSource(target:SourceTarget){if(dirty.current.has(tabId)&&!confirm('丢弃未提交的知识草稿并切换？'))return;setFile('');setChosen(target.moduleId);setSource(target)}
 function select(path:string,kind:'folder'|'file'){if(dirty.current.has(tabId)&&!confirm('丢弃未提交的知识草稿并切换？'))return;setSource(undefined);setFile(kind==='file'?path:'');const owner=Object.keys(tree?.nodes??{}).filter(id=>path===id||path.startsWith(id+'/')).sort((a,b)=>b.length-a.length)[0];setChosen(owner??projectRootModuleId)}
 async function saved(objects:string[]){setEditor(undefined);setMessage('知识已更新，已有任务记录保持不变。');if(objects[0])select(objects[0],'folder');try{await refresh?.()}catch(cause){setError(cause instanceof Error?cause.message:String(cause))}}
 /** 回调固定所点行的模块身份；先保护未提交草稿，编辑/删除仍由原事务弹窗预览。 */
 function nodeActions(target:string):KnowledgeTreeAction[]{
  const wrap=(work:()=>void)=>()=>{if(dirty.current.has(tabId)&&!confirm('存在未提交的知识草稿，继续打开节点操作？'))return;work()};
  if(target==='.cbim/workspace')return [
   {id:'business-govern',label:launch.label,icon:'sparkles',disabled:launch.disabled,onSelect:wrap(()=>void launch.start())},
   {id:'module-new',label:'新建工程模块',icon:'plus',onSelect:wrap(()=>setEditor({kind:'module',parentId:target}))},
   {id:'ownerships',label:'负责人记录',icon:'clock',onSelect:wrap(()=>setOwnership({}))},
   {id:'architecture-publish',label:'发布架构',icon:'upload',disabled:!tree?.roots.length,onSelect:wrap(()=>setTransfer('publish'))},
   {id:'architecture-import',label:'使用模板',icon:'download',onSelect:wrap(()=>setTransfer('import'))},
  ];
  if(!tree?.nodes[target])return [];
  return [
   {id:'module-child',label:'新建子模块',icon:'plus',onSelect:wrap(()=>setEditor({kind:'module',parentId:target}))},
   {id:'module-edit',label:'编辑模块',icon:'edit',onSelect:wrap(()=>setEditor({kind:'module',id:target}))},
   {id:'module-delete',label:'删除模块',icon:'trash',onSelect:wrap(()=>setEditor({kind:'module',id:target,mode:'delete'}))},
   {id:'module-governance',label:'知识治理记录',icon:'knowledge',onSelect:wrap(()=>setGovernance(target))},
   {id:'module-ownership',label:'负责人记录',icon:'clock',onSelect:wrap(()=>setOwnership({moduleId:target}))},
   {id:'workflow-new',label:'新建 Workflow',icon:'flow',onSelect:wrap(()=>setEditor({kind:'workflow',parentId:target}))},
  ];
 }
 const definition=(()=>{try{return JSON.parse(current?.files.find(item=>item.path===node?.id+'/module.json')?.text??'{}')}catch{return {}}})();
 if(current&&registration)return <WorkspaceMembers key={id+current.instanceId} workspace={workspace} agents={agents} initialRegistration={{agentId:registration.agentId}} returnLabel="返回模块负责人" onRegistered={memberId=>{setOwnership({moduleId:registration.moduleId,memberId});setRegistration(undefined)}} onClose={()=>{setOwnership({moduleId:registration.moduleId});setRegistration(undefined)}}/>;
 if(current&&ownership)return <ModuleOwnershipPanel key={id+current.instanceId} identity={{workspaceId:id,instanceId:current.instanceId}} initialModuleId={ownership.moduleId} initialMemberId={ownership.memberId} registration={{agents,onSelect:(moduleId,agentId)=>setRegistration({moduleId,agentId})}} onClose={()=>setOwnership(undefined)}/>;
 return <div className="knowledge-tools business-management"><GovernanceStatus launch={launch}/>
  {message&&<p role="status">{message}</p>}{error&&<p role="alert">{error}</p>}
  <div className="inline-search"><Icon name="search"/><input aria-label="搜索项目模块" placeholder="搜索模块…" value={query} onChange={e=>setQuery(e.target.value)}/></div>
  {!current?<Empty icon="knowledge" title="正在读取项目知识"/>:<div className="org-layout"><div className="module-canvas"><ModuleSourceTree key={id+current.instanceId+current.revision} snapshot={current} selected={chosen} source={source} query={query} onModule={id=>select(id,'folder')} onFile={selectSource} actions={nodeActions}/></div>
   <section className="inspector">{source&&source.revision===current.revision&&source.instanceId===current.instanceId?<><button onClick={()=>select(source.moduleId,'folder')}>返回模块详情</button><SourceFilePreview key={JSON.stringify(source)} target={source}/></>:file?<><button onClick={()=>select(chosen,'folder')}>返回模块详情</button><KnowledgeFilePreview key={file} snapshot={current} path={file} onSaved={refresh} onDirtyChange={onDirtyChange}/></>:node?<>
    <h2>{node.name}</h2><code>{node.id}</code><p>{node.summary}</p><p>执行时依次采用显式负责人、最近父级负责人、模型匹配团队岗位；无匹配由主 Agent 执行。</p>
    <InlineModuleOwner moduleId={node.id} name={node.name} owners={owners}/>{owners.error&&<p role="alert">{owners.error}</p>}{owners.message&&<p role="status">{owners.message}</p>}{(owners.error||owners.blocked)&&<button onClick={()=>void owners.refresh()}>核实原操作并刷新</button>}
    <KnowledgeFilePreview key={node.id} snapshot={current} path={node.id+'/'+(definition.overview??'module.md')} onSaved={refresh} onDirtyChange={onDirtyChange}/>
    <details><summary>模块配置资料</summary>{current.files.filter(item=>item.path.startsWith(node.id+'/')&&Object.keys(tree?.nodes??{}).filter(id=>item.path.startsWith(id+'/')).sort((a,b)=>b.length-a.length)[0]===node.id).map(item=><p key={item.path}><button onClick={()=>select(item.path,'file')}>{item.path.slice(node.id.length+1)}</button></p>)}</details>
    <h3>源目录</h3>{node.sources.map(source=><p key={source.location}><code>{source.location}</code> · {source.scope}</p>)}
    <h3>本模块 Workflow</h3>{(definition.workflows??[]).map((flow:{name:string;reference:string})=><p key={flow.reference}><button onClick={()=>select(node.id+'/'+flow.reference,'file')}>{flow.name}</button><button title="编辑 Workflow" aria-label="编辑 Workflow" onClick={()=>setEditor({kind:'workflow',id:node.id+'/'+flow.reference.replace(/\/workflow\.md$/,'')})}><Icon name="edit" size={16}/></button></p>)}
   </>:<><h2>{workspace.name}</h2><p>项目根可直接开始工作，无需先指定模块负责人。选择模块查看详情，展开绑定目录浏览源码。</p>{current.files.some(item=>item.path.startsWith('.cbim/workspace/')&&item.path.endsWith('/module.json')&&!tree?.nodes[item.path.slice(0,-12)])&&<details><summary>未解析的模块配置</summary>{current.files.filter(item=>item.path.startsWith('.cbim/workspace/')&&item.path.endsWith('/module.json')&&!tree?.nodes[item.path.slice(0,-12)]).map(item=><p key={item.path}><button onClick={()=>select(item.path,'file')}>{item.path}</button></p>)}</details>}</>}</section>
  </div>}
  {current&&editor&&<ArchitectureEditor key={JSON.stringify(editor)} workspaceId={id} snapshot={current} {...editor} onClose={()=>setEditor(undefined)} onSaved={objects=>void saved(objects)}/>}
  {current&&transfer&&<WorkspaceResourceTransfer workspaceId={id} snapshot={current} mode={transfer} kind="architecture" category="templates" onClose={()=>setTransfer(undefined)} onApplied={()=>void saved([])}/>}
  {current&&governance&&<ModuleGovernancePanel key={current.instanceId+governance} identity={{workspaceId:id,instanceId:current.instanceId}} moduleId={governance} onClose={()=>setGovernance(undefined)} onApplied={refresh}/>}
 </div>;
}
