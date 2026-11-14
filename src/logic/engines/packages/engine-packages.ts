/**
 * 作用定位：Application 持有的官方引擎安装选择、依赖锁和运行引用生命周期。
 * 设计原因：支持名单来自 R 的代码，制品来自 C 的验签端口；先准备完整闭包再原子切换，失败不使任务自动下载或重启。
 * 持久化边界：只保存摘要选择，不保存凭据、工作区或 SDK 会话。移除停用选择，保留历史不可变缓存供会话核实。
 */
import fs from 'node:fs/promises';
import {z} from 'zod';
import {atomic} from '../../../core/platform/node/files';
import {SerialQueue} from '../../../core/utility';
import {supportedEngines,engineDescriptor,loopEngineSchema,type LoopEngine} from '../index';
import type {EngineArtifact,EngineArtifactsPort} from '../../updates/engine-artifacts';
import type {EngineRuntimePackage,EngineRuntimeResolver} from '../../execution/rules/engine-runtime';
import type {EnginePackageStatus,EnginePackageSettings} from '../index';

const hash=z.string().regex(/^[a-f0-9]{64}$/);
const entry=z.object({kind:loopEngineSchema,enabled:z.boolean(),active:hash.optional(),installed:z.array(hash).max(256),error:z.string().max(2000).optional()}).strict();
const stateSchema=z.object({schema:z.literal(1),revision:z.number().int().nonnegative(),entries:z.array(entry).max(64)}).strict();
type State=z.infer<typeof stateSchema>;

