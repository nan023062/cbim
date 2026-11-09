import fs from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {signingConfig} from './desktop-signing/config.cjs';
import {createWindowsSigner, runCommand} from './desktop-signing/windows.mjs';
import {signPayload, digest} from './desktop-signing/payload.mjs';
import {artifactHashes, verifyCandidate} from './desktop-signing/artifacts.mjs';

if (process.platform !== 'win32' || process.arch !== 'x64') throw Error('正式安装包当前只支持 Windows x64 构建');
// Fail before Forge or any output mutation when signing prerequisites are missing.
const signing = signingConfig(), signer = createWindowsSigner(signing);
const certificate = signer.preflight();
const pkg = JSON.parse(await fs.readFile('package.json', 'utf8'));
const version = process.env.CBIM_DESKTOP_VERSION || pkg.version;
if (!/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(version)) throw Error('桌面版本格式无效');
const git = args => runCommand('git', args);
if (git(['status', '--porcelain'])) throw Error('RELEASE_SOURCE_DIRTY：先提交并冻结源码，再构建签名候选');
const sourceCommit = git(['rev-parse', 'HEAD']);
const parts = new Intl.DateTimeFormat('en-GB', {timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23'}).formatToParts(new Date());
const part = key => parts.find(item => item.type === key).value;
const buildStamp = `${part('year')}${part('month')}${part('day')}-${part('hour')}${part('minute')}${part('second')}`;
const candidateId = `${buildStamp}-${randomUUID().slice(0, 8)}`;
const destination = path.resolve('build/desktop-release', version, `signed-${candidateId}`);
const buildOut = path.resolve('build', `signed-${candidateId}`);
await fs.mkdir('build', {recursive: true});
const lockPath = path.resolve('build/desktop-signing.lock');
const lock = await fs.open(lockPath, 'wx');
try {
  await lock.writeFile(JSON.stringify({pid: process.pid, sourceCommit, destination}));
  await fs.mkdir(path.dirname(destination), {recursive: true});
  await fs.mkdir(destination);
  const env = {...process.env, CBIM_DESKTOP_RELEASE: '1', CBIM_DESKTOP_VERSION: version, CBIM_BUILD_STAMP: buildStamp, CBIM_BUILD_OUT: buildOut, CBIM_DESKTOP_OUTPUT: destination};
  const run = (entry, args) => runCommand(process.execPath, [entry, ...args], {env, stdio: 'inherit', timeout: 30 * 60_000});
  run('node_modules/@electron-forge/cli/dist/electron-forge.js', ['package']);
  const info = JSON.parse(await fs.readFile(path.join(buildOut, 'build-info.json'), 'utf8'));
  const packagedDirectory = info.packageDirectories[0];
  // --prepackaged skips electron-builder's signApp; sign Forge's exact payload first.
  const payload = await signPayload(packagedDirectory, signer);
  run('node_modules/electron-builder/out/cli/cli.js', ['--win', 'nsis', '--x64', '--prepackaged', packagedDirectory, '--config', 'electron-builder.config.cjs', '--publish', 'never']);
  if (git(['rev-parse', 'HEAD']) !== sourceCommit || git(['status', '--porcelain'])) throw Error('RELEASE_SOURCE_CHANGED：构建期间源码改变，请保留本次产物并重新冻结');
  const artifacts = await artifactHashes(destination, version), resources = {};
  for (const name of ['app.asar', 'app-update.yml', 'desktop-release.json']) resources[name] = await digest(path.join(packagedDirectory, 'resources', name));
  await fs.writeFile(path.join(destination, 'SHA256SUMS.txt'), artifacts.map(a => `${a.sha256}  ${a.name}`).join('\n') + '\n', {flag: 'wx'});
  const receipt = {schema: 1, version, sourceCommit, buildStamp, buildStampTimeZone: 'Asia/Shanghai', packagedDirectory, signing: {thumbprint: signing.thumbprint, publisherName: signing.publisherName, timestampUrl: signing.timestampUrl, certificate}, payload, resources, artifacts, completedAt: new Date().toISOString()};
  await fs.writeFile(path.join(destination, 'build-receipt.json'), JSON.stringify(receipt, null, 2) + '\n', {flag: 'wx'});
  await verifyCandidate(destination, signing, signer);
  console.log(JSON.stringify({version, destination, sourceCommit, signedPayloads: payload.length, artifacts}));
} finally {
  await lock.close();
  await fs.unlink(lockPath);
}
