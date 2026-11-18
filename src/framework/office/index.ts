import type { Agent, AgentConversation, AgentStep, AgentTaskDispatcher } from '../cability/agent';

type ForwardStep = Extract<AgentStep, { kind: 'forward' }>;

export interface OfficeReceipt<Value>
{
  completed: boolean;
  summary: string;
  value: Value;
}

export interface OfficeRun<Result, Value>
{
  Start(): Promise<{ done: Promise<Result> }>;
  Settle(result: Result): Promise<OfficeReceipt<Value>>;
  Close(): Promise<void>;
  Release(): Promise<void> | void;
}

/** 绑定到一次调用者身份。宿主负责准入、实际运行与业务验收，办公室拥有子运行的生命周期。 */
export class OfficeDispatcher<Result, Value> implements AgentTaskDispatcher
{
  constructor(
    private readonly caller: AgentConversation,
    private readonly prepare: (step: ForwardStep) => Promise<OfficeRun<Result, Value>>,
    private readonly retainCleanup: (retry: () => Promise<void>) => void,
    private readonly signal: AbortSignal
  )
  {
  }

  async Dispatch(caller: AgentConversation, step: ForwardStep): Promise<OfficeReceipt<Value>>
  {
    if (caller.workspaceId !== this.caller.workspaceId || caller.taskId !== this.caller.taskId)
      throw new Error('办公室派发与调用方会话不匹配');

    this.signal.throwIfAborted();
    const run = await this.prepare(step);
    let closed = false;
    const cleanup = async () =>
    {
      if (!closed)
      {
        await run.Close();
        closed = true;
      }
      await run.Release();
    };

    try
    {
      this.signal.throwIfAborted();
      const started = await run.Start();
      return await run.Settle(await started.done);
    }
    finally
    {
      try { await cleanup() }
      catch (error) { this.retainCleanup(cleanup); throw error }
    }
  }

  async Forward(caller: Agent, step: ForwardStep): Promise<string>
  {
    const receipt = await this.Dispatch(caller.conversation, step);
    if (!receipt.completed) throw new Error(receipt.summary);
    return receipt.summary;
  }
}
