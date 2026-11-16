/**
 * 作用定位：资源仓库、共享连接与架构包的主进程处理器。
 * 设计原因：连接登记、共享授权与包事务保持独立，原回执查询不隐式重做提交。请求已在总分派中解析。
 */
import type { ApplicationServices } from './services';

import type { IpcHandlers } from '../../contracts/ipc-call';

import type { ResourcesIpcResponses } from '../../contracts/ipc-resources';

import { WorkspacePackages } from '../../../logic/resources/packages/workspace-packages';

/** 仅装配本业务组；每项实际实现都受对应请求／响应约束。 */
export function resourcesIpcHandlers(app: ApplicationServices): IpcHandlers<keyof ResourcesIpcResponses>
{
  return {
    'resources.status': async args => { return app.resources.Status(); },

    'resources.configure': async args => { return app.resources.Configure(args); },

    'resources.list': async args => { return app.resources.Read(); },

    'resources.save': async args => { return app.resources.Save(args); },

    'resources.remove': async args => { return app.resources.Remove(args); },

    'resources.share': async args => { return app.resources.StartSharing(args); },

    'resources.stopSharing': async args => { return app.resources.StopSharing(); },

    'resources.connection': async args => { return app.resources.Connection(); },

    'resources.connection.list': async args => { return app.repositoryConnections.List(args); },

    'resources.connection.preview': async args => { return app.repositoryConnections.Preview(args); },

    'resources.connection.commit': async args => { return app.repositoryConnections.Commit(args); },

    'resources.connection.commitReceipt': async args => { return app.repositoryConnections.CommitReceipt(args); },

    'resources.connection.unaccepted': async args => { return app.repositoryConnections.Unaccepted(args); },

    'resources.connection.grant': async args => { return app.repositoryConnections.Grant(args); },

    'resources.connection.revoke': async args => { return app.repositoryConnections.Revoke(args); },

    'resources.connection.check': async args => { return app.repositoryConnections.Check(args); },

    'resources.connection.receipt': async args => { return app.repositoryConnections.Receipt(args); },

    'resources.publishWorkspace': async args => { return new WorkspacePackages(app.Workspace(args.workspaceId), app.resources).Publish(args); },

    'resources.importPreview': async args => { return new WorkspacePackages(app.Workspace(args.workspaceId), app.resources).Preview(args); },

    'resources.importCommit': async args => { return new WorkspacePackages(app.Workspace(args.workspaceId), app.resources).Commit(args); },
  };
}
