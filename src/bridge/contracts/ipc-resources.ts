/**
 * 作用定位：资源仓库、共享连接与架构包的公开 IPC 请求与响应。
 * 设计原因：连接登记、共享授权与包事务保持独立，原回执查询不隐式重做提交。类型不替代身份和权限校验。
 */
import {z} from 'zod';
import {ipcId,noIpcArgs} from './ipc-shapes';
import {type RepositoryConnectionCheck,type RepositoryConnectionCommit,type RepositoryConnectionList,type RepositoryConnectionPreview,type RepositoryConnectionReceipt,type RepositoryConnectionUnaccepted,repositoryConnectionCheckInputSchema,repositoryConnectionCommitInputSchema,repositoryConnectionCommitLookupSchema,repositoryConnectionGrantInputSchema,repositoryConnectionListInputSchema,repositoryConnectionLookupSchema,repositoryConnectionPreviewInputSchema,repositoryConnectionRevokeInputSchema,repositoryConnectionUnacceptedInputSchema} from '../../backend/core/connectors/repository-connection';
import {type KnowledgeCommit} from '../../backend/core/knowledge/types';
import {type ImportWorkspacePreview,type PublishWorkspaceResult,type RepositoryStatus,type ResourceLibrarySnapshot} from './resources';

export const resourcesIpcRequests={
  'resources.status':noIpcArgs,
  'resources.list':noIpcArgs,
  'resources.configure':z.discriminatedUnion('mode',[z.object({mode:z.literal('local'),location:z.string()}).strict(),z.object({mode:z.literal('remote'),location:z.string(),token:z.string()}).strict()]),
  'resources.save':z.object({repositoryId:z.string().uuid(),revision:z.string(),id:z.string().uuid().optional(),item:z.object({kind:z.enum(['connector','team','agent','skill','architecture','module','workflow']),name:z.string(),summary:z.string(),content:z.string()}).strict()}).strict(),
  'resources.remove':z.object({repositoryId:z.string().uuid(),revision:z.string(),id:z.string().uuid()}).strict(),
  'resources.share':z.object({lan:z.boolean().optional(),port:z.number().int().optional()}).strict().optional(),
  'resources.stopSharing':noIpcArgs,
  'resources.connection':noIpcArgs,
  'resources.connection.list':repositoryConnectionListInputSchema,
  'resources.connection.preview':repositoryConnectionPreviewInputSchema,
  'resources.connection.commit':repositoryConnectionCommitInputSchema,
  'resources.connection.commitReceipt':repositoryConnectionCommitLookupSchema,
  'resources.connection.unaccepted':repositoryConnectionUnacceptedInputSchema,
  'resources.connection.grant':repositoryConnectionGrantInputSchema,
  'resources.connection.revoke':repositoryConnectionRevokeInputSchema,
  'resources.connection.check':repositoryConnectionCheckInputSchema,
  'resources.connection.receipt':repositoryConnectionLookupSchema,
  'resources.publishWorkspace':z.object({workspaceId:ipcId,instanceId:ipcId,revision:z.string(),repositoryId:z.string().uuid(),repositoryRevision:z.string(),kind:z.enum(['team','agent','skill','architecture']),objectId:z.string().optional(),name:z.string(),summary:z.string()}).strict(),
  'resources.importPreview':z.object({workspaceId:ipcId,instanceId:ipcId,revision:z.string(),repositoryId:z.string().uuid(),repositoryRevision:z.string(),resourceId:z.string().uuid(),mode:z.enum(['add','replace']).optional(),targetParentId:z.string().optional(),slug:z.string().optional()}).strict(),
  'resources.importCommit':z.object({workspaceId:ipcId,instanceId:ipcId,planId:z.string().uuid()}).strict(),
};
export interface ResourcesIpcResponses {
  'resources.status':RepositoryStatus;
  'resources.list':ResourceLibrarySnapshot;
  'resources.configure':RepositoryStatus;
  'resources.save':ResourceLibrarySnapshot;
  'resources.remove':ResourceLibrarySnapshot;
  'resources.share':RepositoryStatus;
  'resources.stopSharing':RepositoryStatus;
  'resources.connection':{url:string;host:'127.0.0.1'|'0.0.0.0';port:number;token:string};
  'resources.connection.list':RepositoryConnectionList;
  'resources.connection.preview':RepositoryConnectionPreview;
  'resources.connection.commit':RepositoryConnectionCommit;
  'resources.connection.commitReceipt':RepositoryConnectionCommit|undefined;
  'resources.connection.unaccepted':RepositoryConnectionUnaccepted;
  'resources.connection.grant':RepositoryConnectionReceipt;
  'resources.connection.revoke':RepositoryConnectionReceipt;
  'resources.connection.check':RepositoryConnectionCheck;
  'resources.connection.receipt':RepositoryConnectionReceipt|undefined;
  'resources.publishWorkspace':PublishWorkspaceResult;
  'resources.importPreview':ImportWorkspacePreview;
  'resources.importCommit':KnowledgeCommit;
}
