import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {afterEach, describe, expect, it, vi} from 'vitest';
import {parse, stringify} from 'yaml';
import {signingConfig, updaterConfigYaml} from '../scripts/desktop-signing/config.cjs';
import {createWindowsSigner} from '../scripts/desktop-signing/windows.mjs';
import {digest, signPayload, windowsPayloads} from '../scripts/desktop-signing/payload.mjs';
import {artifactHashes, releaseNames, verifyCandidate, verifyUpdateManifest} from '../scripts/desktop-signing/artifacts.mjs';
import {publishCandidate} from '../scripts/desktop-signing/publication.mjs';

const roots = [];
afterEach(async () => {
  for (const root of roots.splice(0)) {
    if (path.dirname(root) !== os.tmpdir() || !path.basename(root).startsWith('cbim-signing-test-')) throw Error('Invalid cleanup root');
    await fs.rm(root, {recursive: true, force: true});
  }
});
async function temp() { const root = await fs.mkdtemp(path.join(os.tmpdir(), 'cbim-signing-test-')); roots.push(root); return root; }
const config = {thumbprint: 'A'.repeat(40), publisherName: 'CBIM Test Publisher', signTool: path.resolve('SDK/signtool.exe'), store: 'CurrentUser', timestampUrl: 'http://timestamp.digicert.com'};
const goodSignature = {status: 'Valid', thumbprint: config.thumbprint, publisherName: config.publisherName, timestampThumbprint: 'B'.repeat(40)};
const env = {CBIM_SIGN_CERT_SHA1: config.thumbprint, CBIM_SIGN_PUBLISHER: config.publisherName, CBIM_SIGNTOOL_PATH: config.signTool};
const pe = () => { const bytes = Buffer.alloc(72); bytes.write('MZ'); bytes.writeUInt32LE(64, 60); bytes.write('PE\0\0', 64); return bytes; };

describe('signing policy and Windows adapter', () => {
  it('rejects missing, ambiguous, and secret-based configuration before building', () => {
    expect(() => signingConfig({})).toThrow('SIGNING_NOT_CONFIGURED');
    expect(() => signingConfig({...env, CBIM_SIGN_CERT_SHA1: 'A'})).toThrow('SIGNING_NOT_CONFIGURED');
    expect(() => signingConfig({...env, CBIM_SIGNTOOL_PATH: 'signtool.exe'})).toThrow('SIGNING_CONFIG_INVALID');
    expect(() => signingConfig({...env, CSC_LINK: 'certificate.pfx'})).toThrow('SIGNING_CONFIG_CONFLICT');
    expect(() => signingConfig({...env, CBIM_SIGN_TIMESTAMP_URL: 'https://user:pass@example.com'})).toThrow('SIGNING_CONFIG_INVALID');
    expect(signingConfig(env)).toEqual(config);
  });
  it('pins the updater publisher and escapes YAML special characters', () => {
    const publisher = 'Publisher: "Name" # Company';
    expect(parse(updaterConfigYaml('0.1.1', publisher)).publisherName).toEqual([publisher]);
    expect(() => updaterConfigYaml('0.1.1-beta', publisher)).toThrow();
  });
  it('signs with SHA-256 and RFC3161 then verifies the same exact path', () => {
    const calls = [], file = path.resolve('build/path with spaces/CBIM Desktop.exe');
    const run = (command, args) => { calls.push({command, args}); return args.includes('signature') ? JSON.stringify(goodSignature) : ''; };
    expect(createWindowsSigner(config, {run, platform: 'win32'}).sign(file)).toEqual(goodSignature);
    expect(calls[0]).toEqual({command: config.signTool, args: ['sign', '/sha1', config.thumbprint, '/s', 'My', '/fd', 'SHA256', '/tr', config.timestampUrl, '/td', 'SHA256', '/d', 'CBIM Assistant', file]});
    expect(calls[1].args).toEqual(['verify', '/pa', '/all', '/tw', file]);
    expect(calls[2].args).toContain(file);
  });
  it.each([
    {status: 'NotSigned'}, {status: 'HashMismatch'}, {thumbprint: 'C'.repeat(40)}, {publisherName: 'Other'}, {timestampThumbprint: null},
  ])('rejects bad signatures: %j', changes => {
    const run = (_, args) => args.includes('signature') ? JSON.stringify({...goodSignature, ...changes}) : '';
    expect(() => createWindowsSigner(config, {run, platform: 'win32'}).verify('app.exe')).toThrow('SIGNATURE_INVALID');
  });
  it.each([{valid: false}, {hasPrivateKey: false}, {selfSigned: true}, {publisherName: 'Other'}])('rejects unusable certificates: %j', changes => {
    const cert = {valid: true, hasPrivateKey: true, selfSigned: false, thumbprint: config.thumbprint, publisherName: config.publisherName, ...changes};
    const run = vi.fn(() => JSON.stringify(cert));
    expect(() => createWindowsSigner(config, {run, platform: 'win32'}).preflight()).toThrow('SIGNING_CERTIFICATE_INVALID');
    expect(run).toHaveBeenCalledTimes(1);
  });
  it('does not swallow SDK errors or fall back to unsigned output', () => {
    const run = () => { throw Error('SDK unavailable'); };
    expect(() => createWindowsSigner(config, {run, platform: 'win32'}).sign('app.exe')).toThrow('SDK unavailable');
    expect(() => createWindowsSigner(config, {platform: 'linux'})).toThrow('SIGNING_PLATFORM_UNSUPPORTED');
  });
});

