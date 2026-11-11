/**
 * 作用定位：资源仓库、共享连接与架构包的主进程处理器。
 * 设计原因：连接登记、共享授权与包事务保持独立，原回执查询不隐式重做提交。请求已在总分派中解析。
 */
import type {ApplicationServices} from './services';
import type {IpcHandlers} from '../../../bridge/contracts/ipc-call';
import type {ResourcesIpcResponses} from '../../../bridge/contracts/ipc-resources';
import {WorkspacePackages} from '../resources/workspace-packages';

/** 仅装配本业务组；每项实际实现都受对应请求／响应约束。 */
export function resourcesIpcHandlers(app:ApplicationServices):IpcHandlers<keyof ResourcesIpcResponses>{
  return {
    'resources.status':async args=>{return app.resources.status();},
    'resources.configure':async args=>{return app.resources.configure(args);},
    'resources.list':async args=>{return app.resources.read();},
    'resources.save':async args=>{return app.resources.save(args);},
    'resources.remove':async args=>{return app.resources.remove(args);},
    'resources.share':async args=>{return app.resources.startSharing(args);},
    'resources.stopSharing':async args=>{return app.resources.stopSharing();},
    'resources.connection':async args=>{return app.resources.connection();},
    'resources.connection.list':async args=>{return app.repositoryConnections.list(args);},
    'resources.connection.preview':async args=>{return app.repositoryConnections.preview(args);},
    'resources.connection.commit':async args=>{return app.repositoryConnections.commit(args);},
    'resources.connection.commitReceipt':async args=>{return app.repositoryConnections.commitReceipt(args);},
    'resources.connection.unaccepted':async args=>{return app.repositoryConnections.unaccepted(args);},
    'resources.connection.grant':async args=>{
return app.repositoryConnections.grant(args);},
    'resources.connection.revoke':async args=>{
return app.repositoryConnections.revoke(args);},
    'resources.connection.check':async args=>{return app.repositoryConnections.check(args);},
    'resources.connection.receipt':async args=>{return app.repositoryConnections.receipt(args);},
    'resources.publishWorkspace':async args=>{return new WorkspacePackages(app.workspace(args.workspaceId),app.resources).publish(args);},
    'resources.importPreview':async args=>{return new WorkspacePackages(app.workspace(args.workspaceId),app.resources).preview(args);},
    'resources.importCommit':async args=>{return new WorkspacePackages(app.workspace(args.workspaceId),app.resources).commit(args);},
  };
}
