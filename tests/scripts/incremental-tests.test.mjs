import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {afterEach, expect, it} from 'vitest';
import {checkTestModules} from '../../scripts/test-modules.mjs';
import {snapshotTests, planTests, testEnvironment, fingerprint} from '../../scripts/test-fingerprints.mjs';
import {runIncrementalTests, readTestState, verifyTestReport} from '../../scripts/incremental-tests.mjs';

const temporary = [];
afterEach(() => {
  for (const root of temporary.splice(0)) {
    if (path.dirname(root) !== path.resolve(os.tmpdir()) || !path.basename(root).startsWith('cbim-incremental-')) throw Error('Unsafe fixture cleanup');
    fs.rmSync(root, {recursive: true, force: true});
  }
});

function fixture(explicit = true) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cbim-incremental-')); temporary.push(root);
  const write = (file, text) => { fs.mkdirSync(path.dirname(path.join(root, file)), {recursive: true}); fs.writeFileSync(path.join(root, file), text); };
  const catalog = {version: 1, modules: {}};
  for (const name of ['child', 'parent', 'unrelated']) {
    const directory = 'src/logic-new/' + name, file = 'tests/' + directory + '/value.test.ts';
    write(directory + '/index.ts', name === 'parent' ? "import {value} from '../child'; export const result=value;" : 'export const value=1;');
    write(file, `import * as subject from '../../../../${directory}'; export const sample=subject;`);
    catalog.modules[name] = {directory, roots: [directory + '/'], tests: {unit: [file], contract: [], integration: []}};
  }
  if (explicit) {
    write('src/logic-new/child/contract.ts', 'export interface Value { value: number }');
    catalog.modules.child.contract = {files: ['src/logic-new/child/contract.ts'], revision: 'value-v1'};
  }
  let environment = {node: 'test-node', platform: 'test'};
  const snapshot = () => {
    const report = checkTestModules(root, {catalog, files: Object.values(catalog.modules).flatMap(m => Object.values(m.tests).flat())});
    if (!report.ok) throw Error(report.errors.join('\n'));
    return snapshotTests(root, catalog, report.entries, report.dependencies, {environment});
  };
  const stateFile = path.join(root, 'state.json');
  let runs = 0;
  const execute = (args, reportFile) => {
    runs++;
    const files = args.slice(2).filter(arg => !arg.startsWith('--'));
    fs.writeFileSync(reportFile, JSON.stringify({success: true, numFailedTests: 0, numPassedTests: files.length, numPendingTests: 0,
      testResults: files.map(file => ({name: path.join(root, file), status: 'passed', assertionResults: [{status: 'passed'}]}))}));
    return {status: 0};
  };
  const run = options => runIncrementalTests(root, snapshot, {stateFile, execute, log: () => {}, ...options});
  return {root, write, catalog, snapshot, stateFile, execute, run, runs: () => runs, environment: value => { environment = value; }};
}
const passes = snapshot => Object.fromEntries(snapshot.groups.map(group => [group.key, {...group, status: 'passed'}]));
const changed = plan => plan.filter(group => group.action === 'run').map(group => group.key);

it('调度 ID 与命令展示标签变化不使缓存失效，真实运行配置仍参与环境指纹', () => {
  const before = fingerprint(testEnvironment({CODEX_TOOL_CALL_ID: 'one', npm_lifecycle_event: 'test:module', CBIM_TEST_EXE: 'release.exe'}));
  expect(fingerprint(testEnvironment({CODEX_TOOL_CALL_ID: 'two', npm_lifecycle_event: 'test:incremental', CBIM_TEST_EXE: 'release.exe'}))).toBe(before);
  expect(fingerprint(testEnvironment({CODEX_TOOL_CALL_ID: 'one', npm_lifecycle_event: 'test:module', CBIM_TEST_EXE: 'different.exe'}))).not.toBe(before);
});

it('冷启动建立模块回执，输入未变时不再启动测试进程', () => {
  const f = fixture();
  expect(f.run()).toMatchObject({ok: true, ran: 3, reused: 0});
  expect(f.run()).toMatchObject({ok: true, ran: 0, reused: 3});
  expect(f.runs()).toBe(1);
  expect(readTestState(f.stateFile).records['child:unit']).toMatchObject({status: 'passed', contract: expect.any(String), implementation: expect.any(String)});
});

