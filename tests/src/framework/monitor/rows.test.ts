import { afterEach, expect, test, vi } from 'vitest';
import { CbimRuntime } from '../../../../src/framework/cbim-runtime';
import { RuntimeMonitor } from '../../../../src/framework/monitor';
import { ConnectorRuntime } from '../../../../src/resource/connectors';
import type { MonitorUpdate } from '../../../../src/framework/monitor/updates';

afterEach(() => { vi.useRealTimers(); });

test('monitor titles follow the owning project and Office binding even between tasks', async () => {
  const names = new Map([['p', '游戏项目'], ['q', '演示项目']]);
  const runtime = Object.assign(new CbimRuntime(), { ProjectName: (id: string) => names.get(id) });
  const monitor = new RuntimeMonitor(runtime);
  const member = { kind: 'agent' as const, id: 'planner', agentId: 'template', name: '游戏策划', position: '设计玩法', available: true, model: { engine: 'local', modelId: 'm', profileId: 'p' } };
  const factory = { parameters: 0, CreateEngine: async () => ({ session: {}, Close: async () => {} }) };
  try {
    for (const id of names.keys()) {
      const office = runtime.OpenOffice(id, 'same-session');
      office.members.SetMembers([member]);
      office.members.GetMember(member.id);
      await office.OpenMainAgent(factory);
    }
    const [first, second] = monitor.GetSnapshot().offices;
    expect(first.agents.map(a => a.name)).toEqual(['游戏项目 · 助理', '游戏项目 · 游戏策划']);
    expect(second.agents.map(a => a.name)).toEqual(['演示项目 · 助理', '演示项目 · 游戏策划']);
    expect(first.cores[0]).toMatchObject({ name: first.agents[0].name, agentId: first.agents[0].id });
    const other = runtime.OpenOffice('q', 'same-session');
    other.members.SetMembers([{ ...member, name: '关卡策划' }]);
    expect(monitor.GetSnapshot().offices[1].agents[1].name).toBe('演示项目 · 关卡策划');
    names.delete('q');
    other.members.SetMembers([]);
    expect(monitor.GetSnapshot().offices[1].agents[1].name).toBe('未知项目 · 未知 Agent');
    expect(monitor.GetSnapshot().offices[0].agents[1].name).toBe('游戏项目 · 游戏策划');
  } finally {
    monitor.Close();
    await runtime.Close();
  }
});

test('shared connector sessions contribute one peripheral load until the last release', async () => {
  const monitor = new RuntimeMonitor(new CbimRuntime());
  const connector = new ConnectorRuntime(async id => ({ id, Create: () => ({
    mode: 'concurrent' as const, OpenSession: async () => ({
      List: () => [], Call: async () => null, Describe: () => null, Release: async () => {}
    })
  }) }));
  const context = { officeId: 'office', agentInstanceId: 'agent', workspaceId: 'desk', taskId: 'task' };
  const updates: number[] = [];
  monitor.Subscribe(snapshot => updates.push(snapshot.load.total));
  const signal = new AbortController().signal;
  const [first, second] = await Promise.all([connector.Open(['clock'], context, signal), connector.Open(['clock'], context, signal)]);
  expect(monitor.GetSnapshot().peripherals[0].sessions).toHaveLength(2);
  expect(updates.at(-1)).toBe(50);
  await first.Release();
  expect(monitor.GetSnapshot().counts.connectors).toBe(1);
  await second.Release();
  expect(updates.at(-1)).toBe(50);
  expect(monitor.GetSnapshot().peripherals[0].sessions).toHaveLength(0);
  await connector.Close();
  expect(updates.at(-1)).toBe(0);
  monitor.Close();
});

test('existing rows bootstrap once, then office and agent changes affect only their own rows', async () => {
  const runtime = new CbimRuntime();
  const first = runtime.OpenOffice('one', 'session');
  const existing = first.organization.Allocate();
  const monitor = new RuntimeMonitor(runtime);
  const updates: MonitorUpdate[] = [];
  const stop = monitor.WatchRows(row => updates.push(row));
  expect(updates.splice(0)).toMatchObject([
    { kind: 'office', officeId: first.id },
    { kind: 'agent', officeId: first.id, agentId: first.mainAgentId },
    { kind: 'agent', officeId: first.id, agentId: existing.id }
  ]);
  const second = runtime.OpenOffice('two', 'session');
  const agent = second.organization.Allocate();
  expect(updates.splice(0)).toMatchObject([
    { kind: 'office', officeId: second.id },
    { kind: 'agent', officeId: second.id, agentId: second.mainAgentId },
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

test('virtual load follows allocated agents, live engines and open workspaces', async () => {
  const runtime = new CbimRuntime({ OpenWorktree: async () => ({ ResolveDirectory: async () => '.', Release: async () => {} }) });
  const monitor = new RuntimeMonitor(runtime);
  const office = runtime.OpenOffice('project', 'session');
  office.project.UpdateTree({ roots: ['desk'], nodes: { desk: { kind: 'workspace', id: 'desk', name: 'Desk', summary: '', sources: [], children: [] } } });
  const disk = await office.OpenWorkspace('desk', '.', '.');
  expect(monitor.GetSnapshot().load.total).toBe(15);
  const factory = { parameters: 0, CreateEngine: async () => ({ session: {}, Close: async () => {} }) };
  await office.OpenMainAgent(factory);
  const first = monitor.GetSnapshot();
  expect(first.load).toMatchObject({ total: 115, threshold: 1000 });
  expect(first.offices[0].cores[0].agentId).toBe(office.mainAgentId);
  await office.CloseMainEngine();
  expect(monitor.GetSnapshot().offices[0].cores).toEqual([]);
  await office.OpenMainAgent(factory);
  expect(monitor.GetSnapshot().offices[0].cores[0].id).not.toBe(first.offices[0].cores[0].id);
  await disk.Close();
  expect(monitor.GetSnapshot().load.total).toBe(110);
  await runtime.Close();
  expect(monitor.GetSnapshot().load.total).toBe(0);
});

test('failed Office close drains independent resources and remains visible until retry', async () => {
  const release = vi.fn(async () => {});
  const close = vi.fn().mockRejectedValueOnce(Error('busy')).mockResolvedValue(undefined);
  const runtime = new CbimRuntime({ OpenWorktree: async () => ({ ResolveDirectory: async () => '.', Release: release }) });
  const office = runtime.OpenOffice('p','s');
  office.project.UpdateTree({ roots:['desk'], nodes:{desk:{kind:'workspace',id:'desk',name:'Desk',summary:'',sources:[],children:[]}} });
  await office.OpenWorkspace('desk','.','.');
  await office.OpenMainAgent({ parameters: 0, CreateEngine: async () => ({session:{}, Close: close}) });
  const closed = vi.fn();
  office.Subscribe(event => { if (event.type === 'closed') closed(); });
  const first = office.Close();
  expect(office.Close()).toBe(first);
  await expect(first).rejects.toThrow();
  expect(runtime.FindOffice(office.id)).toBe(office);
  expect(release).toHaveBeenCalledTimes(1);
  expect(closed).not.toHaveBeenCalled();
  await office.Close();
  expect(close).toHaveBeenCalledTimes(2);
  expect(release).toHaveBeenCalledTimes(1);
  expect(closed).toHaveBeenCalledTimes(1);
  expect(runtime.FindOffice(office.id)).toBeUndefined();
});
