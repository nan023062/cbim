/**
 * 自动化历史按真实 taskId 打开会话，保留原草稿与附件，不调用启动。
 * 作用定位：桌面外壳：工作区下展示对话，中间固定主 Agent 会话（对话/任务视图），右侧独立扩展区承载架构/流程等视图；可调整宽度的侧边栏、工作区选择、页签、轮询、全局页面和未提交修改提示。
 * 设计原因：外壳拥有选择与布局状态，对话回调显式绑定原工作区和页签。运行管理只核实并定位原会话，保留草稿，不启动或重试；异步定位遇切屏或实例更换即失效。
 * 侧栏更新图标与新版提醒共享后台快照；图标仅在已校验就绪时安装，详情不卸载当前页面或丢弃草稿。
 * 对话标题和移除标记只归本机布局；子 Session 导航按工作区实例与主根缓存已验证投影，选择不改主 taskId 或触发执行。
 * 展开侧栏只显示团队空间文字，保留收起按钮；欢迎页产品标识仍引用同一矢量源。
 * IPC 边界：导航的操作桥按明确请求Schema解析，坏历史记录不能当完整运行。
 */
import {checkedIpcCall} from '../../bridge/contracts/ipc-call';
import {useCallback,useEffect,useRef,useState} from 'react';
import type {Snapshot,WorkspaceView} from '../../bridge/contracts/workspace';
import {ResourceRepositoryView} from '../resources/ResourceRepositoryView';
import {SettingsView} from '../settings/SettingsView';
import {SoftwareUpdates,SoftwareUpdateNotice} from '../updates/SoftwareUpdates';
import {useSoftwareUpdates} from '../updates/useSoftwareUpdates';
import {runningConversations} from '../conversation/conversation-activity';
import {WorkspaceList} from './WorkspaceList';
import {ExtensionArea} from './ExtensionArea';
import {resourceCategories,type ResourceCategory} from '../../bridge/contracts/resources';

import {renameConversation,removeConversation,mergeConversations,newTab,initialLayout,readLayouts,type Layouts,type TabLayout,type TabKind} from './tabs';
import {Icon} from '../components/Icon';
import {BrandMark} from '../components/BrandMark';
import {Empty} from '../components/Empty';
import {Conversation} from '../conversation/Conversation';
import type {TeamConversation} from '../conversation/team-conversations';



import {UserMenu} from './UserMenu';
import {useSidebarWidth} from './useSidebarWidth';

