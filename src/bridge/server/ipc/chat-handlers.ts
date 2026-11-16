/**
 * 图片/路径粘贴只保存当前工作区快照，预览不按客户端路径重新读取磁盘。
 * 作用定位：显式附件导入与快照预览的主进程处理器。
 * 设计原因：资料读取留在主进程，取消和来源核验交给唯一导入服务，页面不能指定可信 proof。请求已在总分派中解析。
 */
import type { ApplicationServices } from './services';

import type { IpcHandlers } from '../../contracts/ipc-call';

import type { ChatIpcResponses } from '../../contracts/ipc-chat';

import { ChatInputs } from '../../../logic/materials/service/chat-inputs';

/** 仅装配本业务组；每项实际实现都受对应请求／响应约束。 */
export function chatIpcHandlers(app: ApplicationServices): IpcHandlers<keyof ChatIpcResponses>
{
  return {
    'chat.paths': args => new ChatInputs(app.Workspace(args.id)).PastedPaths(args.paths),
    'chat.image': args => new ChatInputs(app.Workspace(args.id)).ClipboardImage(args),
    'chat.attach': async args => { return new ChatInputs(app.Workspace(args.id)).Add(args.attachment); },
    'chat.materialTargets': async args => { return app.chatMaterials.Targets(args); },
    'chat.materialList': async args => { return app.chatMaterials.List(args); },
    'chat.import': async args => { return app.chatMaterials.Import(args); },
    'chat.importCancel': async args => { return app.chatMaterials.Cancel(args); },
    'chat.connectors': async args => { return new ChatInputs(app.Workspace(args.id)).Connectors(); },
    'chat.preview': async args => { return new ChatInputs(app.Workspace(args.id)).Preview(args.attachmentId); },
  };
}
