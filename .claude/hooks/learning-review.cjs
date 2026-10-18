'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { ROOT, ID, MAX_BYTES, safePath, readBounded, loadRecord, validateLearningLinks,
  learningRef, knowledgeTarget } = require('./task-archive.cjs');

const LIMITS = { entries: 20000, records: 5000, bytes: 32 * 1024 * 1024 };
const MAX_TARGET = 256 * 1024;
const hash = value => createHash('sha256').update(value).digest('hex');
const order = (a, b) => a < b ? -1 : a > b ? 1 : 0;

function manifest(root, limits) {
  const files = [];
  const diagnostics = [];
  let count = 0;
  let bytes = 0;
  const visit = (relative, level) => {
    let dir;
    try {
      dir = fs.opendirSync(safePath(root, relative));
      for (let entry; (entry = dir.readSync());) {
        if (++count > limits.entries) throw new Error('limit');
        const child = `${relative}/${entry.name}`;
        if (entry.isSymbolicLink()) { diagnostics.push({ path: child, code: 'link' }); continue; }
        if (level === 0 && entry.isDirectory() && /^\d{4}-(0[1-9]|1[0-2])$/.test(entry.name)) {
          visit(child, 1);
        } else if (level === 1 && entry.isFile() && entry.name.endsWith('.json') &&
            ID.test(entry.name.slice(0, -5)) && entry.name.startsWith(path.posix.basename(relative) + '-')) {
          const stat = fs.lstatSync(safePath(root, child));
          bytes += stat.size;
          if (files.length >= limits.records || bytes > limits.bytes) throw new Error('limit');
          files.push({ path: child, id: entry.name.slice(0, -5), size: stat.size,
            mtime: stat.mtimeMs, ctime: stat.ctimeMs, ino: stat.ino });
        } else {
          diagnostics.push({ path: child, code: 'unexpected_entry' });
        }
      }
    } catch (error) {
      if (!(level === 0 && error.code === 'ENOENT')) {
        diagnostics.push({ path: relative, code: error.message === 'limit' ? 'scan_limit' : 'unreadable' });
      }
    } finally { if (dir) dir.closeSync(); }
  };
  visit('.claude/memory/tasks', 0);
  files.sort((a, b) => order(a.path, b.path));
  diagnostics.sort((a, b) => order(a.path, b.path));
  return { files, diagnostics, entries: count, bytes };
}

function reduce(records) {
  const entries = new Map();
  const diagnostics = [];
  for (const record of records) {
    for (const entry of record.learning?.entries || []) entries.set(`${record.task_id}#${entry.id}`, entry);
  }
  for (const record of records) {
    try { validateLearningLinks(record, ref => entries.get(ref)); } catch {
      diagnostics.push({ path: record.task_id, code: 'invalid_reference' });
    }
  }
  const children = new Map();
  const proposals = new Map();
  const results = new Map();
  for (const [ref, entry] of entries) {
    if (entry.kind === 'feedback' && entry.previous) {
      const refs = children.get(entry.previous) || [];
      refs.push(ref);
      children.set(entry.previous, refs);
    }
    if (entry.kind === 'proposal') proposals.set(ref, entry);
    if (entry.kind === 'result') {
      const refs = results.get(entry.proposal) || [];
      refs.push({ ref, ...entry });
      results.set(entry.proposal, refs);
    }
  }
  // Imported or damaged archives may form cycles even though append-only writes cannot.
  const visited = new Set();
  for (const [ref, entry] of entries) {
    if (entry.kind !== 'feedback' || visited.has(ref)) continue;
    const chain = new Set();
    let current = ref;
    while (current && !visited.has(current)) {
      if (chain.has(current)) {
        diagnostics.push({ path: current, code: 'cyclic_reference' });
        break;
      }
      chain.add(current);
      current = entries.get(current)?.previous;
    }
    for (const id of chain) visited.add(id);
  }
  const feedbackState = ref => {
    const seen = new Set();
    let current = ref;
    while (current) {
      if (seen.has(current)) return 'conflict';
      seen.add(current);
      const entry = entries.get(current);
      if (!entry || entry.kind !== 'feedback') return 'conflict';
      if ((children.get(current) || []).length > 1) return 'conflict';
      current = entry.previous;
    }
    const entry = entries.get(ref);
    if (entry.action === 'withdraw') return 'withdrawn';
    const next = children.get(ref) || [];
    if (next.length) return entries.get(next[0])?.action === 'withdraw' ? 'withdrawn' : 'revised';
    if (entry.scope.duration === 'task' || entry.scope.duration === 'unknown' || entry.route === 'suggestion') return 'deferred';
    return 'candidate';
  };
  const items = [];
  for (const [ref, entry] of entries) {
    if (entry.kind === 'feedback') {
      const related = [...proposals].filter(([, p]) => p.sources.includes(ref)).map(([id]) => id);
      items.push({ ref, kind: entry.kind, state: feedbackState(ref), entry, proposals: related });
    } else if (entry.kind === 'proposal') {
      const receipts = results.get(ref) || [];
      const finished = receipts.filter(r => r.phase === 'finished');
      const open = receipts.filter(r => r.phase === 'started' && !finished.some(f => f.attempt === r.ref));
      const success = finished.some(r => ['applied', 'already_present'].includes(r.outcome));
      const sourcesValid = entry.sources.every(id => feedbackState(id) === 'candidate');
      const conflicting = finished.some(a => finished.some(b => a.attempt === b.attempt &&
        (a.outcome !== b.outcome || a.observed_sha256 !== b.observed_sha256)));
      let state = conflicting ? 'conflict' : open.length ? 'recovery_required' : success ? 'applied' :
        finished.some(r => r.outcome === 'declined') ? 'declined' : finished.length ? 'needs_review' : 'pending';
      if (!sourcesValid) state = success ? 'review_applied_knowledge' : 'source_blocked';
      items.push({ ref, kind: entry.kind, state, entry, results: receipts });
    }
  }
  items.sort((a, b) => order(a.ref, b.ref));
  return { items, entries, diagnostics };
}

