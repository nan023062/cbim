/**
 * 作用定位：RepositoryStore 与 LocalRepository：本地资源仓库校验、版本检查及原子更新。
 * 设计原因：用统一接口隔离本地和远端仓库，写入要求仓库身份与版本一致；允许完整静态架构包，仍统一限制单项和仓库总字节数。
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {z} from 'zod';
import {KernelLock} from '../platform/locking';
import {atomic} from '../../core/foundation/files';
import {fail} from '../../core/foundation/errors';
import {hash,json} from '../../core/foundation/serialization';
import type {ResourceLibrarySnapshot} from '../../../bridge/contracts/resources';

export const MAX_BYTES=8*1024*1024;
export const resourceFields=z.object({kind:z.enum(['connector','team','agent','skill','architecture','module','workflow']),name:z.string().trim().min(1).max(100),summary:z.string().trim().max(1000),content:z.string().min(1).max(2*1024*1024).refine(value=>Buffer.byteLength(value)<=2*1024*1024,'单项资源正文不能超过 2 MiB')}).strict();
export const itemSchema=resourceFields.extend({id:z.string().uuid(),updatedAt:z.string().datetime()});
export const snapshotSchema=z.object({repositoryId:z.string().uuid(),revision:z.string(),items:z.array(itemSchema).max(2000)});
const diskSchema=z.object({version:z.literal(1),repositoryId:z.string().uuid(),items:z.array(itemSchema).max(2000)}).strict();
export const saveSchema=z.object({repositoryId:z.string().uuid(),revision:z.string(),id:z.string().uuid().optional(),item:resourceFields}).strict();
export const removeSchema=z.object({repositoryId:z.string().uuid(),revision:z.string(),id:z.string().uuid()}).strict();
/** 本地和 HTTP 仓库共用接口；save/remove 校验身份及版本并返回更新后的完整快照。 */
export interface RepositoryStore{read():Promise<ResourceLibrarySnapshot>;save(args:unknown):Promise<ResourceLibrarySnapshot>;remove(args:unknown):Promise<ResourceLibrarySnapshot>}
export class LocalRepository implements RepositoryStore{
  constructor(readonly root:string){}
  private get file(){return path.join(this.root,'cbim-resources.json')}
  private async lock(){const key=hash(process.platform==='win32'?this.root.replaceAll('\\','/').toLowerCase():this.root);for(let n=0;n<100;n++){try{return new KernelLock(this.root,key,'resource-repository')}catch(e:any){if(e.code!=='LOCKED')throw e;await new Promise(r=>setTimeout(r,30))}}return fail('BUSY','仓库正由其他请求更新，请稍后重试')}
  private async checkFile(){try{if((await fs.lstat(this.file)).isSymbolicLink())fail('PATH','仓库数据文件不能是符号链接')}catch(e:any){if(e.code!=='ENOENT')throw e}}
  async initialize(){const lock=await this.lock();try{await this.checkFile();try{await fs.access(this.file)}catch(e:any){if(e.code!=='ENOENT')throw e;await atomic(this.file,json({version:1,repositoryId:randomUUID(),items:[]}))}return await this.read()}finally{lock.close()}}
  async read():Promise<ResourceLibrarySnapshot>{await this.checkFile();let text:string;try{const stat=await fs.stat(this.file);if(stat.size>MAX_BYTES)fail('SIZE','资源仓库超过 8 MiB 限制');text=await fs.readFile(this.file,'utf8')}catch(e:any){if(e.code==='ENOENT')fail('NOT_FOUND','仓库文件不存在，请重新选择仓库');throw e}
    try{const data=diskSchema.parse(JSON.parse(text));if(new Set(data.items.map(i=>i.id)).size!==data.items.length)throw Error('duplicate');return {repositoryId:data.repositoryId,revision:hash(text),items:data.items}}catch{fail('RESOURCE_DATA','仓库内容格式无效，原文件已保留，请修复后重试')}}
  async save(args:unknown){const r=saveSchema.parse(args);return this.update(r,data=>{const index=r.id?data.items.findIndex(i=>i.id===r.id):-1;if(r.id&&index<0)fail('NOT_FOUND','资源已被删除，请刷新');const item={...r.item,id:r.id||randomUUID(),updatedAt:new Date().toISOString()};if(index<0)data.items.push(item);else data.items[index]=item})}
  async remove(args:unknown){const r=removeSchema.parse(args);return this.update(r,data=>{if(!data.items.some(i=>i.id===r.id))fail('NOT_FOUND','资源已被删除，请刷新');data.items=data.items.filter(i=>i.id!==r.id)})}
  private async update(request:{repositoryId:string;revision:string},edit:(data:ResourceLibrarySnapshot)=>void){const lock=await this.lock();try{const current=await this.read();if(current.repositoryId!==request.repositoryId)fail('IDENTITY','仓库身份已变化，请重新连接');if(current.revision!==request.revision)fail('CONFLICT','仓库已被修改，请刷新后重新编辑');edit(current);const text=json(diskSchema.parse({version:1,repositoryId:current.repositoryId,items:current.items}));if(Buffer.byteLength(text)>MAX_BYTES)fail('SIZE','资源仓库超过 8 MiB 限制');await atomic(this.file,text);return {...current,revision:hash(text)}}finally{lock.close()}}
}
