/**
 * 作用定位：桌面更新的单实例状态机，后台检查并预下载，用户确认后才排空业务和重启安装。
 * 设计原因：把联网等待移到后台，同时将下载和安装授权分开；已校验候选冻结，普通退出和迟到回包都不能触发安装。
 */
import type {DesktopRelease,DesktopUpdateStatus} from '../../bridge/contracts/desktop-updates';
import {compareDesktopVersions} from './desktop-releases';
/** 私有平台端口；安装仅在调用方正常关闭并排空业务后触发，不能由模型或公开 IPC 提供命令。 */
export interface DesktopUpdateInstaller {
  prepare(release:DesktopRelease):Promise<void>;
  download(progress:(percent:number)=>void):Promise<void>;
  install():void;
  close():void;
}
export class DesktopUpdates {
  private state:DesktopUpdateStatus;private busy?:Promise<DesktopUpdateStatus>;
  /** 下载失败后五分钟内只检查版本；手动重试或发现另一版本不受此冷却限制。 */
  private retryDownloadAfter=0;
  private controller=new AbortController();private timer?:ReturnType<typeof setInterval>;private initial?:ReturnType<typeof setTimeout>;
  constructor(version:string,notes:string,enabled:boolean,private readonly latest:(signal:AbortSignal)=>Promise<DesktopRelease|undefined>,private readonly installer:DesktopUpdateInstaller,private readonly beforeInstall:()=>Promise<void>){
    this.state={currentVersion:version,currentNotes:notes,enabled,phase:enabled?'idle':'disabled'};
  }
  /** 复制公开数据，读取不触发联网或下载。 */
  status():DesktopUpdateStatus{return structuredClone(this.state)}
  /** 只有正式安装版启动检查与预下载；下载完成不排空业务，也不自动安装。 */
  start(){if(!this.state.enabled||this.controller.signal.aborted||this.initial||this.timer)return;this.initial=setTimeout(()=>{void this.check()},10000);this.initial.unref();this.timer=setInterval(()=>{void this.check()},60*1000);this.timer.unref()}
  private run(action:()=>Promise<void>){
    if(this.controller.signal.aborted)return Promise.resolve(this.status());
    if(this.busy)return this.busy;
    const job=action().then(()=>this.status()).finally(()=>{if(this.busy===job)this.busy=undefined});this.busy=job;return job;
  }
  check(){
    if(!this.state.enabled||['downloading','ready','installing'].includes(this.state.phase))return Promise.resolve(this.status());
    return this.run(async()=>{
      const previous=this.state;
      this.state={...this.state,phase:'checking',error:undefined};
      try{
        const latest=await this.latest(this.controller.signal);
        if(this.controller.signal.aborted)return;
        const release=latest&&compareDesktopVersions(latest.version,this.state.currentVersion)>0?latest:undefined;
        if(release?.version!==previous.release?.version)this.retryDownloadAfter=0;
        this.state={...this.state,checkedAt:new Date().toISOString(),release,phase:release?'available':'current',progress:undefined};
        if(release){
          if(Date.now()>=this.retryDownloadAfter)await this.downloadCandidate(release);
          else this.state={...this.state,error:previous.error};
        }
      }catch{
        if(!this.controller.signal.aborted)this.state={...this.state,checkedAt:new Date().toISOString(),release:previous.release,phase:previous.release?'available':'idle',error:'暂时无法检查更新，将在下一分钟自动重试，也可手动检查。'};
      }
    });
  }
  /** 手动重试只准备安装包，与后台预下载共用同一在途操作；不授权停止任务或重启。 */
  download(){
    if(this.busy)return this.busy;
    if(this.state.phase!=='available'||!this.state.release)return Promise.resolve(this.status());
    const release=this.state.release;
    return this.run(()=>this.downloadCandidate(release));
  }
  /** 候选在准备和下载期间冻结；完整校验成功才公开 ready，失败有限频后台重试。 */
  private async downloadCandidate(release:DesktopRelease){
    this.state={...this.state,phase:'downloading',progress:0,error:undefined};
    try{
      await this.installer.prepare(release);
      if(this.controller.signal.aborted)return;
      await this.installer.download(percent=>{
        if(!this.controller.signal.aborted&&Number.isFinite(percent))this.state={...this.state,progress:Math.min(100,Math.max(0,Math.round(percent)))};
      });
      if(!this.controller.signal.aborted){
        this.retryDownloadAfter=0;
        this.state={...this.state,phase:'ready',progress:100};
      }
    }catch{
      if(!this.controller.signal.aborted){
        this.retryDownloadAfter=Date.now()+5*60*1000;
        this.state={...this.state,phase:'available',progress:undefined,error:'下载或校验失败，五分钟后自动重试，也可手动重试下载。'};
      }
    }
  }
  /** 用户明确确认重启时安装已校验候选；在途下载不排队安装，须就绪后再次确认。 */
  install(){
    if(this.busy)return this.busy;
    if(this.state.phase!=='ready')return Promise.resolve(this.status());
    return this.run(()=>this.installReady());
  }
  /** installing 先公开两秒供窗口呈现进度；这段期间普通退出会取消，随后必须等待真实业务排空。 */
  private async installReady(){
    this.state={...this.state,phase:'installing',error:undefined};
    try{
      await new Promise<void>(resolve=>{const signal=this.controller.signal;const done=()=>{clearTimeout(timer);signal.removeEventListener('abort',done);resolve()};const timer=setTimeout(done,2000);signal.addEventListener('abort',done,{once:true});if(signal.aborted)done()});
      if(this.controller.signal.aborted)return;
      await this.beforeInstall();if(this.controller.signal.aborted)return;
      this.installer.install();
    }catch{if(!this.controller.signal.aborted)this.state={...this.state,phase:'ready',error:'重启安装未能完成。请保留当前窗口，处理关闭错误后再试。'}}
  }
  /** 退出取消读取／下载并移除计时器；从不在退出时隐式安装。 */
  close(){this.controller.abort();clearTimeout(this.initial);clearInterval(this.timer);this.installer.close();this.state={...this.state,enabled:false,phase:'disabled',error:'更新服务已停止，重新启动应用后可恢复检查。'}}
}
