import {it,expect} from 'vitest';
import fs from 'node:fs';
import {auditDependencies} from '../../scripts/check-dependencies.mjs';

it('canonical Logic and View paths replace the suffixed directories',()=>{
  for(const directory of ['src/logic-new','src/view-new','tests/src/logic-new','tests/src/view-new'])expect(fs.existsSync(directory)).toBe(false);
  expect(fs.existsSync('src/logic')).toBe(true);
  expect(fs.existsSync('src/view')).toBe(true);
  expect(fs.existsSync('tests/src/logic')).toBe(true);
  expect(fs.readFileSync('index.html','utf8')).toContain('/src/view/main.ts');
  const result=auditDependencies();
  expect(result.edges.some(edge=>edge.from.startsWith('src/view/'))).toBe(true);
  expect(result.edges.filter(edge=>/^(src|tests\/src)\/(logic-new|view-new)\//.test(edge.from)||/^(src|tests\/src)\/(logic-new|view-new)\//.test(edge.to))).toEqual([]);
  expect(result.unresolved).toEqual([]);
  expect(result.violations).toEqual([]);
  expect(result.logicalViolations).toEqual([]);
});
