import fs from 'node:fs/promises';
import path from 'node:path';
import {parse} from 'yaml';
import {digest, windowsPayloads} from './payload.mjs';
import {updaterCacheDirName} from './config.cjs';

export function releaseNames(version) {
  if (!/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(version)) throw Error('RELEASE_VERSION_INVALID');
  return [`CBIM-Setup-${version}-x64.exe`, `CBIM-Setup-${version}-x64.exe.blockmap`, 'latest.yml'];
}

export async function artifactHashes(directory, version) {
  return Promise.all(releaseNames(version).map(async name => ({name, size: (await fs.stat(path.join(directory, name))).size, sha256: await digest(path.join(directory, name))})));
}

export async function verifyUpdateManifest(directory, version) {
  const [name] = releaseNames(version), exe = path.join(directory, name);
  const manifest = parse(await fs.readFile(path.join(directory, 'latest.yml'), 'utf8'));
  const sha512 = await digest(exe, 'sha512', 'base64'), size = (await fs.stat(exe)).size;
  if (manifest?.version !== version || manifest.path !== name || manifest.sha512 !== sha512 || manifest.files?.length !== 1 || manifest.files[0].url !== name || manifest.files[0].sha512 !== sha512 || manifest.files[0].size !== size || manifest.packages) {
    throw Error('RELEASE_MANIFEST_INVALID：更新清单必须引用最终安装包的版本、大小和 SHA-512');
  }
}

/** 默认重新验签；未签名发行必须显式选择且匹配回执。两种模式都重核真实制品和更新清单。 */
export async function verifyCandidate(directory, config, signer, {unsigned = false} = {}) {
  const receipt = JSON.parse(await fs.readFile(path.join(directory, 'build-receipt.json'), 'utf8'));
  const identityValid = unsigned
    ? receipt.signing?.mode === 'unsigned' && !receipt.signing.thumbprint && !receipt.signing.publisherName
    : config && signer && receipt.signing?.mode !== 'unsigned' && receipt.signing?.thumbprint === config.thumbprint && receipt.signing?.publisherName === config.publisherName;
  if (receipt.schema !== 1 || !identityValid || !/^[a-f0-9]{40}$/.test(receipt.sourceCommit || '')) throw Error('RELEASE_RECEIPT_INVALID');
  const names = releaseNames(receipt.version);
  await verifyUpdateManifest(directory, receipt.version);
  const artifacts = await artifactHashes(directory, receipt.version);
  if (JSON.stringify(artifacts) !== JSON.stringify(receipt.artifacts)) throw Error('RELEASE_ARTIFACT_CHANGED');
  const sums = artifacts.map(a => `${a.sha256}  ${a.name}`).join('\n') + '\n';
  if (await fs.readFile(path.join(directory, 'SHA256SUMS.txt'), 'utf8') !== sums) throw Error('RELEASE_CHECKSUMS_INVALID');
  const packagedDirectory = receipt.packagedDirectory;
  const payloads = await windowsPayloads(packagedDirectory);
  const files = payloads.map(file => path.relative(packagedDirectory, file).replaceAll('\\', '/'));
  if (JSON.stringify(files) !== JSON.stringify(receipt.payload?.map(item => item.file))) throw Error('RELEASE_PAYLOAD_INVENTORY_CHANGED');
  for (let i = 0; i < payloads.length; i++) {
    if (await digest(payloads[i]) !== receipt.payload[i].sha256) throw Error('RELEASE_PAYLOAD_CHANGED');
    if (!unsigned) await signer.verify(payloads[i]);
  }
  for (const name of ['app.asar', 'app-update.yml', 'desktop-release.json']) {
    if (await digest(path.join(packagedDirectory, 'resources', name)) !== receipt.resources?.[name]) throw Error('RELEASE_RESOURCE_CHANGED');
  }
  const updateConfig = parse(await fs.readFile(path.join(packagedDirectory, 'resources/app-update.yml'), 'utf8'));
  const publisherValid = unsigned ? updateConfig.publisherName === undefined : JSON.stringify(updateConfig.publisherName) === JSON.stringify([config.publisherName]);
  if (!publisherValid || updateConfig.provider !== 'generic' || updateConfig.updaterCacheDirName !== updaterCacheDirName || updateConfig.url !== `https://github.com/nan023062/cbim/releases/download/desktop-v${receipt.version}/`) throw Error('RELEASE_PUBLISHER_CONFIG_INVALID');
  const metadata = JSON.parse(await fs.readFile(path.join(packagedDirectory, 'resources/desktop-release.json'), 'utf8'));
  if (metadata.version !== receipt.version || metadata.channel !== 'desktop-stable' || typeof metadata.notes !== 'string' || !metadata.notes.trim()) throw Error('RELEASE_METADATA_INVALID');
  if (unsigned ? metadata.signingMode !== 'unsigned' : metadata.signingMode === 'unsigned') throw Error('RELEASE_SIGNING_MODE_MISMATCH');
  if (unsigned) return receipt;
  const hook = (await fs.readFile(path.join(directory, 'installer-signatures.jsonl'), 'utf8')).trim().split('\n').map(line => JSON.parse(line));
  for (const [file, hookName] of [[names[0], names[0]], ['signed-uninstaller.exe', names[0].replace(/exe$/, '__uninstaller.exe')]]) {
    const matches = hook.filter(item => item.name === hookName);
    if (matches.length !== 1 || matches[0].sha256 !== await digest(path.join(directory, file))) throw Error('RELEASE_INSTALLER_SIGNING_EVIDENCE_INVALID');
    await signer.verify(path.join(directory, file));
  }
  return receipt;
}
