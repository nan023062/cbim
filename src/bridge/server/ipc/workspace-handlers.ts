/**
 * 作用定位：工作区生命周期与知识编辑的主进程处理器。
 * 设计原因：目录登记、实例启停与知识事务沿原服务执行，公共协议不暴露具体服务对象。请求已在总分派中解析。
 */
import type { ApplicationServices } from './services';
import type { IpcHandlers } from '../../contracts/ipc-call';
import type { WorkspaceIpcResponses } from '../../contracts/ipc-workspace';
import { ModuleSourceBrowser } from '../../../logic/workspace/service/source-browser';
import { ArchitectureService } from '../../../logic/workspace/service/architecture-service';
import { fail } from '../../../core/errors';

/** 仅装配本业务组；每项实际实现都受对应请求／响应约束。 */
export function workspaceIpcHandlers(app: ApplicationServices): IpcHandlers<keyof WorkspaceIpcResponses>
{
  return {
    'source.list': async args => new ModuleSourceBrowser(app.Workspace(args.workspaceId)).List(args),
    'source.read': async args => new ModuleSourceBrowser(app.Workspace(args.workspaceId)).Read(args),
    'list': async args =>
    {
      return app.List();
    },
    'architecture.preview': async args =>
    {
      return new ArchitectureService(app.Workspace(args.workspaceId)).Preview(args);
    },
    'architecture.commit': async args =>
    {
      return new ArchitectureService(app.Workspace(args.workspaceId)).Commit(args);
    },
    'add': async args =>
    {
      const entry = await app.catalog.Add(args.path);
      try
      {
        await app.Open(entry.id)
      }
      catch
      {
        /* report the registered workspace's failed state in list */
      }
      return entry
    },
    'open': async args =>
    {
      return (await app.Open(args.id)).View();
    },
    'rename': async args =>
    {
      const entry = await app.catalog.Rename(args.id, args.name);
      const ws = app.running.get(args.id);
      if (ws)
        ws.entry.name = entry.name;
      app.runtime.Rename(args.id, entry.name);
      return entry
    },
    'remove': async args =>
    {
      return app.Remove(args.id);
    },
    'relocate': async args =>
    {
      const entry = await app.catalog.Relocate(args.id, args.path, args.confirm === true);
      if (entry.id !== args.id)
        await app.Stop(args.id);
      await app.Open(entry.id);
      return entry
    },
    'snapshot': async args =>
    {
      return app.Workspace(args.id).Snapshot();
    },
    'preview': async args =>
    {
      return app.Workspace(args.workspaceId).Preview(args);
    },
    'commit': async args =>
    {
      return app.Workspace(args.workspaceId).Commit(args);
    },
    'movePreview': async args =>
    {
      const ws = app.Workspace(args.id);
      return ws.Preview(await ws.PlanMove(await ws.Read(), args.from, args.to))
    },
    'task': async args =>
    {
      if (!['validate', 'reindex'].includes(args.name))
        fail('TOOL', '不支持的工具');
      return app.Workspace(args.id).StartTask(args.name);
    },
    'cancelTask': async args =>
    {
      return app.Workspace(args.id).CancelTask(args.taskId);
    },
    'local': async args =>
    {
      if (!['memory', 'task-records', 'logs'].includes(args.kind))
        fail('TYPE', '未知本地数据类型');
      return app.Workspace(args.id).LocalData(args.kind);
    },
  };
}
