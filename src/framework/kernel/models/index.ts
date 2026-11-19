/** 引擎创建时使用的模型选择和宿主解析的配置。 */
export interface ModelConfiguration<Model = unknown>
{
  readonly provider: string;

  readonly model: string;

  readonly resolved?: Model;
}

/** 已加载的模型句柄。具体实现可以提供远程连接或本地推理会话。 */
export interface ModelInstance<Runtime>
{
  readonly runtime: Runtime;
}

export interface ModelLoader<Model, Runtime = ModelConfiguration<Model>>
{
  Load(configuration: ModelConfiguration<Model>): Promise<ModelInstance<Runtime>>;

  Unload(instance: ModelInstance<Runtime>): Promise<void>;
}

/** 厂商实现以稳定 ID 登记。协议标识由宿主和引擎约定，Kernel 不枚举厂商协议。 */
export interface ModelAdapter<Model = unknown, Protocol extends string = string>
{
  readonly id: string;

  /** 按配置和引擎目标协议选择加载器；不兼容时返回 undefined。选择本身不分配运行资源。 */
  SelectLoader(configuration: ModelConfiguration<Model>, protocol: Protocol): ModelLoader<Model> | undefined;
}

/** 宿主在装配时登记厂商实现；相同 ID 重复登记应报错，避免覆盖已有实现。 */
export interface ModelAdapterRegistry<Model = unknown, Protocol extends string = string>
{
  Register(adapter: ModelAdapter<Model, Protocol>): void;

  Get(id: string): ModelAdapter<Model, Protocol> | undefined;
}

