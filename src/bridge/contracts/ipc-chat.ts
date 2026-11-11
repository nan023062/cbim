/**
 * 粘贴入口严格限定图片类型/大小与绝对路径列表，预览可返回受管图片字节。
 * 作用定位：显式附件导入与快照预览的公开 IPC 请求与响应。
 * 设计原因：资料读取留在主进程，取消和来源核验交给唯一导入服务，页面不能指定可信 proof。类型不替代身份和权限校验。
 */
import {z} from 'zod';
import {ipcId,workspaceIdArgs} from './ipc-shapes';
import {type RepositoryListOutput,type RepositoryToolTarget} from '../../backend/core/connectors/repository-tools';
import {type ChatAttachment,type ChatAttachmentPreview} from './chat';

export const chatIpcRequests={
  'chat.paths':workspaceIdArgs.extend({paths:z.array(z.string().min(1).max(32768)).min(1).max(12)}).strict(),
  'chat.image':workspaceIdArgs.extend({name:z.string().min(1).max(255),mimeType:z.enum(['image/png','image/jpeg','image/gif','image/webp']),data:z.string().min(1).max(7*1024*1024)}).strict(),
  'chat.attach':workspaceIdArgs.extend({attachment:z.object({kind:z.enum(['link','web','connector']),value:z.string()}).strict()}).strict(),
  'chat.materialTargets':workspaceIdArgs,
  'chat.materialList':workspaceIdArgs.extend({importId:z.string().uuid(),connectorId:ipcId,connectionId:z.string().uuid(),expectedRevision:z.string().optional(),offset:z.number().int().nonnegative().optional(),limit:z.number().int().positive().optional()}).strict(),
  'chat.import':workspaceIdArgs.extend({importId:z.string().uuid(),attachment:z.union([z.object({kind:z.enum(['link','web']),value:z.string()}).strict(),z.object({kind:z.literal('repository_resource'),connectorId:ipcId,connectionId:z.string().uuid(),expectedRevision:z.string(),resourceId:z.string().uuid()}).strict()])}).strict(),
  'chat.importCancel':workspaceIdArgs.extend({importId:z.string().uuid()}).strict(),
  'chat.connectors':workspaceIdArgs,
  'chat.preview':workspaceIdArgs.extend({attachmentId:z.string().uuid()}).strict(),
};
export interface ChatIpcResponses {
  'chat.paths':ChatAttachment[];
  'chat.image':ChatAttachment;
  'chat.attach':ChatAttachment;
  'chat.materialTargets':{workspaceId:string;instanceId:string;targets:RepositoryToolTarget[]};
  'chat.materialList':RepositoryListOutput;
  'chat.import':ChatAttachment;
  'chat.importCancel':{cancelled:boolean};
  'chat.connectors':{id:string;name:string;summary:string}[];
  'chat.preview':ChatAttachmentPreview;
}
