/**
 * 作用定位：桌面更新的单实例状态机，每分钟检查，用户下载后串联校验、业务排空和重启安装。
 * 设计原因：一次点击由后端持有完整流程，关闭弹窗或丢失回包不重复提交；失败只允许显式重试，已选候选不会被后台检查替换。
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
  constructor(version:string,notes:string,enabled:boolean,private readonly latest:(signal:AbortSignal)=>Promise<DesktopRelease|undefined>,private readonly installer:DesktopUpdateInstaller,private readonly beforeInstall:()=>Promise<void>){
    this.state={currentVersion:version,currentNotes:notes,enabled,phase:enabled?'idle':'disabled'};
  }
  /** 复制公开数据，读取不触发联网或下载。 */
  status():DesktopUpdateStatus{return structuredClone(this.state)}
  /** 只有正式安装版启动定时检查；后台失败只保留在设置，不强制中断当前任务。 */
  start(){if(!this.state.enabled||this.controller.signal.aborted||this.initial||this.timer)return;this.initial=setTimeout(()=>{void this.check()},10000);this.initial.unref();this.timer=setInterval(()=>{void this.check()},60*1000);this.timer.unref()}
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
      }catch{if(!this.controller.signal.aborted)this.state={...this.state,checkedAt:new Date().toISOString(),release:previous,phase:previous?'available':'idle',error:'暂时无法检查更新，将在下一分钟自动重试，也可手动检查。'};}
    });
  }
  /** 一次明确下载授权包含随后的安装重启；下载失败不排空，成功后只安装该冻结候选。 */
  download(){
    if(this.busy)return this.busy;
    if(this.state.phase!=='available'||!this.state.release)return Promise.resolve(this.status());
    return this.run(async()=>{const release=this.state.release!;this.state={...this.state,phase:'downloading',progress:0,error:undefined};
      try{await this.installer.prepare(release);if(this.controller.signal.aborted)return;
        await this.installer.download(percent=>{if(!this.controller.signal.aborted&&Number.isFinite(percent))this.state={...this.state,progress:Math.min(100,Math.max(0,Math.round(percent)))};});
        if(!this.controller.signal.aborted)this.state={...this.state,phase:'ready',progress:100};
      }catch{if(!this.controller.signal.aborted)this.state={...this.state,phase:'available',progress:undefined,error:'下载或校验失败，请检查网络后重新下载。'};return;}
      if(!this.controller.signal.aborted)await this.installReady();
    });
  }
  /** 仅用于上次排空/安装失败后的明确重试；不会重新下载或由计时器调用。 */
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
