/** Execution contracts for agent calls, tool bindings and run lifecycle callbacks. */
import type { ScopeActiveInputPayload, ScopeActiveInputToken, ScopeActiveInputSendReceipt } from '../../tasks/rules/scope-active-input';

import type { EngineEvent, RunSummary, TaskSpec } from './types';

import type { EngineCapability } from './engine-tools';

export interface AgentCallContext
{
  task: TaskSpec;

  runId: string;

  depth: number
}

/** 调用协议只限定深度；真实并发和预算由 execution 准入与根账本持有。 */
export interface AgentCallLimits
{
  maxDepth: number
}

export interface AgentToolContext
{
  task: TaskSpec;

  runId: string;

  AssertExclusive(id: string): void;

  AssertQuestionWait?(): void;

  Emit(event: EngineEvent): Promise<void>
}

export interface AgentToolsBinding
{
  /** 由当前调用的人工决定收紧工具副作用；返回拒绝理由，不授予任何新权限。 */
  GuardEffects?(effects: readonly string[] | undefined): string | undefined;

  capability: EngineCapability;

  Active(): boolean;

  AllowsWhileWaiting?(name: string): boolean;

  Stop(): Promise<void>
}

/** 根运行的输入和收尾边界；回执仍由既有目标服务持久化，不复制队列状态。 */
export interface AgentLifecycle
{
  /** 使用原运行的持久插入事务；失败回执不能自动重发。 */
  InsertInput?(runId: string, queueId: string, input: ScopeActiveInputPayload, signal: AbortSignal, send: (token?: ScopeActiveInputToken) => Promise<ScopeActiveInputSendReceipt | undefined>): Promise<void>;

  /** input 是本轮真实正文；排队启动时 scopeId/followupOf 保留原队列身份及关联。 */
  BeforeRun(runId: string, input?: { message: string; attachmentIds?: string[]; scopeId?: string; followupOf?: string }): Promise<void>;

  Settled(summary?: RunSummary): Promise<void>;

  Failed(error: unknown): Promise<void>;
}
