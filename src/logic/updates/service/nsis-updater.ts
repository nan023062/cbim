/**
 * 作用定位：electron-updater 的 Windows NSIS 适配，固定发布源并优先差分下载、校验安装包。
 * 设计原因：复用旧安装包与 blockmap 降低传输量，差分失败交由原下载器完整下载并校验；安装仍须显式业务排空。
 */
import {NsisUpdater,type UpdateCheckResult} from 'electron-updater';
import type {DesktopRelease} from '../contracts';
import type {DesktopUpdateInstaller} from './desktop-updates';
import {desktopInstallerName,desktopReleaseBase} from './desktop-releases';
/** 每次下载先重核版本与唯一 EXE；不允许远端清单把下载转为其它仓库、网络安装器或不同版本。 */
export class NsisUpdateInstaller implements DesktopUpdateInstaller {
  private updater?:NsisUpdater;private pending?:UpdateCheckResult;private error?:Error;private closed=false;private downloaded=false;
  async prepare(release:DesktopRelease){
    this.pending?.cancellationToken?.cancel();this.updater?.removeAllListeners();this.error=undefined;this.downloaded=false;
    if(this.closed)throw Error('更新已关闭');
    // GitHub 附件重定向后的对象存储不要求支持 multipart Range，逐段下载可保持兼容。
    // 当前锁定的 Provider 会同时替换目录与文件名中的版本，从原 desktop-v 标签读取旧 blockmap。
    const updater=new NsisUpdater({provider:'generic',url:desktopReleaseBase(release.version),useMultipleRangeRequest:false});this.updater=updater;
    updater.autoDownload=false;updater.autoInstallOnAppQuit=false;updater.allowDowngrade=false;updater.allowPrerelease=false;updater.disableWebInstaller=true;
    updater.disableDifferentialDownload=false;updater.logger=null;
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
