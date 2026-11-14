/**
 * 作用定位：冷壳持有的通用 E 制品服务，保存独立签名索引历史并准备准确摘要的包。
 * 设计原因：R 消费可用制品而不持有下载信任根；查询不激活，序号回退、同版异包及坏缓存不触发降级或自动重试。
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import {atomic} from '../../../core/platform/node/files';
import {SerialQueue} from '../../../core/utility';
import type {EngineArtifactsPort,EngineArtifact} from '../engine-artifacts';
import {verifyEngineIndex} from './engine-index';
import {verifyRuntimeManifest,type EnginePackage,type SignedRuntimeManifest} from './runtime-manifest';
import type {RuntimeStore} from './runtime-store';
import {downloadRuntimeManifest} from './runtime-download';

/** 构造时 seed 已由启动资源验签；stateFile 位于用户状态区，清缓存不清已接纳发布序号。 */
export class EngineArtifacts implements EngineArtifactsPort {
  private readonly queue=new SerialQueue();
  private initialized=false;
  private envelopes:SignedRuntimeManifest[]=[];
  private seeds:SignedRuntimeManifest[]=[];
  private available=new Map<string,EnginePackage>();
  private current=new Map<string,string>();
  private head=0;private digest='';
  constructor(private readonly stateFile:string,private readonly store:RuntimeStore,private readonly seed:SignedRuntimeManifest,private readonly signal:AbortSignal,private readonly fetchIndex=()=>downloadRuntimeManifest('runtime-engines','latest.json',signal),private readonly progress:(kind:string,version:string,progress?:number,error?:string)=>void=()=>{}){}
  private add(packages:readonly EnginePackage[],target:Map<string,EnginePackage>){
    for(const pkg of packages){
      if(!pkg.adapter)continue;
      const existing=[...target.values()].find(item=>item.kind===pkg.kind&&item.adapter?.version===pkg.adapter!.version);
      if(existing&&JSON.stringify(existing)!==JSON.stringify(pkg))throw Error('同一引擎版本对应不同制品，请开发者发布新版本');
      target.set(pkg.kind+':'+pkg.package.sha256,pkg);
    }
  }
  private async init(){
    if(this.initialized)return;
    const available=new Map<string,EnginePackage>(),current=new Map<string,string>();
    let raw:{schema:1;indexes:SignedRuntimeManifest[];seeds:SignedRuntimeManifest[]}={schema:1,indexes:[],seeds:[]};
    try{const stat=await fs.lstat(this.stateFile);if(!stat.isFile()||stat.isSymbolicLink()||stat.size>128*1024*1024)throw Error('本机引擎索引无效');raw=JSON.parse(await fs.readFile(this.stateFile,'utf8'))}catch(error:any){if(error.code!=='ENOENT')throw error}
    if(raw.schema!==1||!Array.isArray(raw.indexes)||raw.indexes.length>128||!Array.isArray(raw.seeds)||raw.seeds.length>128)throw Error('本机引擎索引格式无效');
    const seeds=raw.seeds.some(value=>value.payload===this.seed.payload)?raw.seeds:[...raw.seeds,this.seed];
    if(seeds.length>128)throw Error('引擎来源保留数量达到上限');
    for(const envelope of seeds){
      // 旧 C/R 签名只用于证明历史 E 的来源，绝不用于启动旧资源；信任根和平台仍是当前冷壳。
      const metadata=JSON.parse(envelope.payload);
      const checked=verifyRuntimeManifest(envelope,{...this.store.cold,codeVersion:metadata.codeVersion,coldFingerprint:metadata.coldFingerprint},{installed:true});this.add(checked.manifest.engines,available);
      if(envelope.payload===this.seed.payload)for(const pkg of checked.manifest.engines)if(pkg.adapter)current.set(pkg.kind,pkg.package.sha256);
    }
    let head=0,digest='';
    for(const envelope of raw.indexes){const checked=verifyEngineIndex(envelope,this.store.cold,true);if(checked.index.sequence<=head)throw Error('本机引擎索引序号无效');this.add(checked.index.releases,available);for(const ref of checked.index.current)current.set(ref.kind,ref.identity);head=checked.index.sequence;digest=checked.digest}
    if(seeds.length!==raw.seeds.length)await atomic(this.stateFile,JSON.stringify({schema:1,seeds,indexes:raw.indexes}));
    this.seeds=seeds;this.available=available;this.current=current;this.head=head;this.digest=digest;this.envelopes=raw.indexes;this.initialized=true;
  }
  private summary(pkg:EnginePackage):EngineArtifact{return {kind:pkg.kind,identity:pkg.package.sha256,version:pkg.adapter!.version,nativeVersion:pkg.version,protocol:pkg.adapter!.protocol,dependencies:structuredClone(pkg.dependencies??[])}}
  list(){return this.queue.run(async()=>{await this.init();return {current:[...this.current].map(([kind,id])=>this.summary(this.available.get(kind+':'+id)!)),available:[...this.available.values()].map(pkg=>this.summary(pkg))}})}
  check(){return this.queue.run(async()=>{
    await this.init();const checked=verifyEngineIndex(await this.fetchIndex(),this.store.cold);
    if(checked.index.sequence<this.head||checked.index.sequence===this.head&&checked.digest!==this.digest)throw Error('引擎索引回退或同序号冲突');
    if(checked.index.sequence===this.head)return;
    if(this.envelopes.length>=128)throw Error('引擎索引保留数量达到上限，需要维护后再更新');
    const available=new Map(this.available);this.add(checked.index.releases,available);
    const envelopes=[...this.envelopes,checked.envelope];await atomic(this.stateFile,JSON.stringify({schema:1,seeds:this.seeds,indexes:envelopes}));
    this.available=available;this.envelopes=envelopes;this.head=checked.index.sequence;this.digest=checked.digest;
    for(const ref of checked.index.current)this.current.set(ref.kind,ref.identity);
  })}
  /** 只准备已验签的准确版本；并发下载交给 RuntimeStore，失败不会删除已安装包。 */
  async prepare(kind:string,identity:string){
    const pkg=await this.queue.run(async()=>{await this.init();const found=this.available.get(kind+':'+identity);if(!found?.adapter)throw Error('没有此身份的受信引擎制品');return found});
    this.progress(kind,pkg.adapter!.version,0);
    try{const root=await this.store.prepare(pkg.package,this.signal,value=>this.progress(kind,pkg.adapter!.version,value));this.progress(kind,pkg.adapter!.version);return {root,version:pkg.version,entry:path.join(root,pkg.entry),identity:pkg.package.sha256,adapter:{...pkg.adapter!,entry:path.join(root,pkg.adapter!.entry)}}}
    catch(error){this.progress(kind,pkg.adapter!.version,undefined,String(error));throw error}
  }
}