function scan(root = ROOT, limits = LIMITS) {
  const before = manifest(root, limits);
  const diagnostics = [...before.diagnostics];
  const records = [];
  for (const file of before.files) {
    try { records.push(loadRecord(root, file.id)); } catch {
      diagnostics.push({ path: file.path, code: 'invalid_or_unreadable_record' });
    }
  }
  const after = manifest(root, limits);
  if (JSON.stringify(before) !== JSON.stringify(after)) diagnostics.push({ path: '.claude/memory/tasks', code: 'changed_during_scan' });
  const reduced = reduce(records);
  diagnostics.push(...reduced.diagnostics);
  const snapshot = hash(JSON.stringify(records));
  return { complete: diagnostics.length === 0, snapshot, scanned: before.files.length,
    bytes: before.bytes, diagnostics, items: reduced.items, entries: reduced.entries };
}

function list(snapshot, { limit = 20, cursor, scope } = {}) {
  if (!Number.isInteger(limit) || limit < 1 || limit > 50) throw new Error('invalid_limit');
  if (scope && !['capability', 'business', 'suggestion'].includes(scope)) throw new Error('invalid_scope');
  let after = '';
  if (cursor) {
    if (cursor.length > 2048) throw new Error('invalid_cursor');
    const value = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
    if (value.snapshot !== snapshot.snapshot || value.scope !== (scope || '') || typeof value.after !== 'string') {
      throw new Error('stale_cursor');
    }
    after = value.after;
  }
  const items = snapshot.items.filter(item => !scope || (item.kind === 'feedback' ? item.entry.route === scope :
    item.entry.sources.some(ref => snapshot.entries.get(ref)?.route === scope)));
  if (after && !items.some(item => item.ref === after)) throw new Error('invalid_cursor');
  const remaining = items.filter(item => order(item.ref, after) > 0);
  const page = [];
  let bytes = 0;
  for (const item of remaining.slice(0, limit)) {
    // Detail stays in the immutable source record; pages never echo entire patch/result chains.
    const row = { ref: item.ref, kind: item.kind, state: snapshot.complete ? item.state : 'unverified',
      ...(item.kind === 'feedback' ? { core: item.entry.core, scope: item.entry.scope, route: item.entry.route,
        proposals: item.proposals.slice(0, 20), proposal_count: item.proposals.length } :
        { target: item.entry.target, sources: item.entry.sources, result_count: item.results.length }) };
    bytes += Buffer.byteLength(JSON.stringify(row));
    if (bytes > 64 * 1024 && page.length) break;
    page.push(row);
  }
  const next = page.length < remaining.length ? Buffer.from(JSON.stringify({ snapshot: snapshot.snapshot,
    scope: scope || '', after: page.at(-1).ref })).toString('base64url') : null;
  return { scan_complete: snapshot.complete, snapshot_id: snapshot.snapshot, scanned: snapshot.scanned,
    total: items.length, diagnostics: snapshot.diagnostics.slice(0, 50), diagnostic_count: snapshot.diagnostics.length,
    items: page, next_cursor: next };
}

function targetText(root, relative) {
  const value = readBounded(safePath(root, relative), MAX_TARGET).text;
  if (!value.isWellFormed() || value.includes('�')) throw new Error('invalid_utf8');
  return value;
}

function applyEdits(text, edits) {
  for (const edit of edits) {
    const first = text.indexOf(edit.old);
    if (first < 0 || text.indexOf(edit.old, first + 1) >= 0) throw new Error('non_unique_edit');
    text = text.slice(0, first) + edit.new + text.slice(first + edit.old.length);
  }
  return text;
}

