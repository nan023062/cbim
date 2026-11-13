/**
 * 作用定位：工作区生命周期与知识编辑的主进程处理器。
 * 设计原因：目录登记、实例启停与知识事务沿原服务执行，公共协议不暴露具体服务对象。请求已在总分派中解析。
 */
import type {ApplicationServices} from './services';
import type {IpcHandlers} from '../../../bridge/contracts/ipc-call';
import type {WorkspaceIpcResponses} from '../../../bridge/contracts/ipc-workspace';
import {ArchitectureService} from '../workspace/architecture-service';
import {fail} from '../../../core/errors';

/** 仅装配本业务组；每项实际实现都受对应请求／响应约束。 */
export function workspaceIpcHandlers(app:ApplicationServices):IpcHandlers<keyof WorkspaceIpcResponses>{
  return {
    'list':async args=>{return app.list();},
    'architecture.preview':async args=>{return new ArchitectureService(app.workspace(args.workspaceId)).preview(args);},
    'architecture.commit':async args=>{return new ArchitectureService(app.workspace(args.workspaceId)).commit(args);},
    'add':async args=>{const entry=await app.catalog.add(args.path);try{await app.open(entry.id)}catch{/* report the registered workspace's failed state in list */}return entry},
    'open':async args=>{return (await app.open(args.id)).view();},
    'rename':async args=>{const entry=await app.catalog.rename(args.id,args.name);const ws=app.running.get(args.id);if(ws)ws.entry.name=entry.name;app.runtime.rename(args.id,entry.name);return entry},
    'remove':async args=>{return app.remove(args.id);},
    'relocate':async args=>{const entry=await app.catalog.relocate(args.id,args.path,args.confirm===true);if(entry.id!==args.id)await app.stop(args.id);await app.open(entry.id);return entry},
    'snapshot':async args=>{return app.workspace(args.id).snapshot();},
    'preview':async args=>{return app.workspace(args.workspaceId).preview(args);},
    'commit':async args=>{return app.workspace(args.workspaceId).commit(args);},
    'movePreview':async args=>{const ws=app.workspace(args.id);return ws.preview(await ws.planMove(await ws.read(),args.from,args.to))},
    'task':async args=>{if(!['validate','reindex'].includes(args.name))fail('TOOL','不支持的工具');
return app.workspace(args.id).startTask(args.name);},
    'cancelTask':async args=>{return app.workspace(args.id).cancelTask(args.taskId);},
    'local':async args=>{if(!['memory','task-records','logs'].includes(args.kind))fail('TYPE','未知本地数据类型');
return app.workspace(args.id).localData(args.kind);},
  };
}
