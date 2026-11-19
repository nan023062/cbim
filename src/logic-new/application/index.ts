/** 应用入口，供宿主初始化和关闭一套应用实例。 */
import { CbimRuntime } from '../../framework/cbim-runtime';
import { ResourceRepositories, type ResourceRepositoryPaths } from '../../resource/service';
import { ResourceManagement, type PluginSource } from '../resource-management';
import { createApplicationMonitor } from '../monitor';
import { Catalog } from '../projects';
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
  public readonly runtime = new CbimRuntime();
  public readonly resources: ResourceRepositories;
  private startup?: Promise<void>;
  private shutdown?: Promise<void>;

  public readonly monitor = createApplicationMonitor(this.runtime);
  public readonly projects: Catalog;
  public readonly discovery: ResourceManagement;

  public constructor(paths: ResourceRepositoryPaths, plugins?: PluginSource)
  {
    this.resources = new ResourceRepositories(paths);
    this.projects = new Catalog(new Paths(paths.userRoot, paths.installRoot, paths.protectedRoots));
    this.discovery = new ResourceManagement(this.resources, plugins);
  }

  public Init(_options?: ApplicationInitOptions): Promise<void>
  {
    if (this.shutdown) return Promise.reject(new Error('应用已关闭'));
    return this.startup ??= this.resources.Init();
  }

  public Shutdown(): Promise<void>
  {
    return this.shutdown ??= this.Close();
  }

  private async Close(): Promise<void>
  {
    await this.startup?.catch(() => {});
    try
    {
      await this.runtime.Close();
    }
    finally
    {
      this.monitor.Close();
      await this.resources.Close();
    }
  }
}
