/**
 * 作用定位：工作区生命周期与知识编辑的公开 IPC 请求与响应。
 * 设计原因：目录登记、实例启停与知识事务沿原服务执行；公共协议依赖纯对象契约，不加载事务或 Node.js 实现。类型不替代身份和权限校验。
 */
import {z} from 'zod';
import {ipcId,noIpcArgs,workspaceIdArgs,taskIdArgs} from './ipc-shapes';
import {type ObjectCommit,type ObjectPreview,objectOperation} from '../../backend/core/knowledge/object-contract';
import {type KnowledgeCommit,type Preview,type Snapshot,type TaskView} from '../../backend/core/knowledge/types';
import {type Catalog,type WorkspaceEntry,type WorkspaceView} from './workspace-view';

export const workspaceIpcRequests={
  'list':noIpcArgs,
  'add':z.object({path:z.string()}).strict(),
  'relocate':z.object({path:z.string(),id:ipcId,confirm:z.boolean().optional()}).strict(),
  'open':workspaceIdArgs,
  'remove':workspaceIdArgs,
  'rename':workspaceIdArgs.extend({name:z.string()}).strict(),
  'snapshot':workspaceIdArgs,
  'preview':z.object({workspaceId:ipcId,instanceId:ipcId,requestId:z.string(),revision:z.string(),changes:z.array(z.object({path:z.string(),text:z.string().nullable()}).strict())}).strict(),
  'commit':z.object({workspaceId:ipcId,instanceId:ipcId,requestId:z.string(),revision:z.string(),changes:z.array(z.object({path:z.string(),text:z.string().nullable()}).strict())}).strict(),
  'movePreview':workspaceIdArgs.extend({from:z.string(),to:z.string().nullable()}).strict(),
  'task':workspaceIdArgs.extend({name:z.enum(['validate','reindex'])}).strict(),
  'cancelTask':taskIdArgs,
  'local':workspaceIdArgs.extend({kind:z.enum(['memory','task-records','logs'])}).strict(),
  'architecture.preview':z.object({workspaceId:ipcId,instanceId:ipcId,revision:z.string(),operations:z.array(objectOperation)}).strict(),
  'architecture.commit':z.object({workspaceId:ipcId,instanceId:ipcId,planId:z.string().uuid()}).strict(),
};
export interface WorkspaceIpcResponses {
  'list':Omit<Catalog,'entries'>&{warning:string;entries:WorkspaceView[]};
  'add':WorkspaceEntry;
  'relocate':WorkspaceEntry;
  'open':WorkspaceView;
  'remove':void;
  'rename':WorkspaceEntry;
  'snapshot':Snapshot;
  'preview':Preview;
  'commit':KnowledgeCommit;
  'movePreview':Preview;
  'task':TaskView;
  'cancelTask':TaskView;
  'local':{source:string;nature:'memory'|'task-records'|'logs';workspaceId:string;files:string[]};
  'architecture.preview':ObjectPreview;
  'architecture.commit':ObjectCommit;
}
