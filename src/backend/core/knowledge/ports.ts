/**
 * 作用定位：核心知识领域需要的工作区存取与事务接口。
 * 设计原因：读取与索引刷新按实际需要收窄端口，完整工作区由 main 实现；查询不取得对象存储或写入权限。
 */
import type {StoragePaths as Paths} from '../foundation/paths';
import type {ChangeRequest,Preview,Snapshot,TaskView} from './types';
import type {KnowledgeSnapshotReader} from './snapshot';

/** 可信知识串行域；调用方须在其内再取得模型与派发锁，不得从派发事务反向进入。 */
export interface SourceSnapshotReader {withSourceSnapshot<T>(use:(snapshot:Snapshot)=>Promise<T>):Promise<T>}

/** 提交完成的持久化回执；结构校验通过不等于业务验收通过。 */
export interface KnowledgeCommit {
  state:string;workspaceId:string;instanceId:string;requestId:string;revision:string;changed:string[];
}
/** 索引刷新所需端口；实际实现仍在同一知识事务内核版本、查原 journal 并原子提交。 */
export interface KnowledgeRefreshWorkspace extends KnowledgeSnapshotReader {
  assert(identity?:{workspaceId:string;instanceId:string}):void;
  commit(request:ChangeRequest):Promise<KnowledgeCommit>;
  /** 只读核原完整请求的成功 journal；缓存回执不能替代权威成功证明。 */
  committedReceipt(request:ChangeRequest):Promise<KnowledgeCommit|undefined>;
}
/** 实现方负责实例状态、路径边界、并发控制、版本检查、事务恢复和物理写入。 */
export interface KnowledgeWorkspace extends KnowledgeRefreshWorkspace {
  /** 对象预览缓存和空目录清理，由工作区平台存储实现。 */
  readonly objects:import('./object-storage').ObjectStorage;
  readonly entry:{id:string;path:string};
  readonly instanceId:string;
  readonly paths:Paths;
  readonly rules:{designRoot:string};
  readonly tasks:Map<string,TaskView>;
  state:string;
  read():Promise<Snapshot>;
  preview(request:ChangeRequest):Promise<Preview>;
  /** 内部计划提交只接固定类型与标识；实现重新读取完整私有计划，不能接调用者自报替换意图。 */
  commitPlanned(reference:import('./planned-commit').KnowledgePlanRef):Promise<KnowledgeCommit>;
  planMove(snapshot:Snapshot,from:string,to:string|null):Promise<ChangeRequest>;
  startTask(name:'validate'|'reindex'):TaskView;
  /** 仅接受本实例的维护任务 ID；未运行或未知任务须抛错，返回当前真实状态而非承诺已停止。终态重复请求保持原结果。 */
  cancelTask(id:string):TaskView;
}
