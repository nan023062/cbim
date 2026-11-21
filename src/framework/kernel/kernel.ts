/**
 * 作用定位：执行内核的静态装配类，负责配置捕获和引擎、模型句柄组合。
 * 设计原因：捕获模型配置后通过注入工厂创建资源，销毁引擎后卸载模型，避免配置漂移与资源所有权不明。
 */
import type { ModelConfiguration, ModelInstance, ModelLoader } from './models';

import type { AgentEngine, EngineAdapter } from './engines';

/** 本次实例的执行选型。已解析凭据仅供适配器使用，不写入会话记录。 */
export interface EngineDescription<Model = unknown>
{
  readonly type: string;

  readonly llm: ModelConfiguration<Model>;
}

/** 配置引用持有一次捕获的值，每次读取返回独立副本。 */
export interface EngineConfigurationRef<Model, Kind extends string = string>
{
  readonly type: Kind;

  Read(): ModelConfiguration<Model>;
}

interface AdapterModelOptions<Model>
{
  provider: string;

  model: string;

  llm?: Model;

  modelInstance: ModelInstance<ModelConfiguration<Model>>;
}

type AdapterHandle<C, I> = Omit<AgentEngine<C, I>, 'close'> &
{
  Close(): Promise<void>
};

/** 独占资源及其释放入口；关闭状态随句柄存活。 */
interface EngineResource<T>
{
  readonly session: T;

  Close(): Promise<void>;
}

function engineResource<T>(session: T, close: () => Promise<void>): EngineResource<T>
{
  let closing: Promise<void> | undefined;

  return Object.freeze({ session, Close: () => closing ??= close().catch(error => { closing = undefined; throw error; }) });
}

/** 根据捕获的配置装配引擎，资源直接交给调用方。 */
export class kernel
{
  private static readonly _configurations = new WeakSet<object>();

  private constructor()
  {
  }

  public static Capture<Model, Kind extends string>(description: EngineDescription<Model> & { type: Kind }): EngineConfigurationRef<Model, Kind>
  {
    const snapshot = structuredClone(description.llm);

    const ref = Object.freeze({ type: description.type, Read: () => structuredClone(snapshot) });

    kernel._configurations.add(ref);

    return ref;
  }

  public static Configurations<Ref, LockedRef, Profile, Model, Kind extends string>(store: { Resolve(ref: Ref): Promise<Model>; WithRuntimeConfiguration<T>(reference: LockedRef, use: (locked: { profile: Profile; Resolve(): Model }) => Promise<T>): Promise<T>; Describe(model: Model): EngineDescription<Model> & { type: Kind }; })
  {
    const capture = (model: Model) => kernel.Capture(store.Describe(model));

    return {
      Resolve: async (ref: Ref) => capture(await store.Resolve(structuredClone(ref))),
      WithConfiguration: <T>(ref: LockedRef, use: (profile: Profile, captureModel: () => EngineConfigurationRef<Model, Kind>) => Promise<T>) => store.WithRuntimeConfiguration(structuredClone(ref), locked => use(structuredClone(locked.profile), () => capture(locked.Resolve()))),
    };
  }

  public static ForRun<C, I, Options, Model, Kind extends string, Package>(host: { Models: ModelLoader<Model>; requireBeforeToolCall?: boolean; ResolvePackage?(kind: Kind): Promise<Package>; Source(kind: Kind): EngineAdapter<Options & AdapterModelOptions<Model>, AgentEngine<C, I>>; Packaged(kind: Kind, runtime: Package): EngineAdapter<Options & AdapterModelOptions<Model>, AgentEngine<C, I>>; Options(runtime?: Package): Omit<Options, keyof AdapterModelOptions<Model>>; Bind(engine: AgentEngine<C, I>, runtime?: Package): AgentEngine<C, I>; })
  {
    const createAdapter = async (ref: EngineConfigurationRef<Model, Kind>) => { if (!kernel._configurations.has(ref)) throw new Error('未知的引擎配置引用'); const model = ref.Read(); const runtime = await host.ResolvePackage?.(ref.type); if (host.ResolvePackage && runtime === undefined) throw new Error('配置的引擎包不可用'); const adapter = runtime === undefined ? host.Source(ref.type) : host.Packaged(ref.type, runtime); if (host.requireBeforeToolCall && !adapter.supportsBeforeToolCall) throw new Error('引擎包未声明执行前的工具拦截能力'); return kernel.Instantiate({ type: ref.type, llm: model }, adapter, host.Models, host.Options(runtime), engine => host.Bind(engine, runtime)); };

    return {
      BindSession: <Context, Session extends object>(open: (driver: { kind: Kind; Create(): Promise<AdapterHandle<C, I>>; Destroy(handle: AdapterHandle<C, I>): Promise<void>; }, context: Context) => Promise<{ session: Session; Close(): Promise<void> }>) => ({ Create: async (ref: EngineConfigurationRef<Model, Kind>, context: Context) => { const opened = await open({ kind: ref.type, Create: () => createAdapter(ref), Destroy: handle => handle.Close() }, context); return engineResource(opened.session, () => opened.Close()); } })
    };
  }

  private static async Instantiate<C, I, Options, Model>(description: EngineDescription<Model>, adapter: EngineAdapter<Options & AdapterModelOptions<Model>, AgentEngine<C, I>>, loader: ModelLoader<Model>, options: Omit<Options, keyof AdapterModelOptions<Model>>, bind: (engine: AgentEngine<C, I>) => AgentEngine<C, I>): Promise<AdapterHandle<C, I>>
  {
    if (adapter.id !== description.type)
      throw new Error('引擎描述与适配器身份不一致');

    const instance = await loader.Load(description.llm);

    let raw: AgentEngine<C, I> | undefined;

    let engine: AgentEngine<C, I>;

    try
    {
      const { provider, model, resolved } = instance.runtime;

      raw = adapter.create({ ...options, provider, model, llm: resolved, modelInstance: instance } as Options & AdapterModelOptions<Model>);

      if (raw.kind !== description.type)
        throw new Error('引擎描述与实例类型不一致');

      engine = bind(raw);
    }
    catch (error)
    {
      try
      {
        await raw?.close();
      }
      finally
      {
        await loader.Unload(instance);
      }

      throw error;
    }

    let disposing = false;

    const assertLive = () => { if (disposing) throw new Error('引擎实例已进入销毁阶段'); };

    const resource = engineResource(engine, async () => { disposing = true; if (!engineClosed) { await engine.close(); engineClosed = true; } await loader.Unload(instance); });

    let engineClosed = false;

    return Object.freeze({
      Close: resource.Close,
      kind: engine.kind,
      start: async (context: C) => { assertLive(); await engine.start(context); },
      run: async (message: string) => { assertLive(); return engine.run(message); },
      stop: async () => { if (!disposing) await engine.stop(); },
      ...(engine.steer ? { steer: async (message: string, images: I[], signal: AbortSignal) => { assertLive(); await engine.steer!(message, images, signal); } } : {}),
    });
  }

  public static Destroy(resource: EngineResource<unknown>): Promise<void>
  {
    return resource.Close();
  }
}
