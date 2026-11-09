import fs from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {signingConfig} from './desktop-signing/config.cjs';
import {createWindowsSigner, runCommand} from './desktop-signing/windows.mjs';
import {verifyCandidate, releaseNames} from './desktop-signing/artifacts.mjs';
import {digest} from './desktop-signing/payload.mjs';
import {publishCandidate} from './desktop-signing/publication.mjs';

const args = process.argv.slice(2);
if (!args[0] || args.length > 2 || (args[1] && args[1] !== '--replace')) throw Error('用法：pnpm publish:desktop <签名候选目录> [--replace]');
const directory = path.resolve(args[0]), config = signingConfig();
const signer = createWindowsSigner(config), repo = 'nan023062/cbim';
const verify = () => verifyCandidate(directory, config, signer);
// This gate runs before even reading the GitHub account, including for accidental unsigned publish attempts.
await verify();
const gh = args => runCommand('gh', args, {timeout: 20 * 60_000});
const api = endpoint => JSON.parse(gh(['api', endpoint]));
const actor = api('user').login;
if (actor !== 'nan023062' || api(`repos/${repo}`).full_name !== repo) throw Error('RELEASE_ACCOUNT_MISMATCH：请使用 nan023062 的目标仓库连接');
const journal = path.join(directory, 'publish-journal.jsonl');
let started = false;
async function record(stage, details) {
  const line = JSON.stringify({stage, actor, repo, at: new Date().toISOString(), ...details}) + '\n';
  if (!started) { await fs.writeFile(journal, line, {flag: 'wx'}); started = true; }
  else await fs.appendFile(journal, line);
}
async function patchRelease(id, data) {
  const file = path.join(directory, `github-request-${randomUUID()}.json`);
  await fs.writeFile(file, JSON.stringify(data), {flag: 'wx'});
  return JSON.parse(gh(['api', '--method', 'PATCH', `repos/${repo}/releases/${id}`, '--input', file]));
}
const remote = {
  async find(tag) {
    const pages = JSON.parse(gh(['api', '--paginate', '--slurp', `repos/${repo}/releases?per_page=100`]));
    const found = pages.flat().filter(item => item.tag_name === tag);
    if (found.length > 1) throw Error('RELEASE_DUPLICATE');
    return found[0];
  },
  async latest() { return api(`repos/${repo}/releases/latest`).id; },
  async source(ref) { return api(`repos/${repo}/commits/${encodeURIComponent(ref)}`).sha; },
  async backup(release) {
    const backup = path.join(directory, 'previous-release');
    await fs.mkdir(backup);
    await fs.writeFile(path.join(backup, 'release.json'), JSON.stringify(release, null, 2));
    for (const name of [...releaseNames(release.tag_name.slice('desktop-v'.length)), 'SHA256SUMS.txt']) {
      const asset = release.assets.find(item => item.name === name);
      if (!asset) throw Error('RELEASE_BACKUP_INCOMPLETE');
      gh(['release', 'download', release.tag_name, '--repo', repo, '--pattern', name, '--dir', backup]);
      if (asset.digest !== `sha256:${await digest(path.join(backup, name))}` || asset.size !== (await fs.stat(path.join(backup, name))).size) throw Error('RELEASE_BACKUP_HASH_MISMATCH');
    }
    await record('backup-complete', {releaseId: release.id, directory: backup});
  },
  async draft(release) {
    const current = api(`repos/${repo}/releases/${release.id}`);
    if (current.updated_at !== release.updated_at || JSON.stringify(current.assets) !== JSON.stringify(release.assets)) throw Error('RELEASE_REMOTE_CHANGED：备份期间原发布改变，停止替换');
    return patchRelease(release.id, {draft: true});
  },
  async create(tag, commit) {
    gh(['release', 'create', tag, '--repo', repo, '--target', commit, '--draft', '--latest=false', '--title', `CBIM Assistant ${tag.slice(9)}`, '--notes', '签名候选验收中']);
    return remote.find(tag);
  },
  async upload(tag, file, replace) { gh(['release', 'upload', tag, file, '--repo', repo, ...(replace ? ['--clobber'] : [])]); },
  async verifyAssets(id, root, names) {
    const release = api(`repos/${repo}/releases/${id}`);
    for (const name of names) {
      const assets = release.assets.filter(asset => asset.name === name);
      if (assets.length !== 1 || assets[0].size !== (await fs.stat(path.join(root, name))).size || assets[0].digest !== `sha256:${await digest(path.join(root, name))}`) throw Error(`RELEASE_REMOTE_HASH_MISMATCH：${name}`);
    }
  },
  async publish(release, receipt, originalTagCommit) {
    const metadata = JSON.parse(await fs.readFile(path.join(receipt.packagedDirectory, 'resources/desktop-release.json'), 'utf8'));
    const body = metadata.notes + `\n\n签名发布者：${config.publisherName}。应用、NSIS 安装器与卸载器已通过 Windows Authenticode 和时间戳校验。\n\n构建提交：${receipt.sourceCommit}；标签提交：${originalTagCommit}。\n` + (args[1] ? '\n本次为同版本签名重发；已安装同版本的用户需手动重装，自动更新仅提示更高版本。\n' : '');
    return patchRelease(release.id, {draft: false, prerelease: false, make_latest: 'false', body});
  },
};
const result = await publishCandidate({directory, replace: args[1] === '--replace', verify, remote, record});
console.log(JSON.stringify({repo, actor, id: result.id, url: result.html_url, published: true}));
