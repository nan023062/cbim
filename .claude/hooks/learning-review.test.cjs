'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { spawnSync } = require('node:child_process');
const { archive, validate, loadRecord, recordPath } = require('./task-archive.cjs');
const { LIMITS, hash, scan, list, checkProposal, applyEdits } = require('./learning-review.cjs');

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'learning 中文 '));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return root;
}
function record(entries, date = '2026-10-18') {
  return { schema_version: 1, task_id: `${date}-${randomUUID()}`, recorded_at: `${date}T10:00:00.000Z`,
    title: '学习测试', summary: '含学习材料', status: 'completed', modules: ['.claude'], roles: ['main'],
    changes: [], decisions: ['仅测试夹具'], verification: [], open_items: [],
    ...(entries ? { learning: { version: 1, entries } } : {}) };
}
function feedback(extra = {}) {
  return { id: 'f1', kind: 'feedback', action: 'add', category: 'requirement',
    source: { origin: 'direct_user', evidence: '测试时检查边界', form: 'redacted_quote' },
    core: '检查边界', scope: { duration: 'global', paths: [] }, route: 'capability', ...extra };
}
function save(root, entry, date) {
  const r = record([entry], date);
  archive(root, r);
  return `${r.task_id}#${entry.id}`;
}
function put(root, file, text) {
  fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
  fs.writeFileSync(path.join(root, file), text);
}
function setup(t, target = '.claude/agents/tester.md') {
  const root = fixture(t);
  const before = target.startsWith('.claude') ? '---\nname: tester\ntools: Read\n---\n检查行为。\n' : '# 模块\n检查行为。\n';
  const after = before.replace('检查行为。', '检查行为与边界。');
  put(root, 'CLAUDE.md', '# 根规则\n');
  put(root, target, before);
  const source = save(root, feedback({ route: target.startsWith('.claude') ? 'capability' : 'business' }));
  const proposal = { id: 'p1', kind: 'proposal', sources: [source], target,
    before_sha256: hash(before), after_sha256: hash(after),
    context: [{ path: 'CLAUDE.md', sha256: hash('# 根规则\n') }],
    edits: [{ old: '检查行为。', new: '检查行为与边界。' }], reason: '通用边界检查' };
  return { root, before, after, source, proposal, ref: save(root, proposal) };
}
function tree(root) {
  return fs.readdirSync(root, { recursive: true }).sort().map(p => {
    const file = path.join(root, p);
    return [p, fs.statSync(file).isFile() ? fs.readFileSync(file, 'utf8') : null];
  });
}

test('old records and optional learning remain compatible; immutable retries preserve evidence', t => {
  const root = fixture(t);
  const old = record();
  archive(root, old);
  assert.deepEqual(loadRecord(root, old.task_id), validate(old));
  const r = record([feedback()]);
  assert.equal(archive(root, r).status, 'created');
  assert.equal(archive(root, r).status, 'unchanged');
  assert.throws(() => archive(root, { ...r, summary: 'changed' }));
  assert.equal(scan(root).items.length, 1);
});

test('learning schema rejects unknown, oversized, duplicate and unsafe fields', () => {
  for (const f of [feedback({ action: 'other' }), feedback({ previous: 'bad' }), feedback({ core: 'x'.repeat(801) }),
    feedback({ scope: { duration: 'module', paths: [] } }), feedback({ route: 'auto_apply' }),
    feedback({ source: { origin: 'assistant', evidence: 'x', form: 'paraphrase' } }),
    feedback({ scope: { duration: 'module', paths: ['../escape'] } })]) assert.throws(() => validate(record([f])));
  assert.throws(() => validate(record([feedback(), feedback()])));
  const r = record([feedback()]);
  r.learning.extra = true;
  assert.throws(() => validate(r));
});

test('reference validation rejects absent, self, sibling, wrong-kind and cross-scope links', t => {
  const s = setup(t);
  const bad = `${record().task_id}#f1`;
  assert.throws(() => save(s.root, feedback({ action: 'revise', previous: bad })));
  assert.throws(() => save(s.root, feedback({ action: 'revise', previous: s.ref })));
  assert.throws(() => save(s.root, feedback({ action: 'revise', previous: s.source,
    scope: { duration: 'module', paths: ['src'] } })));
  const r = record([feedback()]);
  r.learning.entries[0] = feedback({ action: 'revise', previous: `${r.task_id}#f1` });
  assert.throws(() => archive(s.root, r));
  assert.throws(() => save(s.root, { ...s.proposal, target: '.claude/settings.json' }));
  assert.throws(() => save(s.root, { ...s.proposal, target: 'CLAUDE.md' }));
});

