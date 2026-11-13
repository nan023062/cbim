/**
 * 作用定位：桌面资源仓库连接的知识预览/登记、独立本机授权和显式 HTTP 只读核验。
 * 设计原因：静态定义不等于权限，登记与授权分别返回真实回执；所有网络来源由当前共享闭包绑定，模型不能提供地址、令牌或授权。
 * 职责边界：桌面负责显式授权；主 Loop 与桌面资料导入仅捕获已有授权的只读闭包，不启动共享、不执行资源内容、不自动重试或本地回退。
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {z} from 'zod';
import {isDeepStrictEqual} from 'node:util';
import {atomic} from '../../../core/platform/node/files';
import {hash,json} from '../../../core/platform/node/serialization';
import {fail} from '../../../core/errors';
import type {KnowledgeWorkspace,KnowledgeCommit} from '../../knowledge/rules/ports';
import type {ChangeRequest} from '../../knowledge/rules/types';
import {connectorRegistrySchema,isResourceRepositoryConnector,resourceRepositoryConnectorDefinitionSchema,type ConnectorDefinition} from '../rules/definition';
import {
  repositoryConnectionListInputSchema,repositoryConnectionListSchema,repositoryConnectionPreviewInputSchema,repositoryConnectionPreviewSchema,
  repositoryConnectionCommitInputSchema,repositoryConnectionCommitLookupSchema,repositoryConnectionCommitSchema,repositoryConnectionGrantInputSchema,repositoryConnectionRevokeInputSchema,
  repositoryConnectionLookupSchema,repositoryConnectionCheckInputSchema,repositoryConnectionCheckSchema,
  repositoryConnectionUnacceptedInputSchema,repositoryConnectionUnacceptedSchema,
  type RepositoryConnectionIdentity,type RepositoryConnectionPreview,type RepositoryConnectionCommit,type RepositoryConnectionGrant,type RepositoryConnectionReceipt,
} from '../rules/repository-connection';
import {RepositoryConnectionStore} from './repository-connection-store';
import type {ResourceRepositories,SharedRepositoryReadConnection} from '../../resources/service';
import {
  repositoryListInputSchema,repositoryGetInputSchema,repositoryToolLimits,
  type RepositoryToolsPort,type RepositoryToolTarget,
} from '../rules/repository-tools';

const registryPath='.cbim/connectors/registry.json';
const requestSchema=z.object({workspaceId:z.string(),instanceId:z.string().uuid(),revision:z.string(),requestId:z.string().uuid(),changes:z.array(z.object({path:z.string(),text:z.string().nullable()}).strict())}).strict();
const planSchema=z.object({version:z.literal(1),preview:repositoryConnectionPreviewSchema,request:requestSchema,fingerprint:z.string().regex(/^[a-f0-9]{64}$/),committed:repositoryConnectionCommitSchema.optional()}).strict();
type Plan=z.infer<typeof planSchema>;
const identity=(input:RepositoryConnectionIdentity)=>({workspaceId:input.workspaceId,instanceId:input.instanceId});
const definitionHash=(definition:ConnectorDefinition)=>hash(json(definition));
function checkedInput<T>(schema:z.ZodType<T>,raw:unknown):T{const result=schema.safeParse(raw);if(!result.success)fail('REPOSITORY_CONNECTION_INPUT','资源仓库连接请求字段无效');return result.data}
/** 查询原提交的端口归本机知识事务，不扩大 Core 普通知识调用权限。 */
export interface RepositoryConnectionWorkspace extends KnowledgeWorkspace {committedReceipt(request:ChangeRequest):Promise<KnowledgeCommit|undefined>;hasRecordedRequest(request:ChangeRequest):Promise<boolean>}
/** 私有捕获事实只交给桌面快照导入；令牌与地址始终留在原共享闭包。 */
interface CapturedRepositoryTarget {target:RepositoryToolTarget;definitionHash:string;grantRevision:number;verify(signal:AbortSignal):Promise<void>;read(signal:AbortSignal):ReturnType<SharedRepositoryReadConnection['read']>}

