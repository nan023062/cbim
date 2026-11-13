/**
 * 目录归属：backend/main/knowledge；知识物理事务与恢复。
 * 作用定位：对象预览缓存、目录存在性检查和提交后空目录清理的本机实现。
 * 设计原因：将物理副作用从 ObjectCrud 移出；维持旧 object-plans 缓存布局，不递归删除非空资源。
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import type {ObjectPlan,ObjectStorage} from '../../core/knowledge/object-storage';
import type {KnowledgeFile} from '../../core/knowledge/types';
import type {StoragePaths} from '../../core/foundation/paths';
import {atomic} from '../../../foundations/files';
import {json} from '../../core/foundation/serialization';
import {fail} from '../../core/foundation/errors';

/** owner 只提供工程身份和路径端口，不依赖 Workspace 生命周期实现。 */
export class FileObjectStorage implements ObjectStorage {
  constructor(private owner:{entry:{id:string;path:string};paths:StoragePaths}){}
  async assertAbsent(id:string){try{await fs.lstat(path.join(this.owner.entry.path,id));fail('EXISTS','目标目录已存在，请先查询并核实')}catch(e:any){if(e.code!=='ENOENT')throw e}}
  async assertKnowledgeOnly(id:string,files:KnowledgeFile[]):Promise<void>{
    try{for(const e of await fs.readdir(path.join(this.owner.entry.path,id),{withFileTypes:true})){const p=id+'/'+e.name;if(e.isSymbolicLink())fail('PATH','对象含链接');if(e.isDirectory())await this.assertKnowledgeOnly(p,files);else if(!files.some(f=>f.path===p))fail('OBJECT_ASSETS','对象含非知识资源，当前事务不支持删除这些资源')}}catch(e:any){if(e.code!=='ENOENT')throw e}
  }
  private planPath(id:string){if(!/^[0-9a-f-]{36}$/.test(id))fail('PLAN','无效预览标识');return path.join(this.owner.paths.local(this.owner.entry.id,'cache'),'object-plans',id+'.json')}
  savePlan(id:string,plan:ObjectPlan){return atomic(this.planPath(id),json(plan))}
  async readPlan(id:string):Promise<ObjectPlan>{try{return JSON.parse(await fs.readFile(this.planPath(id),'utf8'))}catch{fail('PLAN','预览不存在，请重新预览')}}
  /** 只做 rmdir；发现非空、已删除目录时保留现场，不删除任何文件。 */
  async pruneEmpty(id:string):Promise<void>{
    const checked=await this.owner.paths.knowledge(this.owner.entry.path,id+'/__check__'),dir=path.dirname(checked);
    try{for(const e of await fs.readdir(dir,{withFileTypes:true}))if(e.isDirectory()&&!e.isSymbolicLink())await this.pruneEmpty(id+'/'+e.name);await fs.rmdir(dir)}catch(e:any){if(!['ENOENT','ENOTEMPTY','EEXIST'].includes(e.code))throw e}
  }
}
