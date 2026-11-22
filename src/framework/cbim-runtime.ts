/**
 * 作用定位：应用级 AI 工作流运行时，按工作区和主会话拥有办公室。
 * 设计原因：以实例注册表隔离项目工作区和主会话，Office 的创建与释放不依赖页面挂载。
 */
import { Project, type WorkspaceTree, type WorkspaceInstanceFactory } from './business';

import { AgentInstances, Organization } from './cability/organization';

import { changeEvents } from './events';

import { Office } from './office';

import type { ProjectResources } from './project';

export type { ProjectResources };

export class CbimRuntime
{
  private readonly changes = changeEvents<
    {
      officeId: string;

      change: 'opened' | Parameters<Parameters<Office['Subscribe']>[0]>[0]
    }>();

  public readonly Subscribe = this.changes.Subscribe;

  private readonly _workspaces = new Map<string, Map<string, Office>>();

  private _closed = false;

  public constructor(private readonly _worktrees?: WorkspaceInstanceFactory, private readonly resources?: ProjectResources)
  {
    if (resources)
    {
      this.resources = structuredClone(resources);

      this.organization = this.CreateOrganization(resources.projectId);

      this.project = new Project(structuredClone(resources.business));
    }
  }

  public readonly organization?: Organization;

  public readonly project?: Project;

  private CreateOrganization(id: string)
  {
    const organization = new Organization(id);

    if (this.resources)
      organization.ReplaceChildren(this.resources.organization);

    return organization;
  }

  public ListOffices()
  {
    return [...this._workspaces.values()].flatMap(group => [...group.values()].filter(office => !office.closed));
  }

  public FindOffice(id: string)
  {
    return this.ListOffices().find(office => office.id === id);
  }

  /** 首轮创建办公室，后续轮次继续使用同一办公室及成员绑定。 */
  public OpenOffice(workspaceId: string, rootSessionId: string): Office
  {
    if (this._closed)
      throw new Error('CBIM 运行时已关闭');

    if (!workspaceId.trim() || !rootSessionId.trim())
      throw new Error('办公室需要工作区和主会话身份');

    if (this.resources && workspaceId !== this.resources.projectId)
      throw new Error('办公室不属于当前项目');

    let offices = this._workspaces.get(workspaceId);

    if (!offices)
    {
      offices = new Map();

      this._workspaces.set(workspaceId, offices);
    }

    let office = offices.get(rootSessionId);

    if (!office || office.closed)
    {
      const organization = this.organization ?? new Organization(workspaceId);

      office = new Office(workspaceId, rootSessionId, organization, this._worktrees, this.project, this.organization ? new AgentInstances() : organization);

      offices.set(rootSessionId, office);

      const officeId = office.id;

      const detach = office.Subscribe(change => { if (change.type === 'closed') detach(); this.changes.Emit({ officeId, change }); });

      this.changes.Emit({ officeId, change: 'opened' });
    }

    return office;
  }

  /** 宿主排空执行后释放该工作区的会话绑定。 */
  public async CloseWorkspace(workspaceId: string): Promise<void>
  {
    const offices = this._workspaces.get(workspaceId);

    if (!offices)
      return;

    await Promise.all([...offices].map(async ([key, office]) => { await office.Close(); if (offices.get(key) === office) offices.delete(key); }));

    if (!offices.size)
      this._workspaces.delete(workspaceId);
  }

  /** 应用退出时回收所有办公室，并终止新会话受理。 */
  public async Close(): Promise<void>
  {
    this._closed = true;

    await Promise.all([...this._workspaces.keys()].map(id => this.CloseWorkspace(id)));
  }
}
