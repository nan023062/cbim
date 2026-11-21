/**
 * 作用定位：执行引擎页和 Office 选择器使用的宿主快照。
 * 设计原因：以纯数据契约隔离页面与包管理器，显示版本和依赖不需要取得运行句柄。
 */
import type { ModelConnectionRequirement } from './desktop-models';

interface EngineVersion
{
  version: string;

  identity: string;

  dependencies?:
  {
    kind: string;

    identity: string
  }[];

  plugin?:
  {
    type: string;

    label?: string
  }
}

export interface EnginePackageStatus
{
  kind: string;

  label: string;

  logo?: string;

  requirement: ModelConnectionRequirement;

  enabled: boolean;

  active?: EngineVersion;

  candidate?: EngineVersion;

  installed: EngineVersion[];

  references: number;

  preparing: boolean;

  preparation?:
  {
    identity?: string;

    version: string;

    progress?: number
  };

  error?: string;
}

export interface EnginePackageSettings
{
  managed: boolean;

  revision: number;

  items: EnginePackageStatus[]
}
