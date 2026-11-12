/**
 * 作用定位：管理资源 / 引擎不可变版本目录及其签名清单；后台准备不修改活动选择。
 * 设计原因：按内容摘要去重并合并同一包的并发下载，已存在目录仍核验；失败候选不覆盖正在使用的文件。
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {extractRuntimeArchive,verifyRuntimeDirectory} from './runtime-archive';
import {downloadRuntimePackage} from './runtime-download';
import {verifyRuntimeManifest,type ColdRuntime,type RuntimePackage,type SignedRuntimeManifest} from './runtime-manifest';

export type RuntimePackageDownloader=typeof downloadRuntimePackage;
/** 缓存仅含发布代码；用户数据、engineHome 与业务工作区不得位于此根目录。 */
export class RuntimeStore {
  private preparing=new Map<string,Promise<string>>();
  constructor(readonly root:string,readonly cold:ColdRuntime,private readonly download:RuntimePackageDownloader=downloadRuntimePackage){}
  packageRoot(pkg:RuntimePackage){return path.join(this.root,'packages',pkg.sha256)}
  manifestPath(digest:string){if(!/^[a-f0-9]{64}$/.test(digest))throw Error('资源身份无效');return path.join(this.root,'manifests',digest+'.json')}
  async saveManifest(envelope:SignedRuntimeManifest){
    const checked=verifyRuntimeManifest(envelope,this.cold);const file=this.manifestPath(checked.digest);
    await fs.mkdir(path.dirname(file),{recursive:true});
    const existing=await fs.lstat(file).catch(error=>{if(error.code==='ENOENT')return undefined;throw error});
    if(existing){const old=await this.readManifest(checked.digest);if(old.envelope.payload!==envelope.payload)throw Error('资源清单身份冲突');return checked;}
    const temporary=file+'.'+randomUUID()+'.tmp',handle=await fs.open(temporary,'wx',0o600);
    try{await handle.writeFile(JSON.stringify(envelope));await handle.sync()}finally{await handle.close()}
    await fs.rename(temporary,file);await this.readManifest(checked.digest);
    return checked;
  }
  async readManifest(digest:string){
    const file=this.manifestPath(digest),stat=await fs.lstat(file);if(!stat.isFile()||stat.isSymbolicLink()||stat.size>16*1024*1024)throw Error('本地资源清单无效');
    const checked=verifyRuntimeManifest(JSON.parse(await fs.readFile(file,'utf8')),this.cold,{installed:true});if(checked.digest!==digest)throw Error('本地资源身份不符');return checked;
  }
  /** download / extract / verify 均在后台完成；完整成功后目录才进入内容寻址缓存。 */
  prepare(pkg:RuntimePackage,signal:AbortSignal,progress:(percent:number)=>void=()=>{}):Promise<string>{
    const current=this.preparing.get(pkg.sha256);if(current)return current;
    const job=this.preparePackage(pkg,signal,progress).finally(()=>{if(this.preparing.get(pkg.sha256)===job)this.preparing.delete(pkg.sha256)});
    this.preparing.set(pkg.sha256,job);return job;
  }
  private async preparePackage(pkg:RuntimePackage,signal:AbortSignal,progress:(percent:number)=>void){
    signal.throwIfAborted();const target=this.packageRoot(pkg);
    const existing=await fs.lstat(target).catch(error=>{if(error.code==='ENOENT')return undefined;throw error});
    if(existing){await verifyRuntimeDirectory(target,pkg.files,signal);progress(100);return target;}
    await fs.mkdir(path.join(this.root,'staging'),{recursive:true});await fs.mkdir(path.dirname(target),{recursive:true});
    const space=await fs.statfs(this.root),required=pkg.bytes+pkg.files.reduce((sum,file)=>sum+file.bytes,0)+32*1024*1024;
    if(space.bavail*space.bsize<required)throw Error('没有足够空间准备更新');
    const stage=await fs.mkdtemp(path.join(this.root,'staging','package-'));
    const archive=path.join(stage,randomUUID()+'.zip'),expanded=path.join(stage,'expanded');
    try{
      await this.download(pkg,archive,signal,value=>progress(value*.7));
      await extractRuntimeArchive(archive,expanded,pkg.files,signal,value=>progress(70+value*.25));
      await verifyRuntimeDirectory(expanded,pkg.files,signal);signal.throwIfAborted();
      await fs.rename(expanded,target);progress(100);
      await fs.unlink(archive).catch(()=>{});await fs.rmdir(stage).catch(()=>{});return target;
    }catch(error){
      // 只清理本调用创建的临时目录；不删除内容寻址缓存、活动版本或上一确认版本。
      const resolved=path.resolve(stage),parent=path.resolve(this.root,'staging');
      if(path.dirname(resolved)===parent&&path.basename(resolved).startsWith('package-'))await fs.rm(resolved,{recursive:true,force:true,maxRetries:3,retryDelay:50}).catch(()=>{});
      throw error;
    }
  }
}
