/** 一个主会话的办公室，跨任务保留成员绑定。 */
import { changeEvents } from '../events';
import { Project, type WorkspaceInstance, type WorkspaceInstanceFactory } from '../business';

import { Workstation } from './workstation';

import type { AgentInstances, AgentEngineFactory, Organization } from '../cability/organization';
import { AgentRole } from '../cability/agent';

import { OfficeMembers } from './members';

export type OfficeChange = { type: 'agent'; change: Parameters<Parameters<Organization['Subscribe']>[0]>[0] } | { type: 'workspace-opened' | 'workspace-closed'; instanceId: string } | { type: 'closed' };

export class Office
{
  private readonly changes = changeEvents<OfficeChange>();
  public readonly Subscribe = this.changes.Subscribe;
  private readonly detachAgents: () => void;

  public readonly id = crypto.randomUUID();



  private readonly _stations = new Map<string, Workstation>();

  private readonly _opening = new Set<Promise<WorkspaceInstance>>();

  public GetAgentTokenUsage(id: string, now = performance.now()) { return this.FindAgent(id)?.usage.Read(now); }

  public GetTokenUsage(now = performance.now()) {
    const agents = this.ListAgents().map(agent => ({ id: agent.id, ...agent.usage.Read(now) }));
    return { agents, totalTokens: agents.reduce((n, a) => n + a.totalTokens, 0), tokensPerSecond: agents.reduce((n, a) => n + a.tokensPerSecond, 0) };
  }

  private readonly _members: OfficeMembers;

  /** 内置负责人跨轮持有唯一的 Agent 身份，岗位绑定到本 Office 的主会话。 */
  private readonly principal: ReturnType<Organization['MainAgent']>;
  public readonly mainRole: AgentRole;

  public get mainAgentId(): string { return this.principal.id; }

  /** 宿主选择执行引擎，Office 提供主会话身份及内置职责。 */
  public async OpenMainAgent<P, E>(factory: AgentEngineFactory<P, E>)
  {
    if (this.closed) throw new Error('办公室已关闭');
    return (await this.principal.Open(this.mainRole, factory)).engine;
  }

  public CloseMainEngine(): Promise<void> { return this.principal.Close(); }

  private _closed = false;

  public get closed(): boolean
  {
    return this._closed;
  }

  public get members(): OfficeMembers
  {
    if (this._closed)
      throw new Error('办公室已关闭');

    return this._members;
  }

  public constructor(public readonly workspaceId: string, public readonly rootSessionId: string, public readonly organization: Organization, private readonly _worktrees?: WorkspaceInstanceFactory, public readonly project = new Project({ nodes: {}, roots: [] }), private readonly agents: AgentInstances = organization)
  {
    this._members = new OfficeMembers(organization, agents);
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
    if (this.closed || !this._worktrees) return Promise.reject(new Error('办公室已关闭或缺少工作树宿主'));
    const officeId = JSON.stringify([this.workspaceId, this.rootSessionId]);
    const opening = this.project.OpenWorkspace(nodeId, { officeId, repositoryRoot, relativeDirectory }, this._worktrees).then(async instance => {
      this._stations.set(instance.instanceId, new Workstation(instance));
      const detach = instance.OnClosed(() => { detach(); this._stations.delete(instance.instanceId); this.changes.Emit({ type: 'workspace-closed', instanceId: instance.instanceId }); });
      if (this.closed) { await instance.Close(); throw new Error('办公室已关闭'); }
      this.changes.Emit({ type: 'workspace-opened', instanceId: instance.instanceId });
      return instance;
    }).finally(() => this._opening.delete(opening));
    this._opening.add(opening);
    return opening;
  }

  public ListActiveAgents() { return this.agents.ListActiveAgents(); }
  public ListAgents() { return this._members.ListAgents(); }
  public FindAgent(id: string) { return this.ListAgents().find(agent => agent.id === id); }
  public ListWorkspaces() {
    for (const [id, station] of this._stations) if (station.workspace.closed) this._stations.delete(id);
    return Array.from(this._stations.values(), station => station.workspace);
  }
  public FindWorkspace(id: string) { return this.ListWorkspaces().find(instance => instance.instanceId === id); }

  public async Close(): Promise<void> {
    if (!this._closed) { this._closed = true; this.detachAgents(); this.changes.Emit({ type: 'closed' }); }
    await this.CloseMainEngine();
    await Promise.allSettled(this._opening);
    await Promise.all(this.ListWorkspaces().map(instance => instance.Close()));
    this._stations.clear();
    await this.agents.CloseInstances();
  }
}
