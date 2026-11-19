/** 一个主会话的办公室，跨任务保留成员绑定。 */
import { changeEvents } from '../events';
import { Project, type WorkspaceInstance, type WorkspaceInstanceFactory } from '../business';

import { Workstation } from './workstation';

import type { Organization } from '../cability/organization';

import { OfficeMembers } from './members';

export type OfficeChange = { type: 'agent'; change: Parameters<Parameters<Organization['Subscribe']>[0]>[0] } | { type: 'workspace-opened' | 'workspace-closed'; instanceId: string } | { type: 'closed' };

export class Office
{
  private readonly changes = changeEvents<OfficeChange>();
  public readonly Subscribe = this.changes.Subscribe;
  private readonly detachAgents: () => void;

  public readonly id = crypto.randomUUID();

  public readonly project = new Project({ nodes: {}, roots: [] });

  private readonly _stations = new Map<string, Workstation>();

  private readonly _opening = new Set<Promise<WorkspaceInstance>>();

  public GetAgentTokenUsage(id: string, now = performance.now()) { return this.FindAgent(id)?.usage.Read(now); }

  public GetTokenUsage(now = performance.now()) {
    const agents = this.ListAgents().map(agent => ({ id: agent.id, ...agent.usage.Read(now) }));
    return { agents, totalTokens: agents.reduce((n, a) => n + a.totalTokens, 0), tokensPerSecond: agents.reduce((n, a) => n + a.tokensPerSecond, 0) };
  }

  private readonly _members: OfficeMembers;

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

  public constructor(public readonly workspaceId: string, public readonly rootSessionId: string, public readonly organization: Organization, private readonly _worktrees?: WorkspaceInstanceFactory)
  {
    this._members = new OfficeMembers(organization);
    this.detachAgents = organization.Subscribe(change => this.changes.Emit({ type: 'agent', change }));
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

  public ListAgents() { return this._members.ListAgents(); }
  public FindAgent(id: string) { return this.ListAgents().find(agent => agent.id === id); }
  public ListWorkspaces() {
    for (const [id, station] of this._stations) if (station.workspace.closed) this._stations.delete(id);
    return Array.from(this._stations.values(), station => station.workspace);
  }
  public FindWorkspace(id: string) { return this.ListWorkspaces().find(instance => instance.instanceId === id); }

  public async Close(): Promise<void> {
    if (!this._closed) { this._closed = true; this.detachAgents(); this.changes.Emit({ type: 'closed' }); }
    await Promise.allSettled(this._opening);
    await Promise.all(this.ListWorkspaces().map(instance => instance.Close()));
    this._stations.clear();
    this._members.SetMembers([]);
    this.organization.ClearAgents();
  }
}
