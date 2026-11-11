/**
 * 作用定位：显式附件导入与快照预览的主进程处理器。
 * 设计原因：资料读取留在主进程，取消和来源核验交给唯一导入服务，页面不能指定可信 proof。请求已在总分派中解析。
 */
import type {ApplicationServices} from './services';
import type {IpcHandlers} from '../../../bridge/contracts/ipc-call';
import type {ChatIpcResponses} from '../../../bridge/contracts/ipc-chat';
import {ChatInputs} from '../persistence/tasks/chat-inputs';

/** 仅装配本业务组；每项实际实现都受对应请求／响应约束。 */
export function chatIpcHandlers(app:ApplicationServices):IpcHandlers<keyof ChatIpcResponses>{
  return {
    'chat.attach':async args=>{return new ChatInputs(app.workspace(args.id)).add(args.attachment);},
    'chat.materialTargets':async args=>{return app.chatMaterials.targets(args);},
    'chat.materialList':async args=>{return app.chatMaterials.list(args);},
    'chat.import':async args=>{return app.chatMaterials.import(args);},
    'chat.importCancel':async args=>{return app.chatMaterials.cancel(args);},
    'chat.connectors':async args=>{return new ChatInputs(app.workspace(args.id)).connectors();},
    'chat.preview':async args=>{return new ChatInputs(app.workspace(args.id)).preview(args.attachmentId);},
  };
}
