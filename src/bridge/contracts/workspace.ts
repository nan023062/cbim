/**
 * 作用定位：跨进程工作区、知识事务、MCP 与 IPC 数据契约。
 * 设计原因：集中定义可序列化视图数据，避免界面引用具有文件访问能力的服务实现。
 */
/** 工作区登记身份；path 为规范化实际路径，previousIds 仅关联旧身份历史，不合并数据。 */
import type {TaskView} from '../../backend/core/knowledge/types';
export type {TaskView,KnowledgeFile,Change,ChangeRequest,Issue,Validation,ModuleNode,Snapshot,Preview} from '../../backend/core/knowledge/types';
export interface WorkspaceEntry { id:string; path:string; name:string; lastOpened?:string; previousIds?:string[] }
/** 单次请求元数据；time 为 ISO 时间，durationMs 为毫秒，流量字段为 HTTP 正文字节，不包含凭据与正文。 */
export interface McpCallLog {id:string;time:string;workspaceId:string;instanceId:string;httpMethod:string;method?:string;tool?:string;status:number;result:'ok'|'error';code?:string;message?:string;durationMs:number;receivedBytes:number;sentBytes:number}
/** 本机登记清单；服务启动集合直接取 entries，旧恢复策略字段不进入当前契约。 */
export interface Catalog {version:1; entries:WorkspaceEntry[]; recent:string[];}
/** 当前实例健康与流量；速率单位为字节/秒、最近 5 秒平均，健康探测不计入请求流量。 */
export interface McpStatus {health:'starting'|'online'|'degraded'|'stopped';instanceId:string;startedAt:string;checkedAt?:string;latencyMs?:number;error?:string;requests:number;errors:number;inFlight:number;receivedBytes:number;sentBytes:number;receiveRate:number;sendRate:number;lastActivityAt?:string}
/** 提供界面的工作区快照；writable 只在当前运行有效，knowledgeErrors 与服务健康独立。 */
export interface WorkspaceView extends WorkspaceEntry {state:string; error?:string; hostConfigWarnings?:string[]; writable:boolean; tasks:TaskView[]; revision?:string; changed?:boolean;instanceId?:string;mcp?:McpStatus;knowledgeErrors?:number}
/** 渲染进程唯一服务调用边界；主进程 dispatch 决定实际允许的 action。 */
export interface Bridge {call(action:string,args?:unknown):Promise<any>;/** 原生拖入或粘贴的 File 经 preload 解析路径；不接受字符串路径。 */importFiles(id:string,files:File[]):Promise<import('./chat').ChatAttachment[]>}
declare global {interface Window {cbim:Bridge}}
