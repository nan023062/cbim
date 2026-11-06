/**
 * 作用定位：对象 CRUD 所需的目录检查、预览计划存储和空目录清理端口。
 * 设计原因：领域层规划对象及引用，主进程负责真实文件系统；清理只能删除空目录，不能扩大为业务资源删除。
 */
import type {ChangeRequest,KnowledgeFile} from './types';

/** 指纹由领域层生成并在提交时复核；计划绑定创建时的工作区实例。 */
export interface ObjectPlan {request:ChangeRequest;hash:string;deletedRoots:string[]}
export interface ObjectStorage {
  assertAbsent(id:string):Promise<void>;
  assertKnowledgeOnly(id:string,files:KnowledgeFile[]):Promise<void>;
  savePlan(id:string,plan:ObjectPlan):Promise<void>;
  readPlan(id:string):Promise<ObjectPlan>;
  pruneEmpty(id:string):Promise<void>;
}
