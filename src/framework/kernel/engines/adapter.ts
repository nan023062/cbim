/**
 * 作用定位：引擎适配器的身份、协议与实例工厂契约。
 * 设计原因：以固定协议和创建工厂隔离供应商实现，不依赖 SDK 包版本推测适配兼容性。
 */
export const engineAdapterProtocol = 1 as const;

/** 发布包导出唯一 engineAdapter；create 名称属于 protocol=1。版本由适配器维护，不从 SDK 版本推断。 */
export interface EngineAdapter<Options, Engine, Descriptor = unknown>
{
  readonly protocol: typeof engineAdapterProtocol;

  readonly id: string;

  readonly supportsBeforeToolCall?: boolean;

  readonly version: string;

  /** 此 E 版本编译时的能力声明；正式加载必须与 R 的选型规则匹配，不能将新规则套到旧实现。 */
  readonly descriptor?: Descriptor;

  create(options: Options): Engine;
}
