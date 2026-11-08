/**
 * 作用定位：设置页的版本／日志／手动更新入口，以及外壳中的新版提醒。
 * 设计原因：页面只读取本机状态，检查、下载和重启安装分别由用户点击；渲染远端日志为纯文本，不执行其中的链接或代码。
 */
import {useEffect,useState} from 'react';
import type {DesktopUpdateStatus} from '../../bridge/contracts/desktop-updates';
import './software-updates.css';
const api=window.cbim;
/** 仅轮询 IPC 快照，不随着页面刷新重复发起 GitHub 请求；离页后忽略迟到回包。 */
function useUpdateStatus(){
  const [status,setStatus]=useState<DesktopUpdateStatus>();
  useEffect(()=>{let live=true,running=false;const read=async()=>{if(running)return;running=true;try{const next=await api.call('desktop.updates.status');if(live)setStatus(next)}catch{}finally{running=false}};
    void read();const timer=setInterval(()=>{if(!document.hidden)void read()},1000);return()=>{live=false;clearInterval(timer)}},[]);
  return status;
}
export function SoftwareUpdates(){
  const status=useUpdateStatus(),[error,setError]=useState(''),[pending,setPending]=useState(false);
  async function act(action:'check'|'download'|'install'){setError('');setPending(true);try{await api.call(`desktop.updates.${action}`)}catch{setError('更新操作未能完成，请检查当前状态后重试。')}finally{setPending(false)}}
  const busy=pending||!!status&&['checking','downloading','installing'].includes(status.phase);
  return <section className="repository-settings" aria-label="软件更新"><h2>版本与更新</h2>
    {!status?<p>正在读取版本…</p>:<><p>CBIM Assistant · {status.currentVersion} · Windows x64</p>
      {!status.enabled?<p>当前不是正式安装版。安装正式 APP 后可接收新版提醒并手动更新。</p>:<>
        <p>发现新版时提醒；点击后才下载，再次确认后重启安装。</p>
        <button disabled={busy||status.phase==='ready'} onClick={()=>void act('check')}>{status.phase==='checking'?'正在检查…':'检查更新'}</button>
        {status.phase==='current'&&<p role="status">当前没有更高版本的桌面正式发布。</p>}
        {status.release&&<div><h3>可用版本 {status.release.version}</h3>
          {status.phase==='available'&&<button className="solid-button" disabled={busy} onClick={()=>void act('download')}>下载更新</button>}
          {status.phase==='downloading'&&<p role="status">正在下载并校验… {status.progress??0}%</p>}
          {status.phase==='ready'&&<><p>安装包已下载并校验。重启将停止正在运行的任务；工作区、历史与设置会保留。</p><button className="solid-button" disabled={busy} onClick={()=>void act('install')}>停止任务并重启安装</button></>}
          {status.phase==='installing'&&<p role="status">正在关闭任务并启动安装…</p>}
          <h4>新版更新日志</h4><pre className="software-release-notes">{status.release.notes||'此版本未提供更新日志。'}</pre>
        </div>}
        {status.checkedAt&&<p>最近检查：{new Date(status.checkedAt).toLocaleString()}</p>}
      </>}
      {(error||status.error)&&<p role="alert" className="shell-alert">{error||status.error}</p>}
      <details><summary>当前版本更新日志</summary><pre className="software-release-notes">{status.currentNotes||'此构建未附带正式更新日志。'}</pre></details>
    </>}
  </section>;
}
/** 提醒只打开设置，不会下载、退出或丢弃对话草稿；关闭提醒仅对该版本的当前窗口有效。 */
export function SoftwareUpdateNotice({openSettings}:{openSettings:()=>void}){
  const status=useUpdateStatus(),[dismissed,setDismissed]=useState('');
  if(!status?.release||dismissed===status.release.version||!['available','downloading','ready'].includes(status.phase))return null;
  return <div className="software-update-notice" role="status"><span>{status.phase==='ready'?'新版已下载，可重启安装':'发现 CBIM 新版'} · {status.release.version}</span><button onClick={openSettings}>查看更新</button><button aria-label="稍后提醒" onClick={()=>setDismissed(status.release!.version)}>稍后</button></div>;
}
