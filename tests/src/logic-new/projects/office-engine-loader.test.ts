import { test, expect } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { packagedEngineAdapter } from '../../../../src/logic-new/projects/office-engine-loader';
import { engineDescriptor } from '../../../../src/logic-new/engines';

test('Office 只加载声明逐次工具授权的兼容引擎包', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'office-loader-'));
  try {
    for (const supportsBeforeToolCall of [false, true]) {
      const entry = path.join(root, String(supportsBeforeToolCall) + '.cjs');
      const fields = { protocol: 1, id: 'codex', version: '1.1.1', supportsBeforeToolCall, descriptor: engineDescriptor('codex') };
      await fs.writeFile(entry, 'module.exports.engineAdapter = { ...' + JSON.stringify(fields) + ', create() { return {}; } };');
      const load = () => packagedEngineAdapter('codex', { root, entry, identity: 'test', version: '1.1.1', adapter: { entry, version: '1.1.1', protocol: 1 } });
      if (supportsBeforeToolCall) expect(load().supportsBeforeToolCall).toBe(true);
      else expect(load).toThrow('逐次工具审批');
    }
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
