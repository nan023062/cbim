/**
 * 作用定位：为已运行的工作区装配成员派发服务与本机事务存储。
 * 设计原因：把磁盘路径留在 main，调度只依赖持久化端口；提交事实通过注入的观察者汇入应用全局监管，共享工作区锁但不共享知识或执行权限。
 */
import path from 'node:path';
import type {Workspace} from './workspace/workspace';
import {FileDispatchStore} from './persistence/tasks/dispatch-store';
import {WorkspaceDispatchService} from '../scheduler-engine/execution/dispatch-service';
import type {DispatchObserver} from '../core/tasks/dispatch-storage';

/** 应用对每个活动工作区只调用一次；关闭服务必须早于释放工作区锁。 */
export function createMemberDispatch(workspace:Workspace,observer?:DispatchObserver){
  workspace.assert();
  return new WorkspaceDispatchService(workspace,new FileDispatchStore(path.join(workspace.paths.project(workspace.entry.id),'dispatch'),workspace.entry.id,observer));
}
