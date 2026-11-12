/**
 * 作用定位：连接 C 安装通道与同 C 的 R 资源通道，准备候选并在业务排空后记录显式切换。
 * 设计原因：沿用一个用户状态机和安装授权入口；资源包就绪包含解压校验，不在重启阶段执行安装器。
 */
import type {DesktopRelease} from '../../bridge/contracts/desktop-updates';
import type {DesktopUpdateInstaller} from './desktop-updates';
import {compareDesktopVersions,latestDesktopRelease} from './desktop-releases';
import {downloadRuntimeManifest} from './runtime-download';
import {verifyRuntimeManifest,type RuntimeManifest,type SignedRuntimeManifest} from './runtime-manifest';
import {RuntimeStore} from './runtime-store';
import {RuntimeJournal} from './runtime-journal';

type Candidate={manifest:RuntimeManifest;envelope:SignedRuntimeManifest;digest:string};
interface RuntimeUpdateSources {
  cold(signal:AbortSignal):Promise<DesktopRelease|undefined>;
  resources(tag:string,name:string,signal:AbortSignal):Promise<unknown>;
}
/** 包管理只依赖窄的重启回调；不认识窗口、任务或任何业务数据存储。 */
export class RuntimeUpdates implements DesktopUpdateInstaller {
  private candidate?:Candidate;private selected?:DesktopRelease;private prepared?:Candidate;
  private ready=false;
  private controller=new AbortController();
  constructor(private readonly store:RuntimeStore,private readonly journal:RuntimeJournal,private readonly current:RuntimeManifest,
    private readonly installer:DesktopUpdateInstaller,private readonly restart:()=>void,
    private readonly sources:RuntimeUpdateSources={cold:latestDesktopRelease,resources:downloadRuntimeManifest},
    private readonly usedEngines:()=>readonly string[]=()=>[]){}
  /** 优先当前 C 可用的 R；更高 C 仅在没有兼容资源更新时提示，不强迫所有用户先换基础包。 */
  async latest(signal:AbortSignal):Promise<DesktopRelease|undefined>{
    const coldJob=this.sources.cold(signal).then(value=>({value}),error=>({error}));
    let candidate:Candidate|undefined,resourceError:unknown;
    try{
      const raw=await this.sources.resources(`runtime-c${this.current.codeVersion}`,'latest.json',signal);
      candidate=verifyRuntimeManifest(raw,this.store.cold);
    }catch(error:any){if(error.status!==404)resourceError=error;}
    const cold=await coldJob,highest=this.journal.read().highestResource;
    if(candidate&&candidate.manifest.resourceVersion>Math.max(this.current.resourceVersion,highest)){
      this.candidate=candidate;const {manifest}=candidate;
      return {version:manifest.codeVersion,resourceVersion:manifest.resourceVersion,delivery:'resources',tag:manifest.resource.tag,notes:manifest.notes,publishedAt:manifest.createdAt};
    }
    if('value' in cold&&cold.value&&compareDesktopVersions(cold.value.version,this.current.codeVersion)>0)return cold.value;
    if(resourceError)throw resourceError;if('error' in cold)throw cold.error;
    return undefined;
  }
  async prepare(release:DesktopRelease){
    this.controller.signal.throwIfAborted();this.selected=release;this.prepared=undefined;this.ready=false;
    if(release.delivery!=='resources'){await this.installer.prepare(release);return;}
    const candidate=this.candidate;
    if(!candidate||candidate.manifest.codeVersion!==release.version||candidate.manifest.resourceVersion!==release.resourceVersion||candidate.manifest.resource.tag!==release.tag)throw Error('资源候选已变化');
    await this.store.saveManifest(candidate.envelope);this.prepared=candidate;
  }
  async download(progress:(percent:number)=>void){
    if(!this.selected)throw Error('更新尚未准备');
    if(this.selected.delivery!=='resources'){await this.installer.download(progress);this.ready=true;return;}
    if(!this.prepared)throw Error('资源候选尚未验证');
    const engines=this.prepared.manifest.engines.filter(engine=>this.usedEngines().includes(engine.kind));
    const packages=[this.prepared.manifest.resource,...engines.map(engine=>engine.package)],total=packages.reduce((sum,pkg)=>sum+pkg.bytes,0);let completed=0;
    for(const pkg of packages){await this.store.prepare(pkg,this.controller.signal,value=>progress((completed+pkg.bytes*value/100)/total*100));completed+=pkg.bytes;}
    this.ready=true;
  }
  async install(){
    this.controller.signal.throwIfAborted();
    if(!this.ready)throw Error('更新尚未准备完成');
    if(this.selected?.delivery!=='resources'){await this.installer.install();return;}
    const candidate=this.prepared;if(!candidate)throw Error('资源尚未准备');
    // 点击到退出之间可能有磁盘变化；持久授权前复核候选目录，不触碰活动版本。
    await this.store.prepare(candidate.manifest.resource,this.controller.signal);
    this.journal.authorize({digest:candidate.digest,resourceVersion:candidate.manifest.resourceVersion});this.restart();
  }
  close(){this.controller.abort();this.installer.close()}
}
