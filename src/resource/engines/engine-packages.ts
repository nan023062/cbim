/**
 * 作用定位：引擎设置与执行入口，提供官方引擎目录及制品兼容规则。
 * 设计原因：复用通用 PluginManager 的版本引用机制，将引擎特有兼容性和依赖校验留在此适配层。
 */
import { PluginManager } from '../plugins';

import { registerPackageEngines, supportedEngines, engineDescriptor, loopEngineSchema, type LoopEngine } from '../../logic/engines/index';

import type { EngineArtifact, EngineArtifactsPort, PreparedEngineArtifact } from '../../logic/updates/engine-artifacts';

import type { EngineRuntimePackage, EngineRuntimeResolver } from '../../logic/execution/rules/engine-runtime';

import type { EnginePackageSettings } from '../../logic/engines/index';

export class EnginePackages implements EngineRuntimeResolver
{
  private readonly manager: PluginManager<LoopEngine, EngineArtifact, PreparedEngineArtifact>;

  constructor(file: string, private readonly artifacts: EngineArtifactsPort)
  {
    this.manager = new PluginManager(file, artifacts, {
      get ids()
      {
        return supportedEngines.map(engine => engine.id);
      },

      ParseId: raw => loopEngineSchema.parse(raw),

      Validate: artifact => { const descriptor = engineDescriptor(loopEngineSchema.parse(artifact.kind)); if (artifact.plugin?.type === 'connector' || artifact.protocol !== 1 || artifact.dependencies.length !== (descriptor.packageDependencies ?? []).length || artifact.dependencies.some(ref => !(descriptor.packageDependencies ?? []).includes(loopEngineSchema.parse(ref.kind)))) throw Error('引擎制品与官方声明不兼容'); }
    });
  }

  async Init()
  {
    registerPackageEngines((await this.artifacts.List()).available);

    await this.manager.Init();
  }

  Read(): Promise<EnginePackageSettings>
  {
    return this.manager.Read();
  }

  List()
  {
    return this.manager.List();
  }

  async Check()
  {
    await this.artifacts.Check();

    await this.Init();

    return this.List();
  }

  Install(kind: LoopEngine, expected?: { revision: number; identity: string })
  {
    return this.manager.Install(kind, expected);
  }

  SetEnabled(kind: LoopEngine, enabled: boolean, remove = false, revision?: number)
  {
    return this.manager.SetEnabled(kind, enabled, remove, revision);
  }

  async ResolveEngine(raw: string, pinned?: string): Promise<EngineRuntimePackage>
  {
    if (!supportedEngines.some(engine => engine.id === raw))
      await this.Init();

    const { root, dependencies, retain } = await this.manager.Resolve(raw, pinned);

    return { ...root, dependencies, retain };
  }
}
