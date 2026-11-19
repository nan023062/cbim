import { afterEach, expect, test, vi } from 'vitest';
import { CbimRuntime } from '../../../../src/framework/cbim-runtime';
import { RuntimeMonitor } from '../../../../src/framework/monitor';
import type { MonitorUpdate } from '../../../../src/framework/monitor/updates';

afterEach(() => { vi.useRealTimers(); });

test('existing rows bootstrap once, then office and agent changes affect only their own rows', async () => {
  const runtime = new CbimRuntime();
  const first = runtime.OpenOffice('one', 'session');
  const existing = first.organization.Allocate();
  const monitor = new RuntimeMonitor(runtime);
  const updates: MonitorUpdate[] = [];
  const stop = monitor.WatchRows(row => updates.push(row));
  expect(updates.splice(0)).toMatchObject([
    { kind: 'office', officeId: first.id },
    { kind: 'agent', officeId: first.id, agentId: existing.id }
  ]);
  const second = runtime.OpenOffice('two', 'session');
  const agent = second.organization.Allocate();
  expect(updates.splice(0)).toMatchObject([
    { kind: 'office', officeId: second.id },
    { kind: 'agent', officeId: second.id, agentId: agent.id }
  ]);
  await runtime.CloseWorkspace('two');
  expect(updates.every(row => 'officeId' in row && row.officeId === second.id)).toBe(true);
  expect(updates.at(-1)).toEqual({ kind: 'remove-office', officeId: second.id });
  stop();
  updates.length = 0;
  await runtime.Close();
  expect(updates).toEqual([]);
});

test('only host samples repeat and sampling stops on close', () => {
  vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'performance'] });
  let cpuMicros = 0;
  const monitor = new RuntimeMonitor(new CbimRuntime(), () => ({ pid: 1, rssBytes: 1024, cpuMicros }));
  const updates: MonitorUpdate[] = [];
  monitor.WatchRows(row => updates.push(row));
  vi.advanceTimersByTime(4999);
  expect(updates).toEqual([{ kind: 'host', rssBytes: 1024, cpuPercent: undefined }]);
  cpuMicros = 1_250_000;
  vi.advanceTimersByTime(1);
  expect(updates[1]).toEqual({ kind: 'host', rssBytes: 1024, cpuPercent: 25 });
  monitor.Close();
  vi.advanceTimersByTime(10_000);
  expect(updates).toHaveLength(2);
});
