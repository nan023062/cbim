/** 模块测试输入快照。独立契约必须显式声明；没有行为契约时用实现闭包保守回退。 */
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {isTestSupport} from './test-paths.mjs';

export const fingerprint = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const slash = value => value.replaceAll('\\', '/');
const belongs = (file, entry) => file === entry || entry.endsWith('/') && path.posix.dirname(file) + '/' === entry;

/** 明确的本地输入可为文件或目录；路径越界、缺失和符号链接不能变成“没有变化”。 */
export function inputFiles(root, entries)
{
  const result = new Set();
  function visit(relative)
  {
    const absolute = path.resolve(root, relative), local = slash(path.relative(root, absolute));
    if (!local || local === '..' || local.startsWith('../') || path.isAbsolute(local)) throw Error('Invalid test input: ' + relative);
    const stat = fs.lstatSync(absolute);
    if (stat.isSymbolicLink()) throw Error('Symbolic test input: ' + relative);
    if (stat.isDirectory())
    {
      for (const name of fs.readdirSync(absolute).sort())
        if (!['node_modules', '.git', 'build', '.vite', 'test-results'].includes(name)) visit(local + '/' + name);
    }
    else if (stat.isFile()) result.add(local);
    else throw Error('Unsupported test input: ' + relative);
  }
  for (const entry of entries) visit(entry);
  return [...result].sort();
}

const configuration = ['package.json', 'pnpm-lock.yaml', 'tsconfig.json', 'vitest.config.ts',
  'scripts/test-modules.mjs', 'scripts/test-paths.mjs', 'scripts/test-fingerprints.mjs', 'scripts/incremental-tests.mjs',
  'scripts/check-dependencies.mjs', 'scripts/architecture-boundaries.mjs', 'scripts/logic-domain-entries.mjs',
  'scripts/logic-service-entries.mjs', 'scripts/logic-runtime-entries.mjs', 'scripts/ci-test-sequencer.ts', 'scripts/ci-test-shards.ts'];

/** 调度调用 ID 和 pnpm 的命令展示标签不参与产品行为；其余环境值只进入摘要，不写回原文。 */
export function testEnvironment(variables = process.env)
{
  const orchestration = new Set(['CODEX_TOOL_CALL_ID', 'npm_lifecycle_event', 'npm_lifecycle_script', 'npm_command']);
  return {node: process.version, platform: process.platform, arch: process.arch,
    variables: Object.entries(variables).filter(([key, value]) => value !== undefined && !orchestration.has(key)).sort(([a], [b]) => a.localeCompare(b))};
}

