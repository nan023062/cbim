// 打包外部验收工具及其两项已安装依赖；使用 A 自带的 Node，无需测试机安装开发环境。
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {fileDigest} from './desktop-local-update-fixture.mjs';

const require = createRequire(import.meta.url);
const directory = path.resolve('build/update-experience/local-test-tools');
await fs.mkdir(directory, {recursive: false});
const copied = [];
for (const filename of ['desktop-local-update-fixture.mjs', 'desktop-local-update-test.mjs']) {
  await fs.copyFile(path.join('scripts', filename), path.join(directory, filename));
  copied.push({file: filename, sha256: await fileDigest(path.join(directory, filename))});
}
const starter = 'Start-Local-Update-Test.cmd';
// 批处理明确使用 CRLF，避免受仓库 autocrlf 与复制方式影响。
await fs.writeFile(path.join(directory, starter), (await fs.readFile(path.join('packaging/updater', starter), 'utf8')).replace(/\r?\n/g, '\r\n'));
copied.push({file: starter, sha256: await fileDigest(path.join(directory, starter))});
const dependencies = [];
for (const name of ['playwright-core', 'yaml']) {
  const source = path.dirname(require.resolve(name + '/package.json'));
  const pkg = JSON.parse(await fs.readFile(path.join(source, 'package.json'), 'utf8'));
  assert.equal(Object.keys(pkg.dependencies ?? {}).length, 0, '重新核实工具的传递依赖');
  await fs.cp(source, path.join(directory, 'node_modules', name), {recursive: true, dereference: true});
  dependencies.push({name, version: pkg.version});
}
await fs.writeFile(path.join(directory, 'tool-receipt.json'), JSON.stringify({purpose: 'external local A-to-B test harness, not product files', copied, dependencies, createdAt: new Date().toISOString()}, null, 2));
console.log(JSON.stringify({directory, dependencies, copied}));
