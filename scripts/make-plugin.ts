import fs from 'node:fs/promises';
import path from 'node:path';
import { collectDeclaredPlugin } from './runtime-packaging';

async function main() {
  const [directory, ...extra] = process.argv.slice(2);
  if (!directory || extra.length) throw Error('用法：pnpm make:plugin <含 plugin.json 的产品目录>');
  const root = path.resolve(directory);
  const parent = path.resolve('build/runtime');
  if (parent === root || parent.startsWith(root + path.sep)) throw Error('插件目录不能包含构建输出');
  await fs.mkdir(parent, { recursive: true });
  const output = await fs.mkdtemp(path.join(parent, 'plugin-'));
  const pkg = await collectDeclaredPlugin(root, output);
  await fs.writeFile(path.join(output, 'engines.json'), JSON.stringify([pkg], null, 2));
  console.log(output);
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