async function candidate() {
  const root = await temp(), packagedDirectory = path.join(root, 'app'), directory = path.join(root, 'candidate');
  await fs.mkdir(path.join(packagedDirectory, 'resources'), {recursive: true}); await fs.mkdir(directory);
  const exe = path.join(packagedDirectory, 'CBIM Desktop.exe'); await fs.writeFile(exe, pe());
  const signer = {sign: vi.fn(async file => { await fs.appendFile(file, 'fake signature for unit test'); return goodSignature; }), verify: vi.fn(() => goodSignature)};
  const payload = await signPayload(packagedDirectory, signer);
  const version = '0.1.1', [name] = releaseNames(version), installer = path.join(directory, name);
  await fs.writeFile(installer, pe()); await fs.writeFile(path.join(directory, name + '.blockmap'), 'test blockmap');
  await fs.writeFile(path.join(directory, 'signed-uninstaller.exe'), pe());
  const sha512 = await digest(installer, 'sha512', 'base64'), size = (await fs.stat(installer)).size;
  await fs.writeFile(path.join(directory, 'latest.yml'), stringify({version, files: [{url: name, sha512, size}], path: name, sha512}));
  const artifacts = await artifactHashes(directory, version);
  await fs.writeFile(path.join(directory, 'SHA256SUMS.txt'), artifacts.map(a => `${a.sha256}  ${a.name}`).join('\n') + '\n');
  await fs.writeFile(path.join(packagedDirectory, 'resources/app.asar'), 'unit-test package');
  await fs.writeFile(path.join(packagedDirectory, 'resources/desktop-release.json'), JSON.stringify({version, channel: 'desktop-stable', notes: 'unit-test notes'}));
  await fs.writeFile(path.join(packagedDirectory, 'resources/app-update.yml'), updaterConfigYaml(version, config.publisherName));
  const resources = {};
  for (const name of ['app.asar', 'desktop-release.json', 'app-update.yml']) resources[name] = await digest(path.join(packagedDirectory, 'resources', name));
  const receipt = {schema: 1, version, sourceCommit: 'D'.repeat(40).toLowerCase(), signing: config, packagedDirectory, payload, resources, artifacts};
  const save = () => fs.writeFile(path.join(directory, 'build-receipt.json'), JSON.stringify(receipt)); await save();
  await fs.writeFile(path.join(directory, 'installer-signatures.jsonl'), [{name, sha256: await digest(installer)}, {name: name.replace(/exe$/, '__uninstaller.exe'), sha256: await digest(path.join(directory, 'signed-uninstaller.exe'))}].map(item => JSON.stringify(item)).join('\n') + '\n');
  return {directory, packagedDirectory, installer, signer, receipt, save, verify: () => verifyCandidate(directory, config, signer)};
}

describe('payload and release artifact gates', () => {
  it('finds Windows binaries in nested runtimes and hashes after signing', async () => {
    const root = await temp(); await fs.mkdir(path.join(root, 'runtime'));
    for (const name of ['CBIM Desktop.exe', 'runtime/addon.node', 'runtime/lib.dll']) await fs.writeFile(path.join(root, name), pe());
    await fs.writeFile(path.join(root, 'runtime/linux.node'), Buffer.from([127, 69, 76, 70]));
    const sign = vi.fn(async file => { await fs.appendFile(file, 'signed'); return goodSignature; });
    const receipts = await signPayload(root, {sign});
    expect(sign).toHaveBeenCalledTimes(3);
    for (const receipt of receipts) expect(receipt.sha256).toBe(await digest(path.join(root, receipt.file)));
    await fs.writeFile(path.join(root, 'broken.exe'), 'not PE');
    await expect(windowsPayloads(root)).rejects.toThrow('SIGNING_PAYLOAD_INVALID');
    const truncated = await temp(); await fs.writeFile(path.join(truncated, 'CBIM Desktop.exe'), pe()); await fs.writeFile(path.join(truncated, 'broken.node'), 'MZ');
    await expect(windowsPayloads(truncated)).rejects.toThrow('SIGNING_PAYLOAD_INVALID');
  });
  it('reverifies payload, installer and retained uninstaller', async () => {
    const c = await candidate(); expect(await c.verify()).toEqual(c.receipt);
    expect(c.signer.verify).toHaveBeenCalledTimes(3);
  });
  it('rejects installer changes after metadata was generated', async () => {
    const c = await candidate(); await fs.appendFile(c.installer, 'changed');
    await expect(verifyUpdateManifest(c.directory, '0.1.1')).rejects.toThrow('RELEASE_MANIFEST_INVALID');
  });
  it.each(['app.asar', 'app-update.yml'])('rejects changed packaged resource %s', async name => {
    const c = await candidate(); await fs.appendFile(path.join(c.packagedDirectory, 'resources', name), 'changed');
    await expect(c.verify()).rejects.toThrow('RELEASE_RESOURCE_CHANGED');
  });
  it('rejects a removed updater publisher even when resource hashes are refreshed', async () => {
    const c = await candidate(); const file = path.join(c.packagedDirectory, 'resources/app-update.yml');
    await fs.writeFile(file, 'provider: generic\n'); c.receipt.resources['app-update.yml'] = await digest(file); await c.save();
    await expect(c.verify()).rejects.toThrow('RELEASE_PUBLISHER_CONFIG_INVALID');
  });
  it('rejects additional unsigned payloads and altered blockmaps', async () => {
    const c = await candidate(); await fs.writeFile(path.join(c.packagedDirectory, 'extra.dll'), pe());
    await expect(c.verify()).rejects.toThrow('RELEASE_PAYLOAD_INVENTORY_CHANGED');
    const other = await candidate(); await fs.appendFile(other.installer + '.blockmap', 'changed');
    await expect(other.verify()).rejects.toThrow('RELEASE_ARTIFACT_CHANGED');
  });
  it('rejects mismatched uninstaller evidence', async () => {
    const c = await candidate(); await fs.appendFile(path.join(c.directory, 'signed-uninstaller.exe'), 'changed');
    await expect(c.verify()).rejects.toThrow('RELEASE_INSTALLER_SIGNING_EVIDENCE_INVALID');
  });
});

