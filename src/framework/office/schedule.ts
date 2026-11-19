import { AgentCallExchange } from './exchange';

/** 一个办公室调用树的在途运行和幂等记录，由直接父运行与工具调用共同标识。 */
export class OfficeSchedule<T>
{
  private readonly _attempts = new Map<string,
    {
      input: string;

      result: Promise<T>
    }>();

  private readonly _active = new Map<string,
    {
      controller: AbortController;

      done: Promise<T>;

      exchange: AgentCallExchange<T>
    }>();

  private readonly _exchanges = new Map<string, AgentCallExchange<T>>();

  private readonly _cleanup = new Map<string, () => Promise<void>>();

  public Dispatch(key: string, input: string, signal: AbortSignal, conflict: () => T, admit: () => T | undefined, exchange: AgentCallExchange<T>, execute: (signal: AbortSignal) => Promise<T>): Promise<T>
  {
    const previous = this._attempts.get(key);

    if (previous)
      return previous.input === input ? previous.result : Promise.resolve(conflict());

    const rejection = admit();

    if (rejection !== undefined)
      return Promise.resolve(rejection);

    const controller = new AbortController();

    const childSignal = AbortSignal.any([signal, controller.signal]);

    const result = exchange.Wait();

    this._attempts.set(key, { input, result });

    this._exchanges.set(key, exchange);

    const done = Promise.resolve().then(() => execute(childSignal)).then(value => { this._active.delete(key); exchange.Finish(value); return value; }, error => { this._active.delete(key); exchange.Fail(error); throw error; });

    this._active.set(key, { controller, done, exchange });

    void done.catch(() => { });

    return result;
  }

  public Exchange(key: string)
  {
    return this._exchanges.get(key);
  }

  public Cancel(key: string, reason: unknown)
  {
    this._active.get(key)?.controller.abort(reason);
  }

  public Waiting(prefix: string)
  {
    const calls = [...this._active].filter(([key]) => key.startsWith(prefix));

    return calls.length > 0 && calls.every(([, call]) => call.exchange.Waiting());
  }

  public Active(prefix: string)
  {
    return [...this._active.keys(), ...this._cleanup.keys()].some(key => key.startsWith(prefix));
  }

  public Retain(key: string, retry: () => Promise<void>)
  {
    this._cleanup.set(key, retry);
  }

  public NeedsCleanup(key: string)
  {
    return this._cleanup.has(key);
  }

  public async Stop(prefix = '')
  {
    const calls = [...this._active].filter(([key]) => key.startsWith(prefix));

    for (const [, call] of calls)
      call.controller.abort();

    await Promise.allSettled(calls.map(([, call]) => call.done));

    for (const [key, retry] of this._cleanup)
    {
      if (!key.startsWith(prefix))
        continue;

      await retry();

      this._cleanup.delete(key);
    }
  }
}
