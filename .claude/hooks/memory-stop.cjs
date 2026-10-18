'use strict';

const fs = require('node:fs');

function evaluate(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input) ||
      typeof input.hook_event_name !== 'string') {
    throw new Error('Invalid hook input');
  }
  if (input.hook_event_name !== 'Stop') return null;
  if (input.permission_mode === 'plan') return null;
  if (typeof input.stop_hook_active !== 'boolean') {
    throw new Error('Invalid stop_hook_active');
  }
  if (input.stop_hook_active) return null;
  return null;
}

if (require.main === module) {
  try {
    const decision = evaluate(JSON.parse(fs.readFileSync(0, 'utf8')));
    if (decision) process.stdout.write(JSON.stringify(decision) + '\n');
  } catch {
    // Non-blocking failure: never echo the payload or transcript path.
    process.stderr.write('memory-stop: invalid or unreadable hook input; memory check skipped.\n');
    process.exitCode = 1;
  }
}

module.exports = { evaluate };
