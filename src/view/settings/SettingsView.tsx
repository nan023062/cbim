/**
 * 网页搜索设置只管理 Brave 开关和加密密钥摘要，不向页面提供任意抓取代理。
 * 作用定位：模型供应商、运行并发、新目标软限额、GitHub 反馈连接、仓库与共享服务设置；版本与更新由账号菜单独立打开。
 * 设计原因：总览卡片与分组导航区分设置范围；各表单固定挂载，切换分组只改变可见性，不丢失草稿，新额度不改写正在执行的目标。
 * IPC 边界：预算和反馈的动态入口验证操作请求；开启/停止共享各自使用确定签名。
 */
import {Icon} from '../components/Icon';
import {useCallback,useEffect,useMemo,useRef,useState} from 'react';
import type {RepositoryStatus} from '../../bridge/contracts/resources';
import {WebSettings} from './WebSettings';
import {ModelSettings} from './ModelSettings';
import {AdmissionSettings} from './AdmissionSettings';
import {BudgetSettings} from './BudgetSettings';
import {GitHubFeedbackSettings} from './GitHubFeedbackSettings';
import './settings.css';
const api=window.cbim;
const groups = [
  {id:'models',title:'模型供应商',icon:'api',description:'配置接口、模型目录与默认选择。',scope:'之后启动的任务'},
  {id:'budget',title:'额度与并发',icon:'settings',description:'管理并发占用和新目标的运行额度。',scope:'额度用于新目标；并发用于后续准入'},
  {id:'connections',title:'网页与反馈连接',icon:'connector',description:'管理搜索策略和 GitHub 反馈授权。',scope:'本机的外部服务访问'},
  {id:'repository',title:'资源仓库',icon:'folder',description:'设置本地资源位置和共享范围。',scope:'链接器、人才市场与业务模板'},
] as const;
type SettingsGroup = 'overview' | typeof groups[number]['id'];
/** 只向外壳报告是否有未保存配置，不上送字段或凭据；分组隐藏不清除标记。 */
export function SettingsView({onDirtyChange}:{onDirtyChange?:(dirty:boolean)=>void}={}){
  const drafts=useRef(new Set<string>());
  const report=useCallback((key:string,value:boolean)=>{value?drafts.current.add(key):drafts.current.delete(key);onDirtyChange?.(drafts.current.size>0)},[onDirtyChange]);
  const reporters=useMemo(()=>Object.fromEntries(['models','admission','budget','web','github'].map(key=>[key,(value:boolean)=>report(key,value)])),[report]);
  useEffect(()=>()=>onDirtyChange?.(false),[onDirtyChange]);
  const [group,setGroup]=useState<SettingsGroup>('overview');
  const [status,setStatus]=useState<RepositoryStatus>(),[error,setError]=useState(''),[notice,setNotice]=useState(''),[busy,setBusy]=useState(true);
  const [localPath,setLocalPath]=useState('');
  const [lan,setLan]=useState(false),[port,setPort]=useState(0),[connection,setConnection]=useState<{url:string;host:string;port:number;token:string}>();

  useEffect(()=>{void (async()=>{try{const s:RepositoryStatus=await api.call('resources.status');setStatus(s);setError(s.error||'');if(s.config?.mode==='local')setLocalPath(s.config.location)}catch(e:any){setError(e.message)}finally{setBusy(false)}})()},[]);
  const repositoryDirty=!!status&&status.session.state==='signedOut'&&localPath!==(status.config?.mode==='local'?status.config.location:'');
  useEffect(()=>{report('repository',repositoryDirty);return()=>report('repository',false)},[repositoryDirty,report]);
  async function configure(){setBusy(true);setError('');setNotice('');try{const s=await api.call('resources.configure',{mode:'local',location:localPath});setStatus(s);setConnection(undefined);setNotice('已更新：链接器、人才市场、业务模板统一使用此仓库。')}catch(e:any){setError(e.message)}finally{setBusy(false)}}
  async function sharing(start:boolean){setBusy(true);setError('');try{setStatus(start?await api.call('resources.share',{lan,port}):await api.call('resources.stopSharing'));setConnection(undefined)}catch(e:any){setError(e.message)}finally{setBusy(false)}}
  async function showConnection(){setError('');try{setConnection(await api.call('resources.connection'))}catch(e:any){setError(e.message)}}

  return <div className="view-page resource-library settings-page"><div className="view-heading"><div><p className="overline">CBIM / 本机设置</p><h1>设置</h1><p>按用途配置，分别保存。浏览设置不会更换当前任务的模型或项目。</p></div></div>
    <nav className="settings-navigation" aria-label="设置分组">
      <button aria-current={group==='overview'?'page':undefined} onClick={()=>setGroup('overview')}><Icon name="list" size={16}/>总览</button>
      {groups.map(item=><button key={item.id} aria-current={group===item.id?'page':undefined} onClick={()=>setGroup(item.id)}><Icon name={item.icon} size={16}/>{item.title}</button>)}
    </nav>
    <section hidden={group!=='overview'} aria-label="设置总览" className="settings-overview">
      <div className="settings-cards">{groups.map(item=><button key={item.id} className="settings-card" onClick={()=>setGroup(item.id)}>
        <Icon name={item.icon} size={24}/><span><strong>{item.title}</strong><span>{item.description}</span><small>作用范围 · {item.scope}</small></span><Icon name="chevron" size={18}/>
      </button>)}</div>
      <p className="inline-note">外观可在左下角用户菜单切换；版本与更新保留独立入口。各分组内未保存的输入会在切换时保留，离开设置页面前请完成保存。</p>
    </section>
    <div hidden={group!=='models'}><ModelSettings onDirtyChange={reporters.models}/></div>
    <div hidden={group!=='budget'}><AdmissionSettings onDirtyChange={reporters.admission}/><BudgetSettings onDirtyChange={reporters.budget}/></div>
    <div hidden={group!=='connections'}><GitHubFeedbackSettings onDirtyChange={reporters.github}/><WebSettings onDirtyChange={reporters.web}/></div>
    <div hidden={group!=='repository'}>
    {status&&<div className="repository-bar"><div><b>当前资源来源 · {status.source==='server'?'服务器仓库':'本地仓库（未登录）'}</b><small>{status.config?.location||(status.source==='server'?'等待账号服务提供仓库':'请选择本地仓库目录')}</small></div></div>}
    <p className="inline-note">链接器、人才市场、业务模板共用当前身份对应的仓库。登录后自动切换，不搬迁或合并本地资源。</p>
    {error&&<div className="shell-alert" role="alert">{error}</div>}
    {notice&&<p role="status">{notice}</p>}
    {!status?(!error&&<p role="status">正在读取仓库设置…</p>):<><section className="repository-settings"><h2>本地仓库</h2>
      {status.session.state==='signedOut'?<><p>当前未登录。选择这台电脑上的目录保存三类资源。</p><label>本地仓库文件夹<div className="repository-path"><input aria-label="本地仓库文件夹" placeholder="选择已有文件夹，或输入完整路径" value={localPath} disabled={busy} onChange={e=>setLocalPath(e.target.value)}/><button disabled={busy} onClick={async()=>{try{const p=await api.call('chooseFolder');if(p)setLocalPath(p)}catch(e:any){setError(e.message)}}}><Icon name="folder" size={16}/>选择文件夹</button></div></label><p>首次使用会在所选目录创建 cbim-resources.json。</p><button className="solid-button" disabled={busy||!localPath.trim()} onClick={()=>void configure()}>{busy?'正在验证…':'保存本地目录'}</button><p>更换目录不会搬迁、合并或删除原仓库的数据。</p></>:<p>已登录，当前使用账号服务器仓库。本地目录已保留，退出登录后恢复使用。</p>}
      {status?.config?.mode==='local'&&<div className="repository-sharing"><h3>让这台电脑提供仓库服务</h3>{status.sharing?<><p>服务已启动 · 端口 {status.sharing.port} · {status.sharing.host==='0.0.0.0'?'允许局域网连接':'仅本机访问'}</p><button disabled={busy} onClick={()=>void sharing(false)}><Icon name="stop" size={16}/>停止共享</button><button disabled={busy} onClick={()=>void showConnection()}><Icon name="inspect" size={16}/>显示连接信息</button></>:<><label><input type="checkbox" checked={lan} disabled={busy} onChange={e=>setLan(e.target.checked)}/>允许其他电脑通过局域网连接</label><label>监听端口（0 为自动分配）<input type="number" min={0} max={65535} aria-label="监听端口" value={port} disabled={busy} onChange={e=>setPort(Number(e.target.value))}/></label><button disabled={busy||!Number.isInteger(port)||port<0||port>65535} onClick={()=>void sharing(true)}><Icon name="connector" size={16}/>启动仓库共享</button></>}
      {connection&&<div className="repository-connection"><label>本机服务地址<input readOnly aria-label="本机服务地址" value={connection.url}/></label><label>共享令牌<input readOnly type="password" aria-label="共享令牌" value={connection.token} onFocus={e=>e.target.select()}/></label>{connection.host==='0.0.0.0'&&<p>其他电脑请将地址中的 127.0.0.1 替换为本机局域网 IP。此令牌允许读取和修改仓库，仅交给可信成员。</p>}</div>}<p>退出应用会停止共享；重新开启时生成新令牌，不自动开放网络服务。</p></div>}
    </section>
    <section className="repository-settings"><h2>服务器仓库</h2><p>{status.session.state==='signedIn'?'已登录：由账号服务自动提供服务器仓库，无需手动选择。':'登录后自动连接账号所属的服务器仓库。'}</p><p>账号登录尚未接入，此处为服务器仓库占位；不提供手动地址或令牌配置。</p><button disabled><Icon name="person" size={16}/>账号登录待接入</button></section></>}

    </div>
  </div>
}
