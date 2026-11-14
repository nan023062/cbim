/**
 * 作用定位：资源定义、仓库快照和公开状态的纯业务入口。
 * 设计原因：静态定义与仓库服务独立，界面契约不加载文件、网络或共享凭据。
 */
export {resourceKinds,resourceCategories} from './contracts';
export type {ResourceKind,ResourceCategory,ResourceDefinition,ResourceLibrarySnapshot,RepositoryConfig,RepositorySession,RepositoryStatus} from './contracts';
