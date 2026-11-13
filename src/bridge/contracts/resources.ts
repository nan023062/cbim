/**
 * 作用定位：资源界面的通信类型及静态资源包操作协议。
 * 设计原因：仓库定义由 Logic 持有；迁移期仅转接具名纯契约，不向界面加载仓库服务。
 */
import type {ResourceLibrarySnapshot} from '../../logic/resources';
export {resourceKinds,resourceCategories} from '../../logic/resources';
export type {ResourceKind,ResourceCategory,ResourceDefinition,ResourceLibrarySnapshot,RepositoryConfig,RepositorySession,RepositoryStatus} from '../../logic/resources';
/** 资源包只运输静态知识；不包含目标工程人员、授权、成员实例、任务或会话。 */
export type {WorkspacePackage,WorkspacePackageKind,WorkspacePackageMode} from '../../backend/core/knowledge/portable-package';
export interface PublishWorkspaceInput {workspaceId:string;instanceId:string;revision:string;repositoryId:string;repositoryRevision:string;kind:'team'|'agent'|'skill'|'architecture';objectId?:string;name:string;summary:string}
export interface ImportWorkspacePreviewInput {workspaceId:string;instanceId:string;revision:string;repositoryId:string;repositoryRevision:string;resourceId:string;mode?:'add'|'replace';targetParentId?:string;slug?:string}
export interface ImportWorkspaceCommitInput {workspaceId:string;instanceId:string;planId:string}
export interface PublishWorkspaceResult {repository:ResourceLibrarySnapshot;resourceId:string;warnings:string[];removedBindings:string[]}
export type ImportWorkspacePreview=import('../../backend/core/knowledge/types').Preview&{planId:string;kind:'team'|'agent'|'skill'|'architecture';mode:'add'|'replace';targetRoot:string;files:Array<{path:string;action:'create'|'update'|'delete'}>;warnings:string[];removedBindings:string[]};
