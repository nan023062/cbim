/** 在独立用户目录演练正式包管理器。仅制品来源和签名身份由本地模拟库提供。 */
import assert from 'node:assert/strict';
import { generateKeyPairSync, sign } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { archiveDirectory, collectEngines, signRuntimeManifest } from './runtime-packaging';
import { officialEngineBuilders } from './package-pi-runtime.mjs';
import { EnginePackages } from '../src/logic/engines/packages';
import { packagedEngineAdapter } from '../src/logic/execution/assembly/engine-package-loader';
import { RuntimeStore } from '../src/logic/updates/service/runtime-store';
import { EngineArtifacts } from '../src/logic/updates/service/engine-artifacts';
import type { ColdRuntime, EnginePackage } from '../src/logic/updates/service/runtime-manifest';

async function main() {
  assert(process.platform === 'win32' && process.arch === 'x64');
  const parent = path.join(process.env.LOCALAPPDATA!, 'CBIM-plugin-sim');
  await fs.mkdir(parent, { recursive: true });
  const root = await fs.mkdtemp(path.join(parent, 'user-'));
  const archives = path.join(root, 'archives');
  const catalog = path.join(root, 'catalog');
  for (const builder of Object.values(officialEngineBuilders)) {
    await builder.build(path.join(catalog, builder.directory));
  }
  const packages = await collectEngines(catalog, archives);
  await simulate(root, catalog, archives, packages);
}

export async function simulate(root: string, catalog: string, archives: string, packages: EnginePackage[]) {
  const keys = generateKeyPairSync('ed25519');
  const cold: ColdRuntime = { schema: 1, codeVersion: '0.1.0', platform: 'win32-x64', coldFingerprint: '1'.repeat(64), publicKey: keys.publicKey.export({ type: 'spki', format: 'pem' }).toString() };
  const createdAt = new Date().toISOString();
  const expiresAt = new Date(Date.now() + 86400000).toISOString();
  const metadata = { createdAt, expiresAt, sourceCommit: 'a'.repeat(40), notes: '本机插件生命周期模拟' };
  const resourceDir = path.join(root, 'resource');
  await fs.mkdir(resourceDir, { recursive: true });
  for (const name of ['.vite/build/main.js', '.vite/build/preload.js', '.vite/renderer/main_window/index.html']) {
    const file = path.join(resourceDir, name);
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, name.endsWith('.html') ? '<main></main>' : '// simulation shell');
  }
  const resource = await archiveDirectory(resourceDir, archives, 'runtime-c0.1.0', 'simulation');
  const seed = await signRuntimeManifest({ ...metadata, schema: 1, platform: cold.platform, codeVersion: cold.codeVersion, resourceVersion: 1, coldFingerprint: cold.coldFingerprint, resource, engines: packages }, keys.privateKey, cold);
  const memory = packages.find(pkg => pkg.kind === 'memory')!;
  const updatedDir = path.join(root, 'memory-update');
  await fs.cp(path.join(catalog, officialEngineBuilders.memory.directory), updatedDir, { recursive: true });
  const version = memory.adapter!.version.split('.').map(Number);
  version[2]++;
  const next = version.join('.');
  const entry = 'simulation-update.cjs';
  await fs.writeFile(path.join(updatedDir, entry), "exports.engineAdapter = { ...require('./adapter.cjs').engineAdapter, version: " + JSON.stringify(next) + " };\n");
  const updated: EnginePackage = { ...memory, version: next, entry, adapter: { protocol: 1, version: next, entry }, package: await archiveDirectory(updatedDir, archives, 'runtime-engines', 'memory-simulation-update') };
  const payload = JSON.stringify({ ...metadata, schema: 1, platform: cold.platform, sequence: 1, releases: [updated], current: [{ kind: 'memory', identity: updated.package.sha256 }] });
  const index = { payload, signature: sign(null, Buffer.from(payload), keys.privateKey).toString('base64') };
  const user = path.join(root, 'user');
  await fs.mkdir(user, { recursive: true });
  await fs.writeFile(path.join(root, 'simulation-catalog.json'), JSON.stringify({ cold, seed, index }));
  function open() {
    const store = new RuntimeStore(path.join(user, 'plugins'), cold, async (pkg, file) => fs.copyFile(path.join(archives, pkg.name), file));
    const artifacts = new EngineArtifacts(path.join(user, 'index.json'), store, seed, new AbortController().signal, async () => index);
    return new EnginePackages(path.join(user, 'engines.json'), artifacts);
  }
  let engines = open();
  await engines.Init();
  for (const pkg of packages) {
    await engines.Install(pkg.kind);
    const loaded = await engines.ResolveEngine(pkg.kind);
    assert.equal(packagedEngineAdapter(pkg.kind, loaded).version, pkg.adapter!.version);
    console.log('Loaded', pkg.kind, loaded.root);
  }
  const old = await engines.ResolveEngine('memory');
  const release = old.retain!();
  await engines.Check();
  await engines.Install('memory');
  assert.equal(packagedEngineAdapter('memory', old).version, memory.adapter!.version);
  assert.equal(packagedEngineAdapter('memory', await engines.ResolveEngine('memory')).version, next);
  await assert.rejects(engines.SetEnabled('memory', false, true), /运行引用/);
  release();
  await assert.rejects(engines.SetEnabled('pi', false, true), /codex/i);
  for (const id of ['codex', 'pi', 'claude-code', 'memory']) {
    await engines.SetEnabled(id, false, true);
  }
  engines = open();
  await engines.Init();
  for (const pkg of packages) {
    await assert.rejects(engines.ResolveEngine(pkg.kind), /停用/);
    await engines.Install(pkg.kind);
    assert.equal(packagedEngineAdapter(pkg.kind, await engines.ResolveEngine(pkg.kind)).version, pkg.kind === 'memory' ? next : pkg.adapter!.version);
  }
  console.log('Verified update, removal, persisted state and reinstallation:', user);
}

if (process.argv[1]?.endsWith('engine-plugin-user-smoke.ts')) {
  main().catch(error => { console.error(error); process.exitCode = 1; });
}
