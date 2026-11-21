/**
 * 作用定位：连接器包管理器的装配函数与制品兼容性校验。
 * 设计原因：复用通用插件管理器，单独限制连接器类型、协议及无依赖制品，避免套用引擎兼容规则。
 */
import { PluginManager } from '../../resource/plugins';

import type { EngineArtifactsPort } from '../updates/engine-artifacts';

export function connectorPackages(file: string, artifacts: EngineArtifactsPort)
{
  const compatible = (artifact: Awaited<ReturnType<EngineArtifactsPort['List']>>['available'][number]) => artifact.plugin?.type === 'connector' || (!artifact.plugin && artifact.kind === 'world-clock');

  return new PluginManager(file, artifacts, {
    ids: [],

    Discover: available => [...new Set(available.filter(compatible).map(item => item.kind))],

    ParseId(raw)
    {
      if (!/^[a-z][a-z0-9-]{0,47}$/.test(raw))
        throw Error('未知连接器包：' + raw);

      return raw;
    },

    Validate(artifact)
    {
      if (!compatible(artifact) || artifact.protocol !== 1 || artifact.dependencies.length)
        throw Error('连接器制品协议无效');
    }
  });
}
