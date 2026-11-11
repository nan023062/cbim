/**
 * 作用定位：静态团队架构、知识编辑与人才市场入口；独立打开角色 Session 履历和项目岗位登记。
 * 设计原因：文件夹树展示真实团队知识并隐藏内置角色，完整能力模型与 Skill 父链保留；长期岗位、运行实例与静态能力不能混成一棵树；岗位仅登记采纳与状态，编辑和导入交给预览事务，浏览与登记不授权执行。
 * 主 Agent 配置入口与对话栏读写同一设置；传递自定义 Agent 的默认引擎/模型到岗位登记入口，图谱展示不启动运行或改写历史岗位。
 */
import React,{useEffect,useMemo,useState,useCallback} from 'react';
import type {Snapshot,WorkspaceView} from '../../bridge/contracts/workspace';
import {Icon} from '../components/Icon';
import {KnowledgeFileTree} from '../knowledge/KnowledgeFileTree';
import {KnowledgeFilePreview} from '../knowledge/KnowledgeFilePreview';
import {GovernanceLaunch} from '../knowledge/GovernanceLaunch';
import {MarkdownMessage} from '../execution-view/MarkdownMessage';
import {ArchitectureEditor} from '../knowledge/ArchitectureEditor';
import {WorkspaceResourceTransfer} from '../resources/WorkspaceResourceTransfer';
import {AgentSessionHistory} from './AgentSessionHistory';
import {MainAgentEditor} from './MainAgentEditor';
import {WorkspaceMembers} from './WorkspaceMembers';
import {availableTeamSkills,buildTeamModel,TEAM_ROOT} from './team-model';
import './team-view.css';

