/**
 * 作用定位：资源仓库的宿主服务入口，组合本地存储、HTTP 和共享生命周期。
 * 设计原因：只暴露实际消费者所需契约；登录、路径与权限由调用方明确提供。
 */
export {LocalRepository,MAX_BYTES,resourceFields,itemSchema,snapshotSchema,saveSchema,removeSchema} from './resource-store';
export type {RepositoryStore} from './resource-store';
export {RemoteRepository,repositoryUrl,serveRepository} from './resource-http';
export {ResourceRepositories} from './resource-repository';
export type {SharedRepositoryReadConnection,ResourceRepositoryPaths} from './resource-repository';
