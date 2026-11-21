import { expect, test, vi } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { runOfficePlugin } from '../../../../../src/bridge/server/desktop/office-plugin';

const fixture = vi.hoisted(() => ({ create: vi.fn(), resolve: vi.fn(), load: vi.fn() }));
vi.mock('../../../../../src/logic/projects/office-engine-loader', () => ({ packagedEngineAdapter: (id: string, runtime: unknown) => { fixture.load(id, runtime); return { create: fixture.create }; } }));
vi.mock('../../../../../src/logic/engines/service', () => ({ EngineModelProfiles: class { Resolve = fixture.resolve; } }));

test.each([['read', false], ['ask', false], ['execute', false], ['read', true], ['ask', true], ['execute', true]] as const)('桌面引擎接收 %s 权限、原生工具和 Office 工具目录', async (initial, development) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'office-engine-permission-'));
  let permission: 'read' | 'ask' | 'execute' = initial;
  const ReadPermission = () => permission;
  let context: any;
  const release = vi.fn();
  fixture.resolve.mockResolvedValue({ profile: { id: 'profile', model: 'fixture', contextWindow: 8192 } });
  fixture.create.mockImplementation(() => ({
    start: async (value: unknown) => { context = value; },
    run: async () => { await context.emit({ type: 'message', data: { role: 'assistant', text: '收到' } }); return { status: 'completed' }; },
    close: async () => {}, stop: async () => {},
  }));
  const packages = {
    Check: async () => {},
    List: async () => [{ kind: 'codex', enabled: true, active: { identity: 'version' }, candidate: { identity: 'version' } }],
    ResolveEngine: async () => ({ identity: 'version', retain: () => release }),
  };
  const developmentRoot = path.join(root, 'local-adapters');
  if (development) { await fs.mkdir(path.join(developmentRoot, 'codex'), {recursive:true}); await fs.writeFile(path.join(developmentRoot, 'codex', 'adapter.json'), JSON.stringify({id:'codex',version:'1.1.1',protocol:1,entry:'adapter.cjs'})); }
  try {
    const result = await runOfficePlugin(packages as any, {} as any, '职责', [{ role: 'user', content: '检查' }], new AbortController().signal, () => {}, {
      ReadPermission, ReportTokens: () => {}, operations: { Inspect: () => ({}), Dispatch: async () => ({}) }, selection: { engine: 'codex', profileId: 'profile', modelId: 'fixture' }, root, dataRoot: root, project: 'project', session: 'session',
    }, undefined, undefined, development ? developmentRoot : undefined);
    if (development) expect(fixture.load.mock.lastCall![1]).toMatchObject({root:path.join(developmentRoot,'codex'),adapter:{entry:path.join(developmentRoot,'codex','adapter.cjs')}});
    else expect(fixture.load.mock.lastCall![1]).not.toHaveProperty('adapter');
    const options = fixture.create.mock.lastCall![0];
    expect(options.runtime.identity).toBe('version');
    expect(options.ReadPermission).toBe(ReadPermission);
    expect(options.allowNativeExecution).toBe(initial !== 'read');
    permission = initial === 'read' ? 'execute' : 'read';
    expect(options.ReadPermission()).toBe(permission);
    expect((await options.knowledge.list()).map((tool: any) => tool.name)).toEqual(['cbim_office_inspect', 'cbim_office_dispatch']);
    expect(context.capabilities).toEqual([]);
    permission = 'read';
    expect(await context.beforeTool({ id: 'call', name: 'write', input: { path: 'file.txt', content: 'test' } })).toMatchObject({ allow: false });
    permission = 'execute';
    expect(await context.beforeTool({ id: 'next', name: 'write', input: { path: 'file.txt', content: 'test' } })).toMatchObject({ allow: true });
    expect(result.text).toBe('收到');
    expect(release).toHaveBeenCalledOnce();
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
