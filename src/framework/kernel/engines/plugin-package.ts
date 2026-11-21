/**
 * 作用定位：执行插件的包格式与工厂出口。发行方负责签名、归档和安装位置。
 * 设计原因：包结构与工厂出口可独立校验；格式通过不代表已验证签名或安装来源。
 */
import { z } from 'zod';

import { engineAdapterProtocol, type EngineAdapter } from './adapter';

/** 作者清单与发行索引共用的包头。entry 指向运行库，adapter.entry 指向导出工厂的 CommonJS 模块。 */
export const enginePluginPackageHeader = z.object({ kind: z.string().regex(/^[a-z][a-z0-9-]{0,47}$/), version: z.string().regex(/^(0|[1-9]\d{0,5})\.(0|[1-9]\d{0,5})\.(0|[1-9]\d{0,5})$/), entry: z.string(), });

export const enginePluginAdapterEntry = z.object({ entry: z.string(), version: enginePluginPackageHeader.shape.version, protocol: z.literal(engineAdapterProtocol), }).strict();

/** 新登记引擎的 plugin.json；兼容配置名由宿主产品目录提供。 */
export interface EnginePluginManifest extends z.infer<typeof enginePluginPackageHeader>
{
  plugin:
  {
    type: 'engine';

    profile: string;

    logo: string;

    label: string
  };

  adapter: z.infer<typeof enginePluginAdapterEntry>;

  dependencies?:
  {
    kind: string;

    identity: string
  }[];
}

/** 发布入口必须命名导出 engineAdapter 并声明能力描述。 */
export interface EnginePluginModule<Options, Engine, Descriptor>
{
  readonly engineAdapter: EngineAdapter<Options, Engine, Descriptor> &
  {
    readonly descriptor: Descriptor
  };
}
