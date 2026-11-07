/**
 * 作用定位：模型供应商、运行并发、新目标软限额、仓库与共享服务设置。
 * 设计原因：模型、并发、周期软限额在固定位置独立加载和保存；仓库读取不重挂载表单或丢失草稿，新额度不改写正在执行的目标。
 */
import {useEffect,useState} from 'react';
import type {RepositoryStatus} from '../../bridge/contracts/resources';
import {ModelSettings} from './ModelSettings';
import {AdmissionSettings} from './AdmissionSettings';
import {BudgetSettings} from './BudgetSettings';
const api=window.cbim;
export function SettingsView(){
  const [status,setStatus]=useState<RepositoryStatus>(),[error,setError]=useState(''),[notice,setNotice]=useState(''),[busy,setBusy]=useState(true);
  const [localPath,setLocalPath]=useState('');
  const [lan,setLan]=useState(false),[port,setPort]=useState(0),[connection,setConnection]=useState<{url:string;host:string;port:number;token:string}>();

  useEffect(()=>{void (async()=>{try{const s:RepositoryStatus=await api.call('resources.status');setStatus(s);setError(s.error||'');if(s.config?.mode==='local')setLocalPath(s.config.location)}catch(e:any){setError(e.message)}finally{setBusy(false)}})()},[]);
  async function configure(){setBusy(true);setError('');setNotice('');try{const s=await api.call('resources.configure',{mode:'local',location:localPath});setStatus(s);setConnection(undefined);setNotice('已更新：链接器、人才市场、业务模板统一使用此仓库。')}catch(e:any){setError(e.message)}finally{setBusy(false)}}
  async function sharing(start:boolean){setBusy(true);setError('');try{setStatus(await api.call(start?'resources.share':'resources.stopSharing',start?{lan,port}:{}));setConnection(undefined)}catch(e:any){setError(e.message)}finally{setBusy(false)}}
  async function showConnection(){setError('');try{setConnection(await api.call('resources.connection'))}catch(e:any){setError(e.message)}}

  return <div className="view-page resource-library"><div className="view-heading"><div><p className="overline">CBIM / 设置</p><h1>设置</h1><p>仓库来源跟随登录状态：未登录使用本地目录，登录后自动连接服务器仓库。</p></div></div>
    {status&&<div className="repository-bar"><div><b>当前资源来源 · {status.source==='server'?'服务器仓库':'本地仓库（未登录）'}</b><small>{status.config?.location||(status.source==='server'?'等待账号服务提供仓库':'请选择本地仓库目录')}</small></div></div>}
    <p className="inline-note">链接器、人才市场、业务模板共用当前身份对应的仓库。登录后自动切换，不搬迁或合并本地资源。</p>
    {error&&<div className="shell-alert" role="alert">{error}</div>}
    {notice&&<p role="status">{notice}</p>}
    <ModelSettings/>
    <AdmissionSettings/>
    <BudgetSettings/>
    {!status?(!error&&<p role="status">正在读取仓库设置…</p>):<><section className="repository-settings"><h2>本地仓库</h2>
      {status.session.state==='signedOut'?<><p>当前未登录。选择这台电脑上的目录保存三类资源。</p><label>本地仓库文件夹<div className="repository-path"><input aria-label="本地仓库文件夹" placeholder="选择已有文件夹，或输入完整路径" value={localPath} disabled={busy} onChange={e=>setLocalPath(e.target.value)}/><button disabled={busy} onClick={async()=>{try{const p=await api.call('chooseFolder');if(p)setLocalPath(p)}catch(e:any){setError(e.message)}}}>选择文件夹</button></div></label><p>首次使用会在所选目录创建 cbim-resources.json。</p><button className="solid-button" disabled={busy||!localPath.trim()} onClick={()=>void configure()}>{busy?'正在验证…':'保存本地目录'}</button><p>更换目录不会搬迁、合并或删除原仓库的数据。</p></>:<p>已登录，当前使用账号服务器仓库。本地目录已保留，退出登录后恢复使用。</p>}
      {status?.config?.mode==='local'&&<div className="repository-sharing"><h3>让这台电脑提供仓库服务</h3>{status.sharing?<><p>服务已启动 · 端口 {status.sharing.port} · {status.sharing.host==='0.0.0.0'?'允许局域网连接':'仅本机访问'}</p><button disabled={busy} onClick={()=>void sharing(false)}>停止共享</button><button disabled={busy} onClick={()=>void showConnection()}>显示连接信息</button></>:<><label><input type="checkbox" checked={lan} disabled={busy} onChange={e=>setLan(e.target.checked)}/>允许其他电脑通过局域网连接</label><label>监听端口（0 为自动分配）<input type="number" min={0} max={65535} aria-label="监听端口" value={port} disabled={busy} onChange={e=>setPort(Number(e.target.value))}/></label><button disabled={busy||!Number.isInteger(port)||port<0||port>65535} onClick={()=>void sharing(true)}>启动仓库共享</button></>}
      {connection&&<div className="repository-connection"><label>本机服务地址<input readOnly aria-label="本机服务地址" value={connection.url}/></label><label>共享令牌<input readOnly type="password" aria-label="共享令牌" value={connection.token} onFocus={e=>e.target.select()}/></label>{connection.host==='0.0.0.0'&&<p>其他电脑请将地址中的 127.0.0.1 替换为本机局域网 IP。此令牌允许读取和修改仓库，仅交给可信成员。</p>}</div>}<p>退出应用会停止共享；重新开启时生成新令牌，不自动开放网络服务。</p></div>}
    </section>
    <section className="repository-settings"><h2>服务器仓库</h2><p>{status.session.state==='signedIn'?'已登录：由账号服务自动提供服务器仓库，无需手动选择。':'登录后自动连接账号所属的服务器仓库。'}</p><p>账号登录尚未接入，此处为服务器仓库占位；不提供手动地址或令牌配置。</p><button disabled>账号登录待接入</button></section></>}

  </div>
}
