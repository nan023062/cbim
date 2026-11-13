/**
 * 目录归属：logic/history/service；应用与执行服务装配。
 * 作用定位：在已持锁的工作区中组合角色历史服务、文件索引及 canonical 日志读取端口。
 * 设计原因：生命周期和可信路径归应用装配所有，文件索引可独立复用；只接收身份、目录定位和可用性断言，不依赖完整 Workspace 类型。
 * 职责边界：构造不读盘，初始化与排空顺序由 Application 持有；查询不创建模型或恢复旧运行。
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import {safeId} from '../../execution/ports/identity';
import {AgentHistoryService} from '../runtime/agent-history';
import {FileAgentHistoryStore} from './file-store';
import {FileRunStorage} from '../../execution/storage/run-storage';

/** 主进程已核实并持锁的工作区；assert 在每次原日志读取前重新核实存活，不授予执行能力。 */
export interface AgentHistoryWorkspace {
  entry:{id:string;path:string};
  paths:{project(id:string):string};
  assert():void;
}

/** 构造不读盘；工作区持锁并核实路径后、Store 观察器接收投影前初始化索引。详情定位只能由固定 source/task/run 决定，服务关闭前不释放工作区。 */
export function createAgentHistory(workspace:AgentHistoryWorkspace,diagnostic?:(message:string)=>void){
  const project=workspace.paths.project(workspace.entry.id),storage=new FileRunStorage();
  return new AgentHistoryService(workspace.entry.id,workspace.entry.path,{
    store:new FileAgentHistoryStore(path.join(project,'agent-history'),workspace.entry.id,workspace.entry.path),diagnostic,
    read:async record=>{
      workspace.assert();
      const root=record.journal==='member'?path.join(project,'dispatch','runs','tasks'):path.join(project,'loop-engine','tasks');
      const task=path.join(root,safeId(record.view.taskId)),directory=path.join(task,safeId(record.view.runId));
      for(const target of [root,task,directory,path.join(directory,'events.jsonl')])if((await fs.lstat(target)).isSymbolicLink())throw Error('运行日志不能经符号链接定位');
      const relative=path.relative(await fs.realpath(project),await fs.realpath(directory));
      if(!relative||relative==='..'||relative.startsWith('..'+path.sep)||path.isAbsolute(relative))throw Error('运行日志不在本工作区应用目录');
      const summary=await storage.read(directory);
      if(summary.task.workspaceId!==workspace.entry.id||summary.task.root!==workspace.entry.path||summary.task.taskId!==record.view.taskId||summary.runId!==record.view.runId)throw Error('运行日志身份不一致');
      return summary;
    },
  });
}
