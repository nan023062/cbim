/** 一个主会话的办公室，跨任务保留成员绑定。 */
import { changeEvents } from '../events';

import { Project, type WorkspaceInstance, type WorkspaceInstanceFactory } from '../business';

import { Workstation } from './workstation';

import { OfficeTaskManager, type OfficeTask } from './task-manager';

import type { AgentInstances, AgentEngineFactory, Organization } from '../cability/organization';

import { AgentRole } from '../cability/agent';

import { OfficeMembers } from './members';

export interface TaskAssignment
{
  memberId?: string;

  workspaceInstanceId: string;

  goal: string;

  parentTaskId?: string;
}

type PlannedTask = TaskAssignment &
{
  id: string;

  dependsOn?: readonly string[]
};

type Executor<T> = (task: OfficeTask, agent: ReturnType<Organization['Allocate']>, workspace: WorkspaceInstance, signal: AbortSignal) => Promise<T>;

type Handle<T> =
  {
    id: string;

    done: Promise<T>
  };

export interface MainTaskCommands
{
  DispatchTask<T>(request: TaskAssignment, execute: Executor<T>): Handle<T>;

  SubmitTaskGraph<T>(plan: readonly PlannedTask[], execute: Executor<T>): Handle<T>[];

  Suspend(id: string, reason: string): void;

  Resume(id: string, instruction?: string): void;

  Cancel(id: string): void;

  Reassign(id: string, workspaceInstanceId: string, memberId?: string): void;
}

export type OfficeChange =
  {
    type: 'agent';

    change: Parameters<Parameters<Organization['Subscribe']>[0]>[0]
  } |
  {
    type: 'task';

    task: OfficeTask
  } |
  {
    type: 'workspace-opened' | 'workspace-closed';

    instanceId: string
  } |
  {
    type: 'closed'
  };

export class Office
{
  private readonly changes = changeEvents<OfficeChange>();

  public readonly Subscribe = this.changes.Subscribe;

  private readonly detachAgents: () => void;

  public permission: 'read' | 'ask' | 'execute' = 'ask';

  public readonly id = crypto.randomUUID();

  private readonly _stations = new Map<string, Workstation>();

  private readonly tasks = new OfficeTaskManager();

  private readonly _opening = new Set<Promise<WorkspaceInstance>>();

  public GetAgentTokenUsage(id: string, now = performance.now())
  {
    return this.FindAgent(id)?.usage.Read(now);
  }

  public GetTokenUsage(now = performance.now())
  {
    const agents = this.ListAgents().map(agent => ({ id: agent.id, ...agent.usage.Read(now) }));

    return { agents, totalTokens: agents.reduce((n, a) => n + a.totalTokens, 0), tokensPerSecond: agents.reduce((n, a) => n + a.tokensPerSecond, 0) };
  }

  private readonly _members: OfficeMembers;

  /** 内置负责人跨轮持有唯一的 Agent 身份，岗位绑定到本 Office 的主会话。 */
  private readonly principal: ReturnType<Organization['MainAgent']>;

  public readonly mainRole: AgentRole;

  public get mainAgentId(): string
  {
    return this.principal.id;
  }

  /** 宿主选择执行引擎，Office 提供主会话身份及内置职责。 */
  private mainSession?: symbol;

  private detachTaskEvents?: () => void;

