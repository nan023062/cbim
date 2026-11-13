import fs from 'node:fs';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {pathToFileURL} from 'node:url';

// 只放行明确的展示/发布记录；业务资料、配置及未知路径默认完整验证。
const document = name => name === 'README.md' || name === 'design/development-log.md' || /^design\/verification\/[^/]+\.md$/.test(name);
const website = name => /^website\/[^/]+\.(?:html|css|json)$/.test(name);
const websiteInputs = new Set(['scripts/build-website.mjs', 'scripts/build-brand-assets.mjs', 'scripts/website-smoke.mjs', 'scripts/preview-website.mjs', 'scripts/ci-website-smoke.mjs']);
const safePath = name => typeof name === 'string' && name.length > 0 && !name.includes('\\') && !name.startsWith('/') && !name.split('/').some(part => part === '..' || part === '.' || !part);

/** 接收 git diff 的所有新旧路径。空变更或无法分类的路径不能获得轻量豁免。 */
export function classifyChanges(paths) {
  const valid = paths.length > 0 && paths.every(safePath);
  const needsWebsite = paths.some(name => typeof name === 'string' && (website(name) || name.startsWith('branding/') || websiteInputs.has(name)));
  const light = valid && paths.every(name => document(name) || website(name));
  return {mode: light ? (needsWebsite ? 'website' : 'docs') : 'full', website: needsWebsite};
}

/** --name-status -z 保留空格/换行；重命名和复制必须同时纳入源路径和目标路径。 */
export function parseChangedPaths(raw) {
  const fields = raw.split('\0');
  if (fields.pop() !== '') throw Error('Incomplete git diff');
  const paths = [];
  for (let index = 0; index < fields.length;) {
    const status = fields[index++];
    const count = /^[RC]\d+$/.test(status) ? 2 : /^[AMDTUXB]$/.test(status) ? 1 : 0;
    if (!count || index + count > fields.length) throw Error('Unknown git diff record');
    for (let n = 0; n < count; n++) {
      const name = fields[index++];
      if (!name) throw Error('Missing changed path');
      paths.push(name);
    }
  }
  return [...new Set(paths)].sort();
}

export function changedPaths(base, head) {
  for (const sha of [base, head]) if (!/^[a-f0-9]{40}$/.test(sha)) throw Error('Invalid change commit');
  return parseChangedPaths(execFileSync('git', ['diff', '--name-status', '-z', '--find-renames', `${base}...${head}`], {encoding:'utf8', maxBuffer:16 * 1024 * 1024}));
}

function main() {
  const event = JSON.parse(fs.readFileSync(process.env.GITHUB_EVENT_PATH, 'utf8'));
  let result;
  if (process.env.GITHUB_EVENT_NAME === 'pull_request') {
    const base = event.pull_request.base.sha, head = event.pull_request.head.sha;
    const paths = changedPaths(base, head);
    result = {...classifyChanges(paths), base, head, paths};
  } else if (process.env.GITHUB_EVENT_NAME === 'workflow_dispatch') {
    const scope = process.env.CBIM_CI_SCOPE || 'full';
    if (!['full', 'runtime-diagnostic'].includes(scope)) throw Error('Unknown manual CI scope');
    result = {mode:scope === 'full' ? 'full' : 'diagnostic', website:scope === 'full', base:'', head:'', paths:[]};
  } else throw Error('Unsupported CI event');
  fs.appendFileSync(process.env.GITHUB_OUTPUT, Object.entries(result).filter(([key]) => key !== 'paths').map(([key, value]) => `${key}=${value}\n`).join(''));
  fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, `## 本次验证范围\n\n模式：${result.mode}；官网浏览器检查：${result.website}。\n\n${result.paths.map(name => '- ' + JSON.stringify(name)).join('\n')}\n`);
  console.log(JSON.stringify(result));
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) main();
