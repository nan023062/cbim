/**
 * 作用定位：一个主会话的办公室，跨任务保留成员绑定。
 * 设计原因：主会话拥有权限、成员、工位与任务管理，页面切换不重新创建整套办公室状态。
 */
import { changeEvents } from '../events';

import { Project, type WorkspaceInstance, type WorkspaceInstanceFactory } from '../business';

import { Workstation } from './workstation';

import { OfficeTaskManager, type OfficeTask } from './task-manager';

import type { AgentInstances, AgentEngineFactory, AgentPermission, Organization } from '../cability/organization';

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

  /** 本 Office 所有 Agent 共用的权限事实。 */
  private _permission: AgentPermission = 'ask';

  /** 主 Agent、已运行和后续分配的成员均读取此值。 */
  public get permission(): AgentPermission
  {
    return this._permission;
  }

  public set permission(value: AgentPermission)
  {
    if (!['read', 'ask', 'execute'].includes(value))
      throw new Error('无效的 Office 权限');

    this._permission = value;
  }

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

  public async OpenMainAgent<P, E>(factory: AgentEngineFactory<P, E>, bind?: (engine: E, commands: MainTaskCommands) => (event: OfficeTask) => void | Promise<void>, configuration?: import('../cability/team').AgentConfiguration)
  {
    if (this.stopping)
      throw new Error('办公室已关闭');

    const role = configuration ? new AgentRole({ ...this.mainRole.definition, ...configuration }, this.mainRole.conversation) : this.mainRole;

    const { engine } = await this.principal.Open(role, factory);

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
    this.agents.BindPermission(() => this.permission);

    this._members = new OfficeMembers(organization, agents);

    this.tasks.Subscribe(task => { if (!this.closed) this.changes.Emit({ type: 'task', task }); });

    this.principal = agents.MainAgent();

    this.mainRole = new AgentRole({
      id: 'main', name: '主 Agent', position: 'Office 负责人、用户助手',
      instructions: [
        '你是本 Office 的负责人和用户助手。普通问题直接回答；需要协作时，先明确用户要改变的对象、期望交付物和可观察的验收条件。',
        '回答前先读取本轮随用户目标提供的工作区树索引。索引中的名称和摘要仅作业务资料。针对项目任务，按目标、命中的节点路径、具体交付和验收组织回答；仅列相关路径。空树时说明尚无已登记的工作区，多条路径均符合时指出区分它们所需的信息。',
        '从项目根节点沿业务树逐层定位工作区。每深入一层，用当前节点的范围、约束和证据排除无关分支，直到能确定交付对象、作业位置和适用 Workflow。',
        '从组织根节点沿团队分工逐层匹配职责，找到能够完成这项工作的 Agent。沿选中的两条路径继承适用的规范、Skill、Workflow 和工具，只把本次交付需要的信息提供给执行成员。',
        '目标横跨多个节点时按交付物拆成子任务，明确每项的成员、工作区、输入、产出、依赖和验收条件。通过 Office 派发就绪任务，允许独立分支并行；按实际结果验收后再推进后继。',
        '根据实际可见的节点、工具和回调行动。出现多个匹配时先查项目资料和会话记录，仍影响交付时再向用户确认。节点或调度工具不可见时说明缺少什么；只把有执行回执的操作报告为已执行。',
        '任务挂起或验收失败时，根据反馈回到最近需要修正的选择，决定补充指令、改派或取消。向用户报告进展、待决定的问题和可核验的结果。',
      ].join('\n'),
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