  public async OpenMainAgent<P, E>(factory: AgentEngineFactory<P, E>, bind?: (engine: E, commands: MainTaskCommands) => (event: OfficeTask) => void | Promise<void>)
  {
    if (this.stopping)
      throw new Error('办公室已关闭');

    const { engine } = await this.principal.Open(this.mainRole, factory);

    if (this.stopping)
      throw Error('Office closed during startup');

    const session = Symbol();

    this.mainSession = session;

    const check = () => { if (this.stopping || this.mainSession !== session) throw Error('Main Agent session has ended'); };

    const commands: MainTaskCommands = {
      DispatchTask: (request, execute) => { check(); return this.#Submit([{ ...request, id: crypto.randomUUID() }], execute)[0]; },
      SubmitTaskGraph: (plan, execute) => { check(); return this.#Submit(plan, execute); },
      Suspend: (id, reason) => { check(); this.tasks.Suspend(id, reason); },
      Resume: (id, instruction) => { check(); this.tasks.Resume(id, instruction); },
      Cancel: id => { check(); this.tasks.Cancel(id); },
      Reassign: (id, desk, member) => { check(); if (!this.FindWorkspace(desk)) throw Error('Unknown Office workstation'); const agent = member === undefined ? this.principal : this.members.GetMember(member); this.bindings.set(agent.id, agent); this.tasks.Reassign(id, agent.id, desk); },
    };

    if (bind)
    {
      let listener: ((event: OfficeTask) => void | Promise<void>) | undefined;

      let delivery = Promise.resolve();

      const notify = (event: OfficeTask) => { delivery = delivery.then(async () => { if (this.mainSession === session) await listener?.(event); }).catch(error => console.error('Office principal task callback failed', error)); };

      this.detachTaskEvents = this.tasks.Subscribe(notify);

      try
      {
        for (const task of this.ListTasks())
          notify(task);

        listener = bind(engine, Object.freeze(commands));
      }
      catch (error)
      {
        await this.CloseMainEngine();

        throw error;
      }
    }

    return engine;
  }

  public CloseMainEngine(): Promise<void>
  {
    this.mainSession = undefined;

    this.detachTaskEvents?.();

    this.detachTaskEvents = undefined;

    return this.principal.Close();
  }

  private _closed = false;

  private stopping = false;

  private closing?: Promise<void>;

  public get closed(): boolean
  {
    return this._closed;
  }

  public get members(): OfficeMembers
  {
    if (this.stopping)
      throw new Error('办公室已关闭');

    return this._members;
  }

  public constructor(public readonly workspaceId: string, public readonly rootSessionId: string, public readonly organization: Organization, private readonly _worktrees?: WorkspaceInstanceFactory, public readonly project = new Project({ nodes: {}, roots: [] }), private readonly agents: AgentInstances = organization)
  {
    this._members = new OfficeMembers(organization, agents);

    this.tasks.Subscribe(task => { if (!this.closed) this.changes.Emit({ type: 'task', task }); });

    this.principal = agents.MainAgent();

    this.mainRole = new AgentRole({
      id: 'main', name: '主 Agent', position: 'Office 负责人、用户助手',
      instructions: '在本 Office 的主会话中协助用户澄清目标、回应问题。负责跟进任务，按需要通过 Office 协调成员，向用户说明进展、待确认事项和最终结果。',
    }, { workspaceId, taskId: rootSessionId });

    this.detachAgents = agents.Subscribe(change => this.changes.Emit({ type: 'agent', change }));
  }

  /** 在本办公室的工作副本中打开业务工位，调用方结束使用时关闭实例。 */
  public OpenWorkspace(nodeId: string, repositoryRoot: string, relativeDirectory: string): Promise<WorkspaceInstance>
  {
    if (this.stopping || !this._worktrees)
      return Promise.reject(new Error('办公室已关闭或缺少工作树宿主'));

    const officeId = JSON.stringify([this.workspaceId, this.rootSessionId]);

    const opening = this.project.OpenWorkspace(nodeId, { officeId, repositoryRoot, relativeDirectory }, this._worktrees).then(async instance => { this._stations.set(instance.instanceId, new Workstation(instance)); const detach = instance.OnClosed(() => { detach(); this._stations.delete(instance.instanceId); for (const task of this.ListTasks()) if (task.workspaceInstanceId === instance.instanceId && !['completed', 'blocked', 'cancelled'].includes(task.state)) this.tasks.Suspend(task.id, 'Workstation closed'); this.changes.Emit({ type: 'workspace-closed', instanceId: instance.instanceId }); }); if (this.stopping) { await instance.Close(); throw new Error('办公室已关闭'); } this.changes.Emit({ type: 'workspace-opened', instanceId: instance.instanceId }); return instance; }).finally(() => this._opening.delete(opening));

    this._opening.add(opening);

    return opening;
  }

  public ListActiveAgents()
  {
    return this.agents.ListActiveAgents();
  }

  public ListTasks()
  {
    return this.tasks.List();
  }

  private readonly bindings = new Map<string, ReturnType<Organization['Allocate']>>();

  #Submit<T>(plan: readonly PlannedTask[], execute: Executor<T>)
  {
    const nodes = plan.map(node => { const workspace = this.FindWorkspace(node.workspaceInstanceId); if (!workspace) throw Error('Unknown Office workstation'); const agent = node.memberId === undefined ? this.principal : this.members.GetMember(node.memberId); this.bindings.set(agent.id, agent); const { memberId, ...assignment } = node; return { ...assignment, dependsOn: node.dependsOn ?? [], agentId: agent.id, Execute: (task: OfficeTask, signal: AbortSignal) => { const assigned = this.ListAgents().find(item => item.id === task.agentId); const desk = this.FindWorkspace(task.workspaceInstanceId); if (!assigned || !desk) throw Error('Task assignment is no longer available'); const binding = this.bindings.get(assigned.id); if (!binding) throw Error('Unknown Worker'); return execute(task, binding, desk, signal); } }; });

    return this.tasks.SubmitGraph(nodes);
  }

  public ListAgents()
  {
    return this._members.ListAgents();
  }

  public FindAgent(id: string)
  {
    return this.ListAgents().find(agent => agent.id === id);
  }

  public ListWorkspaces()
  {
    for (const [id, station] of this._stations)
      if (station.workspace.closed)
        this._stations.delete(id);

    return Array.from(this._stations.values(), station => station.workspace);
  }

  public FindWorkspace(id: string)
  {
    return this.ListWorkspaces().find(instance => instance.instanceId === id);
  }

  public Close(): Promise<void>
  {
    if (this.closed)
      return Promise.resolve();

    this.stopping = true;

    return this.closing ??= Promise.resolve().then(() => this.ReleaseResources()).finally(() => { this.closing = undefined; });
  }

  private async ReleaseResources(): Promise<void>
  {
    this.mainSession = undefined;

    this.detachTaskEvents?.();

    this.detachTaskEvents = undefined;

    await this.tasks.Close();

    await Promise.allSettled(this._opening);

    const results = await Promise.allSettled([
      this.agents.CloseInstances(),
      ...this.ListWorkspaces().map(instance => instance.Close()),
    ]);

    const errors = results.filter(result => result.status === 'rejected').map(result => result.reason);

    if (errors.length)
      throw new AggregateError(errors, '办公室资源释放失败');

    this.bindings.clear();

    this.detachAgents();

    this._closed = true;

    this.changes.Emit({ type: 'closed' });
  }
}
