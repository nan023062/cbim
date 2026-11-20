/** 一个已加载的本地项目持有自己的架构资源与唯一的工作流运行时。 */
import path from 'node:path';

import { GitWorktrees } from './git-worktrees';

import { CbimRuntime, type ProjectResources } from '../../framework/cbim-runtime';

import { changeEvents } from '../../framework/events';

import { readProjectResources } from './resources';

import { Catalog } from './index';

import type { WorkspaceEntry } from './contracts';

export class Project
{
  public readonly runtime: CbimRuntime;

  public constructor(public readonly entry: WorkspaceEntry, public readonly resources: ProjectResources, worktrees: GitWorktrees)
  {
    this.runtime = new CbimRuntime(worktrees, resources);
  }
}

export class ProjectList extends Catalog
{
  private readonly loaded = new Map<string, Project>();

  private readonly opening = new Map<string, Promise<Project>>();

  private readonly changes = changeEvents<Parameters<Parameters<CbimRuntime['Subscribe']>[0]>[0]>();

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

    const resources = await readProjectResources(id, entry.path);

    if (this.closed)
      throw Error('项目列表已关闭');

    const project = new Project(entry, resources, new GitWorktrees(path.join(this.paths.userRoot, 'worktrees')));

    project.runtime.Subscribe(this.changes.Emit);

    this.loaded.set(id, project);

    return project;
  }

  public ListOffices()
  {
    return [...this.loaded.values()].flatMap(project => project.runtime.ListOffices());
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
