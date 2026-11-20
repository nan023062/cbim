/** 执行引擎页和 Office 选择器使用的宿主快照。 */
import type { ModelConnectionRequirement } from './desktop-models';

interface EngineVersion
{
  version: string;

  identity: string;

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

  requirement: ModelConnectionRequirement;

  enabled: boolean;

  active?: EngineVersion;

  candidate?: EngineVersion;

  error?: string;
}

export interface EnginePackageSettings
{
  managed: boolean;

  revision: number;

  items: EnginePackageStatus[]
}
