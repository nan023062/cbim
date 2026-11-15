/**
 * 各专业页按模块延迟加载，首次挂载后仍保持原隐藏/卸载语义，不因切页重建草稿。
 * 页签提供方向键/Home/End 导航；工具面板持续标明项目与目录，执行在途与物理退出分别展示。
 * 旧自动化扩展条目复用固定页签的工作区视图，实例切换重建并提供原会话定位。
 * 作用定位：工作区右侧扩展页签，独立于中央对话管理浏览器、命令终端、架构与内部运行诊断视图。
 * 设计原因：空页签只呈现功能选择；收起保留组件和草稿，关闭才释放终端；业务架构取得真实工作区运行状态以复用岗位登记，静态定义提交后刷新共享快照，动态实例仍归会话任务图。网页用无宿主权限的沙箱 iframe。
 */
import {useEffect,useRef,useState,type MutableRefObject} from 'react';
import type {Snapshot,WorkspaceView} from '../../bridge/contracts/workspace';
const TeamView=deferredView<NonNullable<Parameters<typeof import('../team/TeamView').TeamView>[0]>>(()=>import('../team/TeamView').then(module=>({default:module.TeamView})),'团队架构');
const BusinessArchitecture=deferredView<NonNullable<Parameters<typeof import('../workspace/WorkspaceView').BusinessArchitecture>[0]>>(()=>import('../workspace/WorkspaceView').then(module=>({default:module.BusinessArchitecture})),'业务架构');
const AutomationView=deferredView<NonNullable<Parameters<typeof import('../automation/AutomationView').AutomationView>[0]>>(()=>import('../automation/AutomationView').then(module=>({default:module.AutomationView})),'自动化');
const WorkspaceDiagnostics=deferredView<NonNullable<Parameters<typeof import('../diagnostics/WorkspaceDiagnostics').WorkspaceDiagnostics>[0]>>(()=>import('../diagnostics/WorkspaceDiagnostics').then(module=>({default:module.WorkspaceDiagnostics})),'工作区状态');
import {deferredView} from '../components/DeferredView';
import {Icon} from '../components/Icon';
import './extensions.css';
type Kind='empty'|'browser'|'terminal'|'team'|'knowledge'|'automation'|'service';
type Panel={id:string;kind:Kind};
const names:Record<Kind,string>={empty:'新标签页',browser:'浏览器',terminal:'终端',team:'团队架构',knowledge:'业务架构',automation:'自动化',service:'工作区状态'};
const icons:Record<Kind,string>={empty:'add',browser:'browser',terminal:'terminal',team:'team',knowledge:'knowledge',automation:'workflow',service:'inspect'};
const choices:Kind[]=['browser','terminal','team','knowledge','automation'];
const api=window.cbim;
/** 每个工作区独立保存；只恢复已知类型，未知缓存不阻断主对话；旧 flow 页签从工作区扩展配置中移除。 */
export function ExtensionArea({workspace,snapshot,dirty,open,request,onClose,onOpen,refresh,onStarted}:{workspace:WorkspaceView;snapshot?:Snapshot;dirty:MutableRefObject<Set<string>>;open:boolean;request?:{kind:string;nonce:number};onClose:()=>void;onOpen:()=>void;refresh:()=>Promise<void>;onStarted?:(taskId:string,title:string)=>void}){
 const key='cbim.extensions.'+workspace.id;
 const [tabs,setTabs]=useState<Panel[]>(()=>{try{const v=JSON.parse(localStorage.getItem(key)||'[]');return Array.isArray(v)?v.filter(t=>t&&typeof t.id==='string'&&Object.hasOwn(names,t.kind)):[]}catch{return []}}),[active,setActive]=useState('');
 useEffect(()=>{try{localStorage.setItem(key,JSON.stringify(tabs))}catch{}},[key,tabs]);
 function add(kind:Kind='empty'){const t={id:crypto.randomUUID(),kind};setTabs(old=>[...old,t]);setActive(t.id);onOpen()}
 useEffect(()=>{if(request&&Object.hasOwn(names,request.kind))add(request.kind as Kind)},[request?.nonce]);
 const chosen=tabs.some(t=>t.id===active)?active:tabs[0]?.id;
 async function close(t:Panel){if(dirty.current.has(t.id)&&!confirm('此页有未提交的知识编辑，关闭并丢弃？'))return;dirty.current.delete(t.id);if(t.kind==='terminal')await api.call('terminal.close',{id:workspace.id,tabId:t.id});setTabs(old=>old.filter(x=>x.id!==t.id))}
 return <aside className="extension-area" hidden={!open} aria-label="右侧扩展区"><header className="extension-tabs"><div role="tablist" aria-label="扩展页签">{tabs.map(t=><div key={t.id} className={t.id===chosen?'active':''}><button role="tab" id={'extension-tab-'+t.id} aria-controls={'extension-panel-'+t.id} tabIndex={t.id===chosen?0:-1} aria-selected={t.id===chosen} onKeyDown={event=>{
  const index=tabs.findIndex(item=>item.id===t.id);
  const next=event.key==='Home'?0:event.key==='End'?tabs.length-1:event.key==='ArrowRight'?(index+1)%tabs.length:event.key==='ArrowLeft'?(index-1+tabs.length)%tabs.length:-1;
  if(next<0)return;event.preventDefault();setActive(tabs[next].id);document.getElementById('extension-tab-'+tabs[next].id)?.focus();
 }} onClick={()=>setActive(t.id)}><Icon name={icons[t.kind]} size={16}/>{names[t.kind]}</button><button aria-label={'关闭扩展 '+names[t.kind]} onClick={()=>void close(t)}><Icon name="close" size={16}/></button></div>)}</div><button aria-label="新增扩展页签" onClick={()=>add()}><Icon name="plus" size={16}/></button><button aria-label="收起扩展区" onClick={onClose}><Icon name="chevron" size={16}/></button></header>
 {!tabs.length&&<div className="extension-empty"><p>扩展区暂无页签</p><button onClick={()=>add()}><Icon name="add" size={16}/>新增空页签</button></div>}
 {tabs.map(t=><section key={t.id} id={'extension-panel-'+t.id} role="tabpanel" aria-labelledby={'extension-tab-'+t.id} className="extension-content" hidden={t.id!==chosen}>{t.kind==='empty'?<div className="extension-empty">{choices.map(kind=><button key={kind} onClick={()=>setTabs(old=>old.map(x=>x.id===t.id?{...x,kind}:x))}><Icon name={icons[kind]} size={20}/>打开{names[kind]}</button>)}</div>:t.kind==='browser'?<BrowserPane workspace={workspace}/>:t.kind==='terminal'?<TerminalPane workspace={workspace} tabId={t.id}/>:t.kind==='team'?<TeamView workspace={workspace} snapshot={snapshot} refresh={refresh} dirty={dirty} tabId={t.id} onStarted={onStarted}/>:t.kind==='knowledge'?<BusinessArchitecture workspace={workspace} tabId={t.id} dirty={dirty} snapshot={snapshot} refresh={refresh} onStarted={onStarted}/>:t.kind==='automation'?<AutomationView active={open&&t.id===chosen} key={workspace.id+':'+workspace.instanceId} onOpenRun={onStarted} workspace={workspace} snapshot={snapshot}/>:<WorkspaceDiagnostics workspace={workspace} snapshot={snapshot} refreshKnowledge={refresh}/>}</section>)}
 </aside>;
}
/** 沙箱网页无 preload/Node/顶层导航权限；仅接受 HTTP(S)，被站点拒绝嵌入时提供外部打开。 */
function BrowserPane({workspace}:{workspace:WorkspaceView}){
 const workspaceId=workspace.id;
 const [value,setValue]=useState('http://localhost:3000'),[url,setUrl]=useState(''),[error,setError]=useState('');
 function navigate(){try{const u=new URL(value);if(!['http:','https:'].includes(u.protocol)||u.username||u.password)throw Error('仅支持不含凭据的 HTTP(S) 地址');setUrl(u.href);setError('')}catch(e:any){setError(e.message)}}
 return <div className="browser-pane"><div className="view-context"><Icon name="browser" size={16}/><strong>{workspace.name}</strong><span>沙箱网页预览</span></div><form onSubmit={e=>{e.preventDefault();navigate()}}><input aria-label="浏览器地址" value={value} onChange={e=>setValue(e.target.value)}/><button><Icon name="browser" size={16}/>打开</button><button type="button" disabled={!url} onClick={()=>void api.call('chat.openLink',{id:workspaceId,target:url}).catch(e=>setError(e.message))}><Icon name="openExternal" size={16}/>外部打开</button></form><small>部分站点禁止嵌入或需要登录，可在系统浏览器中打开。</small>{error&&<p role="alert">{error}</p>}{url?<iframe title="扩展浏览器" src={url} sandbox="allow-scripts allow-forms"/>:<div className="extension-empty"><Icon name="browser" size={32}/><h2>预览网页</h2><p>输入网页或本地开发服务器地址；打开后在此预览。</p><p>此面板不提供桌面权限，也不会读取账号凭据。</p></div>}</div>;
}
/** 命令由用户显式执行；收起页签继续运行，关闭页签释放进程，输出最多保留 200k 字符。 */
function TerminalPane({workspace,tabId}:{workspace:WorkspaceView;tabId:string}){
 const workspaceId=workspace.id;
 const pending=useRef(false);
 const [request,setRequest]=useState<'start'|'stop'|null>(null);
 const [command,setCommand]=useState(''),[state,setState]=useState({output:'',running:false,exitCode:null as number|null}),[error,setError]=useState('');
 useEffect(()=>{let cancelled=false;const tick=()=>void api.call('terminal.read',{id:workspaceId,tabId}).then(v=>{if(!cancelled)setState(v)}).catch(e=>{if(!cancelled)setError(e.message)});tick();const timer=setInterval(tick,500);return()=>{cancelled=true;clearInterval(timer);void api.call('terminal.close',{id:workspaceId,tabId}).catch(()=>{})}},[workspaceId,tabId]);
 /** 一次点击只派发一次命令；停止回执之后仍按读取的真实 running 展示。 */
 async function execute(kind:'start'|'stop'){
  if(pending.current)return;pending.current=true;setRequest(kind);setError('');
  try{if(kind==='start')setState(await api.call('terminal.start',{id:workspaceId,tabId,command}));else await api.call('terminal.close',{id:workspaceId,tabId})}
  catch(cause){setError((cause instanceof Error?cause.message:String(cause))+'；请核对下方终端状态，操作没有自动重试。')}
  finally{pending.current=false;setRequest(null)}
 }
 return <div className="terminal-pane"><div className="view-context"><Icon name="terminal" size={16}/><strong>{workspace.name}</strong><code>{workspace.path}</code></div>
  <p>命令在以上项目根目录执行。不支持交互式程序，cd 不跨命令保留；执行可能修改项目文件。</p>
  <div className="terminal-state" role="status"><Icon name={request==='stop'?'stopping':state.running?'running':state.exitCode===null?'notRun':state.exitCode===0?'stopped':'failed'} size={16}/>{request==='start'?'正在请求执行…':request==='stop'?'正在请求停止…':state.running?'运行中':state.exitCode===null?'尚无已退出命令':'已退出 · 退出码 '+state.exitCode}</div>
  <pre aria-label="终端输出" tabIndex={0}>{state.output||'尚无输出。输入命令并点击执行。'}</pre>
  {error&&<p role="alert">{error}</p>}
  <form onSubmit={event=>{event.preventDefault();if(!state.running&&command.trim())void execute('start')}}><input aria-label="终端命令" value={command} disabled={!!request} onChange={event=>setCommand(event.target.value)} placeholder="输入命令…"/><button disabled={!!request||state.running||!command.trim()}><Icon name="play" size={16}/>{request==='start'?'请求中…':'执行'}</button><button type="button" disabled={!!request||!state.running} onClick={()=>void execute('stop')}><Icon name="stop" size={16}/>{request==='stop'?'停止请求中…':'停止'}</button></form>
  <small>收起面板不会停止命令；关闭终端页签会请求释放进程。停止是否完成以上方实际状态为准。</small>
 </div>;
}
