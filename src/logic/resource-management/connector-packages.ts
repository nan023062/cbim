/** ????????????????????????????? */
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
