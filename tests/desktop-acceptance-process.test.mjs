import {it, expect, vi} from 'vitest';
import {DesktopAcceptanceProcess, ownLaunchedDesktop} from '../scripts/desktop-acceptance-process.mjs';

function fixture({actionError, exitError, disconnectError} = {}) {
  const order = [], records = [];
  let resolveExit;
  const exited = new Promise(resolve => { resolveExit = resolve; });
  const transport = {
    evaluate: vi.fn(() => 42), firstWindow: vi.fn(() => 'page'),
    quit: vi.fn(async () => { order.push('quit'); resolveExit(); if (actionError) throw actionError; }),
    disconnect: vi.fn(async () => { order.push('disconnect'); if (disconnectError) throw disconnectError; }),
  };
  const process = new DesktopAcceptanceProcess({pid: 321, transport, record: row => records.push(row),
    waitForExit: async (pid, {signal}) => {
      expect(pid).toBe(321); order.push('watch');
      await Promise.race([exited, new Promise(resolve => signal.addEventListener('abort', resolve, {once: true}))]);
      if (exitError) throw exitError;
    },
  });
  return {process, transport, order, records, resolveExit};
}

it('keeps native identity after disposal and closes once under concurrent cleanup', async () => {
  const f = fixture();
  expect(f.process.evaluate(() => {})).toBe(42);
  const one = f.process.close(), two = f.process.close();
  expect(one).toBe(two); await one;
  expect(f.process.pid).toBe(321); expect(f.process.state).toBe('closed');
  expect(f.order).toEqual(['watch','quit','disconnect']);
  expect(f.transport.quit).toHaveBeenCalledTimes(1);
  expect(f.transport.disconnect).toHaveBeenCalledTimes(1);
  expect(() => f.process.firstWindow()).toThrow(/no longer active/);
  expect(() => f.process.evaluate(() => {})).toThrow(/no longer active/);
});

it('handles a UI action that immediately disposes its old connection without reading it again', async () => {
  const f = fixture();
  await f.process.exitAfter(async () => {
    f.resolveExit();
    f.transport.evaluate.mockImplementation(() => { throw Error('disposed'); });
  }, 'install');
  expect(f.process.pid).toBe(321); expect(f.process.state).toBe('closed');
  expect(f.transport.quit).not.toHaveBeenCalled();
  expect(f.records.map(r => r.state)).toEqual(['active','stopping','closed']);
  expect(() => f.process.exitAfter(() => {}, 'again')).toThrow(/no longer active/);
});

it('releases attached debugging before waiting for an inspector-blocked native exit', async () => {
  const f = fixture();
  f.transport.disconnect.mockImplementation(async () => { f.order.push('disconnect'); f.resolveExit(); });
  await f.process.exitAfter(async () => { f.order.push('click'); }, 'resources');
  expect(f.order.indexOf('disconnect')).toBeGreaterThan(f.order.indexOf('click'));
  expect(f.process.state).toBe('closed');
});

it('preserves the original action failure, cancels the watcher, and never retries an unknown side effect', async () => {
  const f = fixture({disconnectError: Error('cleanup failure')});
  await expect(f.process.exitAfter(async () => { throw Error('click outcome unknown'); }, 'install')).rejects.toThrow('click outcome unknown');
  await expect(f.process.close()).rejects.toThrow('click outcome unknown');
  expect(f.transport.quit).not.toHaveBeenCalled();
  expect(f.transport.disconnect).toHaveBeenCalledTimes(1);
  expect(f.process.state).toBe('failed');
});

it('does not mistake a closed window or disconnected debugger for native process exit', async () => {
  const f = fixture({exitError: Error('native exit timeout')});
  await expect(f.process.close()).rejects.toThrow('native exit timeout');
  expect(f.process.state).toBe('failed');
  expect(f.transport.disconnect).toHaveBeenCalledTimes(1);
});

it('retains quit failures instead of reporting a successful cleanup', async () => {
  const f = fixture({actionError: Error('quit refused')});
  await expect(f.process.close()).rejects.toThrow('quit refused');
  await expect(f.process.close()).rejects.toThrow('quit refused');
  expect(f.transport.quit).toHaveBeenCalledTimes(1);
});

it('owns the evaluated runtime identity without consulting a launcher or accepting another executable', async () => {
  const app={evaluate:vi.fn(async()=>({pid:321,executablePath:'desktop.exe'})),
    process(){throw Error('Launcher PID must never be consulted')},close:vi.fn(),firstWindow:vi.fn()};
  const waitForExit=vi.fn();
  const owner=await ownLaunchedDesktop(app,{executablePath:'desktop.exe',waitForExit});
  await owner.close();expect(owner.pid).toBe(321);
  expect(waitForExit.mock.calls[0][0]).toBe(321);
  await expect(ownLaunchedDesktop(app,{executablePath:'other.exe',waitForExit})).rejects.toThrow(/executable mismatch/);
});