/** 全应用一个服务；授权写入串行，慢速 check 不占写队列，撤销可中止它且仍有前后版本屏障。 */
export class RepositoryConnections {
  private queue:Promise<unknown>=Promise.resolve();private closed=false;
  private checks=new Map<AbortController,{workspaceId:string;connectorId:string}>();
  private reads=new Set<Promise<unknown>>();
  private store:RepositoryConnectionStore;
  constructor(filename:string,private resources:ResourceRepositories,private workspace:(id:string)=>RepositoryConnectionWorkspace){this.store=new RepositoryConnectionStore(filename)}
  init(){return this.store.init()}
  private current(){if(this.closed)fail('REPOSITORY_CONNECTION_UNAVAILABLE','资源仓库连接服务正在关闭')}
  private owner(input:RepositoryConnectionIdentity){this.current();const owner=this.workspace(input.workspaceId);owner.assert(input);return owner}
  private assertOwner(owner:KnowledgeWorkspace,input:RepositoryConnectionIdentity){if(this.owner(input)!==owner)fail('REPOSITORY_CONNECTION_STALE','工作区连接实例已更换')}
  private serial<T>(fn:()=>Promise<T>){const result=this.queue.catch(()=>{}).then(()=>{this.current();return fn()});this.queue=result;return result}
  private async definitions(owner:KnowledgeWorkspace){owner.assert();const snapshot=await owner.read(),file=snapshot.files.find(file=>file.path===registryPath);if(!file)fail('REPOSITORY_CONNECTION_DEFINITION','当前知识缺少链接器注册表');let entries:ConnectorDefinition[];try{entries=connectorRegistrySchema.parse(JSON.parse(file.text)).connectors}catch{fail('REPOSITORY_CONNECTION_DEFINITION','链接器注册表无效，请先修复正式知识')}
    owner.assert();return {snapshot,entries};
  }
  private async definition(owner:KnowledgeWorkspace,connectorId:string){const {snapshot,entries}=await this.definitions(owner),definition=entries.find(item=>item.id===connectorId);if(!definition||!isResourceRepositoryConnector(definition))fail('REPOSITORY_CONNECTION_DEFINITION','该定义不是已登记的资源仓库链接器');return {snapshot,definition,definitionHash:definitionHash(definition)}}
  private planPath(owner:KnowledgeWorkspace,planId:string){return path.join(owner.paths.local(owner.entry.id,'cache'),'repository-connections',z.string().uuid().parse(planId)+'.json')}
  private async savePlan(owner:KnowledgeWorkspace,plan:Plan){await atomic(this.planPath(owner,plan.preview.planId),json(plan))}
  private async readPlan(owner:KnowledgeWorkspace,planId:string,requireInstance=true):Promise<Plan>{try{const file=this.planPath(owner,planId),stat=await fs.lstat(file);if(!stat.isFile()||stat.isSymbolicLink()||stat.size>8*1024*1024)throw Error('file');const plan=planSchema.parse(JSON.parse(await fs.readFile(file,'utf8')));if(plan.preview.planId!==planId||plan.request.requestId!==planId||plan.request.workspaceId!==owner.entry.id||hash(json({preview:plan.preview,request:plan.request}))!==plan.fingerprint)throw Error('fingerprint');if(requireInstance)owner.assert(plan.request);return plan}catch{fail('REPOSITORY_CONNECTION_PLAN','连接定义预览不存在、已过期或损坏，请重新预览')};}
  async list(raw:unknown){const input=checkedInput(repositoryConnectionListInputSchema,raw),owner=this.owner(input),{snapshot,entries}=await this.definitions(owner),sharing=this.resources.sharedIdentity(),grants=this.store.grants(input.workspaceId);
    const connections=entries.map(definition=>{
      const grant=grants.find(item=>item.connectorId===definition.id),digest=definitionHash(definition),repository=isResourceRepositoryConnector(definition);
      const status=!repository?'unsupported':!grant?.enabled?'not_granted':grant.definitionHash!==digest?'definition_changed':grant.repositoryId!==definition.repository.repositoryId?'repository_changed':!sharing?'not_shared':sharing.repositoryId!==grant.repositoryId?'repository_changed':'ready';
      return {connectorId:definition.id,name:definition.name,summary:definition.summary,provider:repository?'resource_repository_v1':'cindy_plugin',definitionHash:digest,...(repository?{repositoryId:definition.repository.repositoryId}:{}),grantRevision:grant?.revision??0,...(grant?{grant}:{}),status};
    });
    for(const grant of grants)if(!entries.some(definition=>definition.id===grant.connectorId))connections.push({connectorId:grant.connectorId,name:grant.connectorId,summary:'原定义已删除，仍可撤销本机授权',provider:'resource_repository_v1',repositoryId:grant.repositoryId,grantRevision:grant.revision,grant,status:'definition_missing'} as typeof connections[number]);
    owner.assert(input);return repositoryConnectionListSchema.parse({identity:identity(input),knowledgeRevision:snapshot.revision,...(sharing?{sharing}:{}),connections});
  }
  /** 仅保存知识事务预览；没有 grant，也不会自动开启 HTTP 服务。 */
  preview(raw:unknown):Promise<RepositoryConnectionPreview>{const input=checkedInput(repositoryConnectionPreviewInputSchema,raw);return this.serial(async()=>{
    const owner=this.owner(input),connection=this.resources.readConnection(input.repositoryId),{snapshot,entries}=await this.definitions(owner);if(snapshot.revision!==input.revision)fail('REPOSITORY_CONNECTION_STALE','知识版本已变化，请重新读取并预览');
    const definition=resourceRepositoryConnectorDefinitionSchema.parse({id:input.connectorId,name:input.name,summary:input.summary,provider:'resource_repository_v1',repository:{repositoryId:input.repositoryId}}),existing=entries.find(item=>item.id===input.connectorId);
    if(existing&&(!isResourceRepositoryConnector(existing)||existing.repository.repositoryId!==input.repositoryId))fail('REPOSITORY_CONNECTION_DEFINITION','同名链接器已有其他来源，不能用连接登记覆盖');
    const next=existing?entries.map(item=>item.id===input.connectorId?definition:item):[...entries,definition],planId=randomUUID();
    const request={...identity(input),revision:input.revision,requestId:planId,changes:existing&&definitionHash(existing)===definitionHash(definition)?[]:[{path:registryPath,text:json({connectors:next})}]};
    const checked=await owner.preview(request);owner.assert(input);connection.assertCurrent();
    const result=repositoryConnectionPreviewSchema.parse({identity:identity(input),planId,revision:input.revision,repositoryId:input.repositoryId,connectionId:connection.connectionId,definition,definitionHash:definitionHash(definition),changes:checked.changes,validation:{structural:checked.validation.structural,issues:checked.validation.issues,architecture:checked.validation.architecture,business:checked.validation.business},diff:checked.diff});
    const plan={version:1 as const,preview:result,request,fingerprint:hash(json({preview:result,request}))};await this.savePlan(owner,plan);owner.assert(input);connection.assertCurrent();return result;
  })}
  /** 显式提交只写正式链接器定义；失败后沿原 planId 核实，不顺带授予本机权限。 */
  commit(raw:unknown):Promise<RepositoryConnectionCommit>{const input=checkedInput(repositoryConnectionCommitInputSchema,raw);return this.serial(async()=>{
    const owner=this.owner(input),plan=await this.readPlan(owner,input.planId),known=await owner.committedReceipt(plan.request);
    // 计划缓存不是提交证明；真实知识 journal 必须支持缓存回执，损坏缓存不能冒充写入成功。
    if(plan.committed&&(!known||!isDeepStrictEqual(plan.committed,this.commitResult(plan,known))))fail('REPOSITORY_CONNECTION_DATA','定义回执缓存与原知识事务不一致，请核实记录');
    if(known)return this.commitResult(plan,known);
    const current=await owner.read();if(current.revision===plan.request.revision){const connection=this.resources.readConnection(plan.preview.repositoryId);if(connection.connectionId!==plan.preview.connectionId)fail('REPOSITORY_CONNECTION_STALE','预览所属共享连接已变化，请重新预览');connection.assertCurrent()}
    // 版本已变化时，原知识事务只可返回同请求已提交回执；否则其 CAS 拒绝，不重放旧定义。
    this.assertOwner(owner,input);const committed=await owner.commit(plan.request);const result=this.commitResult(plan,committed);
    plan.committed=result;try{await this.savePlan(owner,plan)}catch{fail('REPOSITORY_CONNECTION_APPLIED','链接器定义已经登记，回执缓存未保存；请核实或重试同一 planId，尚未授予只读权限')};return result;
  })}
  private commitResult(plan:Plan,committed:KnowledgeCommit){return repositoryConnectionCommitSchema.parse({identity:identity(plan.request),planId:plan.preview.planId,connectorId:plan.preview.definition.id,repositoryId:plan.preview.repositoryId,definitionHash:plan.preview.definitionHash,knowledgeRevision:committed.revision,state:'committed',changed:committed.changed})}
  /** 无副作用查询旧 planId，缓存回执丢失时查原知识事务，不因当前定义相同就推断提交成功。 */
  async commitReceipt(raw:unknown):Promise<RepositoryConnectionCommit|undefined>{const input=checkedInput(repositoryConnectionCommitLookupSchema,raw);this.current();const owner=this.workspace(input.workspaceId);owner.assert();const plan=await this.readPlan(owner,input.planId,false),committed=await owner.committedReceipt(plan.request);return committed?this.commitResult(plan,committed):undefined}
  /** 只有旧实例已退役且写队列排空后的“完全无记录”才能证明未受理；不清历史、不新建请求。 */
  unaccepted(raw:unknown){const input=checkedInput(repositoryConnectionUnacceptedInputSchema,raw);return this.serial(async()=>{
    const owner=this.workspace(input.workspaceId);owner.assert();let unaccepted=false;
    if(owner.instanceId!==input.instanceId){
      if(input.action==='commit'){const plan=await this.readPlan(owner,input.id,false);if(plan.request.instanceId!==input.instanceId)fail('REPOSITORY_CONNECTION_PLAN','原计划不属于待核实的实例');unaccepted=!plan.committed&&!await owner.hasRecordedRequest(plan.request)}
      else unaccepted=!this.store.hasCommand(input.id);
    }
    owner.assert();return repositoryConnectionUnacceptedSchema.parse({identity:identity(input),action:input.action,id:input.id,unaccepted});
  })}
  private abortChecks(workspaceId:string,connectorId?:string){for(const [controller,target]of this.checks)if(target.workspaceId===workspaceId&&(!connectorId||target.connectorId===connectorId))controller.abort()}
  /** 仅桌面显式 IPC 调用本方法；定义和实际共享身份重核后持久授权，不由模型或知识正文签发。 */
  grant(raw:unknown):Promise<RepositoryConnectionReceipt>{const input=checkedInput(repositoryConnectionGrantInputSchema,raw),inputHash=hash(json({action:'grant',input}));return this.serial(async()=>{
    const replay=this.store.replay(input.workspaceId,input.commandId,inputHash);if(replay)return replay;
    const owner=this.owner(input),old=this.store.grant(input.workspaceId,input.connectorId);if((old?.revision??0)!==input.expectedGrantRevision)fail('REPOSITORY_CONNECTION_STALE','授权版本已变化，请重新读取');
    const source=await this.definition(owner,input.connectorId);if(source.definitionHash!==input.definitionHash||source.definition.repository.repositoryId!==input.repositoryId)fail('REPOSITORY_CONNECTION_STALE','链接器定义或仓库身份已变化，请重新读取');
    const connection=this.resources.readConnection(input.repositoryId);await connection.read();const after=await this.definition(owner,input.connectorId);this.assertOwner(owner,input);connection.assertCurrent();if(after.definitionHash!==input.definitionHash)fail('REPOSITORY_CONNECTION_STALE','授权期间链接器定义发生变化，未保存授权');
    const grant:RepositoryConnectionGrant={workspaceId:input.workspaceId,connectorId:input.connectorId,repositoryId:input.repositoryId,definitionHash:input.definitionHash,revision:input.expectedGrantRevision+1,enabled:true,updatedAt:new Date().toISOString()},receipt:RepositoryConnectionReceipt={workspaceId:input.workspaceId,connectorId:input.connectorId,commandId:input.commandId,action:'grant',grant};
    await this.store.save(grant,receipt,inputHash);this.abortChecks(input.workspaceId,input.connectorId);return structuredClone(receipt);
  })}
  /** 撤销保留静态定义和历史回执；不停止共享服务器，也不影响其他工作区授权。 */
  revoke(raw:unknown):Promise<RepositoryConnectionReceipt>{const input=checkedInput(repositoryConnectionRevokeInputSchema,raw),inputHash=hash(json({action:'revoke',input}));return this.serial(async()=>{
    const replay=this.store.replay(input.workspaceId,input.commandId,inputHash);if(replay)return replay;this.owner(input);
    const old=this.store.grant(input.workspaceId,input.connectorId);if(!old)fail('REPOSITORY_CONNECTION_NOT_GRANTED','此工作区链接器尚未获得本机授权');if(old.revision!==input.expectedGrantRevision)fail('REPOSITORY_CONNECTION_STALE','授权版本已变化，请重新读取');
    const grant={...old,revision:old.revision+1,enabled:false,updatedAt:new Date().toISOString()},receipt:RepositoryConnectionReceipt={workspaceId:input.workspaceId,connectorId:input.connectorId,commandId:input.commandId,action:'revoke',grant};await this.store.save(grant,receipt,inputHash);this.abortChecks(input.workspaceId,input.connectorId);return structuredClone(receipt);
  })}
  /** 查询原授权命令，不校验共享、不发送网络请求，也不复活已被后续撤销的授权。 */
  receipt(raw:unknown){const input=checkedInput(repositoryConnectionLookupSchema,raw);this.current();return this.store.receipt(input.workspaceId,input.commandId)}
  /**
   * 主运行创建时只读捕获已就绪授权，不联网；坏静态注册表不妨碍主会话诊断知识。
   * 每个闭包固定原实例/定义/授权/共享代际。后续显式授权或重新共享只影响新运行，旧运行不能静默换源。
   */
  private async captureTargets(input:RepositoryConnectionIdentity){
    input=Object.freeze(identity(input));
    const owner=this.owner(input),sharing=this.resources.sharedIdentity();if(!sharing)return undefined;
    let entries:ConnectorDefinition[];try{({entries}=await this.definitions(owner))}catch(error:any){if(error.code==='REPOSITORY_CONNECTION_DEFINITION')return undefined;throw error}
    this.assertOwner(owner,input);
    if(new Set(entries.map(entry=>entry.id)).size!==entries.length)return undefined;
    const grants=this.store.grants(input.workspaceId),captured=new Map<string,CapturedRepositoryTarget>();
    for(const definition of entries){
      if(!isResourceRepositoryConnector(definition)||definition.repository.repositoryId!==sharing.repositoryId)continue;
      const grant=grants.find(item=>item.connectorId===definition.id),digest=definitionHash(definition);
      if(!grant?.enabled||grant.definitionHash!==digest||grant.repositoryId!==sharing.repositoryId)continue;
      const connection=this.resources.readConnection(grant.repositoryId);
      if(connection.connectionId!==sharing.connectionId)fail('REPOSITORY_CONNECTION_STALE','准备期间共享连接已变化');
      const target:RepositoryToolTarget={workspaceId:input.workspaceId,connectorId:definition.id,repositoryId:connection.repositoryId,connectionId:connection.connectionId,name:definition.name.slice(0,100),summary:definition.summary.slice(0,1000)};
      const verify=async(signal:AbortSignal)=>{
        signal.throwIfAborted();this.assertOwner(owner,input);connection.assertCurrent();
        const current=await this.definition(owner,definition.id);this.assertOwner(owner,input);signal.throwIfAborted();connection.assertCurrent();
        const latest=this.store.grant(input.workspaceId,definition.id);
        if(current.definitionHash!==digest||!latest?.enabled||latest.revision!==grant.revision||latest.definitionHash!==digest||latest.repositoryId!==grant.repositoryId)fail('REPOSITORY_CONNECTION_STALE','本轮仓库定义或只读授权已变化，原连接不可继续使用');
      };
      captured.set(definition.id,{target,definitionHash:digest,grantRevision:grant.revision,verify,read:signal=>{
        const controller=new AbortController(),combined=AbortSignal.any([signal,controller.signal]);this.checks.set(controller,{workspaceId:input.workspaceId,connectorId:definition.id});
        const operation=(async()=>{try{await verify(combined);const result=await connection.read(combined);await verify(combined);return result}finally{this.checks.delete(controller)}})();
        this.reads.add(operation);void operation.finally(()=>this.reads.delete(operation)).catch(()=>{});return operation;
      }});
    }
    if(!captured.size)return undefined;
    return captured;
  }
  /** 主运行仍只取得原 list/get 能力；捕获本身不联网。 */
  async prepareTools(input:RepositoryConnectionIdentity):Promise<RepositoryToolsPort|undefined>{
    const captured=await this.captureTargets(input);return captured?this.tools(captured):undefined;
  }
  /** 桌面显式资料导入使用同一授权闭包，一次 HTTP 读取完整选定版本，不能拼接多次分页冒充同一快照。 */
  async prepareMaterials(input:RepositoryConnectionIdentity){
    const captured=await this.captureTargets(input);if(!captured)return undefined;
    const tools=this.tools(captured);
    return {targets:tools.targets,list:tools.list,capture:async(raw:{connectorId:string;connectionId:string;expectedRevision:string;resourceId:string},signal:AbortSignal)=>{
      const entry=captured.get(raw.connectorId);if(!entry)fail('REPOSITORY_CONNECTION_NOT_GRANTED','该资料来源不属于当前工作区已授权连接');
      if(entry.target.connectionId!==raw.connectionId)fail('REPOSITORY_CONNECTION_STALE','资料连接已变化，请重新选择来源');
      const result=await entry.read(signal);
      if(result.revision!==raw.expectedRevision)fail('REPOSITORY_REVISION_CHANGED','仓库资料已变化，请重新读取目录版本');
      const resource=result.items.find(item=>item.id===raw.resourceId);if(!resource)fail('REPOSITORY_RESOURCE_MISSING','当前仓库版本没有该资源');
      return {target:{...entry.target},definitionHash:entry.definitionHash,grantRevision:entry.grantRevision,revision:result.revision,resource:{...resource},assertCurrent:entry.verify};
    }};
  }
  private tools(captured:Map<string,CapturedRepositoryTarget>):RepositoryToolsPort{
    const selected=(connectorId:string)=>{const target=captured.get(connectorId);if(!target)fail('REPOSITORY_CONNECTION_NOT_GRANTED','该链接器不属于本轮已捕获的只读授权');return target};
    return {
      targets:Object.freeze([...captured.values()].map(item=>Object.freeze({...item.target}))),
      list:async(raw,signal)=>{
        const request=checkedInput(repositoryListInputSchema,raw),entry=selected(request.connectorId),result=await entry.read(signal);
        if(request.expectedRevision!==undefined&&request.expectedRevision!==result.revision)fail('REPOSITORY_REVISION_CHANGED','仓库资料已变化，请明确重新读取目录版本');
        const offset=request.offset??0,limit=request.limit??20;if(offset>result.items.length)fail('REPOSITORY_PAGE_INVALID','目录偏移超出当前版本范围');
        const items=result.items.slice(offset,offset+limit).map(({content:_,...item})=>item),end=offset+items.length;
        const {workspaceId,connectorId,repositoryId,connectionId}=entry.target;
        return {scope:{kind:'repository',workspaceId,connectorId,repositoryId,connectionId,operation:'list'},revision:result.revision,offset,totalItems:result.items.length,items,...(end<result.items.length?{nextOffset:end}:{}),readOnly:true};
      },
      get:async(raw,signal)=>{
        const request=checkedInput(repositoryGetInputSchema,raw),entry=selected(request.connectorId),result=await entry.read(signal);
        if(request.expectedRevision!==result.revision)fail('REPOSITORY_REVISION_CHANGED','仓库资料已变化，请明确重新读取目录版本');
        const item=result.items.find(item=>item.id===request.resourceId);if(!item)fail('REPOSITORY_RESOURCE_MISSING','当前仓库版本没有该资源');
        const characters=Array.from(item.content),offset=request.offset??0,limit=request.limit??repositoryToolLimits.contentCharacters;
        if(offset>characters.length)fail('REPOSITORY_PAGE_INVALID','正文偏移超出当前版本范围');
        const text=characters.slice(offset,offset+limit).join(''),end=offset+Array.from(text).length,{content:_,...resource}=item,{workspaceId,connectorId,repositoryId,connectionId}=entry.target;
        return {scope:{kind:'repository',workspaceId,connectorId,repositoryId,connectionId,operation:'get'},revision:result.revision,resource,content:{text,offset,totalCharacters:characters.length,contentHash:hash(item.content),...(end<characters.length?{nextOffset:end}:{}),complete:offset===0&&end===characters.length},readOnly:true};
      },
    };
  }
  /** 仅显式核验发起真实 HTTP；读到内容后再次核对实例、定义、授权和共享代际，绝不返回迟到旧结果。 */
  check(raw:unknown){const operation=this.checkOnce(raw);this.reads.add(operation);void operation.finally(()=>this.reads.delete(operation)).catch(()=>{});return operation}
  private async checkOnce(raw:unknown){const input=checkedInput(repositoryConnectionCheckInputSchema,raw),owner=this.owner(input),grant=this.store.grant(input.workspaceId,input.connectorId);
    if(!grant?.enabled)fail('REPOSITORY_CONNECTION_NOT_GRANTED','请先明确授予当前工作区此链接器的只读权限');if(grant.revision!==input.expectedGrantRevision)fail('REPOSITORY_CONNECTION_STALE','授权版本已变化，请重新读取');
    const source=await this.definition(owner,input.connectorId);if(source.definitionHash!==grant.definitionHash||source.definition.repository.repositoryId!==grant.repositoryId)fail('REPOSITORY_CONNECTION_STALE','正式定义已变化，请重新核实并授权');
    this.assertOwner(owner,input);const before=this.store.grant(input.workspaceId,input.connectorId);if(!before?.enabled||before.revision!==grant.revision)fail('REPOSITORY_CONNECTION_STALE','授权在读取前已变化，未发送仓库请求');
    const connection=this.resources.readConnection(grant.repositoryId),controller=new AbortController();this.checks.set(controller,{workspaceId:input.workspaceId,connectorId:input.connectorId});
    try{const result=await connection.read(controller.signal);this.assertOwner(owner,input);const after=await this.definition(owner,input.connectorId),latest=this.store.grant(input.workspaceId,input.connectorId);this.assertOwner(owner,input);connection.assertCurrent();if(controller.signal.aborted||after.definitionHash!==grant.definitionHash||!latest?.enabled||latest.revision!==grant.revision)fail('REPOSITORY_CONNECTION_STALE','核验期间定义、授权或连接已变化，请重新读取');
      return repositoryConnectionCheckSchema.parse({identity:identity(input),connectorId:input.connectorId,repositoryId:grant.repositoryId,definitionHash:grant.definitionHash,grantRevision:grant.revision,connectionId:connection.connectionId,checkedAt:new Date().toISOString(),revision:result.revision,itemCount:result.items.length,items:result.items.slice(0,20).map(({content:_,...item})=>item),truncated:result.items.length>20,readOnly:true,transport:'http'});
    }finally{this.checks.delete(controller)}
  }
  /** 工作区关闭只取消在途核验，持久授权保留；重开不会自动打开服务器。 */
  retireWorkspace(workspaceId:string){this.abortChecks(workspaceId)}
  async close(){this.closed=true;for(const controller of this.checks.keys())controller.abort();await Promise.allSettled([this.queue,...this.reads])}
}
