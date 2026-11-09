/**
 * 作用定位：ResourceRepositories：统一三类资源的仓库选择、账号占位与共享生命周期。
 * 设计原因：链接器、人才市场和模板共用当前身份的仓库；显式共享生成短期读写/只读凭据，代际退役会取消旧读取，登录占位不被当成账号连接。
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import {randomBytes,randomUUID} from 'node:crypto';
import {networkInterfaces} from 'node:os';
import {z} from 'zod';
import {Paths} from '../platform/paths';
import {atomic} from '../../core/foundation/files';
import {fail} from '../../core/foundation/errors';
import {json} from '../../core/foundation/serialization';
import {LocalRepository,type RepositoryStore,saveSchema,removeSchema} from './resource-store';
import {RemoteRepository,repositoryUrl,serveRepository} from './resource-http';
import type {RepositoryStatus,RepositorySession,ResourceLibrarySnapshot} from '../../../bridge/contracts/resources';

/** 只在主进程闭包中使用，既不暴露令牌/地址，也不提供 save/remove；每次读取真正经过 HTTP。 */
export interface SharedRepositoryReadConnection {
  repositoryId:string;connectionId:string;
  assertCurrent():void;
  read(signal?:AbortSignal):Promise<ResourceLibrarySnapshot>;
}

