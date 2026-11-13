import fs from 'node:fs';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {changedPaths, classifyChanges} from './ci-scope.mjs';

// 此入口只在已分类的轻量路径执行；防止误接线将产品变更当作文档放行。
const base = process.env.CBIM_CI_BASE, head = process.env.CBIM_CI_HEAD;
const files = changedPaths(base, head), scope = classifyChanges(files);
if (!['docs', 'website'].includes(scope.mode)) throw Error('Lightweight validation cannot accept product changes');
execFileSync('git', ['diff', '--check', `${base}...${head}`], {stdio:'inherit'});
for (const file of files.filter(name => name.endsWith('.md') && fs.existsSync(name))) {
  // 只核对新增正文中的本地链接，不要求一次清理历史报告中未改变的旧链接。
  const diff = execFileSync('git', ['diff', '--unified=0', `${base}...${head}`, '--', file], {encoding:'utf8', maxBuffer:8 * 1024 * 1024});
  const added = diff.split(/\r?\n/).filter(line => line.startsWith('+') && !line.startsWith('+++')).map(line => line.slice(1)).join('\n');
  for (const match of added.matchAll(/\]\(<?([^\s)>]+)>?(?:\s+"[^"]*")?\)/g)) {
    const target = match[1].split('#')[0];
    if (!target || /^[a-z][a-z\d+.-]*:/i.test(target) || target.startsWith('/')) continue;
    if (!fs.existsSync(path.resolve(path.dirname(file), decodeURIComponent(target)))) throw Error(`Missing local link in ${file}: ${target}`);
  }
}
console.log(JSON.stringify({mode:scope.mode,files:files.length,whitespace:true,addedLocalLinks:true}));
