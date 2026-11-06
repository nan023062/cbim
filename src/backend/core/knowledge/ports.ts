/**
 * 作用定位：核心知识领域需要的工作区存取与事务接口。
 * 设计原因：核心只依赖能力契约，由 main 注入实际工作区；不导入 Electron 或服务生命周期实现。
 */
import type {StoragePaths as Paths} from '../foundation/paths';
import type {ChangeRequest,Preview,Snapshot,TaskView} from './types';

/** 提交完成的持久化回执；结构校验通过不等于业务验收通过。 */
export interface KnowledgeCommit {
  state:string;workspaceId:string;instanceId:string;requestId:string;revision:string;changed:string[];
}
/** 实现方负责实例状态、路径边界、并发控制、版本检查、事务恢复和物理写入。 */
export interface KnowledgeWorkspace {
  /** 对象预览缓存和空目录清理，由工作区平台存储实现。 */
  readonly objects:import('./object-storage').ObjectStorage;
  readonly entry:{id:string;path:string};
  readonly instanceId:string;
  readonly paths:Paths;
  readonly rules:{designRoot:string};
  readonly tasks:Map<string,TaskView>;
  state:string;
  assert(identity?:{workspaceId:string;instanceId:string}):void;
  read():Promise<Snapshot>;
  snapshot():Promise<Snapshot>;
  preview(request:ChangeRequest):Promise<Preview>;
  commit(request:ChangeRequest):Promise<KnowledgeCommit>;
  planMove(snapshot:Snapshot,from:string,to:string|null):Promise<ChangeRequest>;
  startTask(name:'validate'|'reindex'):TaskView;
  /** 仅接受本实例的维护任务 ID；未运行或未知任务须抛错，返回当前真实状态而非承诺已停止。终态重复请求保持原结果。 */
  cancelTask(id:string):TaskView;
}
