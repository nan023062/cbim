import { expect, test, vi } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { runOfficePlugin } from '../../../../../src/bridge/server/desktop/office-plugin';

const fixture = vi.hoisted(() => ({ create: vi.fn(), resolve: vi.fn() }));
vi.mock('../../../../../src/logic/projects/office-engine-loader', () => ({ packagedEngineAdapter: () => ({ create: fixture.create }) }));
vi.mock('../../../../../src/logic/engines/service', () => ({ EngineModelProfiles: class { Resolve = fixture.resolve; } }));

test.each(['read', 'ask', 'execute'] as const)('桌面引擎接收 %s 权限、原生工具和 Office 工具目录', async initial => {
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
  try {
    const result = await runOfficePlugin(packages as any, {} as any, '职责', [{ role: 'user', content: '检查' }], new AbortController().signal, () => {}, {
      ReadPermission, ReportTokens: () => {}, operations: { Inspect: () => ({}), Dispatch: async () => ({}) }, selection: { engine: 'codex', profileId: 'profile', modelId: 'fixture' }, root, dataRoot: root, project: 'project', session: 'session',
    });
    const options = fixture.create.mock.lastCall![0];
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