it('独立契约不变的实现修改只重跑自身，真实组合契约仍验证新的实现', () => {
  const f = fixture();
  f.write('tests/src/logic-new/parent/parent-contract.test.ts', "import * as value from '../../../../src/logic-new/parent';");
  f.catalog.modules.parent.tests.contract = ['tests/src/logic-new/parent/parent-contract.test.ts'];
  const before = f.snapshot();
  f.write('src/logic-new/child/index.ts', 'export const value=2;');
  expect(changed(planTests(f.snapshot(), passes(before), {kind: 'all'}))).toEqual(['child:unit', 'parent:contract']);
});

it('契约正文或行为版本变化使消费者受影响，不触发无关模块', () => {
  for (const revision of [false, true]) {
    const f = fixture(), before = f.snapshot();
    if (revision) f.catalog.modules.child.contract.revision = 'value-v2';
    else f.write('src/logic-new/child/contract.ts', 'export interface Value { value: string }');
    expect(changed(planTests(f.snapshot(), passes(before)))).toEqual(['child:unit', 'parent:unit']);
  }
});

it('没有独立契约时不把相同类型当作相同行为，保守验证实际消费者', () => {
  const f = fixture(false), before = f.snapshot();
  f.write('src/logic-new/child/index.ts', 'export const value=2;');
  expect(changed(planTests(f.snapshot(), passes(before)))).toEqual(['child:unit', 'parent:unit']);
});

it('测试辅助、显式资源及测试集合变化分别使所属模块失效', () => {
  const f = fixture();
  f.write('tests/src/logic-new/child/helper.ts', 'export const data=1;');
  f.write('tests/src/logic-new/child/value.test.ts', "import {value} from '../../../../src/logic-new/child'; import {data} from './helper';");
  f.write('fixtures/value.json', '{"value":1}');
  f.catalog.modules.child.inputs = ['fixtures/value.json'];
  let before = f.snapshot();
  f.write('tests/src/logic-new/child/helper.ts', 'export const data=2;');
  expect(changed(planTests(f.snapshot(), passes(before)))).toEqual(['child:unit']);
  before = f.snapshot(); f.write('fixtures/value.json', '{"value":2}');
  expect(changed(planTests(f.snapshot(), passes(before)))).toEqual(['child:unit']);
  before = f.snapshot();
  f.write('tests/src/logic-new/child/new.test.ts', "import {value} from '../../../../src/logic-new/child';");
  f.catalog.modules.child.tests.unit.push('tests/src/logic-new/child/new.test.ts');
  expect(changed(planTests(f.snapshot(), passes(before)))).toEqual(['child:unit']);
});

it('环境、配置和锁文件变化不能复用旧环境的结果', () => {
  for (const file of ['vitest.config.ts', 'pnpm-lock.yaml', undefined]) {
    const f = fixture(), before = f.snapshot();
    if (file) f.write(file, file.endsWith('.ts') ? 'export default {};' : 'lockfileVersion: 9');
    else f.environment({node: 'another-node'});
    expect(changed(planTests(f.snapshot(), passes(before)))).toHaveLength(3);
  }
});

it('额外读取全仓文件不会把业务模块误判为依赖检查工具', () => {
  const f = fixture();
  f.catalog.modules.unrelated.inputs = ['src/logic-new/', 'tests/README.md'];
  f.write('tests/README.md', 'test instructions v1');
  let before = f.snapshot();
  f.write('tests/README.md', 'test instructions v2');
  expect(changed(planTests(f.snapshot(), passes(before)))).toEqual(['unrelated:unit']);
  before = f.snapshot();
  f.write('src/logic-new/child/index.ts', 'export const value=2;');
  expect(changed(planTests(f.snapshot(), passes(before)))).toEqual(['child:unit', 'unrelated:unit']);
});