test('cross-month full scan and pagination include later withdrawals, not only recent records', t => {
  const root = fixture(t);
  const first = save(root, feedback(), '2026-09-01');
  for (let i = 0; i < 5; i++) save(root, feedback({ core: `其他 ${i}` }));
  save(root, feedback({ action: 'withdraw', previous: first }));
  const snapshot = scan(root);
  assert.equal(snapshot.complete, true);
  assert.equal(snapshot.items.find(i => i.ref === first).state, 'withdrawn');
  const refs = [];
  let cursor;
  do {
    const page = list(snapshot, { limit: 2, cursor });
    refs.push(...page.items.map(i => i.ref));
    cursor = page.next_cursor;
  } while (cursor);
  assert.equal(new Set(refs).size, 7);
  const page = list(snapshot, { limit: 1 });
  save(root, feedback());
  assert.throws(() => list(scan(root), { cursor: page.next_cursor }), /stale_cursor/);
});

test('task and unknown feedback defer; revision forks conflict rather than newest winning', t => {
  const root = fixture(t);
  const base = save(root, feedback());
  const a = save(root, feedback({ action: 'revise', previous: base }));
  const b = save(root, feedback({ action: 'revise', previous: base }));
  const task = save(root, feedback({ scope: { duration: 'task', paths: [] } }));
  const unknown = save(root, feedback({ scope: { duration: 'unknown', paths: [] } }));
  const states = new Map(scan(root).items.map(i => [i.ref, i.state]));
  for (const ref of [base, a, b]) assert.equal(states.get(ref), 'conflict');
  assert.equal(states.get(task), 'deferred');
  assert.equal(states.get(unknown), 'deferred');
});

test('scan and proposal check are read-only; existing candidate is ready but not approved', t => {
  const s = setup(t);
  const before = tree(s.root);
  assert.equal(checkProposal(s.root, s.ref).action, 'ready_for_current_confirmation');
  list(scan(s.root));
  assert.deepEqual(tree(s.root), before);
  assert.equal(applyEdits(s.before, s.proposal.edits), s.after);
});

test('target, ancestor context and frontmatter changes block stale proposals', t => {
  const s = setup(t);
  put(s.root, s.proposal.target, s.before + '并发改动');
  assert.equal(checkProposal(s.root, s.ref).reason, 'target_changed');
  put(s.root, s.proposal.target, s.before);
  put(s.root, '.claude/CLAUDE.md', '新增祖先规则');
  assert.equal(checkProposal(s.root, s.ref).reason, 'context_changed');
  fs.unlinkSync(path.join(s.root, '.claude/CLAUDE.md'));
  const changed = s.before.replace('tools: Read', 'tools: Read, Write');
  const ref = save(s.root, { ...s.proposal, after_sha256: hash(changed),
    edits: [{ old: 'tools: Read', new: 'tools: Read, Write' }] });
  assert.equal(checkProposal(s.root, ref).reason, 'frontmatter_changed');
  put(s.root, 'CLAUDE.md', '# changed');
  assert.equal(checkProposal(s.root, s.ref).reason, 'context_changed');
});

test('business DNA target excludes itself from ancestors but requires parent DNA', t => {
  const s = setup(t, 'src/mod/CLAUDE.md');
  assert.equal(checkProposal(s.root, s.ref).action, 'ready_for_current_confirmation');
  put(s.root, 'src/CLAUDE.md', '# parent');
  assert.equal(checkProposal(s.root, s.ref).reason, 'context_changed');
  const ref = save(s.root, { ...s.proposal, context: [...s.proposal.context,
    { path: 'src/CLAUDE.md', sha256: hash('# parent') }] });
  assert.equal(checkProposal(s.root, ref).ok, true);
});

