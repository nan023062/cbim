import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { expect, it } from 'vitest';
import { bindConnectorPackages } from '../../../../../src/logic/application/assembly/connector-packages';
import { managedConnectorPackages, openAgentConnectors } from '../../../../../src/logic/application/assembly/connector-packages';
import { runtimeFixture } from '../../updates/service/support/runtime-fixture';
import { collectWorldClock, archiveDirectory, collectDeclaredPlugin } from '../../../../../scripts/runtime-packaging';
import { EnginePackages } from '../../../../../src/logic/engines/packages';
import { packagedEngineAdapter } from '../../../../../src/logic/execution/assembly/engine-package-loader';
import { engineDescriptor, registerPackageEngines } from '../../../../../src/logic/engines';
import { RuntimeStore } from '../../../../../src/logic/updates/service/runtime-store';
import { EngineArtifacts } from '../../../../../src/logic/updates/service/engine-artifacts';
import { readFile } from 'node:fs/promises';

it('verifies a signed clock package, pins live sessions through upgrade and rejects changed bytes', async () => {
  const f = await runtimeFixture();
  try {
    const v1 = await collectWorldClock(f.output);
    const signal = new AbortController().signal;
    const store = new RuntimeStore(path.join(f.root, 'cache'), f.cold, f.download);
    const source = (pkg: typeof v1) => new EngineArtifacts(path.join(f.root, 'index.json'), store, f.envelope({ ...f.manifest, engines: [pkg] }), signal);
    let artifacts = source(v1);
    const clock = managedConnectorPackages(path.join(f.root, 'installed.json'), {
      List: () => artifacts.List(), Check: () => artifacts.Check(), Prepare: (...args) => artifacts.Prepare(...args)
    });
    const context = { officeId: 'o', agentInstanceId: 'a', workspaceId: 'w', taskId: 'first' };
    const first = await clock.Open('world-clock', context, signal);
    const agent = await openAgentConnectors(clock, ['world-clock'], { ...context, agentInstanceId: 'worker' }, signal);
    expect(agent.service.Has('cbim_connector_world_clock')).toBe(true);
    expect(await agent.service.Call('cbim_connector_world_clock', {instant:'2026-07-01T12:00:00Z',timeZone:'UTC'}, signal)).toMatchObject({content:[{type:'text'}]});
    await agent.Release();
    await expect(agent.service.Call('cbim_connector_world_clock', {}, signal)).rejects.toThrow();
    const args = { instant: '2026-07-01T12:00:00Z', timeZone: 'America/New_York' };
    const call = (lease: typeof first, stop = signal) => lease.sessions[0].Call('cbim_connector_world_clock', args, stop);
    expect(await call(first)).toMatchObject({ content: [{ text: expect.stringContaining('08:00:00') }] });

    const dir = await mkdtemp(path.join(f.root, 'upgrade-'));
    const code = await readFile('assets/connectors/world-clock/product.cjs', 'utf8');
    await writeFile(path.join(dir, 'product.cjs'), code.replace("'1.0.0'", "'1.1.0'").replace('text: formatter.format', "text: 'v2 ' + formatter.format"));
    const v2 = { ...v1, version: '1.1.0', adapter: { ...v1.adapter!, version: '1.1.0' }, package: await archiveDirectory(dir, f.output, 'runtime-engines', 'clock-upgrade') };
    artifacts = source(v2);
    await clock.manager.Install('world-clock');
    const next = await clock.Open('world-clock', { ...context, taskId: 'next' }, signal);
    expect(await call(next)).toMatchObject({ content: [{ text: expect.stringMatching(/^v2 /) }] });
    expect(await call(first)).toMatchObject({ content: [{ text: expect.not.stringMatching(/^v2 /) }] });
    await expect(call(first, AbortSignal.abort())).rejects.toThrow();
    await first.Release();
    await expect(call(first)).rejects.toThrow();
    expect((await clock.manager.List())[0].references).toBe(1);
    await next.Release();
    expect((await clock.manager.List())[0].references).toBe(0);
    await writeFile(path.join(store.PackageRoot(v2.package), 'product.cjs'), 'broken');
    await expect(clock.Open('world-clock', context, signal)).rejects.toThrow();
  } finally { await f.cleanup(); }
});

