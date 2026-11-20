/** 插件管理器按制品身份准备固定版本，由宿主实现校验与获取。 */
export interface PluginArtifact
{
  kind: string;

  version: string;

  identity: string;

  dependencies: readonly
  {
    kind: string;

    identity: string
  }[];
}

export interface PluginArtifacts<Artifact extends PluginArtifact, Prepared>
{
  List(): Promise<{ current: Artifact[]; available: Artifact[] }>;

  Check(): Promise<void>;

  Prepare(kind: string, identity: string, onProgress?: (progress: number) => void): Promise<Prepared>;
}

export interface PluginCatalog<Id extends string, Artifact extends PluginArtifact>
{
  readonly ids: readonly Id[];

  Discover?(available: readonly Artifact[]): readonly Id[];

  ParseId(raw: string): Id;

  Validate(artifact: Artifact): void;
}
