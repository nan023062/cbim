/**
 * 作用定位：应用入口，供宿主初始化和关闭一套应用实例。
 * 设计原因：由 Application 实例集中组合项目、资源和队列服务，宿主无需分别管理各业务对象的生命周期。
 */
import { ResourceRepositories, type ResourceRepositoryPaths } from '../../resource/service';

import { ResourceManagement, type PluginSource } from '../resource-management';

import { createApplicationMonitor } from '../monitor';

import { ProjectList } from '../projects/project';

import { ProjectNavigation } from '../projects/navigation';

import { OfficeQueue } from '../projects/office-queue';

import { ProjectOffices, type OfficeChat, type MainAgentSelection } from '../projects/offices';

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

  public readonly officeQueue: OfficeQueue;

  public readonly navigation: ProjectNavigation;

  public readonly discovery: ResourceManagement;

  public constructor(paths: ResourceRepositoryPaths, plugins?: PluginSource, chat?: OfficeChat, defaultModel?: () => Promise<MainAgentSelection | undefined>)
  {
    this.resources = new ResourceRepositories(paths);

    this.projects = new ProjectList(new Paths(paths.userRoot, paths.installRoot, paths.protectedRoots));

    this.monitor = createApplicationMonitor(this.projects);

    this.offices = new ProjectOffices(this.projects, chat, defaultModel);

    this.officeQueue = new OfficeQueue(this.projects, this.offices);

    this.navigation = new ProjectNavigation(this.projects, this.officeQueue);

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
      await this.officeQueue.Close();

      await this.projects.Close();
    }
    finally
    {
      this.monitor.Close();

      await this.resources.Close();
    }
  }
}
