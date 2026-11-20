import type { EngineInstance, EngineTurnResult } from '../../../framework/kernel';

import type { AgentEngine, EngineContext, EngineEvent, InputImage } from '../rules/types';

type Driver = Omit<AgentEngine, 'close'>;

interface SessionHost
{
  kind: string;

  Create(): Promise<Driver>;

  Destroy(driver: Driver): Promise<void>;
}

/** protocol=1 的进程使用单轮工具上下文；后续轮次从同一原生会话继续。 */
export async function openEngineInstance(host: SessionHost, options: { context: EngineContext; signal: AbortSignal; extensions?: readonly import('../rules/extensions').ExecutionExtension[] })
{
  const extensions = options.extensions ?? [];

  let driver: Driver | undefined;

  let sessionFile = options.context.sessionFile;

  let nativeSessionId = options.context.nativeSessionId;

  let closed = false;

  let active: string | undefined;

  let output: string | undefined;

  let ready = false;

  let used = false;

  let tail = Promise.resolve();

  const turns = new Map<string,
    {
      cancelled: boolean;

      controller: AbortController;

      stopping?: Promise<void>
    }>();

  const listeners = new Set<(id: string, event: EngineEvent) => void>();

  async function release()
  {
    if (driver)
      await host.Destroy(driver);

    driver = undefined;

    ready = false;
  }

  async function start()
  {
    driver = await host.Create();

    options.signal.throwIfAborted();

    await driver.start({ ...options.context, sessionFile, nativeSessionId, emit: async event => { if (active) event = { ...event, data: { ...event.data, turnId: active } }; await options.context.emit(event); if (event.type === 'session.bound') { if (typeof event.data.sessionId === 'string') nativeSessionId = event.data.sessionId; if (typeof event.data.sessionFile === 'string') sessionFile = event.data.sessionFile; } if (active && event.type === 'message' && typeof event.data.text === 'string' && (!event.data.role || event.data.role === 'assistant')) output = event.data.text; if (active) for (const listener of listeners) { try { listener(active, structuredClone(event)); } catch { /* 观察者不能中断已落盘事件。 */ } } } });

    options.signal.throwIfAborted();

    ready = true;
  }

  const abort = () => { void driver?.stop().catch(() => { }); };

  options.signal.addEventListener('abort', abort, { once: true });

  try
  {
    await start();
  }
  catch (error)
  {
    await release();

    throw error;
  }
  finally
  {
    options.signal.removeEventListener('abort', abort);
  }

  const session: EngineInstance<InputImage, EngineEvent> = {
    kind: host.kind,

    get supportsAppend()
    {
      return !!driver?.steer;
    },

    Submit(input, context)
    {
      if (closed)
        throw new Error('引擎会话已关闭');

      const turnId = crypto.randomUUID();

      const state:
        {
          cancelled: boolean;

          controller: AbortController;

          stopping?: Promise<void>
        } = { cancelled: false, controller: new AbortController() };

      turns.set(turnId, state);

      const done = tail.then(async (): Promise<EngineTurnResult> => { if (closed || state.cancelled) return { status: 'cancelled' }; active = turnId; output = undefined; if (used) { if (!sessionFile) throw new Error('引擎未提供可接续的原生会话'); await release(); if (closed || state.cancelled) return { status: 'cancelled' }; await start(); } if (closed || state.cancelled) return { status: 'cancelled' }; for (const extension of extensions) { const result = await extension.BeforeTurn?.({ runId: options.context.runId, turnId, input, context }, AbortSignal.any([options.signal, state.controller.signal])); if (closed || state.cancelled) return { status: 'cancelled' }; if (result && 'block' in result) return { status: 'failed', error: result.block }; if (result) context = [context, result.context].filter(Boolean).join('\n'); } used = true; const result = await driver!.run(context ? context + '\n\n' + input : input); return output === undefined ? result : { ...result, output }; }).catch((error): EngineTurnResult => { if (state.cancelled) return { status: 'cancelled' }; throw error; }).finally(async () => { try { await state.stopping; } finally { turns.delete(turnId); if (active === turnId) active = undefined; } });

      tail = done.then(() => { }, () => { });

      return { turnId, done };
    },

    async Append(id, input, images, signal)
    {
      signal.throwIfAborted();

      if (closed || active !== id || !ready || turns.get(id)?.cancelled || !driver?.steer)
        throw new Error('当前轮无法接受追加输入');

      await driver.steer(input, images, signal);
    },

    async Stop(id)
    {
      const turn = turns.get(id);

      if (!turn)
        return;

      turn.cancelled = true;

      turn.controller.abort();

      if (active === id && driver)
        await (turn.stopping ??= driver.stop());
    },

    Subscribe(listener)
    {
      listeners.add(listener);

      return () => { listeners.delete(listener); };
    },
  };

  return { session: Object.freeze(session), Close: async () => { closed = true; try { if (active) await session.Stop(active); } finally { await tail; await release(); } listeners.clear(); } };
}
