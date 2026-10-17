'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn, spawnSync } = require('node:child_process');
const { randomUUID } = require('node:crypto');
const { archive, validate, parse, recordPath, loadRecord, MAX_BYTES } = require('./task-archive.cjs');

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'task archive 中文 '));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return root;
}

function record(extra = {}) {
  return { schema_version: 1, task_id: `2026-10-18-${randomUUID()}`,
    recorded_at: '2026-10-18T10:00:00.000Z', title: '任务测试', summary: '实际结果', status: 'completed',
    modules: ['.claude/hooks'], roles: ['main'], changes: ['实现脚本'], decisions: [],
    verification: [{ status: 'passed', evidence: '本地验证' }], open_items: [], ...extra };
}

function install(root) {
  const hooks = path.join(root, '.claude', 'hooks');
  fs.mkdirSync(hooks, { recursive: true });
  const script = path.join(hooks, 'task-archive.cjs');
  fs.copyFileSync(path.join(__dirname, 'task-archive.cjs'), script);
  return script;
}

function invoke(script, input) {
  return spawnSync(process.execPath, [script], { input, encoding: 'utf8', cwd: os.tmpdir(), timeout: 5000 });
}

test('creates an immutable record; key ordering and whitespace do not affect retries', t => {
  const root = fixture(t);
  const item = record();
  assert.equal(archive(root, item).status, 'created');
  const file = path.join(root, recordPath(item.task_id));
  const before = fs.statSync(file).mtimeMs;
  const reordered = Object.fromEntries(Object.entries(item).reverse());
  assert.equal(archive(root, parse(JSON.stringify(reordered, null, 2))).status, 'unchanged');
  assert.equal(fs.statSync(file).mtimeMs, before);
  assert.deepEqual(loadRecord(root, item.task_id), validate(item));
  assert.throws(() => archive(root, { ...item, summary: 'changed' }));
  assert.equal(loadRecord(root, item.task_id).summary, item.summary);
});

test('rejects cross-month reuse and invalid schema, identifiers, dates and paths', () => {
  const item = record();
  for (const change of [
    { recorded_at: '2026-11-18T10:00:00.000Z' }, { recorded_at: '2026-02-30T00:00:00.000Z' },
    { recorded_at: '2026-10-18T10:00:00+00:00' }, { schema_version: 2 }, { status: 'planned' },
    { task_id: '../escape' }, { title: '' }, { summary: 'x'.repeat(2001) },
    { modules: [] }, { roles: 'main' }, { unknown: true }, { changes: [1] },
    { verification: [{ status: 'ok', evidence: 'test' }] }, { supersedes: item.task_id },
    { supersedes: 'invalid' }, { session_id: '' },
  ]) assert.throws(() => validate({ ...item, ...change }));
  for (const module of ['../outside', '/tmp', 'C:/temp', '//host/share', 'file:stream', 'a\\b', 'NUL', 'a/../b', 'a.']) {
    assert.throws(() => validate({ ...item, modules: [module] }));
  }
  assert.throws(() => parse(' '.repeat(MAX_BYTES + 1)));
  assert.throws(() => parse('{SECRET'));
  assert.throws(() => validate({ ...item, changes: Array(64).fill('中'.repeat(1000)) }));
});

test('partial to completed uses a new record and an existing predecessor', t => {
  const root = fixture(t);
  const first = record({ status: 'partial', open_items: ['待完成'] });
  archive(root, first);
  const next = record({ supersedes: first.task_id });
  assert.equal(archive(root, next).status, 'created');
  assert.equal(loadRecord(root, first.task_id).status, 'partial');
  assert.equal(loadRecord(root, next.task_id).supersedes, first.task_id);
  assert.throws(() => archive(root, record({ supersedes: record().task_id })));
});

test('pre-existing truncated files and directory targets are never overwritten', t => {
  const root = fixture(t);
  const item = record();
  archive(root, item);
  const file = path.join(root, recordPath(item.task_id));
  fs.writeFileSync(file, '{incomplete');
  assert.throws(() => archive(root, item));
  assert.equal(fs.readFileSync(file, 'utf8'), '{incomplete');
  const other = record();
  fs.mkdirSync(path.join(root, recordPath(other.task_id)));
  assert.throws(() => archive(root, other));
});

test('parent junction escape is rejected without writing outside', t => {
  const root = fixture(t);
  const outside = fixture(t);
  fs.mkdirSync(path.join(root, '.claude'));
  fs.symlinkSync(outside, path.join(root, '.claude', 'memory'), process.platform === 'win32' ? 'junction' : 'dir');
  assert.throws(() => archive(root, record()));
  assert.deepEqual(fs.readdirSync(outside), []);
});

test('final file symlink is rejected when the platform permits creation', t => {
  const root = fixture(t);
  const item = record();
  archive(root, item);
  const target = path.join(root, recordPath(item.task_id));
  const linkRecord = record();
  try { fs.symlinkSync(target, path.join(root, recordPath(linkRecord.task_id)), 'file'); } catch (error) {
    if (error.code === 'EPERM') { t.skip('File symlink creation requires OS privilege'); return; }
    throw error;
  }
  assert.throws(() => archive(root, linkRecord));
  assert.deepEqual(loadRecord(root, item.task_id), validate(item));
});

test('CLI resolves root from its script, handles spaces and rejects invalid or oversized input', t => {
  const root = fixture(t);
  const script = install(root);
  const item = record();
  const created = invoke(script, JSON.stringify(item));
  assert.equal(created.status, 0, created.stderr);
  assert.equal(JSON.parse(created.stdout).status, 'created');
  assert.equal(JSON.parse(invoke(script, JSON.stringify(item)).stdout).status, 'unchanged');
  for (const input of ['', '{}', '{SECRET', ' '.repeat(MAX_BYTES + 1)]) {
    const result = invoke(script, input);
    assert.equal(result.status, 1);
    assert.equal(result.stdout, '');
    assert.ok(!result.stderr.includes('SECRET'));
  }
});

test('write failure leaves evidence and does not claim success', t => {
  const root = fixture(t);
  const item = record();
  const original = fs.writeFileSync;
  fs.writeFileSync = () => { throw new Error('Simulated disk failure'); };
  try {
    assert.throws(() => archive(root, item), /Simulated disk failure/);
  } finally { fs.writeFileSync = original; }
  const file = path.join(root, recordPath(item.task_id));
  assert.equal(fs.readFileSync(file, 'utf8'), '');
  assert.throws(() => archive(root, item));
});

test('concurrent same-ID writers never overwrite one another', async t => {
  const root = fixture(t);
  const script = install(root);
  const item = record();
  const run = input => new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [script], { cwd: os.tmpdir(), stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '';
    child.stdout.on('data', data => { stdout += data; });
    child.stderr.resume();
    child.on('error', reject);
    child.on('close', code => resolve({ code, stdout }));
    child.stdin.end(JSON.stringify(input));
  });
  const results = await Promise.all([run(item), run({ ...item, summary: 'other writer' })]);
  assert.equal(results.filter(result => result.code === 0).length, 1);
  assert.equal(results.filter(result => result.code === 1).length, 1);
  const saved = loadRecord(root, item.task_id);
  assert.ok([item.summary, 'other writer'].includes(saved.summary));
  assert.equal(fs.readdirSync(path.dirname(path.join(root, recordPath(item.task_id)))).length, 1);
});
