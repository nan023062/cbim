/** 应用入口，供宿主初始化和关闭一套应用实例。 */
import { ResourceRepositories, type ResourceRepositoryPaths } from '../../resource/service';

import { ResourceManagement, type PluginSource } from '../resource-management';

import { createApplicationMonitor } from '../monitor';

import { ProjectList } from '../projects/project';

import { ProjectOffices, type OfficeChat } from '../projects/offices';

import { Paths } from '../projects/paths';

export interface ApplicationInitOptions
{
  /** 是否在初始化时恢复已登记的项目。 */
  readonly restore?: boolean;
}

export interface ApplicationEntry
{
  Init(options?: ApplicationInitOptions): Promise<void>;

  Shutdown(): Promise<void>;
}

export class Application implements ApplicationEntry
{
  public readonly resources: ResourceRepositories;

  private startup?: Promise<void>;

  private shutdown?: Promise<void>;

  public readonly monitor: ReturnType<typeof createApplicationMonitor>;

  public readonly projects: ProjectList;

  public readonly offices: ProjectOffices;

  public readonly discovery: ResourceManagement;

  public constructor(paths: ResourceRepositoryPaths, plugins?: PluginSource, chat?: OfficeChat)
  {
    this.resources = new ResourceRepositories(paths);

    this.projects = new ProjectList(new Paths(paths.userRoot, paths.installRoot, paths.protectedRoots));

    this.monitor = createApplicationMonitor(this.projects);

    this.offices = new ProjectOffices(this.projects, chat);

    this.discovery = new ResourceManagement(this.resources, plugins);
  }

  public Init(options?: ApplicationInitOptions): Promise<void>
  {
    if (this.shutdown)
      return Promise.reject(new Error('应用已关闭'));

    return this.startup ??= this.resources.Init().then(async () => { if (options?.restore) await Promise.all((await this.projects.Read()).entries.map(entry => this.projects.Open(entry.id))); });
  }

  public Shutdown(): Promise<void>
  {
    return this.shutdown ??= this.Close();
  }

  private async Close(): Promise<void>
  {
    await this.startup?.catch(() => { });

    try
    {
      await this.projects.Close();
    }
    finally
    {
      this.monitor.Close();

      await this.resources.Close();
    }
  }
}
