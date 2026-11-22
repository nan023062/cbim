/**
 * 作用定位：一个打开的项目共享定义与资源引用，各 Office 独立拥有成员实例和任务。
 * 设计原因：持久会话身份与运行实例分离。
 */
import { Project as BusinessTree, type WorkspaceInstanceFactory, type WorkspaceTree } from '../business';

import { Organization, AgentInstances } from '../cability/organization';

import { changeEvents } from '../events';

import { Office } from '../office';

export type SharedPackageKind = 'engines' | 'connectors';

export type ProjectReferences = Partial<Record<SharedPackageKind, Record<string, string>>>;

export interface ProjectResources
{
  projectId: string;

  organization: Parameters<Organization['ReplaceChildren']>[0];

  business: WorkspaceTree;

  references?: ProjectReferences;
}

/** 将 Office 的资源选择映射为本机资源管理器的包身份，不保存安装路径或凭据。 */
export class ProjectResourceBridge
{
  private references: ProjectReferences;

  constructor(references: ProjectReferences = {})
  {
    this.references = structuredClone(references);
  }

  Replace(references: ProjectReferences)
  {
    this.references = structuredClone(references);
  }

  Identity(kind: SharedPackageKind, id: string): string | undefined
  {
    const refs = this.references[kind];

    return refs && Object.hasOwn(refs, id) ? refs[id] : undefined;
  }
}

export interface ResourceContext
{
  session: string;

  selection:
  {
    engine: string;

    profileId: string;

    modelId: string
  }
}

export interface ProjectResourceStore
{
  Read(input: unknown): Promise<unknown>;

  Change(input: unknown, context: ResourceContext): Promise<unknown>;
}

export class ProjectInstance
{
  public readonly organization: Organization;

  public readonly business: BusinessTree;

  public readonly shared: ProjectResourceBridge;

  private readonly offices = new Map<string, Office>();

  private readonly changes = changeEvents<
    {
      officeId: string;

      change: 'opened' | Parameters<Parameters<Office['Subscribe']>[0]>[0]
    }>();

  public readonly Subscribe = this.changes.Subscribe;

  private closed = false;

  constructor(readonly id: string, resources: ProjectResources, private worktrees?: WorkspaceInstanceFactory, private records?: { List(): Promise<string[]>; Create(id: string): Promise<void> }, private store?: ProjectResourceStore)
  {
    if (!id.trim() || resources.projectId !== id)
      throw Error('项目资源身份无效');

    this.organization = new Organization(id);

    this.organization.ReplaceChildren(structuredClone(resources.organization));

    this.business = new BusinessTree(structuredClone(resources.business));

    this.shared = new ProjectResourceBridge(resources.references);
  }

  private ResourceStore()
  {
    if (this.closed || !this.store)
      throw Error('项目已关闭或尚未连接资源存储');

    return this.store;
  }

  async ReadResource(input: unknown)
  {
    return this.ResourceStore().Read(input);
  }

  async ChangeResource(input: unknown, context: ResourceContext)
  {
    return this.ResourceStore().Change(input, context);
  }

  get project()
  {
    return this.business;
  }

  /** 稳定会话 ID 来自磁盘；运行实例 ID 仅在办公室打开期间有效。 */
  async ListOfficeRecords()
  {
    if (!this.records)
      throw Error('未连接项目记录');

    return this.records.List();
  }

  async CreateOfficeRecord()
  {
    if (this.closed || !this.records)
      throw Error('项目已关闭或未连接记录');

    const id = crypto.randomUUID();

    await this.records.Create(id);

    return id;
  }

  ListOffices()
  {
    return [...this.offices.values()].filter(o => !o.closed);
  }

  FindOffice(id: string)
  {
    return this.ListOffices().find(o => o.id === id);
  }

  OpenOffice(session: string): Office;

  OpenOffice(project: string, session: string): Office;

  OpenOffice(first: string, second?: string)
  {
    const session = second ?? first;

    if (this.closed || !session.trim() || second !== undefined && first !== this.id)
      throw Error('办公室不属于当前项目或项目已关闭');

    const old = this.offices.get(session);

    if (old && !old.closed)
      return old;

    const office = new Office(this.id, session, this.organization, this.worktrees, this.business, new AgentInstances());

    this.offices.set(session, office);

    const detach = office.Subscribe(change => { if (change.type === 'closed') { detach(); if (this.offices.get(session) === office) this.offices.delete(session); } this.changes.Emit({ officeId: office.id, change }); });

    this.changes.Emit({ officeId: office.id, change: 'opened' });

    return office;
  }

  async Close()
  {
    this.closed = true;

    await Promise.all(this.ListOffices().map(o => o.Close()));
  }
}
