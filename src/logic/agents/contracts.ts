/**
 * 作用定位：Agent 调用的便携身份、工具绑定和生命周期契约，供 Runtime 与 Bridge 使用。
 * 设计原因：记录读取及运行门禁不加载调度器实现，不通过聚合出口隐藏反向类型依赖。
 */
export * from '../../framework/cability/agent/call';

import type { ScopeActiveInputPayload, ScopeActiveInputToken, ScopeActiveInputSendReceipt } from '../tasks/rules/scope-active-input';

import type { EngineEvent, RunSummary, TaskSpec } from '../execution/rules/types';

import type { EngineCapability } from '../execution/rules/engine-tools';

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

/** 可信准入失败的数值快照；只携带约束，不携带模型正文或凭据。 */