it('未知模块、坏契约和丢失输入明确失败，不回退成全仓执行', () => {
  const f = fixture();
  expect(() => planTests(f.snapshot(), {}, {module: 'missing'})).toThrow('No unit tests');
  f.catalog.modules.child.contract.revision = '';
  expect(() => f.snapshot()).toThrow('behavior revision');
  delete f.catalog.modules.child.contract;
  f.catalog.modules.child.inputs = ['missing.json'];
  expect(() => f.snapshot()).toThrow();
});

it('失败和强制重跑会先撤销旧成功记录，不能回用上一次成功', () => {
  const f = fixture(); f.run();
  expect(f.run({module: 'child', force: true, execute: () => ({status: 1})}).ok).toBe(false);
  expect(readTestState(f.stateFile).records['child:unit'].status).toBe('failed');
  expect(f.run({module: 'child'})).toMatchObject({ok: true, ran: 1, reused: 0});
});

it('同批一个模块失败，其余模块的完整成功回执仍可复用', () => {
  const f = fixture();
  const result = f.run({execute: (args, reportFile) => {
    f.execute(args, reportFile);
    const report = JSON.parse(fs.readFileSync(reportFile, 'utf8'));
    report.success = false; report.numFailedTests = 1;
    report.testResults[0].status = 'failed'; report.testResults[0].assertionResults[0].status = 'failed';
    fs.writeFileSync(reportFile, JSON.stringify(report)); return {status: 1};
  }});
  expect(result.ok).toBe(false);
  expect(f.run()).toMatchObject({ok: true, ran: 1, reused: 2});
});

it('执行期间输入被修改，成功进程也不能更新为已验证', () => {
  const f = fixture();
  expect(f.run({module: 'child', execute: (args, report) => {
    const result = f.execute(args, report); f.write('src/logic-new/child/index.ts', 'export const value=3;'); return result;
  }}).ok).toBe(false);
  expect(readTestState(f.stateFile).records['child:unit'].status).toBe('stale');
});

it('残留 running、损坏回执和明确不缓存的模块都会重跑', () => {
  const f = fixture(); const snapshot = f.snapshot(), records = passes(snapshot);
  records['child:unit'].status = 'running';
  expect(changed(planTests(snapshot, records))).toEqual(['child:unit']);
  f.write('state.json', '{broken'); expect(f.run().ran).toBe(3);
  f.catalog.modules.child.cache = false;
  expect(f.run().ran).toBe(1); expect(f.run().ran).toBe(1);
});

it('集成测试不复用本地缓存，受外部状态影响的验收每次真实运行', () => {
  const f = fixture();
  f.write('tests/src/logic-new/child/child-integration.test.ts', "import * as subject from '../../../../src/logic-new/child';");
  f.catalog.modules.child.tests.integration = ['tests/src/logic-new/child/child-integration.test.ts'];
  const snapshot = f.snapshot();
  expect(changed(planTests(snapshot, passes(snapshot), {kind: 'integration'}))).toEqual(['child:integration']);
});

it('零用例、全跳过、重复或遗漏文件与异常终止均不能形成成功回执', () => {
  const root = path.resolve('fixture');
  const groups = [{files: ['tests/src/logic-new/a/a.test.ts']}];
  const file = {name: path.join(root, groups[0].files[0]), status: 'passed', assertionResults: [{status: 'passed'}]};
  const report = {success: true, numFailedTests: 0, testResults: [file]};
  expect(verifyTestReport(root, groups, report, {status: 0})).toBe(true);
  for (const changed of [[], [file, file], [{...file, assertionResults: []}], [{...file, assertionResults: [{status: 'pending'}]}]])
    expect(verifyTestReport(root, groups, {...report, testResults: changed}, {status: 0})).toBe(false);
  expect(verifyTestReport(root, groups, report, {status: 0, signal: 'SIGTERM'})).toBe(false);
});

it('同工作区的并发写入被拒绝，失败后释放锁', () => {
  const f = fixture();
  const result = f.run({execute: (args, report) => {
    expect(() => f.run()).toThrow('already running'); return f.execute(args, report);
  }});
  expect(result.ok).toBe(true); expect(f.run().ran).toBe(0);
});
