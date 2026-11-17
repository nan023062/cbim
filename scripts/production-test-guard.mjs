import path from 'node:path';
import fs from 'node:fs';
import {isTestSupport} from './test-paths.mjs';

/** Vite/Rollup 在加载和产物形成时双重拒绝测试依赖，避免测试被内联后只检查文件名漏检。 */
export function productionTestGuard(root = process.cwd())
{
  function assertProduction(id)
  {
    const clean = id.replaceAll('\\', '/').split('?')[0];
    const relative = path.relative(root, clean).replaceAll('\\', '/');
    const testPackage = /^(?:vitest(?:\/|$)|@vitest\/)/.test(clean) || /(?:^|\/)node_modules\/(?:\.pnpm\/[^/]+\/node_modules\/)?(?:vitest|@vitest\/[^/]+)(?:\/|$)/.test(clean);
    const projectTest = !relative.startsWith('../') && !path.isAbsolute(relative)
      && !relative.startsWith('node_modules/') && !relative.includes('/node_modules/') && (isTestSupport(relative) || /\.(?:test|spec)\.[cm]?[jt]sx?$/.test(relative));
    if (testPackage || projectTest) throw Error('PRODUCTION_TEST_DEPENDENCY: ' + id);
  }
  return {
    name: 'cbim-production-test-boundary',
    enforce: 'pre',
    apply: 'build',
    load(id) { assertProduction(id); return null; },
    generateBundle(_options, bundle)
    {
      for (const id of this.getModuleIds()) assertProduction(id);
      for (const chunk of Object.values(bundle)) if (chunk.type === 'chunk') for (const id of Object.keys(chunk.modules)) assertProduction(id);
    },
  };
}

/** 制品暂存目录也不能混入自有测试文件；第三方运行依赖维持其原有打包规则。 */
export function assertProductionTree(root)
{
  function visit(directory)
  {
    for (const entry of fs.readdirSync(directory, {withFileTypes: true}))
    {
      if (entry.name === 'node_modules') continue;
      const file = path.join(directory, entry.name);
      if (['unittest', 'tests', 'test-results'].includes(entry.name) || /\.(?:test|spec)\.[cm]?[jt]sx?$/.test(entry.name))
        throw Error('PRODUCTION_TEST_FILE: ' + file);
      if (entry.isDirectory()) visit(file);
    }
  }
  visit(root);
}
