/**
 * 作用定位：按宿主登记的产品 ID 延迟创建实例，按任务获取并归还工具会话。
 * 设计原因：实例复用和任务会话分别管理，获取中途失败时归还已取得资源，避免部分占用泄漏。
 */
import type { Connector, ConnectorSession, ConnectorTaskContext } from './connector';

import { registerConnector } from './activity';

export interface ConnectorProduct<Descriptor, Result>
{
  readonly id: string;

  Create(): Connector<Descriptor, Result> | Promise<Connector<Descriptor, Result>>;
}

export class ConnectorRuntime<Descriptor, Result>
{
  private readonly _instances = new Map<string, Promise<
    {
      instance: Connector<Descriptor, Result>;

      activity: ReturnType<typeof registerConnector>
    }>>();

  private users = 0;

  private stopped = false;

  private closing?: Promise<void>;

  public constructor(private readonly _load: (id: string) => Promise<ConnectorProduct<Descriptor, Result>>)
  {
  }

  private Instance(id: string)
  {
    const existing = this._instances.get(id);

    if (existing)
      return existing;

    const pending = Promise.resolve().then(async () => { const product = await this._load(id); if (product?.id !== id || typeof product.Create !== 'function') throw new Error('连接器产品工厂与登记身份不符：' + id); const instance = await product.Create(); if (!(instance?.mode === 'exclusive' && typeof instance.Acquire === 'function' || instance?.mode === 'concurrent' && typeof instance.OpenSession === 'function')) throw new Error('连接器产品缺少有效的会话契约：' + id); return { instance, activity: registerConnector(instance.mode, id) }; }).catch(error => { this._instances.delete(id); throw error; });

    this._instances.set(id, pending);

    return pending;
  }

  public async Open(ids: readonly string[], context: ConnectorTaskContext, signal: AbortSignal)
  {
    if (this.stopped)
      throw Error('连接器运行时已关闭');

    this.users++;

    const sessions: ConnectorSession<Descriptor, Result>[] = [];

    const tracked: (() => void)[] = [];

    const identity = Object.freeze({ ...context });

    const sessionsReleased = new Set<number>();

    let releasing: Promise<void> | undefined;

    const release = async () => { const errors: unknown[] = []; for (let index = sessions.length - 1; index >= 0; index--) { if (sessionsReleased.has(index)) continue; try { await sessions[index].Release(); tracked[index](); sessionsReleased.add(index); } catch (error) { errors.push(error); } } if (errors.length) throw new AggregateError(errors, '连接器会话释放失败'); this.users--; };

    try
    {
      // 所有任务按相同顺序占用多项资源，避免相反的独占等待顺序。
      for (const id of [...new Set(ids)].sort())
      {
        signal.throwIfAborted();

        const { instance, activity } = await this.Instance(id);

        signal.throwIfAborted();

        sessions.push(await (instance.mode === 'exclusive' ? instance.Acquire(identity, signal) : instance.OpenSession(identity, signal)));

        tracked.push(activity.Open(identity));
      }

      signal.throwIfAborted();

      return { sessions: Object.freeze(sessions), Release: () => releasing ??= release().catch(error => { releasing = undefined; throw error; }) };
    }
    catch (error)
    {
      try
      {
        await release();
      }
      catch (cleanup)
      {
        throw new AggregateError([error, cleanup], '连接器会话获取和回收均失败');
      }

      throw error;
    }
  }

  public Close(): Promise<void>
  {
    if (this.users)
      return Promise.reject(Error('连接器会话仍在使用'));

    this.stopped = true;

    return this.closing ??= Promise.allSettled([...this._instances].map(async ([id, pending]) => { const { instance, activity } = await pending; await instance.Close?.(); this._instances.delete(id); activity.Close(); })).then(results => { const errors = results.filter(result => result.status === 'rejected').map(result => result.reason); if (errors.length) throw new AggregateError(errors, '连接器实例关闭失败'); }).finally(() => { this.closing = undefined; });
  }
}
