/**
 * 作用定位：桌面手动更新的单实例状态机，协调公开发布读取、下载与显式安装。
 * 设计原因：检查、下载、退出安装分开；同一时刻只有一个操作，已校验的待安装版本不会被后台检查替换。
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
  private controller=new AbortController();private timer?:ReturnType<typeof setInterval>;private initial?:ReturnType<typeof setTimeout>;
  constructor(version:string,notes:string,enabled:boolean,private readonly latest:(signal:AbortSignal)=>Promise<DesktopRelease|undefined>,private readonly installer:DesktopUpdateInstaller){
    this.state={currentVersion:version,currentNotes:notes,enabled,phase:enabled?'idle':'disabled'};
  }
  /** 复制公开数据，读取不触发联网或下载。 */
  status():DesktopUpdateStatus{return structuredClone(this.state)}
  /** 只有正式安装版启动定时检查；后台失败只保留在设置，不强制中断当前任务。 */
  start(){if(!this.state.enabled||this.initial||this.timer)return;this.initial=setTimeout(()=>{void this.check()},10000);this.initial.unref();this.timer=setInterval(()=>{void this.check()},30*60*1000);this.timer.unref()}
  private run(action:()=>Promise<void>){
    if(this.controller.signal.aborted)return Promise.resolve(this.status());
    if(this.busy)return this.busy;
    const job=action().then(()=>this.status()).finally(()=>{if(this.busy===job)this.busy=undefined});this.busy=job;return job;
  }
  check(){
    if(!this.state.enabled||['downloading','ready','installing'].includes(this.state.phase))return Promise.resolve(this.status());
    return this.run(async()=>{const previous=this.state.release;this.state={...this.state,phase:'checking',error:undefined};
      try{const release=await this.latest(this.controller.signal);if(this.controller.signal.aborted)return;
        this.state={...this.state,checkedAt:new Date().toISOString(),release:release&&compareDesktopVersions(release.version,this.state.currentVersion)>0?release:undefined,phase:release&&compareDesktopVersions(release.version,this.state.currentVersion)>0?'available':'current'};
      }catch{if(!this.controller.signal.aborted)this.state={...this.state,release:previous,phase:previous?'available':'idle',error:'检查更新失败，请检查网络后重试。'};}
    });
  }
  /** 用户点击后才核对该发布的清单并下载；失败保留原版本，下一次显式下载重新核对。 */
  download(){
    if(this.busy)return this.busy;
    if(this.state.phase!=='available'||!this.state.release)return Promise.resolve(this.status());
    return this.run(async()=>{const release=this.state.release!;this.state={...this.state,phase:'downloading',progress:0,error:undefined};
      try{await this.installer.prepare(release);if(this.controller.signal.aborted)return;
        await this.installer.download(percent=>{if(!this.controller.signal.aborted&&Number.isFinite(percent))this.state={...this.state,progress:Math.min(100,Math.max(0,Math.round(percent)))};});
        if(!this.controller.signal.aborted)this.state={...this.state,phase:'ready',progress:100};
      }catch{if(!this.controller.signal.aborted)this.state={...this.state,phase:'available',progress:undefined,error:'下载或校验失败，请检查网络后重新下载。'};}
    });
  }
  /** 正常业务排空失败时不安装；不会把发起安装当成升级成功。 */
  install(beforeInstall:()=>Promise<void>){
    if(this.busy)return this.busy;
    if(this.state.phase!=='ready')return Promise.resolve(this.status());
    return this.run(async()=>{this.state={...this.state,phase:'installing',error:undefined};try{await beforeInstall();if(this.controller.signal.aborted)return;this.installer.install()}catch{this.state={...this.state,phase:'ready',error:'重启安装未能完成。请保留当前窗口，处理关闭错误后再试。'}}});
  }
  /** 退出取消读取／下载并移除计时器；从不在退出时隐式安装。 */
  close(){this.controller.abort();clearTimeout(this.initial);clearInterval(this.timer);this.installer.close()}
}