const configSchema=z.discriminatedUnion('mode',[z.object({mode:z.literal('local'),location:z.string().min(1),repositoryId:z.string().uuid()}),z.object({mode:z.literal('remote'),location:z.string().url(),repositoryId:z.string().uuid(),token:z.string().min(16).max(512)})]);
type Config=z.infer<typeof configSchema>;
const configureSchema=z.discriminatedUnion('mode',[z.object({mode:z.literal('local'),location:z.string().min(1)}).strict(),z.object({mode:z.literal('remote'),location:z.string().min(1),token:z.string().min(16).max(512)}).strict()]);
export class ResourceRepositories{
  private session:RepositorySession={state:'signedOut'};
  private localConfig:Extract<Config,{mode:'local'}>|null=null;
  private config:Config|null=null;private configError?:string;private sharing?:Awaited<ReturnType<typeof serveRepository>>;private shareToken?:string;private queue:Promise<unknown>=Promise.resolve();
  private readSharing?:{connectionId:string;repositoryId:string;token:string;controller:AbortController};
  constructor(private paths:Paths){}
  private get settingsFile(){return path.join(this.paths.userRoot,'resource-repository-settings.json')}
  private serial<T>(fn:()=>Promise<T>){const result=this.queue.catch(()=>{}).then(fn);this.queue=result;return result}
  async init(){try{const saved=configSchema.parse(JSON.parse(await fs.readFile(this.settingsFile,'utf8')));if(saved.mode==='local'){this.localConfig=saved;this.config=saved}else{this.configError='旧版远端配置已停用。未登录时请选择本地目录；服务器仓库将由账号登录后自动提供。'}}catch(e:any){if(e.code!=='ENOENT')this.configError='仓库配置无效，请检查 resource-repository-settings.json 或重新选择仓库'}}
  status():RepositoryStatus{return {session:this.session,source:this.session.state==='signedIn'?'server':'local',config:this.config?{mode:this.config.mode,location:this.config.location,repositoryId:this.config.repositoryId}:null,error:this.configError,sharing:this.sharing?{url:this.sharing.url,host:this.sharing.host,port:this.sharing.port}:undefined}}
  private store():RepositoryStore{if(!this.config)fail('NOT_CONFIGURED',this.session.state==='signedIn'?'账号服务器仓库尚未就绪，不能使用本地仓库代替':'请先设置本地仓库目录');return this.config.mode==='local'?new LocalRepository(this.config.location):new RemoteRepository(this.config.location,this.config.token,this.config.repositoryId)}
  private identity(id:string){if(!this.config||this.config.repositoryId!==id)fail('REPOSITORY_CHANGED','当前仓库已切换，请刷新后重新操作')}
  /** 先退役代际再等待 HTTP 关闭，旧读取不能趁收尾返回可用结果。 */
  private retireSharing(){const old=this.sharing;this.readSharing?.controller.abort();this.readSharing=undefined;this.sharing=undefined;this.shareToken=undefined;return old}
  /** 公开连接状态只含安全身份；未共享不会隐式启动服务或读取本地仓库。 */
  sharedIdentity(){return this.sharing&&this.readSharing?{repositoryId:this.readSharing.repositoryId,connectionId:this.readSharing.connectionId}:undefined}
  /** 捕获当前显式共享代际；停止/重配后该端口永久失效，不能改读新来源或本地文件。 */
  readConnection(repositoryId:string):SharedRepositoryReadConnection{
    const sharing=this.sharing,binding=this.readSharing;
    if(!sharing||!binding)fail('REPOSITORY_CONNECTION_NOT_SHARED','请先在设置中明确启动本机仓库共享');
    if(binding.repositoryId!==repositoryId)fail('REPOSITORY_CONNECTION_STALE','当前共享仓库与连接定义不一致');
    const assertCurrent=()=>{if(this.readSharing!==binding||this.sharing!==sharing||binding.controller.signal.aborted||this.config?.repositoryId!==repositoryId)fail('REPOSITORY_CONNECTION_STALE','仓库共享代际已失效，请重新核实连接')};
    const remote=new RemoteRepository(sharing.url,binding.token,repositoryId);
    return {repositoryId,connectionId:binding.connectionId,assertCurrent,read:async signal=>{assertCurrent();const result=await remote.read(signal?AbortSignal.any([signal,binding.controller.signal]):binding.controller.signal);assertCurrent();return result}};
  }
  configure(args:unknown){const request=configureSchema.parse(args);return this.serial(async()=>{if(request.mode!=='local')fail('SESSION_REQUIRED','服务器仓库由账号登录后自动连接，不支持手动配置');if(this.session.state==='signedIn')fail('ACCOUNT_REPOSITORY','已登录时使用账号服务器仓库，不能切换本地目录');return this.applyConfig(request)})}
  // Internal integration point for a future verified main-process account service.
  // Never expose this through renderer IPC or accept a renderer-supplied login flag.
  setAccountSession(session:{accountId:string;server?:{location:string;token:string}}|null){return this.serial(async()=>{
    if(session)z.object({accountId:z.string().min(1),server:z.object({location:z.string().min(1),token:z.string().min(16).max(512)}).optional()}).strict().parse(session);
    await this.retireSharing()?.close();this.config=null;this.configError=undefined;
    if(!session){this.session={state:'signedOut'};this.config=this.localConfig;return this.status()}
    this.session={state:'signedIn',accountId:session.accountId};
    if(!session.server){this.configError='服务器仓库待接入，等待账号服务提供连接信息';return this.status()}
    try{return await this.applyConfig({mode:'remote',...session.server})}catch(e:any){this.configError='账号服务器仓库连接失败，请重新登录或重试账号连接';throw e}
  })}
  private async applyConfig(request:z.infer<typeof configureSchema>){let config:Config;
    if(request.mode==='local'){const root=await fs.realpath(request.location);if(!(await fs.stat(root)).isDirectory())fail('PATH','请选择已有文件夹');
      const install=await fs.realpath(this.paths.installRoot),user=await fs.realpath(this.paths.userRoot);for(const blocked of [install,user]){const rel=path.relative(blocked,root);if(!rel||(!path.isAbsolute(rel)&&rel!=='..'&&!rel.startsWith('..'+path.sep)))fail('PATH','请将资源仓库放在程序安装目录和用户运行数据目录之外')}
      if(root.split(/[\\/]/).some(part=>part.toLowerCase()==='.cbim'))fail('PATH','资源仓库不能放在项目 .cbim 正式知识目录中');
      const repo=new LocalRepository(root),snapshot=await repo.initialize();config={mode:'local',location:root,repositoryId:snapshot.repositoryId};
    }else{const url=repositoryUrl(request.location),target=new URL(url),ownHosts=new Set(['localhost','127.0.0.1','[::1]',...Object.values(networkInterfaces()).flatMap(list=>list?.map(n=>n.address)||[])]);if(this.sharing&&Number(target.port)===this.sharing.port&&ownHosts.has(target.hostname))fail('SELF_CONNECTION','此地址属于本窗口正在共享的仓库，请继续使用本地模式；可用另一个客户端连接');const snapshot=await new RemoteRepository(url,request.token).read();config={mode:'remote',location:url,repositoryId:snapshot.repositoryId,token:request.token}}
    if(config.mode==='local'){await atomic(this.settingsFile,json(config));this.localConfig=config}const oldSharing=this.retireSharing();this.config=config;this.configError=undefined;await oldSharing?.close();return this.status();
  }
  read(){return this.serial(async()=>{const result=await this.store().read();this.identity(result.repositoryId);return result})}
  save(args:unknown){const request=saveSchema.parse(args);return this.serial(async()=>{this.identity(request.repositoryId);return this.store().save(request)})}
  remove(args:unknown){const request=removeSchema.parse(args);return this.serial(async()=>{this.identity(request.repositoryId);return this.store().remove(request)})}
  startSharing(args:unknown){const options=z.object({lan:z.boolean(),port:z.number().int().min(0).max(65535)}).strict().parse(args);return this.serial(async()=>{if(this.config?.mode!=='local')fail('MODE','仅本地仓库可以启动共享服务');if(this.sharing)return this.status();const store=this.store(),repositoryId=(await store.read()).repositoryId;this.identity(repositoryId);const token=randomBytes(32).toString('hex'),readToken=randomBytes(32).toString('hex');this.sharing=await serveRepository(store,token,{host:options.lan?'0.0.0.0':'127.0.0.1',port:options.port,readOnlyToken:readToken});this.shareToken=token;this.readSharing={connectionId:randomUUID(),repositoryId,token:readToken,controller:new AbortController()};return this.status()})}
  connection(){if(!this.sharing||!this.shareToken)fail('NOT_RUNNING','仓库共享服务未启动');return {url:this.sharing.url,host:this.sharing.host,port:this.sharing.port,token:this.shareToken}}
  stopSharing(){return this.serial(async()=>{await this.retireSharing()?.close();return this.status()})}
  async close(){await this.stopSharing()}
}
