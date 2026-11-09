/**
 * 作用定位：electron-updater 的 Windows NSIS 适配，只消费已选择的固定桌面发布。
 * 设计原因：沿用成熟安装包校验与缓存；关闭自动下载、退出安装和降级，显式业务排空后才重启安装。
 */
import {NsisUpdater,type UpdateCheckResult} from 'electron-updater';
import type {DesktopRelease} from '../../bridge/contracts/desktop-updates';
import type {DesktopUpdateInstaller} from './desktop-updates';
import {desktopInstallerName,desktopReleaseBase} from './desktop-releases';
/** 每次下载先重核版本与唯一 EXE；不允许远端清单把下载转为其它仓库、网络安装器或不同版本。 */
export class NsisUpdateInstaller implements DesktopUpdateInstaller {
  private updater?:NsisUpdater;private pending?:UpdateCheckResult;private error?:Error;private closed=false;private downloaded=false;
  async prepare(release:DesktopRelease){
    this.pending?.cancellationToken?.cancel();this.updater?.removeAllListeners();this.error=undefined;this.downloaded=false;
    if(this.closed)throw Error('更新已关闭');
    const updater=new NsisUpdater({provider:'generic',url:desktopReleaseBase(release.version)});this.updater=updater;
    updater.autoDownload=false;updater.autoInstallOnAppQuit=false;updater.allowDowngrade=false;updater.allowPrerelease=false;updater.disableWebInstaller=true;
    updater.disableDifferentialDownload=true;updater.logger=null;
    updater.on('error',error=>{this.error=error});
    const result=await updater.checkForUpdates();if(this.closed){result?.cancellationToken?.cancel();throw Error('更新已关闭')}
    const info=result?.updateInfo,name=desktopInstallerName(release.version);
    if(!result?.isUpdateAvailable||!result.cancellationToken||info?.version!==release.version||info.files.length!==1||info.files[0].url!==name||!info.files[0].sha512||('packages' in info&&info.packages))throw Error('更新清单与桌面发布不一致');
    this.pending=result;
  }
  async download(progress:(percent:number)=>void){
    if(this.closed||!this.updater||!this.pending)throw Error('更新尚未准备');
    this.updater.on('download-progress',value=>progress(value.percent));
    await this.updater.downloadUpdate(this.pending.cancellationToken);
    if(this.error)throw this.error;
    this.downloaded=true;
  }
  install(){if(this.closed||!this.updater||!this.downloaded||this.error)throw Error('安装包尚未就绪');this.updater.quitAndInstall(true,true)}
  close(){this.closed=true;this.pending?.cancellationToken?.cancel()}
}
