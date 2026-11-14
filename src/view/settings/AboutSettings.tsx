/**
 * 作用定位：设置中心的产品版本和更新入口，读取 App 已有更新控制器。
 * 设计原因：不创建第二份更新轮询；查看页面不会检查、下载或安装，安装继续由原更新详情显式触发。
 */
import {BrandMark} from '../components/BrandMark';
import {desktopVersionLabel} from '../../bridge/contracts/desktop-updates';
import type {SoftwareUpdateController} from '../updates/useSoftwareUpdates';
export function AboutSettings({updates,onOpenUpdates}:{updates:SoftwareUpdateController;onOpenUpdates:()=>void}){
  const {status,error,pending}=updates;
  const phaseLabel={disabled:'桌面更新不可用',idle:'尚未检查',checking:'正在检查更新',current:'当前已是最新版本',available:'发现新版本',downloading:'正在后台下载',ready:'更新已就绪',installing:'正在安装'};
  return <>
    <section className="settings-card" aria-label="关于 CBIM"><div className="settings-product"><BrandMark size={52} decorative/><div><h2>CBIM Assistant</h2><p>你的团队，新的工作方式。</p></div></div><div className="settings-row"><div><b>当前版本</b><p>{status?desktopVersionLabel(status.currentVersion,status.currentResourceVersion):'正在读取版本…'}</p></div><span className="settings-tag">Windows x64</span></div></section>
    <section className="settings-card" aria-label="桌面更新"><h2>版本与更新</h2><p role="status">{status?(status.enabled?phaseLabel[status.phase]:status.error||'源码开发模式，桌面自动更新不可用。'):'正在读取更新状态…'}</p>{status?.release&&<p>可用版本 {desktopVersionLabel(status.release.version,status.release.resourceVersion)}</p>}
      <p>正式安装版会在后台准备更新。查看日志不会中断工作，重启安装由你在更新详情中确认。</p>
      <div className="model-actions"><button className="solid-button" onClick={onOpenUpdates}>查看更新与日志</button><button disabled={pending||!status?.enabled||['checking','downloading','installing','ready'].includes(status.phase)} onClick={()=>void updates.act('check')}>检查桌面更新</button></div>
      {status?.checkedAt&&<p>最近检查：{new Date(status.checkedAt).toLocaleString()}</p>}
      {error&&<div className="settings-message" role="alert"><p>{error}</p><button disabled={pending} onClick={()=>void updates.refresh()}>重新读取版本</button></div>}
    </section>
  </>;
}
