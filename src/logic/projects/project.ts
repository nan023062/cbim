/**
 * 作用定位：一个已加载的本地项目持有自己的架构资源与唯一的工作流运行时。
 * 设计原因：项目实例隔离资源与运行时，列表管理加载结果，单个项目故障不等同于所有项目不可用。
 */
import { AgentSettings } from './agent-settings';

import { BusinessDirectory } from './business-directory';

import { ProjectWork } from './project-work';

import { projectReads, projectWrites } from './office-operations';

import { ProjectReferenceStore } from './project-references';

import type { ProjectResourceStore } from '../../framework/project';

import { ProjectTrees } from './project-trees';

import { ProjectCache } from './project-cache';

import { ProjectInstance, type ProjectResources } from '../../framework/project';

import { changeEvents } from '../../framework/events';

import { readProjectResources } from './resources';

import { Catalog } from './index';

import type { WorkspaceEntry } from './contracts';

export class Project
{
  public readonly runtime: ProjectInstance;

  public constructor(public readonly entry: WorkspaceEntry, public readonly resources: ProjectResources, public readonly cache: ProjectCache, public readonly trees: ProjectTrees, store: ProjectResourceStore)
  {
    this.runtime = new ProjectInstance(entry.id, resources, cache.worktrees, cache.history, store);
  }
}

export class ProjectList extends Catalog
{
  ResourceChanged: (id: string, text: string) => void = () => { };

  DefaultModel: NonNullable<ConstructorParameters<typeof AgentSettings>[2]> = async () => undefined;

  readonly settings = new AgentSettings(this, (id, text) => this.ResourceChanged(id, text), () => this.DefaultModel());

  readonly businessDirectory = new BusinessDirectory(this, (id, text) => this.ResourceChanged(id, text));

  readonly work = new ProjectWork(this);

  private readonly loaded = new Map<string, Project>();

  private readonly opening = new Map<string, Promise<Project>>();

  private readonly changes = changeEvents<Parameters<Parameters<ProjectInstance['Subscribe']>[0]>[0]>();

  public readonly Subscribe = this.changes.Subscribe;

  private closed = false;

  public async Open(id: string): Promise<Project>
  {
    if (this.closed)
      throw Error('项目列表已关闭');

    const existing = this.loaded.get(id) ?? this.opening.get(id);

    if (existing)
      return existing;

    const opening = this.Load(id).finally(() => this.opening.delete(id));

    this.opening.set(id, opening);

    return opening;
  }

  private async Load(id: string)
  {
    const entry = (await this.Read()).entries.find(item => item.id === id);

    if (!entry)
      throw Error('项目未登记');

    const trees = new ProjectTrees(entry.path, this.Cache(id));

    const resources = await trees.Load((org, biz) => readProjectResources(id, entry.path, org, biz));

    if (this.closed)
      throw Error('项目列表已关闭');

    const references = new ProjectReferenceStore(entry.path);

    const project: Project = new Project(entry, resources, this.Cache(id), trees, {
      Read: async raw => { const input = projectReads.parse(raw); if (input.resource === 'member') return this.settings.Read(id, { kind: 'member', id: input.id }); if (input.resource === 'references') return references.Read(); if (input.resource === 'organization') return this.settings.organization.Read(id); if (input.resource === 'business') return this.businessDirectory.Read(id); const state = await this.work.Read(id); return { revision: state.revision, items: state[input.resource] }; },
      Change: async (raw, context) => { const input = projectWrites.parse(raw); if (input.resource === 'references') return references.Change(input.change, value => project.runtime.shared.Replace(value)); if (input.resource === 'member') return this.settings.Save(id, { kind: 'member', id: input.id }, input.revision, input.configuration); if (input.resource === 'organization') return this.settings.organization.Change(id, input.change); if (input.resource === 'business') return this.businessDirectory.Change(id, input.change); return this.work.Change(id, input.resource, input.change, context.session, context.selection); }
    });

    project.runtime.Subscribe(this.changes.Emit);

    this.loaded.set(id, project);

    return project;
  }

  public ListOffices()
  {
    return [...this.loaded.values()].flatMap(project => project.runtime.ListOffices());
  }

  /** 页面与 Agent 读取同一份当前业务树；返回独立快照，不暴露运行对象。 */
  public async Business(projectId: string)
  {
    const project = await this.Open(projectId);

    const business = project.runtime.business;

    const tree = business.DescribeWorkspaces();

    return { roots: tree.roots, nodes: tree.nodes.map(node => { const workspace = business.FindWorkspace(node.id)!; return { ...node, sources: workspace.sources, virtual: workspace.virtual ?? false }; }) };
  }

  public FindOffice(id: string)
  {
    return this.ListOffices().find(office => office.id === id);
  }

  public async Close()
  {
    this.closed = true;

    await Promise.allSettled(this.opening.values());

    await Promise.all([...this.loaded.values()].map(project => project.runtime.Close()));

    this.loaded.clear();
  }
}