type Editor={kind:'agent'|'skill';id?:string;parentId?:string;mode?:'edit'|'delete'};
type Transfer={mode:'publish'|'import';kind?:'team'|'agent'|'skill';objectId?:string;targetParentId?:string};
/** refresh 在知识事务提交后重新读取工作区快照；不从本地表单臆造已经生效的定义。 */
export function TeamView({snapshot,workspace,refresh,dirty,tabId,onStarted}:{snapshot?:Snapshot;workspace:WorkspaceView;refresh?:()=>Promise<void>;dirty?:React.RefObject<Set<string>>;tabId?:string;onStarted?:(taskId:string,title:string)=>void}){
  const current=snapshot?.workspaceId===workspace.id?snapshot:undefined;
  const model=useMemo(()=>buildTeamModel(current,workspace.name),[current,workspace.name]);
  const [query,setQuery]=useState(''),[chosen,setChosen]=useState(TEAM_ROOT),[skillId,setSkillId]=useState('');
  const [file,setFile]=useState('');
  const onDirtyChange=useCallback((value:boolean)=>{if(dirty&&tabId)value?dirty.current.add(tabId):dirty.current.delete(tabId)},[dirty,tabId]);
  const [editor,setEditor]=useState<Editor>(),[transfer,setTransfer]=useState<Transfer>(),[error,setError]=useState('');
  const [history,setHistory]=useState<{workspaceId:string;agentId?:string}>();
  const [members,setMembers]=useState(false),[mainSettings,setMainSettings]=useState(false);
  useEffect(()=>{setChosen(TEAM_ROOT);setSkillId('');setQuery('');setEditor(undefined);setTransfer(undefined);setHistory(undefined);setMembers(false);setMainSettings(false);setError('')},[workspace.id]);
  const node=model.nodes[chosen]??model.nodes[TEAM_ROOT];
  const skills=availableTeamSkills(model,node.id),skill=skills.find(item=>item.id===skillId);
  const agents=Object.values(model.nodes).filter(item=>item.kind==='agent');
  const owner=node.kind==='builtin'?TEAM_ROOT:node.id;
  const newAgentParent=node.kind==='agent'?node.parentId??TEAM_ROOT:owner;
  const canEdit=!!current&&workspace.state==='running';
  function select(id:string){if(dirty&&tabId&&dirty.current.has(tabId)&&!confirm('丢弃未提交的知识草稿并切换？'))return;setChosen(id);setSkillId('');setFile('')}
  function selectPath(path:string,kind:'folder'|'file'){if(dirty&&tabId&&dirty.current.has(tabId)&&!confirm('丢弃未提交的知识草稿并切换？'))return;const owner=Object.keys(model.nodes).filter(id=>path===id||path.startsWith(id+'/')).sort((a,b)=>b.length-a.length)[0]??TEAM_ROOT;setChosen(owner);setSkillId('');setFile(kind==='file'?path:'')}
  async function reload(){try{await refresh?.();setError('')}catch(cause){setError(`已完成操作，但团队视图刷新失败：${cause instanceof Error?cause.message:String(cause)}`)}}
  if(members)return <div className="view-page team-management"><WorkspaceMembers key={JSON.stringify([workspace.id,workspace.instanceId])} workspace={workspace} agents={Object.values(model.nodes).filter(item=>item.kind==='agent').map(item=>({id:item.id,name:item.name,runtime:item.runtime}))} onClose={()=>setMembers(false)}/></div>;
  return <div className="view-page team-management">
    <div className="view-heading"><div><p className="overline">团队 / 静态能力架构</p><h1>团队组织架构</h1><p>展示项目自定义成员与共享 Skill，按团队层级排列。内置角色仍可调度，历史在独立入口查看。</p></div><GovernanceLaunch workspaceId={workspace.id} kind="team" disabled={!canEdit} onStarted={onStarted}/></div>
    <div className="team-toolbar">
      <div className="inline-search"><Icon name="search" size={16}/><input aria-label="搜索团队成员或 Skill" placeholder="搜索成员或知识文件…" value={query} onChange={event=>setQuery(event.target.value)}/></div>
      <button disabled={!canEdit} onClick={()=>setEditor({kind:'agent',parentId:newAgentParent})}><Icon name="plus" size={15}/> 新建 Agent</button>
      <button disabled={!canEdit} onClick={()=>setTransfer({mode:'import',kind:node.kind==='agent'?'skill':undefined,targetParentId:owner})}><Icon name="download" size={16}/><span>从人才市场下载</span></button>
      <button data-testid="team-main-agent-settings" disabled={!canEdit} onClick={()=>setMainSettings(true)}><Icon name="settings" size={16}/><span>主 Agent 配置</span></button>
      <button data-testid="team-history-roles" onClick={()=>setHistory({workspaceId:workspace.id})}><Icon name="clock" size={16}/><span>历史角色</span></button>
      <button data-testid="team-workspace-members" disabled={workspace.state!=='running'||!workspace.instanceId} onClick={()=>setMembers(true)}><Icon name="team" size={16}/><span>项目岗位</span></button>
    </div>
    {error&&<p role="alert">{error} <button onClick={()=>void reload()}>重试刷新</button></p>}
    {!current&&<p role="status">正在读取团队知识…</p>}
    {!!model.issues.length&&<details className="team-issues"><summary>有 {model.issues.length} 项定义需要检查</summary><ul>{model.issues.map((issue,index)=><li key={index}>{issue}</li>)}</ul></details>}
    {history?.workspaceId===workspace.id?<AgentSessionHistory key={JSON.stringify([workspace.id,history.agentId??''])} workspaceId={workspace.id} initialAgentId={history.agentId} currentDefinitions={Object.fromEntries(Object.values(model.nodes).filter(item=>item.kind==='agent'||item.kind==='builtin').map(item=>[item.id,item.name]))} knowledgeReady={!!current} onClose={()=>setHistory(undefined)}/>:<div className="team-management-layout">
      <div className="team-definition-tree">{current&&<KnowledgeFileTree snapshot={current} root={TEAM_ROOT} label="团队架构" selected={file||node.id} query={query} onSelect={selectPath} labels={Object.fromEntries(Object.values(model.nodes).filter(item=>item.kind!=='builtin').map(item=>[item.id,item.name]))}/>}</div>
      <section className="team-definition-detail" aria-label="团队定义详情">
        {file&&current?<KnowledgeFilePreview key={file} snapshot={current} path={file} onSaved={reload} onDirtyChange={onDirtyChange}/>:<>
        <p className="overline">{node.kind==='team'?'Team 根':node.kind==='group'?'小组':node.kind==='builtin'?'内置 Agent · 只读':'自定义 Agent'}</p><h2>{node.name}</h2><code>{node.id}</code>
        <div className="team-definition-actions">
          {(node.kind==='agent'||node.kind==='builtin')&&<button data-testid="team-history-open" data-agent-id={node.id} onClick={()=>setHistory({workspaceId:workspace.id,agentId:node.id})}><Icon name="clock" size={16}/><span>执行历史</span></button>}
          {node.kind==='agent'&&<><button disabled={!canEdit} onClick={()=>setEditor({kind:'agent',id:node.id})}><Icon name="edit" size={16}/><span>编辑 Agent</span></button><button disabled={!canEdit} onClick={()=>setEditor({kind:'agent',id:node.id,parentId:node.parentId,mode:'delete'})}><Icon name="trash" size={16}/><span>删除 Agent</span></button><button disabled={!canEdit} onClick={()=>setTransfer({mode:'publish',kind:'agent',objectId:node.id})}><Icon name="upload" size={16}/><span>发布 Agent 到人才市场</span></button></>}
          {node.kind==='team'&&<button disabled={!canEdit} onClick={()=>setTransfer({mode:'publish',kind:'team',objectId:TEAM_ROOT})}><Icon name="upload" size={16}/><span>发布整个团队</span></button>}
          {node.kind!=='builtin'?<button disabled={!canEdit} onClick={()=>setEditor({kind:'skill',parentId:node.id})}><Icon name="plus" size={16}/><span>新增 Skill</span></button>:<button onClick={()=>select(TEAM_ROOT)}><Icon name="settings" size={16}/><span>管理 Team 共享 Skill</span></button>}
        </div>
        {node.summary&&<p>{node.summary}</p>}
        {node.kind==='agent'&&<><h3>能力与职责</h3><ul>{node.capabilities.map((value,index)=><li key={index}>{value}</li>)}</ul><h3>限制与边界</h3>{node.limitations.length?<ul>{node.limitations.map((value,index)=><li key={index}>{value}</li>)}</ul>:<p>未声明专门限制；执行仍受工作区权限与规则约束。</p>}<h3>工作原则</h3>{node.bodyAvailable?<MarkdownMessage text={node.body} workspaceId={workspace.id}/>:<p role="alert">工作原则正文缺失，请编辑定义或治理知识。</p>}{current&&<p>{current.validation?.issues.filter(issue=>issue.path?.startsWith(node.id+'/')).map((issue,index)=><span key={index} className="knowledge-file-warning">{issue.path} · {issue.message}<br/></span>)}</p>}</>}
        {(node.kind==='team'||node.kind==='group')&&<p>此节点的 Skill 会被下级小组和 Agent 继承。新建成员时填写 100–250 个非空白字符的单行摘要、能力、边界和工作原则。</p>}
        <h3>可用 Skill <small>自有及父链继承</small></h3>
        <div className="team-skill-list">{skills.length?skills.map((item,index)=><button key={`${item.id}-${index}`} className={skill?.id===item.id?'selected':''} onClick={()=>setSkillId(item.id)}><span className="team-skill-title"><Icon name="sparkles" size={16}/><b>{item.name}</b></span><small>{item.inherited?'继承':'自有'} · {model.nodes[item.ownerId]?.name??item.ownerId}</small><span>{item.purpose}</span></button>):<p>尚无 Skill 定义。可以为当前节点添加共享方法。</p>}</div>
        {skill&&<section className="team-skill-detail" aria-label="Skill 定义详情"><h3>{skill.name}</h3><p>{skill.purpose}</p><code>{skill.id}</code><p>所属节点：{model.nodes[skill.ownerId]?.name??skill.ownerId}</p><div className="team-definition-actions">{skill.inherited?<button onClick={()=>{setChosen(skill.ownerId);setSkillId(skill.id)}}><Icon name="arrow" size={16}/><span>前往所属节点管理</span></button>:<><button disabled={!canEdit} onClick={()=>setEditor({kind:'skill',id:skill.id})}><Icon name="edit" size={16}/><span>编辑 Skill</span></button><button disabled={!canEdit} onClick={()=>setEditor({kind:'skill',id:skill.id,parentId:skill.ownerId,mode:'delete'})}><Icon name="trash" size={16}/><span>删除 Skill</span></button><button disabled={!canEdit} onClick={()=>setTransfer({mode:'publish',kind:'skill',objectId:skill.id})}><Icon name="upload" size={16}/><span>发布 Skill 到人才市场</span></button></>}</div>{skill.available?<MarkdownMessage text={skill.body} workspaceId={workspace.id}/>:<p role="alert">Skill 正文缺失，当前不能展示完整方法。</p>}</section>}
        </>}
      </section>
    </div>}
    <p className="view-footnote">组织树仅展示静态定义，历史单独只读查询。编辑与导入先预览再提交；能力归属、Skill 继承与历史浏览不授予执行权限。</p>
    {mainSettings&&<MainAgentEditor key={workspace.instanceId} workspace={workspace} onClose={()=>setMainSettings(false)}/>}
    {current&&editor&&<ArchitectureEditor workspaceId={workspace.id} snapshot={current} {...editor} onClose={()=>setEditor(undefined)} onSaved={objects=>{const saved=editor;setEditor(undefined);if(saved.mode==='delete')select(saved.parentId??TEAM_ROOT);else if(saved.kind==='agent'&&objects[0])select(objects[0]);else if(saved.kind==='skill'&&objects[0]){if(saved.parentId)setChosen(saved.parentId);setSkillId(objects[0])}void reload()}}/>}
    {current&&transfer&&<WorkspaceResourceTransfer workspaceId={workspace.id} snapshot={current} {...transfer} category="talent" onClose={()=>setTransfer(undefined)} onApplied={()=>void reload()}/>}
  </div>;
}
