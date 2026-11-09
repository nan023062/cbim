import path from 'node:path';
import {digest} from './payload.mjs';
import {releaseNames} from './artifacts.mjs';

/** GitHub 没有附件事务。同版本替换先完整备份，再暂时转为草稿，最后公开完整一致的附件集合。 */
export async function publishCandidate({directory, replace = false, verify, remote, record}) {
  const receipt = await verify(); // 先通过对应发行模式的真实制品检查，签名模式还必须重新验签。
  const tag = `desktop-v${receipt.version}`;
  const previous = await remote.find(tag);
  if (previous && !replace) throw Error('RELEASE_EXISTS：同版本替换必须明确使用 --replace');
  if (!previous && replace) throw Error('RELEASE_NOT_FOUND：不能把新发布当成替换');
  if (previous?.immutable) throw Error('RELEASE_IMMUTABLE：不可变 Release 不能替换，需另发更高版本');
  if (previous?.draft || previous?.prerelease) throw Error('RELEASE_INCOMPLETE：已有草稿或预发布需人工核实，不重放未知发布');
  const latest = await remote.latest();
  const source = await remote.source(receipt.sourceCommit);
  if (source !== receipt.sourceCommit) throw Error('RELEASE_SOURCE_NOT_PUSHED');
  const tagCommit = previous ? await remote.source(tag) : receipt.sourceCommit;
  await record('prepared', {tag, sourceCommit: receipt.sourceCommit, originalTagCommit: tagCommit, release: previous, latest});
  if (previous) await remote.backup(previous);
  await verify(); // Backup may take minutes; catch local changes before hiding the old release.
  if (previous && await remote.source(tag) !== tagCommit) throw Error('RELEASE_TAG_CHANGED');
  await record('draft-intent', {releaseId: previous?.id});
  const release = previous ? await remote.draft(previous) : await remote.create(tag, receipt.sourceCommit);
  if (!release.draft || release.tag_name !== tag) throw Error('RELEASE_DRAFT_REQUIRED');
  await record('draft', {releaseId: release.id});
  const [exe, blockmap, manifest] = releaseNames(receipt.version);
  const names = [exe, blockmap, 'SHA256SUMS.txt', manifest];
  const expected = new Map(receipt.artifacts.map(item => [item.name, item.sha256]));
  expected.set('SHA256SUMS.txt', await digest(path.join(directory, 'SHA256SUMS.txt')));
  for (const name of names) {
    if (await digest(path.join(directory, name)) !== expected.get(name)) throw Error('RELEASE_ARTIFACT_CHANGED');
    await record('upload-intent', {name});
    await remote.upload(tag, path.join(directory, name), Boolean(previous));
  }
  await remote.verifyAssets(release.id, directory, names);
  await verify();
  if (await remote.source(tag) !== tagCommit) throw Error('RELEASE_TAG_CHANGED');
  await record('publish-intent', {releaseId: release.id});
  const published = await remote.publish(release, receipt, tagCommit);
  if (published.draft || published.prerelease || published.tag_name !== tag || published.id !== release.id) throw Error('RELEASE_PUBLISH_RESULT_INVALID');
  await remote.verifyAssets(release.id, directory, names);
  if (await remote.latest() !== latest) throw Error('RELEASE_LATEST_CHANGED：需核实旧通道 latest，禁止自动重放发布');
  await record('published', {releaseId: release.id, url: published.html_url, sourceCommit: receipt.sourceCommit, signingMode: receipt.signing.mode || 'signed', publisherName: receipt.signing.publisherName});
  return published;
}
