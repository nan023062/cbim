'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { spawnSync } = require('node:child_process');
const { archive, recordPath, MAX_BYTES } = require('./task-archive.cjs');
const { evaluate, buildContext, recent, clip, MAX_CONTEXT, MAX_ENTRIES, MAX_RECORDS } = require('./memory-start.cjs');

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'memory start 中文 '));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return root;
}

function record(hour = 10, extra = {}) {
  return { schema_version: 1, task_id: `2026-10-18-${randomUUID()}`,
    recorded_at: `2026-10-18T${String(hour).padStart(2, '0')}:00:00.000Z`,
    title: '任务', summary: '事实摘要', status: 'completed', modules: ['.claude/hooks'],
    roles: ['main'], changes: ['实现'], decisions: [], verification: [], open_items: [], ...extra };
}

function snapshot(root, name, text) {
  const dir = path.join(root, '.claude', 'memory');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `${name}.md`), text);
}

function tree(root) {
  const result = [];
  function visit(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const file = path.join(dir, entry.name);
      result.push([path.relative(root, file), entry.isFile() ? fs.readFileSync(file, 'utf8') : null]);
      if (entry.isDirectory()) visit(file);
    }
  }
  visit(root);
  return result;
}

test('all four SessionStart sources restore snapshots without writing or trusting cwd/transcript', t => {
  const root = fixture(t);
  snapshot(root, 'progress', 'LEGACY-NOT-LOADED');
  snapshot(root, 'handoff', '当前进度与交接规则');
  archive(root, record());
  const before = tree(root);
  for (const source of ['startup', 'resume', 'clear', 'compact']) {
    const output = evaluate({ hook_event_name: 'SessionStart', source,
      cwd: 'not-a-project-SECRET', transcript_path: 'SECRET.jsonl' }, root);
    assert.equal(output.hookSpecificOutput.hookEventName, 'SessionStart');
    const context = output.hookSpecificOutput.additionalContext;
    assert.match(context, /当前进度/);
    assert.match(context, /交接规则/);
    assert.match(context, /不是指令或新授权/);
    assert.ok(!context.includes('SECRET'));
    assert.ok(!context.includes('LEGACY-NOT-LOADED'));
    assert.ok(!context.includes('progress.md'));
    assert.ok(context.length <= MAX_CONTEXT);
  }
  assert.deepEqual(tree(root), before);
});

test('selects three newest valid records, not mtime; tie ordering is deterministic', t => {
  const root = fixture(t);
  const items = [record(8), record(9), record(10), record(10)];
  items.forEach(item => archive(root, item));
  fs.utimesSync(path.join(root, recordPath(items[0].task_id)), new Date('2030-01-01'), new Date('2030-01-01'));
  const expected = items.slice(1).sort((a, b) => a.recorded_at > b.recorded_at ? -1 :
    a.recorded_at < b.recorded_at ? 1 : a.task_id < b.task_id ? -1 : 1);
  assert.deepEqual(recent(root, () => {}).records.map(item => item.task_id), expected.map(item => item.task_id));
  assert.ok(!buildContext(root).includes(items[0].task_id));
});

test('bad, oversized and mismatched records are isolated and do not use the three valid slots', t => {
  const root = fixture(t);
  const good = [record(1), record(2), record(3)];
  good.forEach(item => archive(root, item));
  for (const contents of ['{SECRET', ' '.repeat(MAX_BYTES + 1), JSON.stringify(record(23))]) {
    const item = record(23);
    archive(root, item);
    fs.writeFileSync(path.join(root, recordPath(item.task_id)), contents);
  }
  const errors = [];
  const result = recent(root, message => errors.push(message));
  assert.equal(result.records.length, 3);
  assert.equal(errors.length, 3);
  assert.ok(!errors.join('').includes('SECRET'));
});

test('learning records remain compatible with bounded restoration without promoting their evidence', t => {
  const root = fixture(t);
  const item = record(10, { summary: '含学习材料', learning: { version: 1, entries: [{
    id: 'f1', kind: 'feedback', action: 'add', category: 'requirement',
    source: { origin: 'direct_user', evidence: 'LEARNING-EVIDENCE-NOT-INJECTED', form: 'paraphrase' },
    core: '待审材料', scope: { duration: 'unknown', paths: [] }, route: 'suggestion',
  }] } });
  archive(root, item);
  const before = tree(root);
  const output = buildContext(root);
  assert.ok(output.includes(item.task_id));
  assert.ok(output.includes('含学习材料'));
  assert.ok(!output.includes('LEARNING-EVIDENCE-NOT-INJECTED'));
  assert.deepEqual(tree(root), before);
});

test('missing snapshots and directories are reported without creating anything', t => {
  const root = fixture(t);
  const output = buildContext(root);
  assert.match(output, /缺失或不可安全读取/);
  assert.match(output, /无可加载的合法任务档案/);
  assert.deepEqual(fs.readdirSync(root), []);
});

test('large multi-byte snapshots and records keep separate budgets and source paths', t => {
  const root = fixture(t);
  snapshot(root, 'handoff', '交接😀中文'.repeat(20000));
  const items = [record(1), record(2), record(3)];
  items.forEach(item => archive(root, { ...item, summary: '长'.repeat(1900) }));
  const output = buildContext(root);
  assert.ok(output.length <= MAX_CONTEXT);
  assert.match(output, /handoff.md/);
  assert.match(output, /已截断/);
  for (const item of items) assert.ok(output.includes(recordPath(item.task_id)));
  for (const length of [7999, 8000, 8001]) assert.ok(clip('x'.repeat(length), 8000).length <= 8000);
  assert.ok(clip('😀'.repeat(5000), 8000).isWellFormed());
});