test('already-present recovery still validates the patch and protected frontmatter', t => {
  const s = setup(t);
  const after = s.before.replace('tools: Read', 'tools: Read, Write');
  const forbidden = save(s.root, { ...s.proposal, after_sha256: hash(after),
    edits: [{ old: 'tools: Read', new: 'tools: Read, Write' }] });
  put(s.root, s.proposal.target, after);
  assert.equal(checkProposal(s.root, forbidden).reason, 'frontmatter_changed');
  const broken = save(s.root, { ...s.proposal, after_sha256: hash(after),
    edits: [{ old: 'NONEXISTENT', new: 'ALSO-NONEXISTENT' }] });
  assert.equal(checkProposal(s.root, broken).ok, false);
  const deletion = save(s.root, { ...s.proposal, after_sha256: hash(s.before.replace('检查行为。', '')),
    edits: [{ old: '检查行为。', new: '' }] });
  put(s.root, s.proposal.target, s.before.replace('检查行为。', ''));
  assert.equal(checkProposal(s.root, deletion).reason, 'recovery_required');
});

test('imported cyclic feedback makes the complete scan fail closed for every proposal', t => {
  const s = setup(t);
  const a = record([feedback()]);
  const b = record([feedback()]);
  a.learning.entries[0] = feedback({ action: 'revise', previous: `${b.task_id}#f1` });
  b.learning.entries[0] = feedback({ action: 'revise', previous: `${a.task_id}#f1` });
  for (const r of [a, b]) put(s.root, recordPath(r.task_id), JSON.stringify(validate(r)));
  const snapshot = scan(s.root);
  assert.equal(snapshot.complete, false);
  assert.ok(snapshot.diagnostics.some(d => d.code === 'cyclic_reference'));
  assert.equal(checkProposal(s.root, s.ref).reason, 'incomplete_scan');
});

test('route and module scope mismatch cannot promote into unrelated knowledge', t => {
  const s = setup(t, 'src/mod/CLAUDE.md');
  const source = save(s.root, feedback({ route: 'business', scope: { duration: 'module', paths: ['design'] } }));
  const ref = save(s.root, { ...s.proposal, sources: [source] });
  assert.equal(checkProposal(s.root, ref).reason, 'source_scope_mismatch');
});

test('partial apply, already-present content and missing receipts do not trigger duplicate edits', t => {
  const s = setup(t);
  const other = save(s.root, { ...s.proposal });
  const attempt = save(s.root, { id: 'r1', kind: 'result', phase: 'started', proposal: s.ref, confirmation: '本次确认具体提案' });
  assert.equal(checkProposal(s.root, s.ref).reason, 'recovery_required');
  put(s.root, s.proposal.target, s.after);
  assert.equal(checkProposal(s.root, s.ref).action, 'already_present');
  const finish = { id: 'r1', kind: 'result', phase: 'finished', proposal: s.ref, attempt,
    outcome: 'applied', observed_sha256: hash(s.after), detail: '临时目标已核验' };
  save(s.root, finish);
  save(s.root, finish);
  const snap = scan(s.root);
  assert.equal(snap.items.find(i => i.ref === s.ref).state, 'applied');
  assert.equal(snap.items.find(i => i.ref === other).state, 'pending');
  assert.equal(checkProposal(s.root, s.ref).action, 'already_present');
  save(s.root, feedback({ action: 'withdraw', previous: s.source }));
  assert.equal(scan(s.root).items.find(i => i.ref === s.ref).state, 'review_applied_knowledge');
  assert.equal(checkProposal(s.root, s.ref).ok, false);
});

test('bad result links and false success hashes are rejected; conflicting outcomes need review', t => {
  const s = setup(t);
  const attempt = save(s.root, { id: 'r1', kind: 'result', phase: 'started', proposal: s.ref, confirmation: '确认' });
  const done = { id: 'r1', kind: 'result', phase: 'finished', proposal: s.ref, attempt,
    outcome: 'applied', observed_sha256: hash(s.after), detail: 'test' };
  assert.throws(() => save(s.root, { ...done, observed_sha256: hash('wrong') }));
  assert.throws(() => save(s.root, { ...done, attempt: s.source }));
  save(s.root, done);
  save(s.root, { ...done, outcome: 'failed' });
  assert.equal(checkProposal(s.root, s.ref).reason, 'conflict');
});

