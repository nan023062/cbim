import {it,expect} from 'vitest';
import fs from 'node:fs';
import {auditDependencies} from '../../scripts/check-dependencies.mjs';

it('the current renderer has no retired View source or dependency',()=>{
  expect(fs.existsSync('src/view')).toBe(false);
  expect(fs.existsSync('src/logic')).toBe(false);
  expect(fs.existsSync('tests/src/logic')).toBe(false);
  expect(fs.existsSync('tests/src/view')).toBe(false);
  expect(fs.readFileSync('index.html','utf8')).toContain('/src/view-new/main.ts');
  const result=auditDependencies();
  expect(result.edges.some(edge=>edge.from.startsWith('src/view-new/'))).toBe(true);
  expect(result.edges.filter(edge=>edge.from.startsWith('src/view/')||edge.to.startsWith('src/view/')||edge.from.startsWith('src/logic/')||edge.to.startsWith('src/logic/'))).toEqual([]);
  expect(result.unresolved).toEqual([]);
  expect(result.violations).toEqual([]);
  expect(result.logicalViolations).toEqual([]);
});