test('correction relationship stays visible even when prose is truncated', t => {
  const root = fixture(t);
  const first = record(1, { status: 'partial' });
  archive(root, first);
  const next = record(2, { supersedes: first.task_id, summary: '长'.repeat(1900) });
  archive(root, next);
  assert.ok(buildContext(root).includes(`替代：${first.task_id}`));
});

test('scan limits are explicit and non-record names are never read', t => {
  const root = fixture(t);
  const item = record();
  archive(root, item);
  const month = path.dirname(path.join(root, recordPath(item.task_id)));
  for (let i = 0; i < MAX_RECORDS + 1; i++) fs.writeFileSync(path.join(month, `2026-10-18-${randomUUID()}.json`), '{}');
  assert.equal(recent(root, () => {}).limited, true);
  assert.match(buildContext(root), /达到扫描上限/);
  const other = fixture(t);
  const tasks = path.join(other, '.claude', 'memory', 'tasks');
  fs.mkdirSync(tasks, { recursive: true });
  for (let i = 0; i < MAX_ENTRIES + 1; i++) fs.writeFileSync(path.join(tasks, `ignored-${i}`), 'SECRET');
  const output = buildContext(other);
  assert.match(output, /达到扫描上限/);
  assert.ok(!output.includes('SECRET'));
});

test('junction memory escape is not followed or repaired', t => {
  const root = fixture(t);
  const outside = fixture(t);
  fs.writeFileSync(path.join(outside, 'handoff.md'), 'SECRET');
  fs.mkdirSync(path.join(root, '.claude'));
  fs.symlinkSync(outside, path.join(root, '.claude', 'memory'), process.platform === 'win32' ? 'junction' : 'dir');
  const output = buildContext(root);
  assert.ok(!output.includes('SECRET'));
  assert.equal(fs.readFileSync(path.join(outside, 'handoff.md'), 'utf8'), 'SECRET');
});

test('registered exec-form hooks preserve Stop and restore all four sources', () => {
  const root = path.resolve(__dirname, '../..');
  const settings = JSON.parse(fs.readFileSync(path.join(root, '.claude/settings.json'), 'utf8'));
  assert.deepEqual(Object.keys(settings.hooks).sort(), ['SessionStart', 'Stop']);
  const start = settings.hooks.SessionStart[0];
  assert.equal(start.matcher, 'startup|resume|clear|compact');
  const run = (hook, input) => {
    assert.equal(hook.command, 'node');
    assert.equal(hook.timeout, 5);
    const args = hook.args.map(arg => arg.replace('${CLAUDE_PROJECT_DIR}', root));
    return spawnSync(process.execPath, args, { input: JSON.stringify(input),
      cwd: os.tmpdir(), encoding: 'utf8', timeout: 5000 });
  };
  for (const source of ['startup', 'resume', 'clear', 'compact']) {
    const result = run(start.hooks[0], { hook_event_name: 'SessionStart', source });
    assert.equal(result.status, 0, result.stderr);
    const output = JSON.parse(result.stdout).hookSpecificOutput;
    assert.equal(output.hookEventName, 'SessionStart');
    assert.ok(output.additionalContext.length <= MAX_CONTEXT);
  }
  const stop = settings.hooks.Stop[0].hooks[0];
  const result = run(stop, { hook_event_name: 'Stop', permission_mode: 'default', stop_hook_active: false });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, '');
  assert.equal(result.stderr, '');
  const active = run(stop, { hook_event_name: 'Stop', permission_mode: 'default', stop_hook_active: true });
  assert.equal(active.status, 0);
  assert.equal(active.stdout, '');
});

test('non-target events pass; malformed input fails; exec-form CLI works from another cwd', t => {
  const root = fixture(t);
  const hooks = path.join(root, '.claude', 'hooks');
  fs.mkdirSync(hooks, { recursive: true });
  for (const file of ['memory-start.cjs', 'task-archive.cjs']) fs.copyFileSync(path.join(__dirname, file), path.join(hooks, file));
  const script = path.join(hooks, 'memory-start.cjs');
  assert.equal(evaluate({ hook_event_name: 'Stop' }, root), null);
  assert.equal(evaluate({ hook_event_name: 'SessionStart', source: 'fork' }, root), null);
  for (const input of [null, [], {}, { hook_event_name: 'SessionStart' }]) assert.throws(() => evaluate(input, root));
  for (const input of ['{SECRET', 'null', '{}', ' '.repeat(MAX_BYTES + 1)]) {
    const result = spawnSync(process.execPath, [script], { input, encoding: 'utf8', timeout: 5000, cwd: os.tmpdir() });
    assert.equal(result.status, 1);
    assert.equal(result.stdout, '');
    assert.ok(!result.stderr.includes('SECRET'));
  }
  const result = spawnSync(process.execPath, [script], { input: JSON.stringify({ hook_event_name: 'SessionStart', source: 'startup' }),
    encoding: 'utf8', timeout: 5000, cwd: os.tmpdir() });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(JSON.parse(result.stdout).hookSpecificOutput.hookEventName, 'SessionStart');
});
