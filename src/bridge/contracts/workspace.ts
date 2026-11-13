/**
 * 作用定位：跨进程工作区、知识事务与 IPC 数据契约。
 * 设计原因：集中定义可序列化视图数据及只读项目根身份，避免界面引用具有文件访问能力的服务实现。
 */
import type {IpcCaller} from './ipc-call';
export type {TaskView,KnowledgeFile,Change,ChangeRequest,Issue,Validation,ModuleNode,Snapshot,Preview} from '../../logic/knowledge/rules/types';
export {projectRootModuleId,projectRootModule} from '../../logic/workspace/rules/project-root';
export type {WorkspaceEntry,Catalog,WorkspaceView} from './workspace-view';
/** 渲染进程唯一服务调用边界；操作契约限制调用类型，主进程另核身份、输入及实际允许的路由。 */
export interface Bridge {call:IpcCaller;/** 原生拖入或粘贴的 File 经 preload 解析路径；不接受字符串路径。 */importFiles(id:string,files:File[]):Promise<import('./chat').ChatAttachment[]>}
declare global {interface Window {cbim:Bridge}}
