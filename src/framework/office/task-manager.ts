/**
 * 作用定位：Office 的任务分配与执行队列。任务记录绑定实际 Agent、工位实例和目标。
 * 设计原因：对实际 Agent 串行分配任务并维护依赖状态，执行终态不自动等同于业务验收。
 */
import { changeEvents } from '../events';

export interface OfficeTask
{
  readonly id: string;

  readonly agentId: string;

  readonly workspaceInstanceId: string;

  readonly goal: string;

  readonly parentTaskId?: string;

  readonly dependsOn: readonly string[];

  readonly state: 'waiting' | 'blocked' | 'queued' | 'running' | 'completed' | 'suspended' | 'cancelled';

  readonly error?: string;

  readonly instruction?: string;

  readonly attempt: number;
}

interface Job
{
  controller?: AbortController;

  Start(task: OfficeTask, signal: AbortSignal): Promise<void>;

  Reject(reason: Error): void;
}

export class OfficeTaskManager
{
  private readonly records = new Map<string, OfficeTask>();

  private readonly jobs = new Map<string, Job>();

  private readonly running = new Map<string, Promise<void>>();

  private readonly changes = changeEvents<OfficeTask>();

  private closed = false;

  public readonly Subscribe = this.changes.Subscribe;

  public List()
  {
    return [...this.records.values()];
  }

  public SubmitGraph<T>(nodes: readonly (Omit<OfficeTask, 'state' | 'error' | 'attempt'> & { Execute(task: OfficeTask, signal: AbortSignal): Promise<T> })[])
  {
    if (this.closed)
      throw Error('Office task queue is closed');

    const ids = new Set(nodes.map(node => node.id));

    if (!nodes.length || ids.size !== nodes.length)
      throw Error('Empty graph or duplicate task ID');

    const successors = new Map<string, string[]>();

    const remaining = new Map<string, number>();

    const ready: string[] = [];

    for (const node of nodes)
    {
      if (!node.id.trim() || this.records.has(node.id) || !node.goal.trim())
        throw Error('Invalid task ID or goal: ' + node.id);

      if (node.parentTaskId !== undefined && !ids.has(node.parentTaskId) && !this.records.has(node.parentTaskId))
        throw Error('Unknown parent task: ' + node.parentTaskId);

      remaining.set(node.id, node.dependsOn.length);

      if (!node.dependsOn.length)
        ready.push(node.id);

      for (const id of node.dependsOn)
      {
        if (!ids.has(id))
          throw Error('Missing dependency: ' + id);

        const children = successors.get(id) ?? [];

        children.push(node.id);

        successors.set(id, children);
      }
    }

    for (const id of ready)
    {
      for (const child of successors.get(id) ?? [])
      {
        const count = remaining.get(child)! - 1;

        remaining.set(child, count);

        if (!count)
          ready.push(child);
      }
    }

    if (ready.length !== nodes.length)
      throw Error('Task dependency cycle');

    const handles = nodes.map(({ Execute, ...assignment }) => { const dependsOn = Object.freeze([...assignment.dependsOn]); const task: OfficeTask = Object.freeze({ ...assignment, dependsOn, attempt: 0, state: dependsOn.length ? 'waiting' : 'queued' }); this.records.set(task.id, task); return this.Register(task, Execute); });

    for (const handle of handles)
      this.changes.Emit(this.records.get(handle.id)!);

    this.Schedule();

    return handles;
  }

  private Register<T>(task: OfficeTask, execute: (task: OfficeTask, signal: AbortSignal) => Promise<T>)
  {
    let job!: Job;

    const done = new Promise<T>((resolve, reject) => { job = { Reject: reject, Start: async (current, signal) => { try { signal.throwIfAborted(); const result = await execute(current, signal); if (signal.aborted) return; this.jobs.delete(current.id); this.Update(current, 'completed'); resolve(result); } catch (error) { if (!signal.aborted) this.Update(current, 'suspended', String(error)); } } }; });

    void done.catch(() => { });

    this.jobs.set(task.id, job);

    return { id: task.id, done };
  }

  private Mutable(id: string)
  {
    const task = this.records.get(id);

    if (!task || !this.jobs.has(id))
      throw Error('Task is unknown or already terminal: ' + id);

    return task;
  }

  public Suspend(id: string, reason: string)
  {
    const task = this.Mutable(id);

    if (task.state === 'suspended')
      return;

    this.jobs.get(id)!.controller?.abort(reason);

    this.Update(task, 'suspended', reason);
  }

  public Resume(id: string, instruction?: string)
  {
    const task = this.Mutable(id);

    if (task.state !== 'suspended')
      throw Error('Task must be suspended before resuming');

    this.Update({ ...task, instruction }, 'waiting');

    this.Schedule();
  }

  public Reassign(id: string, agentId: string, workspaceInstanceId: string)
  {
    const task = this.Mutable(id);

    this.jobs.get(id)!.controller?.abort();

    this.Update({ ...task, agentId, workspaceInstanceId }, 'suspended', 'Task reassigned');
  }

  public Cancel(id: string)
  {
    const task = this.Mutable(id);

    const job = this.jobs.get(id)!;

    this.jobs.delete(id);

    const reason = Error('Task cancelled');

    job.controller?.abort(reason);

    this.Update(task, 'cancelled', reason.message);

    job.Reject(reason);

    this.Schedule();
  }

  public async Close()
  {
    this.closed = true;

    for (const id of this.jobs.keys())
      this.Cancel(id);

    await Promise.all(this.running.values());
  }

  private scheduling = false;

  private dirty = false;

  private Schedule()
  {
    this.dirty = true;

    if (this.closed || this.scheduling)
      return;

    this.scheduling = true;

    try
    {
      while (this.dirty && !this.closed)
      {
        this.dirty = false;

        for (const [id, job] of this.jobs)
        {
          const task = this.records.get(id)!;

          const dependencies = task.dependsOn.map(parent => this.records.get(parent)!);

          const blocked = dependencies.find(parent => parent.state === 'blocked' || parent.state === 'cancelled');

          if (blocked)
          {
            this.jobs.delete(id);

            const reason = Error('Blocked by task: ' + blocked.id);

            this.Update(task, 'blocked', reason.message);

            job.Reject(reason);

            this.dirty = true;

            continue;
          }

          if (task.state === 'waiting' && dependencies.every(parent => parent.state === 'completed'))
          {
            this.Update(task, 'queued');

            this.dirty = true;

            continue;
          }

          if (task.state !== 'queued' || job.controller || this.running.has(task.agentId))
            continue;

          const controller = new AbortController();

          job.controller = controller;

          const current = Object.freeze({ ...task, state: 'running' as const, attempt: task.attempt + 1 });

          const run = Promise.resolve().then(() => job.Start(current, controller.signal)).finally(() => { job.controller = undefined; this.running.delete(current.agentId); this.Schedule(); });

          this.running.set(current.agentId, run);

          this.Update(current, 'running');
        }
      }
    }
    finally
    {
      this.scheduling = false;
    }
  }

  private Update(task: OfficeTask, state: OfficeTask['state'], error?: string)
  {
    const snapshot = Object.freeze({ ...task, state, error });

    this.records.set(task.id, snapshot);

    this.changes.Emit(snapshot);
  }
}
