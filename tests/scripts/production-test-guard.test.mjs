import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {afterEach, expect, it} from 'vitest';
import {build} from 'vite';
import {productionTestGuard, assertProductionTree} from '../../scripts/production-test-guard.mjs';

const temporary = [];
afterEach(() => {
  for (const root of temporary.splice(0)) {
    if (path.dirname(root) !== path.resolve(os.tmpdir()) || !path.basename(root).startsWith('cbim-production-')) throw Error('Unsafe cleanup');
    fs.rmSync(root, {recursive: true, force: true});
  }
});
function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cbim-production-')); temporary.push(root);
  const write = (file, text) => {fs.mkdirSync(path.dirname(path.join(root, file)), {recursive: true}); fs.writeFileSync(path.join(root, file), text);};
  write('tests/src/module/secret.ts', "export const secret='TEST_ONLY_SENTINEL';");
  write('src/module/index.ts', 'export const value=42;');
  const compile = () => build({root, configFile: false, logLevel: 'silent', plugins: [productionTestGuard(root)],
    build: {write: false, minify: false, lib: {entry: path.join(root, 'src/module/index.ts'), formats: ['es']}}});
  return {root, write, compile};
}
it('根 tests 中存在镜像测试不影响真实生产构建，产物没有测试正文', async () => {
  const f = fixture(), result = await f.compile();
  const chunks = (Array.isArray(result) ? result : [result]).flatMap(item => item.output).filter(item => item.type === 'chunk');
  expect(chunks.length).toBeGreaterThan(0);
  expect(chunks.map(chunk => chunk.code).join('\n')).toContain('42');
  expect(chunks.map(chunk => chunk.code).join('\n')).not.toContain('TEST_ONLY_SENTINEL');
});
it.each(["export {secret} from '../../tests/src/module/secret';", "export const load=()=>import('../../tests/src/module/secret');"])(
  '静态或动态导入测试代码时构建失败：%s', async source => {
    const f = fixture(); f.write('src/module/index.ts', source);
    await expect(f.compile()).rejects.toThrow('PRODUCTION_TEST_DEPENDENCY');
  });
it('不能通过编译后内联或 external 的测试运行器绕过检查', () => {
  const f = fixture(), guard = productionTestGuard(f.root);
  const id = path.join(f.root, 'tests/src/module/secret.ts');
  expect(() => guard.generateBundle.call({getModuleIds: () => [id]}, {}, {})).toThrow('PRODUCTION_TEST_DEPENDENCY');
  expect(() => guard.load(path.join(f.root, 'node_modules/vitest/index.js'))).toThrow('PRODUCTION_TEST_DEPENDENCY');
  expect(() => guard.generateBundle.call({getModuleIds: () => ['vitest']}, {}, {})).toThrow('PRODUCTION_TEST_DEPENDENCY');
});
it('资源包和安装包暂存目录混入自有测试文件时拒绝归档', () => {
  const f = fixture();
  expect(() => assertProductionTree(f.root)).toThrow('PRODUCTION_TEST_FILE');
});