/** 不保存凭据原文；环境、工具链及执行配置共同限定成功结果可以复用的范围。 */
export function snapshotTests(root, catalog, entries, dependencies, options = {})
{
  const graph = new Map(), allFiles = dependencies.sourceFiles ?? [...new Set(dependencies.edges.flatMap(edge => [edge.from, edge.to]))];
  for (const edge of dependencies.edges)
  {
    if (!graph.has(edge.from)) graph.set(edge.from, new Set());
    graph.get(edge.from).add(edge.to);
  }
  const closure = seeds => {
    const seen = new Set(seeds), queue = [...seeds];
    for (let i = 0; i < queue.length; i++) for (const next of graph.get(queue[i]) ?? []) if (!seen.has(next)) { seen.add(next); queue.push(next); }
    return [...seen].sort();
  };
  const hashes = new Map();
  function hashFiles(files)
  {
    return fingerprint([...new Set(files)].sort().map(file => {
      if (!hashes.has(file)) hashes.set(file, createHash('sha256').update(fs.readFileSync(path.join(root, file))).digest('hex'));
      return [file, hashes.get(file)];
    }));
  }
  const environment = options.environment ?? testEnvironment();
  const execution = fingerprint({schema: 1, root: slash(path.resolve(root)), environment,
    configuration: hashFiles(configuration.filter(file => fs.existsSync(path.join(root, file))))});
  const modules = {};
  for (const [name, definition] of Object.entries(catalog.modules))
  {
    const owned = allFiles.filter(file => !isTestSupport(file) && definition.roots.some(entry => belongs(file, entry)));
    // 非代码资源不会出现在 import 图中，但直接归属文件及显式动态输入仍属于模块验证输入。
    const resources = definition.roots.filter(entry => entry.endsWith('/')).flatMap(entry => fs.readdirSync(path.join(root, entry), {withFileTypes: true})
      .filter(item => item.isFile() && !/\.(?:md|[cm]?[jt]sx?)$/.test(item.name)).map(item => entry + item.name));
    const inputs = inputFiles(root, definition.inputs ?? []);
    const ownedFiles = [...new Set([...owned, ...resources])].sort();
    const implementationFiles = [...new Set([...ownedFiles, ...inputs])].sort();
    const implementation = hashFiles(implementationFiles);
    const explicit = definition.contract;
    if (explicit && (!Array.isArray(explicit.files) || !explicit.files.length || typeof explicit.revision !== 'string' || !explicit.revision.trim()))
      throw Error('Explicit contract requires files and a behavior revision: ' + name);
    const contractFiles = explicit ? inputFiles(root, explicit.files) : implementationFiles;
    modules[name] = {implementation, contractMode: explicit ? 'explicit' : 'implementation', ownedFiles, implementationFiles, inputs, contractFiles};
  }
  function contractFingerprint(name, stack = [])
  {
    const module = modules[name];
    if (module.contract) return module.contract;
    if (stack.includes(name)) return hashFiles(closure(module.contractFiles));
    const definition = catalog.modules[name], files = new Set(module.contractFiles), queue = [...files], dependencies = {};
    for (let i = 0; i < queue.length; i++) for (const target of graph.get(queue[i]) ?? [])
    {
      const owner = Object.entries(catalog.modules).find(([other, value]) => other !== name && value.contract && value.roots.some(entry => belongs(target, entry)));
      if (owner && !module.implementationFiles.includes(target)) dependencies[owner[0]] = contractFingerprint(owner[0], [...stack, name]);
      else if (!files.has(target)) { files.add(target); queue.push(target); }
    }
    return module.contract = fingerprint({revision: definition.contract?.revision ?? null, mode: module.contractMode, contents: hashFiles([...files]), dependencies});
  }
  for (const name of Object.keys(modules)) contractFingerprint(name);
  const groups = [];
  for (const name of Object.keys(modules)) for (const kind of ['unit', 'contract', 'integration'])
  {
    const definition = catalog.modules[name], module = modules[name];
    const files = entries.filter(entry => entry.module === name && entry.kind === kind).map(entry => entry.file).sort();
    if (!files.length) continue;
    const dependencyContracts = {}, local = new Set([...files, ...module.implementationFiles]);
    // 只有单元允许在明确的外部契约边界停止；契约和集成验证实际组合，继续追踪真实实现。
    const queue = [...local], visited = new Set();
    for (let i = 0; i < queue.length; i++)
    {
      const file = queue[i];
      if (visited.has(file)) continue;
      visited.add(file);
      for (const target of graph.get(file) ?? [])
      {
        const owner = Object.entries(catalog.modules).find(([other, value]) => other !== name && value.contract && value.roots.some(entry => belongs(target, entry)));
        if (kind === 'unit' && owner && !module.implementationFiles.includes(target)) dependencyContracts[owner[0]] = modules[owner[0]].contract;
        else { local.add(target); queue.push(target); }
      }
    }
    // 包括未抽成独立契约的依赖，避免“类型没改但行为变了”时复用旧结果。
    const related = new Set([...local]);
    // 额外输入是读取关系，不是所有权；全仓审计的输入不能使所有业务反向依赖审计工具。
    for (const [other, value] of Object.entries(modules)) if (other !== name && value.ownedFiles.some(file => related.has(file)))
      dependencyContracts[other] = value.contract;
    const input = hashFiles([...local]);
    const key = name + ':' + kind;
    groups.push({key, module: name, kind, files, implementation: module.implementation, contract: module.contract,
      dependencyContracts, input, execution, cacheable: kind !== 'integration' && definition.cache !== false,
      fingerprint: fingerprint({key, files, roots: definition.roots, input, execution, contract: module.contract, dependencyContracts})});
  }
  return {schema: 1, modules, groups};
}

export function planTests(snapshot, records = {}, options = {})
{
  const kind = options.kind ?? 'unit';
  if (!['unit', 'contract', 'integration', 'all'].includes(kind)) throw Error('Unknown test kind: ' + kind);
  const groups = snapshot.groups.filter(group => (!options.module || group.module === options.module) && (kind === 'all' || group.kind === kind));
  if (!groups.length) throw Error('No ' + kind + ' tests for module ' + (options.module ?? '*'));
  return groups.map(group => {
    const stored = records[group.key];
    const previous = stored && typeof stored === 'object' && typeof stored.fingerprint === 'string'
      && typeof stored.execution === 'string' && stored.dependencyContracts && typeof stored.dependencyContracts === 'object' ? stored : undefined;
    const reason = options.force ? 'forced' : !group.cacheable ? 'non-cacheable' : !previous ? 'no-success-record'
      : previous.status !== 'passed' ? previous.status : previous.execution !== group.execution ? 'execution-environment-changed'
      : previous.implementation !== group.implementation ? 'module-changed' : previous.contract !== group.contract ? 'contract-changed'
      : fingerprint(previous.dependencyContracts) !== fingerprint(group.dependencyContracts) ? 'dependency-contract-changed'
      : previous.fingerprint !== group.fingerprint ? 'tests-or-inputs-changed' : 'unchanged';
    return {...group, action: reason === 'unchanged' ? 'reuse' : 'run', reason};
  });
}
