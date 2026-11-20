import type { OfficeMembers } from './members';

import type { AgentRole, AgentConversation, AgentStep, AgentTaskDispatcher } from '../cability/agent';

export interface OfficeChildTask extends AgentConversation
{
  readonly parentTaskId: string;

  readonly memberId: string;

  readonly goal: string;
}

export function composeTaskTools<T extends { id: string }>(agent: readonly T[], workspace: readonly T[]): T[]
{
  const tools = new Map<string, T>();

  for (const tool of [...agent, ...workspace])
  {
    const previous = tools.get(tool.id);

    if (previous && previous !== tool)
      throw new Error('任务工具绑定冲突：' + tool.id);

    tools.set(tool.id, tool);
  }

  return [...tools.values()];
}

export interface OfficeWorkflow
{
  ownerId?: string;

  workspaceId: string;

  skillId: string;

  content: string;
}

/** 任务专用技能快照。跨工作区重复继承同一 Workflow 时只追加一次。 */
export function composeTaskSkills(role: Pick<AgentRole['definition'], 'effectiveSkills'>, workflows: readonly OfficeWorkflow[])
{
  const skills = [...(role.effectiveSkills ?? [])];

  const seen = new Set(skills.map(skill => skill.skillId));

  for (const workflow of workflows)
  {
    if (seen.has(workflow.skillId))
      continue;

    seen.add(workflow.skillId);

    const ownerId = workflow.ownerId ?? workflow.workspaceId;

    skills.push({ skillId: workflow.skillId, ownerId, inherited: ownerId !== workflow.workspaceId, content: workflow.content });
  }

  return skills;
}

export function composeTaskInstructions(role: string, workflow?: string): string
{
  return [role, workflow].filter(Boolean).join('\n');
}

type ForwardStep = Extract<AgentStep,
  {
    kind: 'forward'
  }>;

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
  public constructor(private readonly _caller: AgentConversation, private readonly _prepare: (step: ForwardStep, child: OfficeChildTask, agents: ReturnType<OfficeMembers["ForTask"]>) => Promise<OfficeRun<Result, Value>>, private readonly _retainCleanup: (retry: () => Promise<void>) => void, private readonly _signal: AbortSignal, private readonly _agents: OfficeMembers)
  {
  }

  public async Dispatch(caller: AgentConversation, step: ForwardStep): Promise<OfficeReceipt<Value>>
  {
    if (caller.workspaceId !== this._caller.workspaceId || caller.taskId !== this._caller.taskId)
      throw new Error('办公室派发与调用方会话不匹配');

    this._signal.throwIfAborted();

    const child = Object.freeze({ workspaceId: caller.workspaceId, taskId: crypto.randomUUID(), parentTaskId: caller.taskId, memberId: step.memberId, goal: step.task });

    const agents = this._agents.ForTask(child);

    let run: OfficeRun<Result, Value>;

    try
    {
      run = await this._prepare(step, child, agents);
    }
    catch (error)
    {
      try
      {
        await agents.Close();
      }
      catch (cleanupError)
      {
        this._retainCleanup(agents.Close);

        throw cleanupError;
      }

      throw error;
    }

    let closed = false;

    const cleanup = async () => { if (!closed) { await run.Close(); closed = true; } await agents.Close(); await run.Release(); };

    try
    {
      this._signal.throwIfAborted();

      const started = await run.Start();

      return await run.Settle(await started.done);
    }
    finally
    {
      try
      {
        await cleanup()
      }
      catch (error)
      {
        this._retainCleanup(cleanup);

        throw error
      }
    }
  }

  public async Forward(caller: AgentRole, step: ForwardStep): Promise<string>
  {
    const receipt = await this.Dispatch(caller.conversation, step);

    if (!receipt.completed)
      throw new Error(receipt.summary);

    return receipt.summary;
  }
}

export { OfficeSchedule } from './schedule';

export { OfficeMembers } from './members';

export { Office } from './office';

export type { TeamDescription } from '../cability/team';

export * from './session';
