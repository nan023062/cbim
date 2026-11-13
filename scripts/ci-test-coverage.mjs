import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';

const equalSet = (actual, expected) => {
  const left=[...actual].sort(), right=[...expected].sort();
  return left.length === right.length && new Set(left).size === left.length && left.every((name,index)=>name===right[index]);
};
const reportPath = name => {
  const normalized = name.replaceAll('\\','/'), start = normalized.lastIndexOf('/tests/');
  if (start < 0) throw Error('Unexpected test report path: ' + name);
  return ':' + normalized.slice(start + 1);
};

/** 从每片独立产物核对发现全集、分配并集和实际执行报告；不能只凭四个绿色 job 宣称全量覆盖。 */
export function verifyShardCoverage(reports) {
  if (reports.length !== 4 || !equalSet(reports.map(r=>r.plan.index),[1,2,3,4])) throw Error('Four distinct shard reports required');
  const all = reports[0].plan.allFiles;
  if (!all?.length || new Set(all).size !== all.length) throw Error('Invalid discovered test set');
  const digest = createHash('sha256').update(JSON.stringify([...all].sort())).digest('hex');
  const assigned = [];
  let passed = 0, skipped = 0;
  for (const {plan,result} of reports) {
    if (plan.count !== 4 || plan.discovered !== all.length || plan.discoveredDigest !== digest || !equalSet(plan.allFiles,all)) throw Error('Discovered test sets differ between shards');
    if (!result.success || result.numFailedTests !== 0) throw Error('Failed test report');
    if (!equalSet(result.testResults.map(file=>reportPath(file.name)),plan.files)) throw Error('Executed tests differ from assigned shard');
    assigned.push(...plan.files);
    passed += result.numPassedTests;
    skipped += result.numPendingTests;
  }
  if (!equalSet(assigned,all)) throw Error('Missing or duplicate test assignment');
  return {files:all.length,passed,skipped,failed:0,discoveredDigest:digest};
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const root = process.argv[2];
  if (!root) throw Error('Expected downloaded CI report directory');
  const reports = [1,2,3,4].map(index=>{
    const dir=path.join(root,`windows-validation-${index}`);
    return {plan:JSON.parse(fs.readFileSync(path.join(dir,`ci-shard-plan-${index}.json`),'utf8')),result:JSON.parse(fs.readFileSync(path.join(dir,'pr-full-suite.json'),'utf8'))};
  });
  const result = verifyShardCoverage(reports);
  if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, `\n完整覆盖：${result.files} 文件，${result.passed} 通过，${result.failed} 失败，${result.skipped} 跳过。分片无遗漏、无重复。\n`);
  console.log(JSON.stringify(result));
}
