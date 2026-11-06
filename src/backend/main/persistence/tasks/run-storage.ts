/**
 * 作用定位：将本机运行目录和 RunJournal 装配为大脑及调度共享的存储端口。
 * 设计原因：保留原有 loop-engine/tasks 数据格式及 fsync 语义，目录重构不迁移或重放历史任务。
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import type {RunStorage} from '../../../core/brain/storage';
import type {TaskSpec} from '../../../core/tasks/types';
import {safeId} from '../../../core/foundation/identity';
import {RunJournal} from './run-journal';

/** 应用装配的文件存储；实例不缓存历史，查询总是核验已落盘日志。 */
export class FileRunStorage implements RunStorage {
  /** 非递归创建任务目录，已有任务须走显式恢复而不能覆盖。 */
  async reserveTask(directory:string,taskId:string){await fs.mkdir(directory,{recursive:true});await fs.mkdir(path.join(directory,safeId(taskId)))}
  createJournal(directory:string,task:TaskSpec,runId:string){return new RunJournal(directory,task,runId)}
  read(directory:string){return RunJournal.read(directory)}
  list(directory:string){return fs.readdir(directory)}
}
