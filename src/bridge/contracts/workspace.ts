/**
 * 作用定位：跨进程工作区、知识事务与 IPC 数据契约。
 * 设计原因：集中定义可序列化视图数据及只读项目根身份，避免界面引用具有文件访问能力的服务实现。
 */
import type {TaskView} from '../../backend/core/knowledge/types';
export type {TaskView,KnowledgeFile,Change,ChangeRequest,Issue,Validation,ModuleNode,Snapshot,Preview} from '../../backend/core/knowledge/types';
export {projectRootModuleId,projectRootModule} from '../../backend/core/workspace/project-root';
/** 工作区登记身份；path 为规范化实际路径，previousIds 仅关联旧身份历史，不合并数据。 */
export interface WorkspaceEntry { id:string; path:string; name:string; lastOpened?:string; previousIds?:string[] }
/** 本机登记清单；内部工作区运行时的启动集合直接取 entries。 */
export interface Catalog {version:1; entries:WorkspaceEntry[]; recent:string[];}
/** 提供界面的内部工作区运行快照；knowledgeErrors 是知识规则检查结果，与运行状态独立。 */
export interface WorkspaceView extends WorkspaceEntry {state:string; error?:string; tasks:TaskView[]; revision?:string; changed?:boolean;instanceId?:string;knowledgeErrors?:number}
/** 渲染进程唯一服务调用边界；主进程 dispatch 决定实际允许的 action。 */
export interface Bridge {call(action:string,args?:unknown):Promise<any>;/** 原生拖入或粘贴的 File 经 preload 解析路径；不接受字符串路径。 */importFiles(id:string,files:File[]):Promise<import('./chat').ChatAttachment[]>}
declare global {interface Window {cbim:Bridge}}
