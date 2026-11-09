/**
 * 作用定位：账号菜单的统一版本与更新弹窗，以及新版和自动重启进度提醒。
 * 设计原因：弹窗不切换全局页面，保留对话与表单草稿；只消费同一份状态，日志作为纯文本展示。
 */
import {useEffect,useId,useRef,useState} from 'react';
import type {DesktopUpdateStatus} from '../../bridge/contracts/desktop-updates';
import {Icon} from '../components/Icon';
import type {SoftwareUpdateController} from './useSoftwareUpdates';
import './software-updates.css';

/** 原生模态框限制焦点，Escape／关闭返回原入口；查看日志不检查网络、不下载或安装。 */
export function SoftwareUpdates({updates,onClose}:{updates:SoftwareUpdateController;onClose:()=>void}){
  const dialog=useRef<HTMLDialogElement>(null),title=useId();
  const {status,error,pending,act}=updates;
  useEffect(()=>{const element=dialog.current,previous=document.activeElement as HTMLElement|null;element?.showModal();
    return()=>{element?.close();if(previous?.isConnected)previous.focus()};
  },[]);
  const busy=pending||!!status&&['checking','downloading','installing'].includes(status.phase);
  return <dialog ref={dialog} className="software-updates-dialog" aria-labelledby={title} onCancel={e=>{e.preventDefault();onClose()}}>
    <header><div><p className="overline">CBIM Assistant</p><h2 id={title}>版本与更新</h2></div><button className="icon-button" aria-label="关闭版本与更新" autoFocus onClick={onClose}><Icon name="close"/></button></header>
    {!status?<p role="status">{error?'暂时无法显示版本信息。':'正在读取版本…'}</p>:<>
      <p className="software-current-version">当前版本 {status.currentVersion} · Windows x64</p>
      {!status.enabled?<p>{status.error||'当前不是正式安装版。安装正式 APP 后可接收新版提醒并更新。'}</p>:<section className="software-update-actions" aria-label="软件更新">
        <div className="software-update-heading"><div><h3>{status.release?`可用版本 ${status.release.version}`:'软件更新'}</h3><p>每分钟自动检查。点击下载后会自动校验、停止任务、安装并重启；请先保存未提交的编辑。</p></div>
          <button disabled={busy||status.phase==='ready'} onClick={()=>void act('check')}>{status.phase==='checking'?'正在检查…':'检查更新'}</button></div>
        {status.phase==='current'&&<p role="status">当前没有更高版本的桌面正式发布。</p>}
        {status.phase==='available'&&<button className="solid-button" disabled={busy} onClick={()=>void act('download')}>下载更新</button>}
        {status.phase==='downloading'&&<><p role="status">正在下载并校验… {status.progress??0}%</p><progress aria-label="更新下载进度" max={100} value={status.progress??0}/></>}
        {status.phase==='ready'&&<><p>安装包已下载并校验，上次安装未完成。处理错误后可重试，无需重复下载。</p><button className="solid-button" disabled={busy} onClick={()=>void act('install')}>重试安装并重启</button></>}
        {status.phase==='installing'&&<p role="status">下载已校验，正在保存任务并启动安装，应用将自动重启…</p>}
        {status.checkedAt&&<p className="software-update-time">最近检查：{new Date(status.checkedAt).toLocaleString()}</p>}
      </section>}
      <section className="software-latest-notes" aria-label="最近一次更新日志"><header><h3>{status.release?'新版更新日志':'最近一次更新'}</h3><span>v{status.release?.version||status.currentVersion}</span></header>
        {status.release?.publishedAt&&<p className="software-update-time">发布于 {new Date(status.release.publishedAt).toLocaleDateString()}</p>}
        <pre className="software-release-notes">{status.release?(status.release.notes||'此版本未提供更新日志。'):(status.currentNotes||'此构建未附带正式更新日志。')}</pre>
      </section>
      {status.release&&<details><summary>当前版本 {status.currentVersion} 的更新日志</summary><pre className="software-release-notes">{status.currentNotes||'此构建未附带正式更新日志。'}</pre></details>}
    </>}
    {error&&<div className="software-update-error" role="alert"><p>{error}</p><button onClick={()=>void updates.refresh()}>重试读取状态</button></div>}
  </dialog>;
}

/** 提醒只打开同一更新弹窗；关闭提醒仅对该版本的当前窗口有效，不影响账号菜单入口。 */
export function SoftwareUpdateNotice({status,onOpen}:{status?:DesktopUpdateStatus;onOpen:()=>void}){
  const [dismissed,setDismissed]=useState('');
  if(!status?.enabled||!status.release||!['available','downloading','ready','installing'].includes(status.phase)||dismissed===status.release.version&&status.phase!=='installing')return null;
  return <div className="software-update-notice" role="status"><span>{status.phase==='installing'?'下载已校验，正在准备自动安装重启':status.phase==='downloading'?`正在下载更新 ${status.progress??0}%`:status.phase==='ready'?'安装未完成，请查看并重试':'发现 CBIM 新版'} · {status.release.version}</span><button onClick={onOpen}>查看更新</button>{status.phase!=='installing'&&<button aria-label="稍后提醒" onClick={()=>setDismissed(status.release!.version)}>稍后</button>}</div>;
}
