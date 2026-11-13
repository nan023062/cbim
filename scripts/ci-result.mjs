import fs from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';

/** 固定汇总入口只接受本次选中的检查成功；失败、取消、意外跳过均不能变绿。 */
export function assertCiResults(mode, results) {
  if (!['full', 'diagnostic', 'docs', 'website'].includes(mode)) throw Error('Unknown validation mode');
  const full = mode === 'full' || mode === 'diagnostic';
  const expected = {scope:'success', static:full ? 'success' : 'skipped', windows:full ? 'success' : 'skipped', light:full ? 'skipped' : 'success'};
  for (const [job, result] of Object.entries(expected)) {
    if (results[job]?.result !== result) throw Error(`${job}: expected ${result}, received ${results[job]?.result ?? 'missing'}`);
  }
  return expected;
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const results = JSON.parse(process.env.CBIM_CI_NEEDS);
  const mode = results.scope?.outputs?.mode;
  const checked = assertCiResults(mode, results);
  fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, `## 验证结果\n\n${mode} 路径通过。\n\n${Object.entries(checked).map(([job,result])=>`- ${job}: ${result}`).join('\n')}\n`);
  console.log(JSON.stringify({mode,checked}));
}