export class EnginePackages implements EngineRuntimeResolver {
  private state:State={schema:1,revision:0,entries:[]};
  private initialized?:Promise<void>;
  private readonly queue=new SerialQueue();
  private readonly references=new Map<string,number>();
  private readonly busy=new Set<string>();
  /** 一次进程内准备失败被记住；用户显式安装/更新才可重试，普通对话不反复请求网络。 */
  private readonly failures=new Map<string,Error>();
  constructor(private readonly file:string,private readonly artifacts:EngineArtifactsPort){}
  init(){return this.initialized??=(async()=>{
    try{const stat=await fs.lstat(this.file);if(!stat.isFile()||stat.isSymbolicLink()||stat.size>1024*1024)throw Error('本机引擎安装清单无效');this.state=stateSchema.parse(JSON.parse(await fs.readFile(this.file,'utf8')))}catch(error:any){if(error.code!=='ENOENT')throw error}
    if(new Set(this.state.entries.map(item=>item.kind)).size!==this.state.entries.length||this.state.entries.some(item=>new Set(item.installed).size!==item.installed.length||item.active&&!item.installed.includes(item.active)))throw Error('本机引擎安装清单冲突');
  })()}
  private async save(next:State){next.revision=this.state.revision+1;await atomic(this.file,JSON.stringify(stateSchema.parse(next)));this.state=next}
  private trusted(artifact:EngineArtifact){
    const descriptor=engineDescriptor(loopEngineSchema.parse(artifact.kind));
    if(artifact.protocol!==1||artifact.dependencies.length!==(descriptor.packageDependencies??[]).length||artifact.dependencies.some(ref=>!(descriptor.packageDependencies??[]).includes(loopEngineSchema.parse(ref.kind))))throw Error('引擎制品与官方声明不兼容');
    return artifact;
  }
  private closure(root:EngineArtifact,available:EngineArtifact[]){
    const result:EngineArtifact[]=[],visiting=new Set<string>(),visited=new Set<string>();
    const visit=(value:EngineArtifact)=>{this.trusted(value);const key=value.kind+':'+value.identity;if(visiting.has(key))throw Error('引擎依赖成环');if(visited.has(key))return;visiting.add(key);for(const ref of value.dependencies){const dependency=available.find(item=>item.kind===ref.kind&&item.identity===ref.identity);if(!dependency)throw Error('固定的引擎依赖制品缺失');visit(dependency)}visiting.delete(key);visited.add(key);result.push(value)};
    visit(root);return result;
  }
  async read():Promise<EnginePackageSettings>{
    await this.init();const versions=await this.artifacts.list();
    const items:EnginePackageStatus[]=supportedEngines.map(descriptor=>{const item=this.state.entries.find(entry=>entry.kind===descriptor.id),find=(id?:string)=>versions.available.find(value=>value.kind===descriptor.id&&value.identity===id);return {kind:descriptor.id,enabled:item?.enabled??true,active:find(item?.active),candidate:versions.current.find(value=>value.kind===descriptor.id),installed:(item?.installed??[]).map(id=>find(id)).filter((value):value is EngineArtifact=>!!value),references:[...this.references].filter(([key])=>key.startsWith(descriptor.id+':')).reduce((sum,[,count])=>sum+count,0),preparing:this.busy.has(descriptor.id),error:item?.error??this.failures.get(descriptor.id)?.message}});
    return {managed:true,revision:this.state.revision,items};
  }
  async list(){return (await this.read()).items}
  async check(){await this.init();await this.artifacts.check();return this.list()}
  /** 用户显式动作；整个依赖闭包准备完成才改活动指针，其他引擎的活动版本不随依赖下载改变。 */
  install(kind:LoopEngine,expected?:{revision:number;identity:string}){return this.queue.run(async()=>{await this.init();this.assertRevision(expected?.revision);return this.installNow(kind,true,expected?.identity)})}
  private assertRevision(revision?:number){if(revision!==undefined&&revision!==this.state.revision)throw Error('引擎设置已变化，请刷新后再操作')}
  private async installNow(kind:LoopEngine,explicit:boolean,expectedIdentity?:string){
    loopEngineSchema.parse(kind);const previous=this.state.entries.find(item=>item.kind===kind);
    if(!explicit&&(previous?.enabled===false||previous?.error||this.failures.has(kind)))throw Error(previous?.error??this.failures.get(kind)?.message??'引擎已停用，请在引擎设置中启用');
    const versions=await this.artifacts.list(),candidate=versions.current.find(item=>item.kind===kind);if(!candidate)throw Error('官方目录没有可安装的兼容引擎版本');
    if(expectedIdentity!==undefined&&candidate.identity!==expectedIdentity)throw Error('可安装版本已变化，请刷新后核对');
    this.busy.add(kind);
    try{
      const closure=this.closure(candidate,versions.available);
      for(const dependency of closure){if(dependency.kind!==kind&&this.state.entries.find(item=>item.kind===dependency.kind)?.enabled===false)throw Error('依赖引擎已停用，请先启用 '+dependency.kind);await this.artifacts.prepare(dependency.kind,dependency.identity)}
      const next=structuredClone(this.state);
      for(const dependency of closure){let item=next.entries.find(item=>item.kind===dependency.kind);if(!item){item={kind:loopEngineSchema.parse(dependency.kind),enabled:true,installed:[]};next.entries.push(item)}if(!item.installed.includes(dependency.identity))item.installed.push(dependency.identity);if(dependency.kind===kind){item.active=dependency.identity;item.enabled=true;delete item.error}}
      await this.save(next);this.failures.delete(kind);for(const dependency of closure)this.failures.delete(dependency.kind+':'+dependency.identity);
    }catch(error){const failure=error instanceof Error?error:Error(String(error));this.failures.set(kind,failure);const next=structuredClone(this.state);let item=next.entries.find(item=>item.kind===kind);if(!item){item={kind,enabled:true,installed:[]};next.entries.push(item)}item.error=failure.message.slice(0,2000);await this.save(next);throw failure}
    finally{this.busy.delete(kind)}
  }
  /** 停用与移除均拒绝正在运行的引用和活动依赖；移除不删除历史包字节或模型设置。 */
  setEnabled(kind:LoopEngine,enabled:boolean,remove=false,revision?:number){return this.queue.run(async()=>{
    await this.init();this.assertRevision(revision);loopEngineSchema.parse(kind);
    if(!enabled){if([...this.references].some(([key,count])=>key.startsWith(kind+':')&&count>0))throw Error('引擎仍有运行引用，请先结束任务');const versions=await this.artifacts.list();for(const item of this.state.entries){if(item.kind===kind||!item.enabled||!item.active)continue;const artifact=versions.available.find(v=>v.kind===item.kind&&v.identity===item.active);if(artifact&&this.closure(artifact,versions.available).some(v=>v.kind===kind))throw Error('仍被启用的 '+item.kind+' 引擎依赖，请先停用它')}}
    const next=structuredClone(this.state);let item=next.entries.find(value=>value.kind===kind);if(!item){item={kind,enabled,installed:[]};next.entries.push(item)}item.enabled=enabled;if(remove)delete item.active;await this.save(next);
  })}
  /** 每次装配固定活动版本及其准确依赖。升级不会改变已返回地址；缺包明确失败，不改选 latest。 */
  async resolveEngine(raw:string):Promise<EngineRuntimePackage>{
    const kind=loopEngineSchema.parse(raw);await this.init();
    let item=this.state.entries.find(value=>value.kind===kind);
    if(item?.enabled===false)throw Error('引擎已停用，请在引擎设置中启用');
    if(!item?.active){await this.queue.run(async()=>{if(!this.state.entries.find(value=>value.kind===kind)?.active)await this.installNow(kind,false)});item=this.state.entries.find(value=>value.kind===kind)}
    if(!item?.enabled||!item.active)throw Error('引擎尚未启用');
    const identity=item.active,versions=await this.artifacts.list(),artifact=versions.available.find(value=>value.kind===kind&&value.identity===identity);if(!artifact)throw Error('已安装引擎的受信版本记录缺失');
    const closure=this.closure(artifact,versions.available),prepared=new Map<string,EngineRuntimePackage>();
    for(const dependency of closure){const key=dependency.kind+':'+dependency.identity;if(this.failures.has(key))throw this.failures.get(key);try{prepared.set(key,await this.artifacts.prepare(dependency.kind,dependency.identity))}catch(error){const failure=error instanceof Error?error:Error(String(error));this.failures.set(key,failure);throw failure}}
    const root=prepared.get(kind+':'+identity)!;
    root.dependencies=Object.fromEntries(closure.filter(value=>value!==artifact).map(value=>[value.kind,prepared.get(value.kind+':'+value.identity)!]));
    root.retain=()=>{
      if(!this.state.entries.find(value=>value.kind===kind)?.enabled||closure.some(value=>this.state.entries.find(item=>item.kind===value.kind)?.enabled===false))throw Error('引擎在任务启动前已停用');
      const keys=closure.map(value=>value.kind+':'+value.identity);for(const key of keys)this.references.set(key,(this.references.get(key)??0)+1);let released=false;
      return ()=>{if(released)return;released=true;for(const key of keys){const remaining=this.references.get(key)!-1;if(remaining)this.references.set(key,remaining);else this.references.delete(key)}};
    };
    return root;
  }
}