test('corrupt, oversized and invalid-link archives fail closed without echoing payload', t => {
  const s = setup(t);
  const r = record();
  archive(s.root, r);
  for (const text of ['{SECRET', 'x'.repeat(40000)]) {
    put(s.root, recordPath(r.task_id), text);
    const snapshot = scan(s.root);
    assert.equal(snapshot.complete, false);
    assert.ok(!JSON.stringify(list(snapshot)).includes('SECRET'));
    assert.equal(list(snapshot).items[0].state, 'unverified');
    assert.equal(checkProposal(s.root, s.ref).reason, 'incomplete_scan');
  }
  const broken = record([feedback({ action: 'revise', previous: `${record().task_id}#f1` })]);
  put(s.root, recordPath(r.task_id), JSON.stringify(r));
  put(s.root, recordPath(broken.task_id), JSON.stringify(broken));
  assert.equal(scan(s.root).complete, false);
});

test('missing archives stay empty; limits and junctions report incomplete without writes', t => {
  const root = fixture(t);
  assert.equal(scan(root).complete, true);
  assert.deepEqual(fs.readdirSync(root), []);
  save(root, feedback());
  assert.equal(scan(root, { ...LIMITS, records: 0 }).complete, false);
  const outside = fixture(t);
  const linked = fixture(t);
  put(outside, 'secret', 'SECRET');
  fs.mkdirSync(path.join(linked, '.claude'));
  fs.symlinkSync(outside, path.join(linked, '.claude/memory'), process.platform === 'win32' ? 'junction' : 'dir');
  assert.equal(scan(linked).complete, false);
  assert.deepEqual(fs.readdirSync(outside), ['secret']);
});

test('unreadable directories and scan mutation are reported, never treated as empty', t => {
  const s = setup(t);
  const original = fs.opendirSync;
  fs.opendirSync = () => { const error = new Error('PRIVATE'); error.code = 'EACCES'; throw error; };
  try {
    const snapshot = scan(s.root);
    assert.equal(snapshot.complete, false);
    assert.ok(!JSON.stringify(list(snapshot)).includes('PRIVATE'));
  } finally { fs.opendirSync = original; }
  const read = fs.readSync;
  let changed = false;
  fs.readSync = (...args) => {
    const count = read(...args);
    if (!changed) { changed = true; put(s.root, '.claude/memory/tasks/new-file', ''); }
    return count;
  };
  try { assert.equal(scan(s.root).complete, false); } finally { fs.readSync = read; }
});

test('failed result persistence preserves edited target and flags incomplete recovery', t => {
  const s = setup(t);
  const attempt = save(s.root, { id: 'r1', kind: 'result', phase: 'started', proposal: s.ref, confirmation: '确认' });
  put(s.root, s.proposal.target, s.after);
  const result = record([{ id: 'r1', kind: 'result', phase: 'finished', proposal: s.ref, attempt,
    outcome: 'applied', observed_sha256: hash(s.after), detail: '核验' }]);
  const write = fs.writeFileSync;
  fs.writeFileSync = () => { throw new Error('simulated disk failure'); };
  try { assert.throws(() => archive(s.root, result)); } finally { fs.writeFileSync = write; }
  assert.equal(fs.readFileSync(path.join(s.root, s.proposal.target), 'utf8'), s.after);
  assert.equal(fs.readFileSync(path.join(s.root, recordPath(result.task_id)), 'utf8'), '');
  assert.equal(scan(s.root).complete, false);
  assert.equal(checkProposal(s.root, s.ref).reason, 'incomplete_scan');
});

test('CLI roots at script location and rejects invalid arguments without writes', t => {
  const root = fixture(t);
  for (const file of ['task-archive.cjs', 'learning-review.cjs']) put(root, `.claude/hooks/${file}`, fs.readFileSync(path.join(__dirname, file), 'utf8'));
  const script = path.join(root, '.claude/hooks/learning-review.cjs');
  const run = args => spawnSync(process.execPath, [script, ...args], { cwd: os.tmpdir(), encoding: 'utf8' });
  assert.equal(JSON.parse(run(['list']).stdout).total, 0);
  assert.equal(run(['list', '--limit', '0']).status, 1);
  assert.equal(run(['write']).status, 1);
  assert.equal(fs.existsSync(path.join(root, '.claude/memory')), false);
});
