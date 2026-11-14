/**
 * 作用定位：新版提醒的更新详情，展示发布日志、后台准备及显式重启安装入口；侧栏图标独立常驻。
 * 设计原因：弹窗不切换全局页面，保留对话与表单草稿；只消费同一份状态，日志作为纯文本展示。
 */
import {useEffect,useId,useRef,useState} from 'react';
import {desktopVersionLabel,type DesktopUpdateStatus} from '../../bridge/contracts/desktop-updates';
import {Icon} from '../components/Icon';
import type {SoftwareUpdateController} from './useSoftwareUpdates';
import './software-updates.css';

/** 原生模态框限制焦点，Escape／关闭返回原入口；查看日志不检查网络、不下载或安装。 */
export function SoftwareUpdates({updates,onClose}:{updates:SoftwareUpdateController;onClose:()=>void}){
  const dialog=useRef<HTMLDialogElement>(null),title=useId();
  const {status,error,pending,act}=updates;
  const currentVersion=status?desktopVersionLabel(status.currentVersion,status.currentResourceVersion):'';
  const targetVersion=status?.release?desktopVersionLabel(status.release.version,status.release.resourceVersion):currentVersion;
  useEffect(()=>{const element=dialog.current,previous=document.activeElement as HTMLElement|null;element?.showModal();
    return()=>{element?.close();if(previous?.isConnected)previous.focus()};
  },[]);
  const busy=pending||!!status&&['checking','downloading','installing'].includes(status.phase);
  return <dialog ref={dialog} className="software-updates-dialog" aria-labelledby={title} onCancel={e=>{e.preventDefault();onClose()}}>
    <header><div><p className="overline">CBIM Assistant</p><h2 id={title}>版本与更新</h2></div><button className="icon-button" aria-label="关闭版本与更新" autoFocus onClick={onClose}><Icon name="close"/></button></header>
    {!status?<p role="status">{error?'暂时无法显示版本信息。':'正在读取版本…'}</p>:<>
      <p className="software-current-version">当前版本 {currentVersion} · Windows x64</p>
      {!status.enabled?<p>{status.error||'当前不是正式安装版。安装正式 APP 后可接收新版提醒并更新。'}</p>:<section className="software-update-actions" aria-label="软件更新">
        <div className="software-update-heading"><div><h3>{status.release?`可用版本 ${targetVersion}`:'软件更新'}</h3><p>每分钟自动检查并在后台下载。下载不会停止任务；点击“重启安装”后才会停止任务、安装并重启，请先保存未提交的编辑。</p></div>
          <button disabled={busy||status.phase==='ready'} onClick={()=>void act('check')}>{status.phase==='checking'?'正在检查…':'检查更新'}</button></div>
        {status.phase==='current'&&<p role="status">当前没有更高版本的桌面正式发布。</p>}
        {status.phase==='available'&&<button className="solid-button" disabled={busy} onClick={()=>void act('download')}>重试下载</button>}
        {status.phase==='downloading'&&<><p role="status">正在后台下载并校验… {status.progress??0}%</p><progress aria-label="更新下载进度" max={100} value={status.progress??0}/></>}
        {status.phase==='ready'&&<><p>{status.error?'上次安装未完成。处理错误后可重试，无需重复下载。':'安装包已下载并校验。可以继续工作，准备好后再重启安装。'}</p><button className="solid-button" disabled={busy} onClick={()=>void act('install')}>{status.error?'重试安装并重启':'重启安装'}</button></>}
        {status.phase==='installing'&&<p role="status">下载已校验，正在保存任务并启动安装，应用将自动重启…</p>}
        {status.checkedAt&&<p className="software-update-time">最近检查：{new Date(status.checkedAt).toLocaleString()}</p>}
      </section>}
      <section className="software-latest-notes" aria-label="最近一次更新日志"><header><h3>{status.release?'新版更新日志':'最近一次更新'}</h3><span>{targetVersion}</span></header>
        {status.release?.publishedAt&&<p className="software-update-time">发布于 {new Date(status.release.publishedAt).toLocaleDateString()}</p>}
        <pre className="software-release-notes">{status.release?(status.release.notes||'此版本未提供更新日志。'):(status.currentNotes||'此构建未附带正式更新日志。')}</pre>
      </section>
      {status.release&&<details><summary>当前版本 {currentVersion} 的更新日志</summary><pre className="software-release-notes">{status.currentNotes||'此构建未附带正式更新日志。'}</pre></details>}
    </>}
    {error&&<div className="software-update-error" role="alert"><p>{error}</p><button onClick={()=>void updates.refresh()}>重试读取状态</button></div>}
  </dialog>;
}

/** 提醒只打开更新详情；关闭提醒仅对该版本的当前窗口有效，不影响侧栏更新图标。 */
export function SoftwareUpdateNotice({status,onOpen}:{status?:DesktopUpdateStatus;onOpen:()=>void}){
  const [dismissed,setDismissed]=useState('');
  const target=status?.release?desktopVersionLabel(status.release.version,status.release.resourceVersion):'';
  if(!status?.enabled||!status.release||!['available','downloading','ready','installing'].includes(status.phase)||dismissed===target&&status.phase!=='installing')return null;
  return <div className="software-update-notice" role="status"><span>{status.phase==='installing'?'下载已校验，正在准备自动安装重启':status.phase==='downloading'?`正在后台下载更新 ${status.progress??0}%`:status.phase==='ready'?(status.error?'安装未完成，请查看并重试':'更新已就绪，等待重启安装'):'发现 CBIM 新版'} · {target}</span><button onClick={onOpen}>查看更新</button>{status.phase!=='installing'&&<button aria-label="稍后提醒" onClick={()=>setDismissed(target)}>稍后</button>}</div>;
}
