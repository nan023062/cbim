/**
 * 作用定位：岗位登记与模块责任的主进程处理器。
 * 设计原因：只注入本机提交来源；岗位配置和模块绑定由各自服务维护，不借登记启动模型。请求已在总分派中解析。
 */
import type {ApplicationServices} from './services';
import type {IpcHandlers} from '../../../bridge/contracts/ipc-call';
import type {PeopleIpcResponses} from '../../../bridge/contracts/ipc-people';

/** 仅装配本业务组；每项实际实现都受对应请求／响应约束。 */
export function peopleIpcHandlers(app:ApplicationServices):IpcHandlers<keyof PeopleIpcResponses>{
  return {
    'workspace.members.list':async args=>{return app.workspaceMembers(args.workspaceId).list(args);},
    'workspace.members.get':async args=>{return app.workspaceMembers(args.workspaceId).get(args);},
    'workspace.members.preview':async args=>{return app.workspaceMembers(args.workspaceId).preview(args);},
    'workspace.members.receipt':async args=>{return app.workspaceMembers(args.workspaceId).receipt(args);},
    'workspace.members.commit':async args=>{return app.workspaceMembers(args.workspaceId).commit(args,{kind:'local_desktop',interaction:'explicit_submit'});},
    'workspace.ownerships.list':async args=>{return app.workspaceOwnerships(args.workspaceId).list(args);},
    'workspace.ownerships.get':async args=>{return app.workspaceOwnerships(args.workspaceId).get(args);},
    'workspace.ownerships.byMember':async args=>{return app.workspaceOwnerships(args.workspaceId).byMember(args);},
    'workspace.ownerships.preview':async args=>{return app.workspaceOwnerships(args.workspaceId).preview(args);},
    'workspace.ownerships.receipt':async args=>{return app.workspaceOwnerships(args.workspaceId).receipt(args);},
    'workspace.ownerships.commit':async args=>{return app.workspaceOwnerships(args.workspaceId).commit(args,{kind:'local_desktop',interaction:'explicit_submit'});},
  };
}
