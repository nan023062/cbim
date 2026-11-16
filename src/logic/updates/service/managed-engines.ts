/**
 * 作用定位：受管引擎目录、准备进度及固定版本解析；由冷壳注入已验签的清单和缓存。
 * 设计原因：对话菜单和执行工厂复用同一准备任务，查看不下载，更新不覆盖运行中的不可变包。
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import type {EnginePackage} from './runtime-manifest';
import {RuntimeStore} from './runtime-store';
import {verifyRuntimeDirectory} from './runtime-archive';
import type {ManagedEngineStatus} from '../contracts';

export class ManagedEngines {
  private readonly states=new Map<string,ManagedEngineStatus>();
  private readonly jobs=new Map<string,Promise<{root:string;version:string;entry:string;identity:string}>>();
  private initialization?:Promise<void>;
  constructor(private readonly store:RuntimeStore,private readonly descriptors:EnginePackage[],private readonly signal:AbortSignal){}
  /** 本地只读校验一次；清单固定于本次启动，不联网发现或自动安装候选。 */
  async status():Promise<ManagedEngineStatus[]>{await this.initialize();return structuredClone([...this.states.values()])}
  preparations(){return [...this.states.values()].filter(s=>s.state==='preparing'||s.state==='failed').map(s=>({engine:s.engine,version:s.version!,progress:s.progress,error:s.error}))}
  used(){return [...this.jobs.keys()]}
  private initialize(){
    return this.initialization??=(async()=>{
      for(const engine of ['pi','claude-code','codex'] as const){
        const descriptor=this.descriptors.find(d=>d.kind===engine);
        if(!descriptor){this.states.set(engine,{engine,state:'unavailable',error:'当前资源版本未提供兼容引擎包'});continue}
        let installedVersion:string|undefined,identity:string|undefined;
        try{const record=JSON.parse(await fs.readFile(path.join(this.store.root,'engine-'+engine+'.json'),'utf8'));if(typeof record.version==='string'&&typeof record.identity==='string'){installedVersion=record.version;identity=record.identity}}catch{}
        const state:ManagedEngineStatus={engine,version:descriptor.version,installedVersion,state:identity&&identity!==descriptor.package.sha256?'update':'install'};
        try{
          const target=this.store.packageRoot(descriptor.package);
          const exists=await fs.lstat(target).catch(error=>{if(error.code==='ENOENT')return undefined;throw error});
          if(exists){await verifyRuntimeDirectory(target,descriptor.package.files,this.signal);state.state='ready';state.installedVersion=descriptor.version}
        }catch{state.state='failed';state.error='本地引擎校验失败，未覆盖原文件；请修复缓存或重新安装兼容版本。'}
        this.states.set(engine,state);
      }
    })();
  }
  /** 显式准备或首次运行共用同一 Promise；失败允许重试，既有成功包和运行引用不被替换。 */
  resolveEngine(engine:ManagedEngineStatus['engine']){
    const old=this.jobs.get(engine);if(old)return old;
    const job=this.prepare(engine).catch(error=>{this.jobs.delete(engine);throw error});
    this.jobs.set(engine,job);return job;
  }
  private async prepare(engine:ManagedEngineStatus['engine']){
    await this.initialize();this.signal.throwIfAborted();
    const descriptor=this.descriptors.find(d=>d.kind===engine);if(!descriptor)throw Error('此资源版本没有兼容的引擎包');
    const state=this.states.get(engine)!;state.state='preparing';state.progress=undefined;state.error=undefined;
    try{
      const root=await this.store.prepare(descriptor.package,this.signal,progress=>{state.progress=progress});
      const record=path.join(this.store.root,'engine-'+engine+'.json'),temporary=record+'.'+randomUUID()+'.tmp';
      await fs.mkdir(this.store.root,{recursive:true});
      try{await fs.writeFile(temporary,JSON.stringify({version:descriptor.version,identity:descriptor.package.sha256}));await fs.rename(temporary,record)}finally{await fs.unlink(temporary).catch(()=>{})}
      state.state='ready';state.installedVersion=descriptor.version;state.progress=undefined;
      return {root,version:descriptor.version,entry:path.join(root,descriptor.entry),identity:descriptor.package.sha256};
    }catch{state.state='failed';state.progress=undefined;state.error='引擎准备失败，请检查网络、磁盘和缓存后重试；原会话数据已保留。';throw Error(state.error)}
  }
}
