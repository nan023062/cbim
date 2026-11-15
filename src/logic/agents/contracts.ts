/**
 * 作用定位：Agent 调用的便携身份、工具绑定和生命周期契约，供 Runtime 与 Bridge 使用。
 * 设计原因：记录读取及运行门禁不加载调度器实现，不通过聚合出口隐藏反向类型依赖。
 */
import type {EngineEvent,RunSummary,TaskSpec} from '../execution/rules/types';
import type {EngineCapability} from '../execution/rules/engine-tools';
export const agentCallToolName='cbim_agent_call';
export const agentListToolName='cbim_agent_list';
export const agentReplyToolName='cbim_agent_reply';
export interface AgentCallReference {version:1;workspaceId:string;callerTaskId:string;callerRunId:string;toolCallId:string;taskId:string;runId:string}
export interface AgentCallContext {task:TaskSpec;runId:string;depth:number}
/** 调用协议只限定深度；真实并发和预算由 execution 准入与根账本持有。 */
export interface AgentCallLimits {maxDepth:number}
export interface AgentToolContext {task:TaskSpec;runId:string;assertExclusive(id:string):void;assertQuestionWait?():void;emit(event:EngineEvent):Promise<void>}
export interface AgentToolsBinding {capability:EngineCapability;active():boolean;allowsWhileWaiting?(name:string):boolean;stop():Promise<void>}
export interface AgentLifecycle {beforeRun(runId:string):Promise<void>;settled(summary?:RunSummary):Promise<void>;failed(error:unknown):Promise<void>}
/** 可信准入失败的数值快照；只携带约束，不携带模型正文或凭据。 */
export class AgentConstraintError extends Error {
  constructor(readonly code:string,message:string,readonly constraint:{current:number;requested:number;limit:number;unit:string}){super(message)}
}
