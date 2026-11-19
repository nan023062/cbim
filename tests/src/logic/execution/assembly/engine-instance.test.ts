import { expect, it, vi } from 'vitest';
import { openEngineInstance } from '../../../../../src/logic/execution/assembly/engine-instance';
import type { EngineContext } from '../../../../../src/logic/execution/rules/types';

it('queues turns, targets append and stop, resumes native history and delivers correlated results', async () =>
{
  const starts: EngineContext[] = [];
  let release!: () => void;
  let signalStarted!: () => void;
  const started = new Promise<void>(resolve => { signalStarted = resolve; });
  const appended = vi.fn(async () => {});
  const destroy = vi.fn(async () => {});
  const {session, Close} = await openEngineInstance({
    kind: 'test', Destroy: destroy, Create: async () => ({
      kind: 'test',
      start: async context => { starts.push(context); await context.emit({type:'session.bound',data:{sessionId:'native',sessionFile:'history'}}); },
      run: async input => {
        if (input === 'first') {
          signalStarted();
          await new Promise<void>(resolve => { release = resolve; });
          return {status:'cancelled'};
        }
        await starts.at(-1)!.emit({type:'message',data:{text:input}});
        return {status:'completed'};
      },
      steer: appended,
      stop: async () => release(),
    })
  }, {context: {emit: async () => {}} as unknown as EngineContext, signal:new AbortController().signal});
  const events = vi.fn();
  session.Subscribe(events);
  const first = session.Submit('first');
  const second = session.Submit('second','context');
  await started;
  await expect(session.Append(second.turnId,'wrong',[],new AbortController().signal)).rejects.toThrow();
  await session.Append(first.turnId,'extra',[],new AbortController().signal);
  await session.Stop(first.turnId);
  expect(await first.done).toEqual({status:'cancelled'});
  expect(await second.done).toEqual({status:'completed',output:'context\n\nsecond'});
  expect(starts[1]).toMatchObject({sessionFile:'history',nativeSessionId:'native'});
  expect(events).toHaveBeenCalledWith(second.turnId,expect.objectContaining({type:'message'}));
  await Close();
  expect(destroy).toHaveBeenCalledTimes(2);
  expect(() => session.Submit('late')).toThrow();
});

it('orders workflow context and vetoes a turn before the driver runs', async () =>
{
  const run = vi.fn(async (_input: string) => ({ status: 'completed' as const }));
  const { session, Close } = await openEngineInstance({
    kind: 'test', Create: async () => ({ kind: 'test', start: async () => {}, stop: async () => {}, run }),
    Destroy: async () => {},
  }, {
    context: { runId: 'run', emit: async () => {} } as unknown as EngineContext,
    signal: new AbortController().signal,
    extensions: [
      { id: 'workspace', BeforeTurn: async () => ({ context: 'workflow' }) },
      { id: 'review', BeforeTurn: async turn => {
        expect(turn.context).toBe('role\nworkflow');
        return turn.input === 'blocked' ? { block: 'review required' } : { context: 'reviewed' };
      } },
    ],
  });
  try {
    expect(await session.Submit('blocked', 'role').done).toEqual({ status: 'failed', error: 'review required' });
    expect(run).not.toHaveBeenCalled();
    expect(await session.Submit('work', 'role').done).toEqual({ status: 'completed' });
    expect(run).toHaveBeenCalledWith('role\nworkflow\nreviewed\n\nwork');
  } finally { await Close(); }
});