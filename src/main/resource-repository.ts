import fs from 'node:fs/promises';
import path from 'node:path';
import {randomBytes} from 'node:crypto';
import {networkInterfaces} from 'node:os';
import {z} from 'zod';
import {Paths,atomic,fail,json} from './paths';
import {LocalRepository,type RepositoryStore,saveSchema,removeSchema} from './resource-store';
import {RemoteRepository,repositoryUrl,serveRepository} from './resource-http';
import type {RepositoryStatus} from '../shared/resources';

const configSchema=z.discriminatedUnion('mode',[z.object({mode:z.literal('local'),location:z.string().min(1),repositoryId:z.string().uuid()}),z.object({mode:z.literal('remote'),location:z.string().url(),repositoryId:z.string().uuid(),token:z.string().min(16).max(512)})]);
type Config=z.infer<typeof configSchema>;
const configureSchema=z.discriminatedUnion('mode',[z.object({mode:z.literal('local'),location:z.string().min(1)}).strict(),z.object({mode:z.literal('remote'),location:z.string().min(1),token:z.string().min(16).max(512)}).strict()]);
export class ResourceRepositories{
  private config:Config|null=null;private configError?:string;private sharing?:Awaited<ReturnType<typeof serveRepository>>;private shareToken?:string;private queue:Promise<unknown>=Promise.resolve();
  constructor(private paths:Paths){}
  private get settingsFile(){return path.join(this.paths.userRoot,'resource-repository-settings.json')}
  private serial<T>(fn:()=>Promise<T>){const result=this.queue.catch(()=>{}).then(fn);this.queue=result;return result}
  async init(){try{this.config=configSchema.parse(JSON.parse(await fs.readFile(this.settingsFile,'utf8')))}catch(e:any){if(e.code!=='ENOENT')this.configError='仓库配置无效，请检查 resource-repository-settings.json 或重新选择仓库'}}
  status():RepositoryStatus{return {config:this.config?{mode:this.config.mode,location:this.config.location,repositoryId:this.config.repositoryId}:null,error:this.configError,sharing:this.sharing?{url:this.sharing.url,host:this.sharing.host,port:this.sharing.port}:undefined}}
  private store():RepositoryStore{if(!this.config)fail('NOT_CONFIGURED','请先选择本地仓库或连接远端仓库');return this.config.mode==='local'?new LocalRepository(this.config.location):new RemoteRepository(this.config.location,this.config.token,this.config.repositoryId)}
  private identity(id:string){if(!this.config||this.config.repositoryId!==id)fail('REPOSITORY_CHANGED','当前仓库已切换，请刷新后重新操作')}
  configure(args:unknown){const request=configureSchema.parse(args);return this.serial(async()=>{let config:Config;
    if(request.mode==='local'){const root=await fs.realpath(request.location);if(!(await fs.stat(root)).isDirectory())fail('PATH','请选择已有文件夹');
      const install=await fs.realpath(this.paths.installRoot),user=await fs.realpath(this.paths.userRoot);for(const blocked of [install,user]){const rel=path.relative(blocked,root);if(!rel||(!path.isAbsolute(rel)&&rel!=='..'&&!rel.startsWith('..'+path.sep)))fail('PATH','请将资源仓库放在程序安装目录和用户运行数据目录之外')}
      if(root.split(/[\\/]/).some(part=>part.toLowerCase()==='.cbim'))fail('PATH','资源仓库不能放在项目 .cbim 正式知识目录中');
      const repo=new LocalRepository(root),snapshot=await repo.initialize();config={mode:'local',location:root,repositoryId:snapshot.repositoryId};
    }else{const url=repositoryUrl(request.location),target=new URL(url),ownHosts=new Set(['localhost','127.0.0.1','[::1]',...Object.values(networkInterfaces()).flatMap(list=>list?.map(n=>n.address)||[])]);if(this.sharing&&Number(target.port)===this.sharing.port&&ownHosts.has(target.hostname))fail('SELF_CONNECTION','此地址属于本窗口正在共享的仓库，请继续使用本地模式；可用另一个客户端连接');const snapshot=await new RemoteRepository(url,request.token).read();config={mode:'remote',location:url,repositoryId:snapshot.repositoryId,token:request.token}}
    await atomic(this.settingsFile,json(config));const oldSharing=this.sharing;this.sharing=undefined;this.shareToken=undefined;this.config=config;this.configError=undefined;await oldSharing?.close();return this.status();
  })}
  read(){return this.serial(async()=>{const result=await this.store().read();this.identity(result.repositoryId);return result})}
  save(args:unknown){const request=saveSchema.parse(args);return this.serial(async()=>{this.identity(request.repositoryId);return this.store().save(request)})}
  remove(args:unknown){const request=removeSchema.parse(args);return this.serial(async()=>{this.identity(request.repositoryId);return this.store().remove(request)})}
  startSharing(args:unknown){const options=z.object({lan:z.boolean(),port:z.number().int().min(0).max(65535)}).strict().parse(args);return this.serial(async()=>{if(this.config?.mode!=='local')fail('MODE','仅本地仓库可以启动共享服务');if(this.sharing)return this.status();const store=this.store();this.identity((await store.read()).repositoryId);const token=randomBytes(32).toString('hex');this.sharing=await serveRepository(store,token,{host:options.lan?'0.0.0.0':'127.0.0.1',port:options.port});this.shareToken=token;return this.status()})}
  connection(){if(!this.sharing||!this.shareToken)fail('NOT_RUNNING','仓库共享服务未启动');return {...this.status().sharing,token:this.shareToken}}
  stopSharing(){return this.serial(async()=>{await this.sharing?.close();this.sharing=undefined;this.shareToken=undefined;return this.status()})}
  async close(){await this.stopSharing()}
}