describe('publication workflow (fake GitHub; no external writes)', () => {
  async function publication(existing = true) {
    const c = await candidate(), events = [], tag = 'desktop-v0.1.1', release = {id: 42, tag_name: tag, draft: false, prerelease: false};
    const remote = {
      find: async () => existing ? release : undefined, latest: async () => 5, source: async () => c.receipt.sourceCommit,
      backup: async () => { events.push('backup'); },
      draft: async () => { events.push('draft'); return {...release, draft: true}; },
      create: async () => { events.push('create'); return {...release, draft: true}; },
      upload: async (_, file) => { events.push('upload:' + path.basename(file)); },
      verifyAssets: async () => { events.push('remote-verified'); },
      publish: async () => { events.push('published'); return {...release, html_url: 'https://example.invalid/release'}; },
    };
    return {c, remote, events, options: {directory: c.directory, replace: existing, verify: c.verify, remote, record: async () => {}}};
  }
  it('requires an explicit replace action for existing releases', async () => {
    const p = await publication(); await expect(publishCandidate({...p.options, replace: false})).rejects.toThrow('RELEASE_EXISTS'); expect(p.events).toEqual([]);
  });
  it('backs up before hiding a release and publishes only after all assets match', async () => {
    const p = await publication(); await publishCandidate(p.options);
    expect(p.events).toEqual(['backup', 'draft', 'upload:CBIM-Setup-0.1.1-x64.exe', 'upload:CBIM-Setup-0.1.1-x64.exe.blockmap', 'upload:SHA256SUMS.txt', 'upload:latest.yml', 'remote-verified', 'published', 'remote-verified']);
  });
  it('does not mutate GitHub when signature validation fails', async () => {
    const p = await publication(); p.c.signer.verify.mockImplementation(() => { throw Error('SIGNATURE_INVALID'); });
    await expect(publishCandidate(p.options)).rejects.toThrow('SIGNATURE_INVALID'); expect(p.events).toEqual([]);
  });
  it('does not withdraw the current release if backup fails', async () => {
    const p = await publication(); p.remote.backup = async () => { throw Error('backup failed'); };
    await expect(publishCandidate(p.options)).rejects.toThrow('backup failed'); expect(p.events).toEqual([]);
  });
  it('leaves a failed replacement draft unpublished without retrying uploads', async () => {
    const p = await publication(); const upload = vi.fn(async () => { throw Error('unknown network result'); }); p.remote.upload = upload;
    await expect(publishCandidate(p.options)).rejects.toThrow('unknown network result'); expect(upload).toHaveBeenCalledTimes(1); expect(p.events).toEqual(['backup', 'draft']);
  });
  it('refuses a remote hash mismatch before publishing', async () => {
    const p = await publication(); p.remote.verifyAssets = async () => { throw Error('remote mismatch'); };
    await expect(publishCandidate(p.options)).rejects.toThrow('remote mismatch'); expect(p.events).not.toContain('published');
  });
  it('creates a draft for a new version', async () => {
    const p = await publication(false); await publishCandidate(p.options); expect(p.events[0]).toBe('create'); expect(p.events).toContain('published');
  });
  it('refuses immutable releases without withdrawing them', async () => {
    const p = await publication(); p.remote.find = async () => ({immutable: true});
    await expect(publishCandidate(p.options)).rejects.toThrow('RELEASE_IMMUTABLE'); expect(p.events).toEqual([]);
  });
});
