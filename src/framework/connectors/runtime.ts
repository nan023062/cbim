/** 按宿主登记的产品 ID 延迟创建实例，按任务获取并归还工具会话。 */
import type { Connector, ConnectorSession, ConnectorTaskContext } from './connector';

export interface ConnectorProduct<Descriptor, Result>
{
  readonly id: string;

  Create(): Connector<Descriptor, Result> | Promise<Connector<Descriptor, Result>>;
}

export class ConnectorRuntime<Descriptor, Result>
{
  private readonly _instances = new Map<string, Promise<Connector<Descriptor, Result>>>();

  public constructor(private readonly _load: (id: string) => Promise<ConnectorProduct<Descriptor, Result>>)
  {
  }

  private Instance(id: string)
  {
    const existing = this._instances.get(id);
    if (existing)
      return existing;

    const pending = Promise.resolve().then(async () => {
      const product = await this._load(id);
      if (product?.id !== id || typeof product.Create !== 'function')
        throw new Error('连接器产品工厂与登记身份不符：' + id);

      const instance = await product.Create();
      if (!(instance?.mode === 'exclusive' && typeof instance.Acquire === 'function'
        || instance?.mode === 'concurrent' && typeof instance.OpenSession === 'function'))
        throw new Error('连接器产品缺少有效的会话契约：' + id);

      return instance;
    }).catch(error => {
      this._instances.delete(id);
      throw error;
    });
    this._instances.set(id, pending);
    return pending;
  }

  public async Open(ids: readonly string[], context: ConnectorTaskContext, signal: AbortSignal)
  {
    const sessions: ConnectorSession<Descriptor, Result>[] = [];
    const identity = Object.freeze({ ...context });
    let releasing: Promise<void> | undefined;
    const release = async () => {
      const errors: unknown[] = [];
      for (const session of [...sessions].reverse())
      {
        try { await session.Release(); }
        catch (error) { errors.push(error); }
      }
      if (errors.length)
        throw new AggregateError(errors, '连接器会话释放失败');
    };
    try
    {
      // 所有任务按相同顺序占用多项资源，避免相反的独占等待顺序。
      for (const id of [...new Set(ids)].sort())
      {
        signal.throwIfAborted();
        const instance = await this.Instance(id);
        signal.throwIfAborted();
        sessions.push(await (instance.mode === 'exclusive' ? instance.Acquire(identity, signal) : instance.OpenSession(identity, signal)));
      }
      signal.throwIfAborted();
      return { sessions: Object.freeze(sessions), Release: () => releasing ??= release() };
    }
    catch (error)
    {
      try { await release(); }
      catch (cleanup) { throw new AggregateError([error, cleanup], '连接器会话获取和回收均失败'); }
      throw error;
    }
  }
}
