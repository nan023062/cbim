/**
 * 作用定位：工作区右侧扩展页签，独立于中央对话管理浏览器、命令终端、架构与内部运行诊断视图。
 * 设计原因：空页签只呈现功能选择；收起保留组件和草稿，关闭才释放终端。网页用无宿主权限的沙箱 iframe。
 */
import {useEffect,useState,type MutableRefObject} from 'react';
import type {Snapshot,WorkspaceView} from '../../bridge/contracts/workspace';
import {TeamView} from '../team/TeamView';
import {BusinessArchitecture} from '../workspace/WorkspaceView';
import {AutomationView} from '../automation/AutomationView';
import {WorkspaceDiagnostics} from '../diagnostics/WorkspaceDiagnostics';
import {Icon} from '../components/Icon';
import './extensions.css';
type Kind='empty'|'browser'|'terminal'|'team'|'knowledge'|'automation'|'service';
type Panel={id:string;kind:Kind};
const names:Record<Kind,string>={empty:'新标签页',browser:'浏览器',terminal:'终端',team:'团队架构',knowledge:'业务架构',automation:'自动化',service:'工作区状态'};
const choices:Kind[]=['browser','terminal','team','knowledge'];
const api=window.cbim;
/** 每个工作区独立保存；只恢复已知类型，未知缓存不阻断主对话；旧 flow 页签从工作区扩展配置中移除。 */
export function ExtensionArea({workspace,snapshot,dirty,open,request,onClose,onOpen,refresh}:{workspace:WorkspaceView;snapshot?:Snapshot;dirty:MutableRefObject<Set<string>>;open:boolean;request?:{kind:string;nonce:number};onClose:()=>void;onOpen:()=>void;refresh:()=>Promise<void>}){
 const key='cbim.extensions.'+workspace.id;
 const [tabs,setTabs]=useState<Panel[]>(()=>{try{const v=JSON.parse(localStorage.getItem(key)||'[]');return Array.isArray(v)?v.filter(t=>t&&typeof t.id==='string'&&Object.hasOwn(names,t.kind)):[]}catch{return []}}),[active,setActive]=useState('');
 useEffect(()=>{try{localStorage.setItem(key,JSON.stringify(tabs))}catch{}},[key,tabs]);
 function add(kind:Kind='empty'){const t={id:crypto.randomUUID(),kind};setTabs(old=>[...old,t]);setActive(t.id);onOpen()}
 useEffect(()=>{if(request&&Object.hasOwn(names,request.kind))add(request.kind as Kind)},[request?.nonce]);
 const chosen=tabs.some(t=>t.id===active)?active:tabs[0]?.id;
 async function close(t:Panel){if(dirty.current.has(t.id)&&!confirm('此页有未提交的知识编辑，关闭并丢弃？'))return;dirty.current.delete(t.id);if(t.kind==='terminal')await api.call('terminal.close',{id:workspace.id,tabId:t.id});setTabs(old=>old.filter(x=>x.id!==t.id))}
 return <aside className="extension-area" hidden={!open} aria-label="右侧扩展区"><header className="extension-tabs"><div role="tablist" aria-label="扩展页签">{tabs.map(t=><div key={t.id} className={t.id===chosen?'active':''}><button role="tab" aria-selected={t.id===chosen} onClick={()=>setActive(t.id)}>{names[t.kind]}</button><button aria-label={'关闭扩展 '+names[t.kind]} onClick={()=>void close(t)}>×</button></div>)}</div><button aria-label="新增扩展页签" onClick={()=>add()}><Icon name="plus" size={16}/></button><button aria-label="收起扩展区" onClick={onClose}>›</button></header>
 {!tabs.length&&<div className="extension-empty"><p>扩展区暂无页签</p><button onClick={()=>add()}>新增空页签</button></div>}
 {tabs.map(t=><section key={t.id} className="extension-content" hidden={t.id!==chosen} aria-label={names[t.kind]}>{t.kind==='empty'?<div className="extension-empty">{choices.map(kind=><button key={kind} onClick={()=>setTabs(old=>old.map(x=>x.id===t.id?{...x,kind}:x))}>打开{names[kind]}</button>)}</div>:t.kind==='browser'?<BrowserPane workspaceId={workspace.id}/>:t.kind==='terminal'?<TerminalPane workspaceId={workspace.id} tabId={t.id}/>:t.kind==='team'?<TeamView workspace={workspace} snapshot={snapshot}/>:t.kind==='knowledge'?<BusinessArchitecture id={workspace.id} tabId={t.id} dirty={dirty} snapshot={snapshot}/>:t.kind==='automation'?<AutomationView workspace={workspace} snapshot={snapshot}/>:<WorkspaceDiagnostics workspace={workspace} snapshot={snapshot} refreshKnowledge={refresh}/>}</section>)}
 </aside>;
}
/** 沙箱网页无 preload/Node/顶层导航权限；仅接受 HTTP(S)，被站点拒绝嵌入时提供外部打开。 */
function BrowserPane({workspaceId}:{workspaceId:string}){
 const [value,setValue]=useState('http://localhost:3000'),[url,setUrl]=useState(''),[error,setError]=useState('');
 function navigate(){try{const u=new URL(value);if(!['http:','https:'].includes(u.protocol)||u.username||u.password)throw Error('仅支持不含凭据的 HTTP(S) 地址');setUrl(u.href);setError('')}catch(e:any){setError(e.message)}}
 return <div className="browser-pane"><form onSubmit={e=>{e.preventDefault();navigate()}}><input aria-label="浏览器地址" value={value} onChange={e=>setValue(e.target.value)}/><button>打开</button><button type="button" disabled={!url} onClick={()=>void api.call('chat.openLink',{id:workspaceId,target:url}).catch(e=>setError(e.message))}>外部打开</button></form><small>部分站点禁止嵌入或需要登录，可在系统浏览器中打开。</small>{error&&<p role="alert">{error}</p>}{url?<iframe title="扩展浏览器" src={url} sandbox="allow-scripts allow-forms"/>:<div className="extension-empty">输入网页或本地开发服务器地址</div>}</div>;
}
/** 命令由用户显式执行；收起页签继续运行，关闭页签释放进程，输出最多保留 200k 字符。 */
function TerminalPane({workspaceId,tabId}:{workspaceId:string;tabId:string}){
 const [command,setCommand]=useState(''),[state,setState]=useState({output:'',running:false,exitCode:null as number|null}),[error,setError]=useState('');
 useEffect(()=>{let cancelled=false;const tick=()=>void api.call('terminal.read',{id:workspaceId,tabId}).then(v=>{if(!cancelled)setState(v)}).catch(e=>{if(!cancelled)setError(e.message)});tick();const timer=setInterval(tick,500);return()=>{cancelled=true;clearInterval(timer);void api.call('terminal.close',{id:workspaceId,tabId}).catch(()=>{})}},[workspaceId,tabId]);
 return <div className="terminal-pane"><p>命令模式 · 工作区根目录 · 不支持交互式程序，cd 不跨命令保留</p><pre aria-label="终端输出">{state.output||'等待执行命令…'}</pre>{error&&<p role="alert">{error}</p>}<form onSubmit={async e=>{e.preventDefault();try{setError('');setState(await api.call('terminal.start',{id:workspaceId,tabId,command}))}catch(e:any){setError(e.message)}}}><input aria-label="终端命令" value={command} onChange={e=>setCommand(e.target.value)} placeholder="输入命令…"/><button disabled={state.running||!command.trim()}>执行</button><button type="button" disabled={!state.running} onClick={()=>void api.call('terminal.close',{id:workspaceId,tabId})}>停止</button></form><small>{state.running?'运行中':state.exitCode===null?'':`退出码 ${state.exitCode}`}</small></div>;
}
