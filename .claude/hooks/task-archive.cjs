'use strict';

const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '../..');
const MAX_BYTES = 32 * 1024;
const ID = /^\d{4}-\d{2}-\d{2}-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

function check(condition) {
  if (!condition) throw new Error('Invalid task record');
}

function text(value, max = 2000) {
  check(typeof value === 'string' && value.trim().length > 0 && value.length <= max &&
    !/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value));
}

function object(value, required, optional = []) {
  check(value && typeof value === 'object' && !Array.isArray(value));
  check(required.every(key => Object.hasOwn(value, key)));
  check(Object.keys(value).every(key => required.includes(key) || optional.includes(key)));
}

function strings(value, max = 2000) {
  check(Array.isArray(value) && value.length <= 64);
  value.forEach(item => text(item, max));
}

function relative(value) {
  text(value, 240);
  check(!/[\\:<>"|?*]/.test(value) && !value.startsWith('/'));
  check(value === '.' || value.split('/').every(part => part && part !== '.' && part !== '..' &&
    !/[. ]$/.test(part) && !/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part)));
}

function validId(value) {
  check(typeof value === 'string' && ID.test(value));
  const date = value.slice(0, 10);
  check(Number.isFinite(Date.parse(date)) && new Date(date).toISOString().slice(0, 10) === date);
}

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]));
  }
  return value;
}

function validate(record) {
  object(record, ['schema_version', 'task_id', 'recorded_at', 'title', 'summary', 'status',
    'modules', 'roles', 'changes', 'decisions', 'verification', 'open_items'], ['session_id', 'supersedes']);
  check(record.schema_version === 1);
  validId(record.task_id);
  text(record.recorded_at, 40);
  check(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(record.recorded_at));
  check(Number.isFinite(Date.parse(record.recorded_at)) &&
    new Date(record.recorded_at).toISOString() === record.recorded_at &&
    record.task_id.slice(0, 10) === record.recorded_at.slice(0, 10));
  text(record.title, 160);
  text(record.summary, 2000);
  check(['completed', 'partial', 'blocked'].includes(record.status));
  strings(record.modules, 240);
  check(record.modules.length > 0);
  record.modules.forEach(relative);
  strings(record.roles, 80);
  check(record.roles.length > 0);
  for (const key of ['changes', 'decisions', 'open_items']) strings(record[key]);
  check(Array.isArray(record.verification) && record.verification.length <= 64);
  for (const item of record.verification) {
    object(item, ['status', 'evidence'], ['command', 'paths']);
    check(['passed', 'failed', 'not_run'].includes(item.status));
    text(item.evidence);
    if (Object.hasOwn(item, 'command')) text(item.command, 1000);
    if (Object.hasOwn(item, 'paths')) {
      strings(item.paths, 240);
      item.paths.forEach(relative);
    }
  }
  check(record.changes.length + record.decisions.length + record.verification.length + record.open_items.length > 0);
  if (Object.hasOwn(record, 'session_id')) text(record.session_id, 160);
  if (Object.hasOwn(record, 'supersedes')) {
    validId(record.supersedes);
    check(record.supersedes !== record.task_id);
  }
  const result = canonical(record);
  check(Buffer.byteLength(JSON.stringify(result) + '\n') <= MAX_BYTES);
  return result;
}

function parse(raw) {
  check(Buffer.byteLength(raw) <= MAX_BYTES);
  return validate(JSON.parse(raw));
}

// Fixed descendants only. This guards existing links, not hostile concurrent directory replacement.
function safePath(root, relativePath, createParents = false) {
  const base = fs.realpathSync(root);
  const parts = relativePath.split('/');
  relative(relativePath);
  let current = base;
  for (let i = 0; i < parts.length; i++) {
    current = path.join(current, parts[i]);
    if (createParents && i < parts.length - 1) {
      try { fs.mkdirSync(current); } catch (error) { if (error.code !== 'EEXIST') throw error; }
    }
    let stat;
    try { stat = fs.lstatSync(current); } catch (error) {
      if (error.code === 'ENOENT' && i === parts.length - 1) return current;
      throw error;
    }
    check(!stat.isSymbolicLink());
    if (i < parts.length - 1) check(stat.isDirectory());
    const resolved = fs.realpathSync(current);
    const rel = path.relative(base, resolved);
    check(rel !== '..' && !rel.startsWith('..' + path.sep) && !path.isAbsolute(rel));
  }
  return current;
}

function readBounded(file, limit, prefix = false) {
  const before = fs.lstatSync(file);
  check(before.isFile() && !before.isSymbolicLink());
  const fd = fs.openSync(file, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0));
  try {
    const stat = fs.fstatSync(fd);
    check(stat.isFile() && stat.dev === before.dev && stat.ino === before.ino);
    const buffer = Buffer.alloc(limit + 1);
    let size = 0;
    while (size < buffer.length) {
      const count = fs.readSync(fd, buffer, size, buffer.length - size, null);
      if (!count) break;
      size += count;
    }
    const truncated = size > limit;
    check(prefix || !truncated);
    return { text: buffer.subarray(0, Math.min(size, limit)).toString('utf8'), truncated };
  } finally { fs.closeSync(fd); }
}

function readStdin(limit = MAX_BYTES) {
  // Bounded even when stdin is a pipe rather than a regular file.
  const buffer = Buffer.alloc(limit + 1);
  let size = 0;
  while (size < buffer.length) {
    const count = fs.readSync(0, buffer, size, buffer.length - size, null);
    if (!count) break;
    size += count;
  }
  check(size <= limit);
  return buffer.subarray(0, size).toString('utf8');
}

function recordPath(id) {
  validId(id);
  return `.claude/memory/tasks/${id.slice(0, 7)}/${id}.json`;
}

function loadRecord(root, id) {
  const record = parse(readBounded(safePath(root, recordPath(id)), MAX_BYTES).text);
  check(record.task_id === id);
  return record;
}

function archive(root, input) {
  const record = validate(input);
  const relativePath = recordPath(record.task_id);
  if (record.supersedes) loadRecord(root, record.supersedes);
  const file = safePath(root, relativePath, true);
  const serialized = JSON.stringify(record);
  let fd;
  try { fd = fs.openSync(file, 'wx', 0o600); } catch (error) {
    if (error.code !== 'EEXIST') throw error;
    if (JSON.stringify(loadRecord(root, record.task_id)) !== serialized) {
      throw new Error('Task record conflict');
    }
    return { status: 'unchanged', path: relativePath };
  }
  // A failed/interrupted write is retained as evidence, never silently overwritten.
  try {
    fs.writeFileSync(fd, serialized + '\n', 'utf8');
    fs.fsyncSync(fd);
  } finally { fs.closeSync(fd); }
  return { status: 'created', path: relativePath };
}

if (require.main === module) {
  try {
    process.stdout.write(JSON.stringify(archive(ROOT, parse(readStdin()))) + '\n');
  } catch {
    process.stderr.write('task-archive: invalid, conflicting or inaccessible record; archive not confirmed.\n');
    process.exitCode = 1;
  }
}

module.exports = { ROOT, MAX_BYTES, ID, validate, parse, safePath, readBounded, readStdin, recordPath, loadRecord, archive };
