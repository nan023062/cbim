/**
 * 作用定位：应用内显式资料导入的取消、工作区归属及真实资源仓库读取入口。
 * 设计原因：导入不启动模型；每个 importId 只执行一次，取消先到也保留墓碑。慢网络和原生选择器不能跨实例返回，仓库授权仍由原连接闭包核实。
 */
import {z} from 'zod';
import {fail} from '../../../core/foundation/errors';
import {hash} from '../../../core/foundation/serialization';
import type {KnowledgeWorkspace} from '../../../core/knowledge/ports';
import {repositoryListInputSchema} from '../../../core/connectors/repository-tools';
import type {RepositoryConnections} from '../../resources/repository-connections';
import {ChatInputs} from './chat-inputs';
import {sourceExcerpt} from './chat-source-readers';

const identitySchema=z.object({id:z.string().min(1).max(128),importId:z.string().uuid()}).strict();
const connectorId=z.string().regex(/^\.cbim\/connectors\/[A-Za-z0-9_-]+$/),digest=z.string().regex(/^[a-f0-9]{64}$/);
const selectionSchema=z.object({connectorId,connectionId:z.string().uuid()}).strict();
const importSchema=identitySchema.extend({attachment:z.discriminatedUnion('kind',[
  z.object({kind:z.literal('link'),value:z.string().min(1).max(4096)}).strict(),
  z.object({kind:z.literal('web'),value:z.string().min(1).max(4096)}).strict(),
  selectionSchema.extend({kind:z.literal('repository_resource'),expectedRevision:digest,resourceId:z.string().uuid()}).strict(),
])}).strict();
const listSchema=identitySchema.extend({connectorId,connectionId:z.string().uuid(),expectedRevision:digest.optional(),offset:z.number().int().nonnegative().optional(),limit:z.number().int().min(1).max(50).optional()}).strict();
function input<T>(schema:z.ZodType<T>,raw:unknown){const parsed=schema.safeParse(raw);if(!parsed.success)fail('ATTACHMENT_IMPORT_INPUT','资料导入字段无效，请重新选择');return parsed.data}
type ImportOperation={workspaceId:string;controller:AbortController;started:boolean;finished:boolean};
/** 应用持有一份；退出或工作区退役先撤销在途导入，不恢复网络操作或重放旧 importId。 */
export class ChatMaterialImports {
  private operations=new Map<string,ImportOperation>();private pending=new Set<Promise<unknown>>();private closed=false;
  constructor(private workspace:(id:string)=>KnowledgeWorkspace,private repositories:RepositoryConnections){}
  private key(id:string,importId:string){return id+':'+importId}
  private assert(owner:KnowledgeWorkspace,signal?:AbortSignal){signal?.throwIfAborted();if(this.closed)fail('ATTACHMENT_IMPORT_CLOSED','资料导入服务正在关闭');owner.assert();if(this.workspace(owner.entry.id)!==owner)fail('ATTACHMENT_IMPORT_STALE','工作区实例已变化，请重新选择资料')}
  private operation(id:string,importId:string){
    const key=this.key(id,importId),old=this.operations.get(key);if(old)return old;
    if(this.operations.size>=4096)fail('ATTACHMENT_IMPORT_LIMIT','本次应用的资料导入记录已达上限，请正常重开应用后再导入');
    const value={workspaceId:id,controller:new AbortController(),started:false,finished:false};this.operations.set(key,value);return value;
  }
  /** 取消可以先于原请求抵达；重复 ID 不重新读来源，已写快照不宣称回滚。 */
  cancel(raw:unknown){const request=input(identitySchema,raw),operation=this.operation(request.id,request.importId);operation.controller.abort(Object.assign(Error('资料导入已取消'),{code:'ATTACHMENT_IMPORT_CANCELLED'}));return {cancelled:!operation.finished}}
  private run<T>(id:string,importId:string,work:(owner:KnowledgeWorkspace,signal:AbortSignal)=>Promise<T>):Promise<T>{
    const operation=this.operation(id,importId);operation.controller.signal.throwIfAborted();
    if(operation.started)fail('ATTACHMENT_IMPORT_REUSED','原导入已经处理，请核实原结果；再次导入需要新的操作标识');
    const owner=this.workspace(id);this.assert(owner);operation.started=true;
    const pending=(async()=>{try{const value=await work(owner,operation.controller.signal);this.assert(owner,operation.controller.signal);return value}finally{operation.finished=true}})();
    this.pending.add(pending);void pending.finally(()=>this.pending.delete(pending)).catch(()=>{});return pending;
  }
  /** 只展示真实已授权且共享就绪的连接；不发送 HTTP，不回传令牌或地址。 */
  async targets(raw:unknown){const {id}=input(z.object({id:z.string().min(1).max(128)}).strict(),raw),owner=this.workspace(id);this.assert(owner);
    const port=await this.repositories.prepareMaterials({workspaceId:id,instanceId:owner.instanceId});this.assert(owner);
    return {workspaceId:id,instanceId:owner.instanceId,targets:port?[...port.targets]:[]};
  }
  /** 显式目录读取和正文导入都绑定用户选择的共享代次，不从最新连接猜测替换。 */
  list(raw:unknown){const request=input(listSchema,raw);return this.run(request.id,request.importId,async(owner,signal)=>{
    const port=await this.port(owner,request.connectorId,request.connectionId,signal);
    const {id:_,importId:__,connectionId:___,...query}=request;return port.list(input(repositoryListInputSchema,query),signal);
  })}
  import(raw:unknown){const request=input(importSchema,raw);return this.run(request.id,request.importId,async(owner,signal)=>{
    const inputs=new ChatInputs(owner),selection=request.attachment;
    if(selection.kind!=='repository_resource')return inputs.add(selection,signal);
    const port=await this.port(owner,selection.connectorId,selection.connectionId,signal),result=await port.capture(selection,signal);
    this.assert(owner,signal);const excerpt=sourceExcerpt(result.resource.content);
    const saved=await inputs.saveSource({kind:'repository_resource',name:result.resource.name,source:'repository:'+result.target.repositoryId+'/'+result.resource.id,text:excerpt.text,note:'已授权资源仓库的静态资料；不安装、不执行'+(excerpt.truncated?'；正文已截取前 64 KiB UTF-8':''),proof:{kind:'repository_resource',capturedAt:new Date().toISOString(),savedTextBytes:excerpt.savedTextBytes,provider:'resource_repository_v1',connectorId:result.target.connectorId,repositoryId:result.target.repositoryId,connectionId:result.target.connectionId,definitionHash:result.definitionHash,grantRevision:result.grantRevision,revision:result.revision,resourceId:result.resource.id,resourceKind:result.resource.kind,fullContentHash:hash(result.resource.content),fullContentBytes:Buffer.byteLength(result.resource.content),truncated:excerpt.truncated,readOnly:true,transport:'http'}},signal);
    await result.assertCurrent(signal);return saved;
  })}
  private async port(owner:KnowledgeWorkspace,connectorId:string,connectionId:string,signal:AbortSignal){
    this.assert(owner,signal);const port=await this.repositories.prepareMaterials({workspaceId:owner.entry.id,instanceId:owner.instanceId});this.assert(owner,signal);
    const target=port?.targets.find(item=>item.connectorId===connectorId);if(!port||!target)fail('REPOSITORY_CONNECTION_NOT_GRANTED','当前工作区没有此已授权且共享就绪的资料连接');
    if(target.connectionId!==connectionId)fail('REPOSITORY_CONNECTION_STALE','资料连接已变化，请重新选择来源');return port;
  }
  /** 原生选择对话框无法强制关闭，但取消立即结束导入，迟到路径不再读取或保存。 */
  pick(raw:unknown,select:()=>Promise<string[]>){const request=input(identitySchema.extend({kind:z.enum(['file','folder'])}).strict(),raw);return this.run(request.id,request.importId,async(owner,signal)=>{
    const files=await this.selection(select,signal);this.assert(owner,signal);if(files.length>12)fail('ATTACHMENT_IMPORT_LIMIT','最多选择12个附件，请减少选择后重试');
    const inputs=new ChatInputs(owner),items=[];for(const file of files){this.assert(owner,signal);items.push(await inputs.path(request.kind,file,signal))}return items;
  })}
  private selection(select:()=>Promise<string[]>,signal:AbortSignal):Promise<string[]>{
    signal.throwIfAborted();return new Promise((resolve,reject)=>{
      const cancel=()=>reject(signal.reason);signal.addEventListener('abort',cancel,{once:true});
      Promise.resolve().then(()=>{signal.throwIfAborted();return select()}).then(value=>{signal.throwIfAborted();resolve(value)},reject).catch(reject).finally(()=>signal.removeEventListener('abort',cancel));
    });
  }
  retireWorkspace(id:string){for(const value of this.operations.values())if(value.workspaceId===id&&!value.finished)value.controller.abort(Object.assign(Error('工作区已关闭，资料导入已取消'),{code:'ATTACHMENT_IMPORT_CANCELLED'}))}
  async close(){this.closed=true;for(const value of this.operations.values())value.controller.abort();await Promise.allSettled([...this.pending])}
}
