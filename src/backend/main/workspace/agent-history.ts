/**
 * 作用定位：工作区装配层组合历史索引存储、运行日志读取与查询服务，供 Application 按持锁生命周期创建。
 * 设计原因：日志路径和工作区身份属于装配策略；稳定的文件索引存储不应反向依赖 Workspace 或调度服务。
 * 职责边界：不获取或释放工程锁，不主动加载索引；原启动、关闭和日志事实核验顺序由 Application 保持。
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import {safeId} from '../../core/foundation/identity';
import {AgentHistoryService} from '../../scheduler-engine/runtime/agent-history';
import {FileAgentHistoryStore} from '../persistence/tasks/agent-history';
import {FileRunStorage} from '../persistence/tasks/run-storage';

/** 仅使用工作区身份、固定应用目录和运行态断言；不向历史服务暴露知识或调度写入能力。 */
export interface AgentHistoryOwner {
  entry:{id:string;path:string};
  paths:{project(workspaceId:string):string};
  assert():void;
}

/** 构造不读盘；工作区持锁并核实路径后、Store 观察器接收投影前初始化索引。详情定位只能由固定 source/task/run 决定，服务关闭前不释放工作区。 */
export function createAgentHistory(workspace:AgentHistoryOwner,diagnostic?:(message:string)=>void){
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
