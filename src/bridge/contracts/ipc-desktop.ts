/**
 * 作用定位：桌面更新、终端、选择器与链接打开的公开 IPC 请求与响应。
 * 设计原因：固定操作只声明公开数据；Electron 主 Frame、系统副作用和安装门禁由桌面入口负责。类型不替代身份和权限校验。
 */
import {z} from 'zod';
import {noIpcArgs,workspaceIdArgs} from './ipc-shapes';
import {type ChatAttachment} from './chat';
import {type DesktopUpdateStatus} from './desktop-updates';

export const desktopIpcRequests={
  'desktop.updates.status':noIpcArgs,
  'desktop.updates.check':noIpcArgs,
  'desktop.updates.download':noIpcArgs,
  'desktop.updates.install':noIpcArgs,
  'terminal.start':workspaceIdArgs.extend({tabId:z.string().regex(/^[a-zA-Z0-9-]{1,100}$/),command:z.string().min(1).max(16000)}).strict(),
  'terminal.read':workspaceIdArgs.extend({tabId:z.string().regex(/^[a-zA-Z0-9-]{1,100}$/)}).strict(),
  'terminal.close':workspaceIdArgs.extend({tabId:z.string().regex(/^[a-zA-Z0-9-]{1,100}$/)}).strict(),
  'github.feedback.openLogin':noIpcArgs,
  'chat.openLink':workspaceIdArgs.extend({target:z.string()}).strict(),
  'chat.pick':workspaceIdArgs.extend({kind:z.enum(['file','folder']),importId:z.string().uuid().optional()}).strict(),
  'chooseFolder':noIpcArgs,
};
export interface DesktopIpcResponses {
  'desktop.updates.status':DesktopUpdateStatus;
  'desktop.updates.check':DesktopUpdateStatus;
  'desktop.updates.download':DesktopUpdateStatus;
  'desktop.updates.install':DesktopUpdateStatus;
  'terminal.start':{output:string;running:boolean;exitCode:number|null};
  'terminal.read':{output:string;running:boolean;exitCode:number|null};
  'terminal.close':void;
  'github.feedback.openLogin':boolean;
  'chat.openLink':boolean;
  'chat.pick':ChatAttachment[];
  'chooseFolder':string|null;
}
