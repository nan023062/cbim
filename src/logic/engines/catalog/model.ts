/**
 * 作用定位：引擎执行准备后的模型快照契约，供岗位、任务与装配保存公开参数。
 * 设计原因：引擎身份归执行选型，不进入通用模型连接；兼容旧快照中缺省的 engine，禁止补写影响历史哈希。
 */
import type { ModelAdapter, ModelAdapterRegistry, ModelConfiguration } from '../../../framework/kernel';

import { identifyProvider, llmApiSchema, type ResolvedLlm, type ResolvedModelOperation } from '../../models';

import type { LoopEngine } from './supported-engines';

import type { ModelRolesSnapshot } from './model-roles';

/** apiKey 只在执行准备期间存在；持久化只使用 profile。engine 缺省时保留缺省。 */
export interface ResolvedEngineModel
{
  profile: ResolvedLlm['profile'] &
  {
    engine?: LoopEngine;

    modelRoles?: ModelRolesSnapshot
  };

  apiKey: string;

  /** 各额外角色的凭据仅在可信执行装配中使用，不持久化。 */
  modelRoles?: Readonly<Record<string, ResolvedModelOperation>>
}

/** 已发布引擎包消费连接参数；句柄卸载时释放本轮持有的配置及凭据。 */
export function createModelLoader(): import('../../../framework/kernel').ModelLoader<ResolvedEngineModel>
{
  type Runtime = import('../../../framework/kernel').ModelConfiguration<ResolvedEngineModel>;

  const active = new WeakMap<object, Runtime>();

  return {
    async Load(configuration)
    {
      const instance = Object.freeze({
        get runtime(): Runtime
        {
          const value = active.get(instance);

          if (!value)
            throw new Error('模型实例已卸载');

          return value;
        }
      });

      active.set(instance, configuration);

      return instance;
    },

    async Unload(instance)
    {
      active.delete(instance);
    },
  };
}

/** 每个宿主持有独立登记表。没有显式模型快照的旧调用走引擎原生配置。 */
export function createModelAdapterRegistry(): ModelAdapterRegistry<ResolvedEngineModel>
{
  const adapters = new Map<string, ModelAdapter<ResolvedEngineModel>>();

  const registry: ModelAdapterRegistry<ResolvedEngineModel> = {
    Register(adapter)
    {
      if (!adapter.id.trim() || adapters.has(adapter.id))
        throw new Error('模型适配器 ID 为空或已登记');

      adapters.set(adapter.id, adapter);
    },

    Get(id)
    {
      return adapters.get(id);
    },
  };

  for (const protocol of [...llmApiSchema.options, 'native'])
    registry.Register({
      id: 'protocol:' + protocol,
      SelectLoader: (_configuration, target) => target === protocol ? createModelLoader() : undefined,
    });

  return registry;
}

/** 优先使用指定厂商实现。通用协议加载器只接受原配置已经选好的协议。 */
export function selectExecutionModelLoader(registry: ModelAdapterRegistry<ResolvedEngineModel>, configuration: ModelConfiguration<ResolvedEngineModel>, supported: readonly string[])
{
  const profile = configuration.resolved?.profile;

  const vendorId = profile && identifyProvider(profile.baseUrl)?.id;

  const vendor = registry.Get(configuration.provider) ?? (vendorId ? registry.Get(vendorId) : undefined);

  if (vendor)
  {
    const targets = profile && supported.includes(profile.api) ? [profile.api, ...supported.filter(api => api !== profile.api)] : supported;

    for (const target of targets)
    {
      const loader = vendor.SelectLoader(configuration, target);

      if (loader)
        return loader;
    }

    throw new Error('厂商模型适配器与所选引擎协议不兼容');
  }

  const protocol = profile ? profile.api : 'native';

  const adapter = registry.Get('protocol:' + protocol);

  const loader = (!profile || supported.includes(protocol)) && adapter?.SelectLoader(configuration, protocol);

  if (!loader)
    throw new Error('没有支持当前模型和引擎协议的加载器');

  return loader;
}
