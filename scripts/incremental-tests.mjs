/** 本地增量测试回执：先失效旧结果，再执行精确文件集合；完整成功且输入未变化才记为可复用。 */
import fs from 'node:fs';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {createRequire} from 'node:module';
import {spawnSync} from 'node:child_process';
import {planTests} from './test-fingerprints.mjs';

export const defaultStateFile = root => path.join(root, 'test-results/module-tests/state.json');

export function readTestState(file)
{
  try
  {
    const state = JSON.parse(fs.readFileSync(file, 'utf8'));
    return state?.schema === 1 && state.records && typeof state.records === 'object' && !Array.isArray(state.records) ? state : {schema: 1, records: {}};
  }
  catch (error)
  {
    if (error.code !== 'ENOENT' && !(error instanceof SyntaxError)) throw error;
    return {schema: 1, records: {}};
  }
}

function saveState(file, state)
{
  fs.mkdirSync(path.dirname(file), {recursive: true});
  const temporary = file + '.' + randomUUID() + '.tmp';
  try { fs.writeFileSync(temporary, JSON.stringify(state, null, 2) + '\n', {flag: 'wx'}); fs.renameSync(temporary, file); }
  finally { if (fs.existsSync(temporary)) fs.unlinkSync(temporary); }
}

/** 同一工作区只允许一个缓存写入者；崩溃进程的锁可回收，但活进程不能被后来的测试覆盖。 */
function lockState(file)
{
  fs.mkdirSync(path.dirname(file), {recursive: true});
  const lock = file + '.lock';
  try { const fd = fs.openSync(lock, 'wx'); fs.writeFileSync(fd, JSON.stringify({pid: process.pid})); fs.closeSync(fd); }
  catch (error)
  {
    if (error.code !== 'EEXIST') throw error;
    const owner = JSON.parse(fs.readFileSync(lock, 'utf8'));
    if (!Number.isInteger(owner.pid) || owner.pid <= 0) throw Error('Invalid module test lock: ' + lock);
    try { process.kill(owner.pid, 0); }
    catch (probe)
    {
      if (probe.code !== 'ESRCH') throw Error('Module tests are already running');
      fs.unlinkSync(lock);
      return lockState(file);
    }
    throw Error('Module tests are already running');
  }
  return () => fs.unlinkSync(lock);
}

/** 回执必须覆盖精确选择，不能把退出码 0、零用例、全跳过或缺少文件报告当作模块通过。 */
export function verifyTestReport(root, groups, report, result)
{
  if (result.status !== 0 || result.error || result.signal || !report?.success || report.numFailedTests || report.numFailedTestSuites || report.numRuntimeErrorTestSuites)
    return false;
  const expected = groups.flatMap(group => group.files).sort();
  const actual = (report.testResults ?? []).map(item => path.relative(root, item.name).replaceAll('\\', '/')).sort();
  if (JSON.stringify(expected) !== JSON.stringify(actual)) return false;
  return report.testResults.every(item => item.status === 'passed' && item.assertionResults?.some(test => test.status === 'passed')
    && item.assertionResults.every(test => ['passed', 'pending', 'skipped', 'todo'].includes(test.status)));
}

function completedBatch(root, groups, report, result)
{
  if (![0, 1].includes(result?.status) || result.error || result.signal || !report || report.wasInterrupted
    || report.numRuntimeErrorTestSuites || report.unhandledErrors?.length) return false;
  const expected = groups.flatMap(group => group.files).sort();
  const actual = (report.testResults ?? []).map(item => path.relative(root, item.name).replaceAll('\\', '/')).sort();
  if (JSON.stringify(expected) !== JSON.stringify(actual)) return false;
  return result.status === 0 && report.success || result.status === 1 && !report.success && report.testResults.some(item => item.status === 'failed');
}

export function runIncrementalTests(root, snapshotFactory, options = {})
{
  const stateFile = options.stateFile ?? defaultStateFile(root), release = lockState(stateFile);
  try
  {
    const snapshot = snapshotFactory(), state = readTestState(stateFile);
    const plan = planTests(snapshot, state.records, options), selected = plan.filter(group => group.action === 'run');
    for (const group of plan) (options.log ?? console.log)(`${group.action === 'reuse' ? '复用' : '运行'} ${group.key} (${group.files.length})：${group.reason}`);
    if (!selected.length) return {ok: true, ran: 0, reused: plan.length, plan};
    const startedAt = new Date().toISOString(), reportFile = path.join(path.dirname(stateFile), 'runs', randomUUID() + '.json');
    fs.mkdirSync(path.dirname(reportFile), {recursive: true});
    for (const group of selected) state.records[group.key] = {...group, status: 'running', startedAt, reportFile};
    saveState(stateFile, state);
    let result, report;
    try
    {
      const require = createRequire(import.meta.url), cli = path.join(path.dirname(require.resolve('vitest/package.json')), 'vitest.mjs');
      const args = [cli, 'run', ...selected.flatMap(group => group.files), '--reporter=default', '--reporter=json', '--outputFile=' + reportFile];
      result = (options.execute ?? ((args) => spawnSync(process.execPath, args, {cwd: root, stdio: 'inherit', windowsHide: true})))(args, reportFile);
      report = JSON.parse(fs.readFileSync(reportFile, 'utf8'));
    }
    catch (error) { result = {status: 1, error}; }
    const verified = verifyTestReport(root, selected, report, result);
    const complete = completedBatch(root, selected, report, result);
    let current;
    try { current = snapshotFactory(); } catch { /* 运行过程中删除文件或损坏依赖也必须使旧结果失效。 */ }
    let ok = verified;
    for (const group of selected)
    {
      const unchanged = current?.groups.find(item => item.key === group.key)?.fingerprint === group.fingerprint;
      const files = (report?.testResults ?? []).filter(item => group.files.includes(path.relative(root, item.name).replaceAll('\\', '/')));
      const passed = complete && verifyTestReport(root, [group], {success: true, testResults: files}, {status: 0});
      const status = !unchanged ? 'stale' : passed ? 'passed' : 'failed';
      if (status !== 'passed') ok = false;
      const assertions = (report?.testResults ?? []).filter(item => group.files.includes(path.relative(root, item.name).replaceAll('\\', '/'))).flatMap(item => item.assertionResults ?? []);
      state.records[group.key] = {...group, status, startedAt, completedAt: new Date().toISOString(), reportFile,
        result: {passed: assertions.filter(item => item.status === 'passed').length, skipped: assertions.filter(item => ['pending','skipped','todo'].includes(item.status)).length, exitCode: result?.status ?? 1}};
    }
    state.modules = current?.modules ?? snapshot.modules;
    saveState(stateFile, state);
    if (!ok) (options.log ?? console.log)('本轮结果未全部取得有效成功回执；失败或运行期间变化的模块下次必须重跑。');
    return {ok, ran: selected.length, reused: plan.length - selected.length, plan};
  }
  finally { release(); }
}