import {RuntimeOverview} from '../runtime/RuntimeOverview';
import type {RuntimeNavigationTarget} from '../runtime/runtime-view-state';
import {RuntimeNavigationResolver,bindRuntimeConversation,type RuntimeNavigationRequest} from './runtime-navigation';
const api=window.cbim;
/** 同一工作区的会话页签保持挂载并传递 active；切换工作区或全局页面会卸载视图，但不停止后台执行。 */
export function App(){
  const sidebarSize=useSidebarWidth();
  const updates=useSoftwareUpdates(),[updateView,setUpdateView]=useState(false);
  /** 合并入口只叠加版本、日志和检查操作，不卸载当前页面或隐式下载。 */
  function openUpdates(){setUpdateView(true)}
  const [catalog,setCatalog]=useState<any>({entries:[]}),[selected,setSelected]=useState(''),[screen,setScreen]=useState<'workspace'|'settings'|'runtime'|ResourceCategory>('workspace');
  const runtimeResolver=useRef(new RuntimeNavigationResolver((action,args)=>api.call(...checkedIpcCall(action,args))));
  const runtimeSequence=useRef(0);
  const [runtimeNavigation,setRuntimeNavigation]=useState<RuntimeNavigationRequest>();
  const [runtimeNavigationError,setRuntimeNavigationError]=useState('');
  const [snapshots,setSnapshots]=useState<Record<string,Snapshot>>({}),[layouts,setLayouts]=useState<Layouts>(()=>{try{return readLayouts(localStorage.getItem('cbim.workspace.tabs.v1'))}catch{return {}}});
  const [running,setRunning]=useState<Record<string,string[]>>({});
  const [teamChats,setTeamChats]=useState<Record<string,TeamConversation[]>>({}),[selectedChildren,setSelectedChildren]=useState<Record<string,string|undefined>>({});
  const observeTeamChats=useCallback((key:string,items:TeamConversation[])=>setTeamChats(old=>JSON.stringify(old[key])===JSON.stringify(items)?old:{...old,[key]:items}),[]);
  const [extensionOpen,setExtensionOpen]=useState<Record<string,boolean>>({});
  const [extensionRequest,setExtensionRequest]=useState<{workspaceId:string;kind:string;nonce:number}>();
  function openExtension(kind:string){setExtensionOpen(old=>({...old,[selected]:true}));setExtensionRequest({workspaceId:selected,kind,nonce:Date.now()})}
  const openingRequests=useRef(new Set<string>());
  const [openingIds,setOpeningIds]=useState<Set<string>>(new Set());
  const [error,setError]=useState(''),[busy,setBusy]=useState(''),[search,setSearch]=useState(''),[settings,setSettings]=useState(false),[sidebar,setSidebar]=useState(true);
  const [theme,setTheme]=useState(()=>{try{return localStorage.getItem('cbim.theme')||'dark'}catch{return 'dark'}});
  const dirty=useRef(new Set<string>()),snapshotCache=useRef<Record<string,Snapshot>>({}),loading=useRef(new Set<string>()),alive=useRef(true),listRequest=useRef(0);
  const workspaces:WorkspaceView[]=catalog.entries,current=workspaces.find(w=>w.id===selected),layout=layouts[selected],active=layout?.tabs.find(t=>t.id===layout.active&&t.kind==='chat')||layout?.tabs.find(t=>t.kind==='chat');
  const currentOpening=openingIds.has(selected)||current?.state==='opening';
  useEffect(()=>{document.documentElement.dataset.theme=theme;try{localStorage.setItem('cbim.theme',theme)}catch{}},[theme]);
  useEffect(()=>{try{localStorage.setItem('cbim.workspace.tabs.v1',JSON.stringify(layouts))}catch{setError('页签或草稿保存失败，本次修改仅保留在当前窗口。请检查本机存储空间。')}},[layouts]);
  async function loadSnapshot(w:WorkspaceView,force=false){if(loading.current.has(w.id))return;const cache=snapshotCache.current[w.id];if(!force&&cache&&cache.revision===w.revision&&cache.instanceId===w.instanceId&&!w.changed)return;loading.current.add(w.id);try{const snap=await api.call('snapshot',{id:w.id});snapshotCache.current[w.id]=snap;if(alive.current)setSnapshots(old=>({...old,[w.id]:snap}))}catch(e:any){if(alive.current)setError(`${w.name}：${e.message}`)}finally{loading.current.delete(w.id)}}
  async function refresh(){const request=++listRequest.current;const data=await api.call('list');if(!alive.current||request!==listRequest.current)return;setCatalog(data);void api.call('runtime.snapshot').then(snapshot=>{if(alive.current&&request===listRequest.current)setRunning(runningConversations(snapshot))}).catch(()=>{if(alive.current&&request===listRequest.current)setRunning({})});for(const w of data.entries as WorkspaceView[])if(w.state==='running'){void loadSnapshot(w);void api.call('loop.list',{id:w.id}).then(records=>{if(!alive.current||request!==listRequest.current)return;setLayouts(old=>{const merged=mergeConversations(old[w.id],records);return merged&&merged!==old[w.id]?{...old,[w.id]:merged}:old})}).catch(()=>{})}}
  useEffect(()=>{alive.current=true;void refresh().catch(e=>setError(e.message));const timer=setInterval(()=>void refresh().catch(e=>setError(e.message)),1200);return()=>{alive.current=false;runtimeResolver.current.cancel();clearInterval(timer)}},[]);
  async function perform(label:string,fn:()=>Promise<unknown>){setBusy(label);setError('');try{await fn()}catch(e:any){setError(e.message)}finally{setBusy('');await refresh().catch(e=>setError(e.message))}}
  function canLeave(){return !dirty.current.size||confirm('有尚未提交的知识编辑，离开将丢弃这些编辑。继续吗？')}
  function ensureLayout(id:string,kind?:TabKind){setLayouts(old=>{let l=old[id]||initialLayout();if(!l.tabs.some(t=>t.kind==='chat')){const chat=newTab('chat');l={...l,tabs:[...l.tabs,chat],active:chat.id}}if(kind){const existing=l.tabs.find(t=>t.kind===kind);if(existing)l={...l,active:existing.id};else{const tab=newTab(kind);l={...l,tabs:[...l.tabs,tab],active:tab.id}}}return {...old,[id]:l}})}
  async function openWorkspace(id:string){
    if(openingRequests.current.has(id))return;
    openingRequests.current.add(id);setOpeningIds(new Set(openingRequests.current));setError('');
    const name=workspaces.find(w=>w.id===id)?.name||'工作区';
    try{await api.call('open',{id})}catch(e:any){setError(`${name}：${e.message}`)}
    finally{await refresh().catch(e=>setError(`${name}：${e.message}`));openingRequests.current.delete(id);setOpeningIds(new Set(openingRequests.current))}
  }
  function cancelRuntimeNavigation(){runtimeResolver.current.cancel();setRuntimeNavigation(undefined);setRuntimeNavigationError('')}
  function select(id:string,kind?:TabKind,openOnSelect=true){if((selected!==id||screen!=='workspace')&&!canLeave())return;cancelRuntimeNavigation();if(selected!==id)dirty.current.clear();setSelected(id);setScreen('workspace');ensureLayout(id,kind);setSettings(false);const state=workspaces.find(w=>w.id===id)?.state;if(openOnSelect&&!['opening','closing','missing'].includes(state||''))void openWorkspace(id)}
  function global(kind:ResourceCategory|'settings'|'runtime'){if(!canLeave())return;cancelRuntimeNavigation();dirty.current.clear();setScreen(kind);setSettings(false)}
  /** 运行总览的显式导航只有读取与本机布局副作用；核实期间切屏后忽略迟到结果。 */
  async function openRuntimeTarget(target:RuntimeNavigationTarget){
    if(!canLeave())return;setError('');setRuntimeNavigationError('');setRuntimeNavigation(undefined);
    try{
      const verified=await runtimeResolver.current.resolve(target);if(!alive.current||!verified)return;
      dirty.current.clear();setCatalog((old:any)=>({...old,entries:old.entries.some((entry:WorkspaceView)=>entry.id===verified.workspace.id)?old.entries.map((entry:WorkspaceView)=>entry.id===verified.workspace.id?verified.workspace:entry):[...old.entries,verified.workspace]}));
      setLayouts(old=>({...old,[verified.workspace.id]:bindRuntimeConversation(old[verified.workspace.id],verified)}));
      setRuntimeNavigation({...verified.target,instanceId:verified.workspace.instanceId!,requestId:++runtimeSequence.current});
      setSelected(verified.workspace.id);setScreen('workspace');setSettings(false);
    }catch(error){if(alive.current)setRuntimeNavigationError(error instanceof Error?error.message:'原会话定位失败。')}
  }
  function updateLayout(fn:(layout:TabLayout)=>TabLayout){setLayouts(old=>({...old,[selected]:fn(old[selected]||initialLayout())}))}
  function newConversation(id:string){if(!canLeave())return;cancelRuntimeNavigation();if(selected!==id)dirty.current.clear();setSelected(id);setScreen('workspace');setSettings(false);const state=workspaces.find(w=>w.id===id)?.state;if(!['opening','closing','missing'].includes(state||''))void openWorkspace(id);const t=newTab('chat');setLayouts(old=>{const l=old[id]||{tabs:[],active:''};return {...old,[id]:{...l,tabs:[...l.tabs,t],active:t.id}}})}
  async function addWorkspace(){if(!canLeave())return;await perform('添加工作区',async()=>{const folder=await api.call('chooseFolder');if(!folder)return;const w=await api.call('add',{path:folder});select(w.id,undefined,false);await openWorkspace(w.id)})}
  /** 绑定真实启动回执到原工作区；不覆盖已有草稿或假造执行完成。 */
  function showStartedTask(workspaceId:string,taskId:string,title:string){setLayouts(old=>{const layout=old[workspaceId]??initialLayout(),existing=layout.tabs.find(tab=>tab.taskId===taskId),tab=existing??{...newTab('chat'),taskId,title};return {...old,[workspaceId]:{...layout,tabs:existing?layout.tabs:[...layout.tabs,tab],active:tab.id}}})}
  function renameChat(workspaceId:string,tabId:string,title:string){setLayouts(old=>old[workspaceId]?{...old,[workspaceId]:renameConversation(old[workspaceId],tabId,title)}:old)}
  function removeChat(workspaceId:string,tabId:string){cancelRuntimeNavigation();setLayouts(old=>old[workspaceId]?{...old,[workspaceId]:removeConversation(old[workspaceId],tabId)}:old)}
  function changeDraft(id:string,draft:string){updateLayout(l=>({...l,tabs:l.tabs.map(t=>t.id===id?{...t,draft}:t)}))}
  return <div className={'desktop-shell '+(!sidebar?'sidebar-collapsed':'')}>
    <aside className="workspace-sidebar" style={{width:sidebarSize.width,flexBasis:sidebarSize.width}}>
    <div className="sidebar-resize" {...sidebarSize.handle}/><div className="sidebar-top"><button className="icon-button" aria-label="收起侧栏" onClick={()=>setSidebar(false)}><Icon name="menu"/></button><span className="sidebar-title">团队空间</span></div><div className="primary-nav"><button data-testid="runtime-navigation-entry" className={screen==='runtime'?'selected':''} onClick={()=>global('runtime')}><Icon name="flow"/>运行管理</button><button onClick={()=>void addWorkspace()} disabled={!!busy}><Icon name="plus"/>新建工作区</button><button className={screen==='connectors'?'selected':''} onClick={()=>global('connectors')}><Icon name="plug"/>链接器<span className="nav-caption">工具桥梁</span></button><button className={screen==='talent'?'selected':''} onClick={()=>global('talent')}><Icon name="team"/>人才市场</button><button className={screen==='templates'?'selected':''} onClick={()=>global('templates')}><Icon name="knowledge"/>业务模版</button></div><div className="sidebar-search"><Icon name="search" size={16}/><input aria-label="搜索工作区" placeholder="搜索工作区…" value={search} onChange={e=>setSearch(e.target.value)}/></div><div className="sidebar-label"><span>工作区</span><span>{workspaces.length}</span></div><nav className="workspace-list" aria-label="所有工作区"><WorkspaceList teamChats={teamChats} selectedChildren={selectedChildren} onChild={(id,t,childId)=>{select(id);setSelectedChildren(old=>({...old,[t.id]:childId}));setLayouts(old=>({...old,[id]:{...old[id],active:t.id}}))}} onSettings={id=>{select(id);setSettings(true)}} running={running} onRenameChat={renameChat} onRemoveChat={removeChat} workspaces={workspaces.filter(w=>(w.name+' '+w.path).toLowerCase().includes(search.toLowerCase()))} layouts={layouts} selected={screen==='workspace'?selected:''} busy={!!busy} onSelect={id=>select(id)} onChat={(id,t)=>{select(id);setSelectedChildren(old=>({...old,[t.id]:undefined}));setLayouts(old=>({...old,[id]:{...old[id],active:t.id}}))}} onNew={id=>newConversation(id)} onRename={(id,name)=>perform('重命名项目',()=>api.call('rename',{id,name}))} onRemove={id=>perform('移除项目',async()=>{if(!canLeave())return;await api.call('remove',{id});if(selected===id){setSelected('');dirty.current.clear()}})}/>{!workspaces.length&&<p className="sidebar-hint">添加项目，开始团队协作。</p>}{workspaces.length>0&&!workspaces.some(w=>(w.name+' '+w.path).toLowerCase().includes(search.toLowerCase()))&&<p className="sidebar-hint">没有匹配的工作区。</p>}</nav><UserMenu theme={theme} toggleTheme={()=>setTheme(t=>t==='dark'?'light':'dark')} openSettings={()=>global('settings')} updates={updates}/></aside>
    <main className={'workspace-main'+(screen==='workspace'&&active?.kind==='chat'?' chat-focused':'')+(settings?' settings-open':'')}><div className="workspace-topbar">{!sidebar&&<button className="icon-button" aria-label="展开侧栏" onClick={()=>setSidebar(true)}><Icon name="menu"/></button>}<Icon name={screen==='runtime'?'flow':screen==='settings'?'settings':screen==='connectors'?'plug':screen==='talent'?'team':screen==='templates'?'knowledge':'folder'} size={16}/><strong>{screen==='workspace'?current?.name||'工作区':screen==='settings'?'设置':screen==='runtime'?'运行管理':resourceCategories[screen].label}</strong>{screen==='workspace'&&current&&<><span className="topbar-separator">/</span><span className="topbar-context">{active?.title||'团队空间'}</span></>}<div className="topbar-right">{current&&screen==='workspace'&&<button aria-label={extensionOpen[selected]?'收起右侧扩展':'展开右侧扩展'} onClick={()=>setExtensionOpen(old=>({...old,[selected]:!old[selected]}))}><Icon name="menu" size={16}/></button>}{current&&screen==='workspace'&&<></>}</div></div>
    <SoftwareUpdateNotice status={updates.status} onOpen={openUpdates}/>
    {(error||runtimeNavigationError||catalog.warning)&&<div role="alert" data-testid={runtimeNavigationError?'runtime-navigation-error':undefined} className="shell-alert">{runtimeNavigationError||error||catalog.warning}<button className="icon-button" aria-label="关闭错误提示" onClick={()=>{setError('');setRuntimeNavigationError('')}}><Icon name="close" size={14}/></button></div>}{busy&&<div role="status" className="busy-line">{busy}…</div>}
    {settings&&current&&<section className="workspace-settings"><div><h2>工作区设置</h2><p>{current.path}</p><p>已注册工作区随 CBIM 启动，关闭页面不会停止其内部任务运行。可在工作区状态中查看运行状态与知识校验问题。</p></div><div className="settings-actions"><button onClick={()=>{openExtension('automation');setSettings(false)}}>自动化</button><button onClick={()=>{openExtension('service');setSettings(false)}}>工作区状态</button><button onClick={()=>{if(canLeave()){dirty.current.clear();setSelected('');setSettings(false)}}}>关闭工作区页面</button><button onClick={()=>void perform('打开工作区',()=>api.call('open',{id:current.id}))}>{current.state==='running'?'刷新工作区':'重试打开工作区'}</button><button onClick={()=>{if(!canLeave())return;void perform('重新定位',async()=>{const p=await api.call('chooseFolder');if(p&&confirm('确认这是原工程的新位置？旧本机历史将保留，不自动合并。')){const w=await api.call('relocate',{id:current.id,path:p,confirm:true});dirty.current.clear();select(w.id)}})}}>重新定位</button><button onClick={()=>{if(canLeave()&&confirm('移除此工作区登记并停止其任务运行？项目文件与本机历史会保留。'))void perform('移除登记',async()=>{await api.call('remove',{id:current.id});setSelected('');dirty.current.clear()})}}>移除登记</button></div></section>}
    {screen!=='workspace'?<div className="shell-scroll">{screen==='runtime'?<RuntimeOverview onOpen={target=>void openRuntimeTarget(target)}/>:screen==='settings'?<SettingsView/>:<ResourceRepositoryView key={screen} category={screen} onSettings={()=>global('settings')}/>}</div>:!current?<div className="workspace-welcome"><div className="intro-emblem"><BrandMark size={64} decorative/></div><p className="overline">CBIM Assistant · 团队工作空间</p><h1>你的团队，新的工作方式</h1><p>连接团队能力、项目知识与每一次协作。</p><button className="solid-button" onClick={()=>void addWorkspace()}><Icon name="plus" size={17}/>新建工作区</button><small>选择一个现有项目目录，建立团队工作空间。</small></div>:<>
    <div className="workspace-split"><div className="main-conversation">{current.state!=='running'?<Empty icon="folder" title={currentOpening?'正在打开工作区…':'工作区尚未就绪'}><p>{current.error||'选择左侧工作区以启动内部运行环境。'}</p><button onClick={()=>void openWorkspace(current.id)}>重试打开</button></Empty>:<div className="workspace-panels">{layout?.tabs.filter(t=>t.kind==='chat').map(t=><div key={current.id+':'+current.instanceId+':'+t.id} role="tabpanel" aria-label={t.title} hidden={t.id!==active?.id} className="workspace-panel"><Conversation selectedChild={selectedChildren[t.id]} onTeamConversations={observeTeamChats} onOpenAutomationRun={(taskId,title)=>showStartedTask(current.id,taskId,title)} conversations={layout.tabs.filter(item=>item.kind==='chat')} runningTaskIds={running[current.id]??[]} onSelectConversation={tabId=>{setSelectedChildren(old=>({...old,[tabId]:undefined}));setLayouts(old=>({...old,[current.id]:{...old[current.id],active:tabId}}))}} onRenameConversation={(tabId,title)=>renameChat(current.id,tabId,title)} onRemoveConversation={tabId=>removeChat(current.id,tabId)} active={t.id===active?.id} navigation={runtimeNavigation?.workspaceId===current.id&&runtimeNavigation.rootSessionId===t.taskId?runtimeNavigation:undefined} onNavigationHandled={requestId=>setRuntimeNavigation(old=>old?.requestId===requestId?undefined:old)} tab={t} workspace={current} onDraft={draft=>changeDraft(t.id,draft)} openView={kind=>openExtension(kind)} onBind={taskId=>{cancelRuntimeNavigation();if(!taskId){newConversation(current.id);return}setLayouts(old=>({...old,[current.id]:{...old[current.id],tabs:old[current.id].tabs.filter(x=>x.id===t.id||x.taskId!==taskId).map(x=>x.id===t.id?{...x,taskId}:x)}}))}} openSettings={()=>global('settings')} onAttachments={attachments=>setLayouts(old=>({...old,[current.id]:{...old[current.id],tabs:old[current.id].tabs.map(x=>x.id===t.id?{...x,attachments}:x)}}))}/></div>)}</div>}</div><ExtensionArea key={current.id} workspace={current} snapshot={snapshots[current.id]} dirty={dirty} open={!!extensionOpen[current.id]} request={extensionRequest?.workspaceId===current.id?extensionRequest:undefined} onOpen={()=>{setExtensionOpen(old=>({...old,[current.id]:true}));setExtensionRequest(undefined)}} onClose={()=>setExtensionOpen(old=>({...old,[current.id]:false}))} refresh={()=>loadSnapshot(current,true)} onStarted={(taskId,title)=>showStartedTask(current.id,taskId,title)}/></div></>}
    </main>{updateView&&<SoftwareUpdates updates={updates} onClose={()=>setUpdateView(false)}/>}</div>
}
