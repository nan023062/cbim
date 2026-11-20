/** 为发现菜单整理已登记的插件和仓库资源，只返回浏览所需的字段。 */
import { resourceKinds, type ResourceCategory } from '../../resource';

import type { ResourceRepositories } from '../../resource/service';

export interface PluginSource
{
  List(): Promise<{ current: { kind: string; version: string; plugin?: { type: string; label?: string } }[] }>;
}

export class ResourceManagement
{
  public constructor(private readonly repository: ResourceRepositories, private readonly plugins?: PluginSource)
  {
  }

  public async Plugins(type: 'engine' | 'connector')
  {
    if (!this.plugins)
      return { source: '当前宿主未提供已签名插件目录', items: [] };

    const { current } = await this.plugins.List();

    return { source: '已签名插件目录', items: current.filter(p => (p.plugin?.type ?? 'engine') === type).map(p => ({ id: p.kind, name: p.plugin?.label ?? p.kind, kind: type, summary: p.version, })) };
  }

  public async Library(category: ResourceCategory)
  {
    const status = this.repository.Status();

    if (status.error)
      throw new Error(status.error);

    if (!status.config)
      return { source: '尚未配置资源仓库', items: [] };

    const { items } = await this.repository.Read();

    return {
      source: status.config.location, items: items.filter(item => resourceKinds[item.kind].category === category)
        .map(({ id, name, kind, summary }) => ({ id, name, kind: resourceKinds[kind].label, summary }))
    };
  }
}
