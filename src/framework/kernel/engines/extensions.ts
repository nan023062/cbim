/** 可信宿主按派发顺序注册。工具决策只允许否决，最终授权归运行时。 */
export interface EngineExtension<Tool, Event>
{
  readonly id: string;

  readonly tools?: readonly Tool[];

  BeforeTurn?(turn: { runId: string; turnId: string; input: string; context?: string }, signal: AbortSignal): Promise<void | { context: string } | { block: string }>;

  BeforeToolCall?(call: { runId: string; turnId?: string; id: string; name: string; input: Record<string, unknown> }, signal: AbortSignal): Promise<void | { block: string }>;

  OnEvent?(event: Event): void | Promise<void>;
}
