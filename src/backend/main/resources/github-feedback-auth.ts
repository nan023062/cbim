/**
 * 作用定位：桌面 GitHub Device Flow、账号／仓库绑定和本机加密凭据管理。
 * 设计原因：公开 Client ID 可以随应用配置，授权令牌只留在主进程；连接代际和串行队列使换号、断开与在途提交具有确定顺序。
 * 生命周期：轮询由可见设置页驱动，后端强制 interval/slow_down/过期；退出取消授权请求，不在后台无限轮询。运行诊断单独检查公开连接事实与原绑定，不解密、不联网。
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {z} from 'zod';
import {atomic} from '../../core/foundation/files';
import {fail,Fault} from '../../core/foundation/errors';
import {hash} from '../../core/foundation/serialization';
import {KernelLock} from '../platform/locking';
import type {SecretCipher} from '../../core/brain/llm/ports';
import {githubFeedbackConfigSchema,type GitHubFeedbackStatus,type FeedbackScope,type FeedbackConnectionCheck} from '../../core/connectors/github-feedback';
import {githubRequest,type GitHubRequest} from './github-api';

const connectionSchema=z.object({id:z.string().uuid(),accountId:z.number().int().positive(),login:z.string().regex(/^[A-Za-z0-9-]{1,100}$/),repositoryId:z.number().int().positive(),encryptedToken:z.string().min(1).max(32000),expiresAt:z.number().positive().optional()}).strict();
const diskSchema=z.object({version:z.literal(1),config:githubFeedbackConfigSchema.optional(),connection:connectionSchema.optional(),flowId:z.string().uuid().optional()}).strict().refine(value=>!value.connection||!!value.config&&!value.flowId);
type Disk=z.infer<typeof diskSchema>;
type Connection=z.infer<typeof connectionSchema>;
interface Flow {id:string;controller:AbortController;deviceCode:string;userCode:string;expiresAt:number;nextPollAt:number;interval:number}
export interface GitHubFeedbackIdentity {connection:Connection;config:NonNullable<Disk['config']>;token:string}
/** 仅本应用服务持有。任何方法都不把解密值返回 IPC；网络异常统一为无正文错误。 */
export class GitHubFeedbackAuth {
  private queue:Promise<unknown>=Promise.resolve();
  private flow?:Flow;
  private closed=false;
  private lifetime=new AbortController();
  private generation=0;
  constructor(private filename:string,private cipher?:SecretCipher,private request:GitHubRequest=githubRequest,private now:()=>number=Date.now){}
  private serial<T>(work:()=>Promise<T>){const next=this.queue.then(async()=>{
    if(this.closed)fail('GITHUB_CLOSED','CBIM 正在退出');
    await fs.mkdir(path.dirname(this.filename),{recursive:true});const lock=new KernelLock(path.dirname(this.filename),hash(path.resolve(this.filename).toLowerCase()),'github-auth');
    try{return await work()}catch(error){if(error instanceof Fault)throw error;fail('GITHUB_OPERATION','GitHub 操作未完成，请检查网络和本机安全存储；反馈提交须先核实原记录')}finally{lock.close()}
  });this.queue=next.catch(()=>{});return next}
  private async read():Promise<Disk>{
    try{const parsed=diskSchema.safeParse(JSON.parse(await fs.readFile(this.filename,'utf8')));if(!parsed.success)throw Error();return parsed.data}
    catch(error:any){if(error.code==='ENOENT')return {version:1};return fail('GITHUB_SETTINGS','GitHub 设置无法读取，请检查本机配置文件')}
  }
  private secure(){if(!this.cipher?.available())fail('GITHUB_SECRET_STORAGE','系统安全存储不可用，未保存 GitHub 凭据')}
  private view(data:Disk):GitHubFeedbackStatus{
    // 正式产品预置公开 Client ID；用户仍须自己完成 OAuth，不随安装包分发任何访问凭据。
    const config=data.config??{clientId:process.env.CBIM_GITHUB_CLIENT_ID??'Ov23liSMDZneBd3gSyTo',owner:'nan023062',repo:'cbim',visibility:'public' as const,autoSubmit:true as const};
    const flow=this.flow&&this.now()<this.flow.expiresAt?this.flow:undefined;
    return {secureStorage:this.cipher?.available()===true,config:{clientId:config.clientId,owner:config.owner,repo:config.repo,visibility:config.visibility},...(data.connection?{connected:{login:data.connection.login,owner:config.owner,repo:config.repo}}:{}),...(flow?{flow:{id:flow.id,userCode:flow.userCode,verificationUri:'https://github.com/login/device' as const,expiresAt:flow.expiresAt,nextPollAt:flow.nextPollAt}}:{})};
  }
  status(){return this.serial(async()=>this.view(await this.read()))}
  /** 诊断不能凭“工具缺失”推断未登录；本机仍等待授权回包、读取失败与账号断开分开。旧绑定变化只提示开启新一轮。 */
  checkConnection(scope?:FeedbackScope):Promise<FeedbackConnectionCheck>{return this.serial(async():Promise<FeedbackConnectionCheck>=>{
    const data=await this.read();
    if(!data.config||!data.connection)return {code:this.flow&&data.flowId===this.flow.id&&this.now()<this.flow.expiresAt?'GITHUB_AUTH_PENDING':'GITHUB_NOT_CONNECTED'};
    const repository={owner:data.config.owner,repo:data.config.repo};
    if(scope&&(scope.connectionId!==data.connection.id||scope.repositoryId!==data.connection.repositoryId||scope.owner!==repository.owner||scope.repo!==repository.repo))return {code:'GITHUB_CONNECTION_CHANGED',repository};
    if(data.connection.expiresAt&&this.now()>=data.connection.expiresAt)return {code:'GITHUB_EXPIRED',repository};
    if(!this.cipher?.available())return {code:'GITHUB_SECRET_STORAGE',repository};
    return {code:'GITHUB_CONNECTED',repository};
  }).catch(()=>({code:'GITHUB_SETTINGS' as const}))}
  /** 开始新的明确授权；不接收客户端令牌。先可靠保存公开设置，才向固定 GitHub 地址请求设备码。 */
  begin(input:unknown){const requested=this.generation;return this.serial(async()=>{
    if(requested!==this.generation)fail('GITHUB_CANCELLED','GitHub 授权已取消');
    const parsed=githubFeedbackConfigSchema.safeParse(input);if(!parsed.success)fail('GITHUB_CONFIG','请填写有效的公开 Client ID、仓库所有者和仓库名，并允许反馈自动提交');
    this.secure();const previous=await this.read();if(previous.connection)fail('GITHUB_CONNECTED','请先断开当前 GitHub 连接，再更换账号或仓库');
    if(requested!==this.generation)fail('GITHUB_CANCELLED','GitHub 授权已取消');
    this.cancelFlow();const generation=this.generation,config=parsed.data,data:Disk={version:1,config,flowId:randomUUID()};await atomic(this.filename,JSON.stringify(data));
    if(this.closed||generation!==this.generation)fail('GITHUB_CANCELLED','GitHub 授权已取消');
    const controller=new AbortController();const flow:Flow={id:data.flowId!,controller,deviceCode:'',userCode:'',expiresAt:this.now()+600000,nextPollAt:Infinity,interval:5000};this.flow=flow;
    try{
      const reply=await this.request('https://github.com/login/device/code',{method:'POST',body:{client_id:config.clientId,scope:config.visibility==='private'?'repo':'public_repo'},signal:AbortSignal.any([controller.signal,this.lifetime.signal])});
      controller.signal.throwIfAborted();
      const body=z.object({device_code:z.string().min(1).max(1000),user_code:z.string().regex(/^[A-Z0-9-]{4,32}$/),verification_uri:z.literal('https://github.com/login/device'),expires_in:z.number().int().min(1).max(1800),interval:z.number().int().min(1).max(60)}).safeParse(reply.data);
      if(reply.status!==200||!body.success)fail('GITHUB_DEVICE_FLOW','GitHub 设备授权未启动，请检查 Client ID，并在 OAuth App 中启用 Device Flow');
      Object.assign(flow,{deviceCode:body.data.device_code,userCode:body.data.user_code,expiresAt:this.now()+body.data.expires_in*1000,interval:body.data.interval*1000,nextPollAt:this.now()+body.data.interval*1000});return this.view(data);
    }catch(error){if(this.flow===flow)this.cancelFlow();throw error}
  })}
  /** 只轮询本机生成的 flowId；页面刷新或重复轮询不会超过 GitHub 返回的间隔。 */
  poll(input:unknown){return this.serial(async()=>{
    const parsed=z.object({flowId:z.string().uuid()}).strict().safeParse(input);if(!parsed.success)fail('GITHUB_FLOW','授权会话无效，请重新连接');
    const flow=this.flow,data=await this.read();if(!flow||flow.id!==parsed.data.flowId)fail('GITHUB_FLOW','授权会话已结束，请重新连接');
    if(data.flowId!==flow.id||!data.config){this.cancelFlow();fail('GITHUB_FLOW','授权会话已由另一个窗口替换，请重新连接')}
    if(this.now()>=flow.expiresAt){this.cancelFlow();fail('GITHUB_EXPIRED','GitHub 授权码已过期，请重新连接')}
    if(this.now()<flow.nextPollAt)return this.view(data);
    flow.nextPollAt=this.now()+flow.interval;
    const signal=AbortSignal.any([flow.controller.signal,this.lifetime.signal]);
    const reply=await this.request('https://github.com/login/oauth/access_token',{method:'POST',body:{client_id:data.config.clientId,device_code:flow.deviceCode,grant_type:'urn:ietf:params:oauth:grant-type:device_code'},signal});
    signal.throwIfAborted();const body=reply.data as Record<string,unknown>|null;
    if(reply.status===200&&body?.error==='authorization_pending')return this.view(data);
    if(reply.status===200&&body?.error==='slow_down'){flow.interval+=5000;flow.nextPollAt=this.now()+flow.interval;return this.view(data)}
    const token=z.object({access_token:z.string().regex(/^[A-Za-z0-9_]{10,1000}$/),token_type:z.string().refine(value=>value.toLowerCase()==='bearer'),scope:z.string().max(1000),expires_in:z.number().positive().optional()}).safeParse(body);
    if(reply.status!==200||!token.success){this.cancelFlow();fail('GITHUB_AUTH','GitHub 授权未完成或已被拒绝，请重新连接')}
    try{
      const scopes=token.data.scope.split(/[ ,]+/);if(!scopes.includes('repo')&&!(data.config.visibility==='public'&&scopes.includes('public_repo')))fail('GITHUB_SCOPE','GitHub 未授予所选仓库的 Issue 提交权限，请重新连接');
      const identity=await this.verifyIdentity(data.config,token.data.access_token,signal);
      signal.throwIfAborted();this.secure();
      data.connection={id:randomUUID(),...identity,encryptedToken:this.cipher!.encrypt(token.data.access_token),...(token.data.expires_in?{expiresAt:this.now()+token.data.expires_in*1000}:{})};
      delete data.flowId;await atomic(this.filename,JSON.stringify(data));
      if(signal.aborted||this.flow!==flow){delete data.connection;await atomic(this.filename,JSON.stringify(data));fail('GITHUB_CANCELLED','GitHub 授权已取消')}
      this.cancelFlow();return this.view(data);
    }catch{this.cancelFlow();fail('GITHUB_BINDING','GitHub 账号或仓库核验／凭据保存失败，请检查仓库可见性、Issues 开关和系统安全存储后重新连接')}
  })}
  /** 网络核验账号及不可变仓库 ID；无法核实就不发 Issue。 */
  async verifyIdentity(config:NonNullable<Disk['config']>,token:string,signal:AbortSignal){
    const user=await this.request('https://api.github.com/user',{method:'GET',token,signal});
    const account=z.object({id:z.number().int().positive(),login:z.string().regex(/^[A-Za-z0-9-]{1,100}$/)}).safeParse(user.data);
    if(user.status!==200||!account.success)fail('GITHUB_ACCOUNT','GitHub 登录已失效，请在设置中重新连接');
    const repository=await this.request(`https://api.github.com/repos/${config.owner}/${config.repo}`,{method:'GET',token,signal});
    const parsed=z.object({id:z.number().int().positive(),full_name:z.string(),has_issues:z.literal(true),archived:z.literal(false),private:z.boolean()}).safeParse(repository.data);
    if(repository.status!==200||!parsed.success||parsed.data.full_name.toLowerCase()!==`${config.owner}/${config.repo}`.toLowerCase()||parsed.data.private!==(config.visibility==='private'))fail('GITHUB_REPOSITORY','GitHub 目标仓库未通过核验，请检查仓库、可见性和 Issues 开关');
    return {accountId:account.data.id,login:account.data.login,repositoryId:parsed.data.id};
  }
  /** 捕获无密钥范围；断开或重连使旧范围失效，运行时不能静默改投新仓库。 */
  capture(workspaceId:string){return this.serial(async()=>{
    const data=await this.read();if(!data.config||!data.connection)return undefined;
    return {kind:'github-feedback' as const,workspaceId,connectionId:data.connection.id,repositoryId:data.connection.repositoryId,owner:data.config.owner,repo:data.config.repo};
  })}
  /** 持有设置队列直到一次有界请求结束；凭据仅交主进程闭包，不交模型或 IPC。 */
  withConnection<T>(scope:FeedbackScope,signal:AbortSignal,use:(identity:GitHubFeedbackIdentity,signal:AbortSignal)=>Promise<T>){return this.serial(async()=>{
    const data=await this.read(),connection=data.connection,config=data.config;
    if(!connection||!config||connection.id!==scope.connectionId||connection.repositoryId!==scope.repositoryId||config.owner!==scope.owner||config.repo!==scope.repo)fail('GITHUB_CONNECTION_CHANGED','GitHub 连接已改变，请重新发起反馈；原未知提交仍需核实');
    this.secure();if(connection.expiresAt&&this.now()>=connection.expiresAt)fail('GITHUB_EXPIRED','GitHub 登录已过期，请重新连接');
    let token:string;try{token=this.cipher!.decrypt(connection.encryptedToken)}catch{fail('GITHUB_SECRET_STORAGE','GitHub 凭据无法解密，请重新连接')}
    const bounded=AbortSignal.any([signal,this.lifetime.signal]);bounded.throwIfAborted();return use({connection,config,token},bounded);
  })}
  private cancelFlow(){this.generation++;this.flow?.controller.abort();this.flow=undefined}
  /** 撤销本机使用许可，不声称删除 GitHub 网站上的 OAuth 授权。 */
  disconnect(){this.cancelFlow();return this.serial(async()=>{const data=await this.read();delete data.connection;delete data.flowId;await atomic(this.filename,JSON.stringify(data));return this.view(data)})}
  cancel(){this.cancelFlow();return this.status()}
  async close(){this.closed=true;this.cancelFlow();this.lifetime.abort();await this.queue}
}
