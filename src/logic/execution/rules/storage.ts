/**
 * 目录归属：logic/execution/rules/execution；运行协议与计量。
 * 作用定位：执行循环使用的日志和任务目录存储端口。
 * 设计原因：大脑只要求持久化后才能继续工具执行；磁盘布局、fsync 和实际文件操作由应用注入。
 */
import type { EngineEvent, RunSummary, StoredEvent } from './types';
import type { TaskSpec } from '../../tasks/rules/types';

/** append 返回前记录必须可靠保存；失败后不得继续放行依赖该证据的工具。 */
export interface ExecutionJournal
{
  Init(): Promise<void>;

  Append(event: EngineEvent): Promise<StoredEvent>;

  Flush(): Promise<void>;
}

/** 目录参数由可信装配方生成；实现需保留重复任务拒绝和日志完整性检查。 */
export interface RunStorage
{
  ReserveTask(directory: string, taskId: string): Promise<void>;

  CreateJournal(directory: string, task: TaskSpec, runId: string): ExecutionJournal;

  Read(directory: string): Promise<RunSummary>;

  List(directory: string): Promise<string[]>;
}