it('loads the selected package once and rolls back an exclusive session if another ID fails', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'cbim-connector-'));
  try {
    const entry = path.join(directory, 'product.cjs');
    await writeFile(entry, `
      let creations = 0;
      exports.connectorProduct = {
        id: 'editor',
        Create() {
          if (++creations !== 1) throw Error('duplicate instance');
          let busy = false;
          return { mode: 'exclusive', async Acquire(context) {
            if (busy) throw Error('busy');
            busy = true;
            return { List: () => [], Describe: () => ({}), Call: async () => context.taskId,
              Release: async () => { busy = false; } };
          }};
        }
      };
    `);
    const runtime = bindConnectorPackages({ entries: new Map([['editor', entry]]), Select: (_context, _agent, ids) => ids });
    const signal = new AbortController().signal;
    const open = (taskId: string, ids: string[]) => runtime.Open({ officeId: 'office', workspaceId: 'space', agentInstanceId: 'agent', taskId }, 'role', ids, signal);
    await expect(open('first', ['editor', 'missing'])).rejects.toThrow('missing');
    const second = await open('second', ['editor', 'editor']);
    expect(second.sessions).toHaveLength(1);
    await expect(open('third', ['editor'])).rejects.toThrow('busy');
    expect(await second.sessions[0].Call('tool', {}, signal)).toBe('second');
    await Promise.all([second.Release(), second.Release()]);
    await (await open('third', ['editor'])).Release();
  }
  finally {
    await rm(directory, { recursive: true, force: true });
  }
});

it('discovers two new IDs through signed declarations and loads their declared entry points', async () => {
  const f = await runtimeFixture();
  try {
    const packages = [];
    for (const type of ['connector', 'engine'] as const) {
      const id = 'test-' + type;
      const dir = await mkdtemp(path.join(f.root, id));
      const plugin = type === 'engine' ? { type, profile: 'pi', label: 'Test' } : { type };
      await writeFile(path.join(dir, 'plugin.json'), JSON.stringify({ kind: id, plugin, version: '1.0.0', entry: 'main.cjs', adapter: { entry: 'main.cjs', version: '1.0.0', protocol: 1 } }));
      const descriptor = { ...engineDescriptor('pi'), id, label: 'Test', storageDirectory: 'plugin-' + id };
      const code = type === 'engine'
        ? "exports.engineAdapter = {id:'test-engine', version:'1.0.0', protocol:1, descriptor:" + JSON.stringify(descriptor) + ",create:()=>({})}"
        : (await readFile('assets/connectors/world-clock/product.cjs','utf8')).replace("'world-clock'", "'test-connector'");
      await writeFile(path.join(dir,'main.cjs'), code);
      packages.push(await collectDeclaredPlugin(dir, f.output));
    }
    const signal = new AbortController().signal;
    const store = new RuntimeStore(path.join(f.root,'cache'), f.cold, f.download);
    const artifacts = new EngineArtifacts(path.join(f.root,'index'), store, f.envelope({ ...f.manifest, engines: packages }), signal);
    const engines = new EnginePackages(path.join(f.root,'engines'), artifacts);
    await engines.Init();
    const installed = await engines.ResolveEngine('test-engine');
    expect(packagedEngineAdapter('test-engine',installed).id).toBe('test-engine');
    const connectors = managedConnectorPackages(path.join(f.root,'connectors'), artifacts);
    expect((await connectors.manager.List()).map(item => item.kind)).toEqual(['test-connector']);
    const lease = await connectors.Open('test-connector',{officeId:'o',workspaceId:'w',agentInstanceId:'a',taskId:'t'},signal);
    expect(lease.sessions[0].List()).toHaveLength(1);
    await lease.Release();
  } finally { registerPackageEngines([]); await f.cleanup(); }
});