function checkProposal(root, ref, snapshot = scan(root)) {
  learningRef(ref);
  if (!snapshot.complete) return { ok: false, reason: 'incomplete_scan' };
  const item = snapshot.items.find(row => row.ref === ref && row.kind === 'proposal');
  if (!item) return { ok: false, reason: 'proposal_missing' };
  const proposal = item.entry;
  try {
    if (['source_blocked', 'review_applied_knowledge', 'conflict', 'declined'].includes(item.state)) throw new Error(item.state);
    if (!knowledgeTarget(proposal.target)) throw new Error('invalid_target');
    const capability = proposal.target.startsWith('.claude/agents/');
    for (const source of proposal.sources.map(id => snapshot.entries.get(id))) {
      if (source.route !== (capability ? 'capability' : 'business')) throw new Error('source_scope_mismatch');
      if (source.scope.duration === 'module' && !source.scope.paths.some(p =>
        proposal.target === p || proposal.target.startsWith(p + '/'))) throw new Error('source_scope_mismatch');
    }
    const target = targetText(root, proposal.target);
    const observed = hash(target);
    const contexts = new Map(proposal.context.map(c => [c.path, c.sha256]));
    // All existing ancestor instructions must be versioned, including the root.
    let parent = path.posix.dirname(proposal.target);
    if (path.posix.basename(proposal.target) === 'CLAUDE.md') parent = path.posix.dirname(parent);
    while (parent !== '.') {
      const ancestor = `${parent}/CLAUDE.md`;
      try {
        const text = targetText(root, ancestor);
        if (contexts.get(ancestor) !== hash(text)) throw new Error('context_changed');
      } catch (error) { if (error.code !== 'ENOENT') throw error; }
      parent = path.posix.dirname(parent);
    }
    for (const context of proposal.context) {
      if (hash(targetText(root, context.path)) !== context.sha256) throw new Error('context_changed');
    }
    const already = observed === proposal.after_sha256;
    let before = target;
    if (already) {
      // A matching result hash alone proves neither the patch nor the protected boundary.
      // Ambiguous reversals (including deletions) require manual recovery, not blind acceptance.
      if (proposal.edits.some(edit => !edit.new)) throw new Error('recovery_required');
      before = applyEdits(target, [...proposal.edits].reverse().map(edit => ({ old: edit.new, new: edit.old })));
      if (hash(before) !== proposal.before_sha256) throw new Error('before_hash_mismatch');
    } else {
      if (item.state === 'applied' || item.state === 'recovery_required') throw new Error('recovery_required');
      if (observed !== proposal.before_sha256) throw new Error('target_changed');
    }
    const after = applyEdits(before, proposal.edits);
    if (Buffer.byteLength(after) > MAX_TARGET || hash(after) !== proposal.after_sha256) throw new Error('after_hash_mismatch');
    if (proposal.target.startsWith('.claude/agents/')) {
      const frontmatter = text => text.match(/^(?:﻿)?---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/)?.[0];
      if (!frontmatter(before) || frontmatter(before) !== frontmatter(after)) throw new Error('frontmatter_changed');
    }
    return { ok: true, action: already ? 'already_present' : 'ready_for_current_confirmation',
      state: item.state, observed_sha256: observed };
  } catch (error) {
    const known = ['context_changed', 'target_changed', 'after_hash_mismatch', 'frontmatter_changed',
      'non_unique_edit', 'before_hash_mismatch', 'recovery_required', 'invalid_utf8', 'invalid_target', 'source_blocked',
      'review_applied_knowledge', 'conflict', 'declined', 'source_scope_mismatch'];
    return { ok: false, reason: known.includes(error.message) ? error.message : 'target_or_context_unreadable' };
  }
}

if (require.main === module) {
  try {
    const [command = 'list', ...args] = process.argv.slice(2);
    let output;
    const snapshot = scan();
    if (command === 'check' && args.length === 1) output = checkProposal(ROOT, args[0], snapshot);
    else if (command === 'list') {
      const options = {};
      for (let i = 0; i < args.length; i += 2) {
        const key = { '--limit': 'limit', '--cursor': 'cursor', '--scope': 'scope' }[args[i]];
        if (!key || args[i + 1] === undefined || Object.hasOwn(options, key)) throw new Error('invalid_arguments');
        options[key] = key === 'limit' ? Number(args[i + 1]) : args[i + 1];
      }
      output = list(snapshot, options);
    } else throw new Error('invalid_arguments');
    process.stdout.write(JSON.stringify(output) + '\n');
    if (!snapshot.complete || output.ok === false) process.exitCode = 1;
  } catch {
    process.stderr.write('learning-review: invalid arguments, stale cursor or unreadable input; review not confirmed.\n');
    process.exitCode = 1;
  }
}

module.exports = { LIMITS, hash, scan, reduce, list, applyEdits, checkProposal };
