'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { evaluate } = require('./memory-stop.cjs');

const script = path.join(__dirname, 'memory-stop.cjs');
const stop = { hook_event_name: 'Stop', permission_mode: 'default', stop_hook_active: false };

function run(input, target = script, cwd = os.tmpdir()) {
  return spawnSync(process.execPath, [target], {
    input, cwd, encoding: 'utf8', timeout: 5000,
  });
}

test('normal main Stop passes without emitting a block decision', () => {
  assert.equal(evaluate(stop), null);
  const result = run(JSON.stringify(stop));
  assert.equal(result.status, 0);
  assert.equal(result.stderr, '');
  assert.equal(result.stdout, '');
});

test('normal and active stops pass without recursive blocking', () => {
  for (const active of [false, true]) {
    assert.equal(evaluate({ ...stop, stop_hook_active: active }), null);
    const result = run(JSON.stringify({ ...stop, stop_hook_active: active }));
    assert.equal(result.status, 0);
    assert.equal(result.stdout, '');
    assert.equal(result.stderr, '');
  }
});

test('plan mode passes without requesting memory writes', () => {
  assert.equal(evaluate({ hook_event_name: 'Stop', permission_mode: 'plan' }), null);
  const result = run(JSON.stringify({ ...stop, permission_mode: 'plan' }));
  assert.equal(result.status, 0);
  assert.equal(result.stdout, '');
  assert.equal(result.stderr, '');
});

test('SubagentStop and other events pass without requiring Stop fields', () => {
  for (const event of ['SubagentStop', 'SessionEnd', 'StopFailure', 'UserPromptSubmit']) {
    assert.equal(evaluate({ hook_event_name: event }), null);
  }
});

test('agent_type does not change pass-through or bypass input validation', () => {
  assert.equal(evaluate({ ...stop, agent_type: 'custom-main' }), null);
  assert.throws(() => evaluate({ ...stop, agent_type: 'custom-main', stop_hook_active: 'false' }));
});

test('invalid input fails non-blockingly without exposing payload', () => {
  for (const input of ['', '{SECRET', 'null', '[]', '{}',
    JSON.stringify({ ...stop, stop_hook_active: 'false' }),
    JSON.stringify({ hook_event_name: 'Stop' })]) {
    const result = run(input);
    assert.equal(result.status, 1);
    assert.equal(result.stdout, '');
    assert.match(result.stderr, /memory-stop: invalid or unreadable hook input/);
    assert.ok(!result.stderr.includes('SECRET'));
  }
});

test('transcript path and response content are not read or echoed', () => {
  const result = run(JSON.stringify({ ...stop,
    transcript_path: 'does-not-exist-SECRET.jsonl', last_assistant_message: 'SECRET' }));
  assert.equal(result.status, 0);
  assert.ok(!result.stdout.includes('SECRET'));
  assert.equal(result.stderr, '');
});

test('exec form supports a script path containing spaces from another cwd', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'memory hook test '));
  try {
    const target = path.join(dir, 'memory stop.cjs');
    fs.copyFileSync(script, target);
    const result = run(JSON.stringify(stop), target);
    assert.equal(result.status, 0);
    assert.equal(result.stdout, '');
    assert.equal(result.stderr, '');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
