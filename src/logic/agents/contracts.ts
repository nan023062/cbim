/**
 * 作用定位：Agent 调用的便携身份、工具绑定和生命周期契约，供 Runtime 与 Bridge 使用。
 * 设计原因：记录读取及运行门禁不加载调度器实现，不通过聚合出口隐藏反向类型依赖。
 */
import {z} from 'zod';
import type {ScopeActiveInputPayload,ScopeActiveInputToken,ScopeActiveInputSendReceipt} from '../tasks/rules/scope-active-input';
import type {EngineEvent,RunSummary,TaskSpec} from '../execution/rules/types';
import type {EngineCapability} from '../execution/rules/engine-tools';
export const agentCallToolName='cbim_agent_call';
export const agentListToolName='cbim_agent_list';
export const agentReplyToolName='cbim_agent_reply';
export interface AgentCallReference {version:1;workspaceId:string;callerTaskId:string;callerRunId:string;toolCallId:string;taskId:string;runId:string}
/** 父子日志共用严格引用格式；不接受任意路径、额外身份或自己调用自己的引用。 */
export const agentCallReferenceSchema=z.object({version:z.literal(1),workspaceId:z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/),callerTaskId:z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/),callerRunId:z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/),toolCallId:z.string().min(1).max(512),taskId:z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/),runId:z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/)}).strict();
/** 仅核验引用本身与当前子运行身份；父日志授权和周期归属仍由读取者校验。 */
export function checkedAgentCallReference(value:unknown,task:{workspaceId:string;taskId:string},runId:string):AgentCallReference{
  const ref=agentCallReferenceSchema.parse(value);
  if(ref.workspaceId!==task.workspaceId||ref.taskId!==task.taskId||ref.runId!==runId||ref.callerTaskId===ref.taskId||ref.callerRunId===ref.runId)throw Error('Agent 调用引用与子运行身份不一致');
  return ref;
}
export interface AgentCallContext {task:TaskSpec;runId:string;depth:number}
/** 调用协议只限定深度；真实并发和预算由 execution 准入与根账本持有。 */
export interface AgentCallLimits {maxDepth:number}
export interface AgentToolContext {task:TaskSpec;runId:string;assertExclusive(id:string):void;assertQuestionWait?():void;emit(event:EngineEvent):Promise<void>}
export interface AgentToolsBinding {
  /** 由当前调用的人工决定收紧工具副作用；返回拒绝理由，不授予任何新权限。 */
  guardEffects?(effects:readonly string[]|undefined):string|undefined;
  capability:EngineCapability;active():boolean;allowsWhileWaiting?(name:string):boolean;stop():Promise<void>}
/** 根运行的输入和收尾边界；回执仍由既有目标服务持久化，不复制队列状态。 */
export interface AgentLifecycle {
  /** 使用原运行的持久插入事务；失败回执不能自动重发。 */
  insertInput?(runId:string,queueId:string,input:ScopeActiveInputPayload,signal:AbortSignal,send:(token?:ScopeActiveInputToken)=>Promise<ScopeActiveInputSendReceipt|undefined>):Promise<void>;
  /** input 是本轮真实正文；排队启动时 scopeId/followupOf 保留原队列身份及关联。 */
  beforeRun(runId:string,input?:{message:string;attachmentIds?:string[];scopeId?:string;followupOf?:string}):Promise<void>;
  settled(summary?:RunSummary):Promise<void>;
  failed(error:unknown):Promise<void>;
}
/** 可信准入失败的数值快照；只携带约束，不携带模型正文或凭据。 */
export class AgentConstraintError extends Error {
  constructor(readonly code:string,message:string,readonly constraint:{current:number;requested:number;limit:number;unit:string}){super(message)}
}
