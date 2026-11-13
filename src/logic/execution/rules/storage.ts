/**
 * 目录归属：logic/execution/rules/execution；运行协议与计量。
 * 作用定位：执行循环使用的日志和任务目录存储端口。
 * 设计原因：大脑只要求持久化后才能继续工具执行；磁盘布局、fsync 和实际文件操作由应用注入。
 */
import type {EngineEvent,RunSummary,StoredEvent} from './types';
import type {TaskSpec} from '../../tasks/rules/types';

/** append 返回前记录必须可靠保存；失败后不得继续放行依赖该证据的工具。 */
export interface ExecutionJournal {
  init():Promise<void>;
  append(event:EngineEvent):Promise<StoredEvent>;
  flush():Promise<void>;
}

/** 目录参数由可信装配方生成；实现需保留重复任务拒绝和日志完整性检查。 */
export interface RunStorage {
  reserveTask(directory:string,taskId:string):Promise<void>;
  createJournal(directory:string,task:TaskSpec,runId:string):ExecutionJournal;
  read(directory:string):Promise<RunSummary>;
  list(directory:string):Promise<string[]>;
}
