/**
 * 作用定位：关联全部桌面 IPC 操作名、请求与响应，并为主进程提供结构解析入口。
 * 设计原因：联合元组保留每一对调用，没有任意字符串或 any 响应兜底；业务协议按组维护，不从服务实现反向推导。
 * 职责边界：结构解析不授予权限；发送者、实例、事务、版本与原回执仍由主进程和所属服务核实。
 */
import {z} from 'zod';
import {agentHistoryRequests,type AgentHistoryResponses} from './agent-history-ipc';
import {peopleIpcRequests,type PeopleIpcResponses} from './ipc-people';
import {governanceIpcRequests,type GovernanceIpcResponses} from './ipc-governance';
import {dispatchIpcRequests,type DispatchIpcResponses} from './ipc-dispatch';
import {settingsIpcRequests,type SettingsIpcResponses} from './ipc-settings';
import {loopIpcRequests,type LoopIpcResponses} from './ipc-loop';
import {chatIpcRequests,type ChatIpcResponses} from './ipc-chat';
import {resourcesIpcRequests,type ResourcesIpcResponses} from './ipc-resources';
import {workspaceIpcRequests,type WorkspaceIpcResponses} from './ipc-workspace';
import {desktopIpcRequests,type DesktopIpcResponses} from './ipc-desktop';

export const ipcRequests={...agentHistoryRequests,...peopleIpcRequests,...governanceIpcRequests,...dispatchIpcRequests,...settingsIpcRequests,...loopIpcRequests,...chatIpcRequests,...resourcesIpcRequests,...workspaceIpcRequests,...desktopIpcRequests};
export interface IpcResponses extends AgentHistoryResponses,PeopleIpcResponses,GovernanceIpcResponses,DispatchIpcResponses,SettingsIpcResponses,LoopIpcResponses,ChatIpcResponses,ResourcesIpcResponses,WorkspaceIpcResponses,DesktopIpcResponses {}
export type IpcAction=keyof IpcResponses;
export type IpcRequest<A extends IpcAction>=z.input<(typeof ipcRequests)[A]>;
export type IpcResponse<A extends IpcAction>=IpcResponses[A];
export type IpcCall<A extends IpcAction=IpcAction>={[K in A]:undefined extends IpcRequest<K>?[action:K,args?:IpcRequest<K>]:[action:K,args:IpcRequest<K>]}[A];
export interface IpcCaller {<C extends IpcCall>(...request:C):Promise<IpcResponse<C[0]>>}
export type IpcHandlers<A extends IpcAction=IpcAction>={[K in A]:(input:IpcRequest<K>)=>IpcResponse<K>|Promise<IpcResponse<K>>};
export type DesktopIpcAction=keyof DesktopIpcResponses;
export type ApplicationIpcAction=Exclude<IpcAction,DesktopIpcAction>;
/** 不读取原型属性；未知操作不进入任何服务。 */
export function isIpcAction(action:string):action is IpcAction{return Object.hasOwn(ipcRequests,action)}
/** 映射类型让解析、处理和返回始终使用同一操作键，运行时输入在此之前保持 unknown。 */
const requestParsers:{[K in IpcAction]:z.ZodType<IpcRequest<K>,z.ZodTypeDef,unknown>}=ipcRequests;
export function parseIpcRequest<A extends IpcAction>(action:A,input:unknown):IpcRequest<A>{return requestParsers[action].parse(input)}

/** 保留既有错误信封；失败不等于未执行，不由桥自动重试。 */
export type IpcResult<A extends IpcAction>={ok:true;value:IpcResponse<A>}|{ok:false;error:{code?:string;message:string}};
/** 原生桌面成功值同样按操作核对，不能由调用方任意指定响应。 */
export function ipcSuccess<A extends IpcAction>(_action:A,value:NoInfer<IpcResponse<A>>):{ok:true;value:IpcResponse<A>}{return {ok:true,value}}

/** 动态表单先按已知操作解析，再形成相关元组；仅在这个已验证的配对处恢复 TS 无法表达的相关性。 */
export function checkedIpcCall<A extends IpcAction>(action:A,input:unknown):IpcCall<A>{return [action,parseIpcRequest(action,input)] as IpcCall<A>}
export type IpcCallerFor<A extends IpcAction>=<C extends IpcCall<A>>(...request:C)=>Promise<IpcResponse<C[0]>>;
