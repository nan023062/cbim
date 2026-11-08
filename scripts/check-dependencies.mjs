import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import ts from 'typescript';

// 检查维护中的代码，而非编译后的 JS；类型边和 re-export 同样构成架构依赖。
// .agents 是宿主提供的 Skill 符号链接入口，实际文件归 .claude 扫描，避免重复遍历。
export const roots = ['src', 'tests', 'scripts', 'design', 'docs', '.claude', '.codex'];
const code = /\.(?:[cm]?[jt]sx?)$/;
const slash = value => value.replaceAll('\\', '/');
const key = value => process.platform === 'win32' ? slash(path.resolve(value)).toLowerCase() : path.resolve(value);
// 前后端分组不能掩盖后端内部边界；类型重导出只允许通过通信契约访问 Core。
const layers = {
  'backend/core':['backend/core'],
  'backend/scheduler-engine':['backend/scheduler-engine','backend/core'],
  'backend/main':['backend/main','backend/scheduler-engine','backend/core','bridge/contracts'],
  'bridge/contracts':['bridge/contracts','backend/core'],
  'bridge/preload':['bridge/preload','bridge/contracts'],
  frontend:['frontend','bridge/contracts'],
};
const layerOf = file => file.startsWith('src/frontend/') ? 'frontend' : file.split('/').slice(1,3).join('/');

// 非字面量加载不能静态证明目标，只允许逐项核实的外部依赖；表达式变化必须重新审核。
export const externalLoads = [
  {file:'src/backend/main/platform/locking.ts', expression:"requireNative(packagedNative&&fs.existsSync(packagedNative)?packagedNative:'koffi')", reason:'仅从安装包或 node_modules 加载第三方 koffi 原生库'},
  {file:'src/backend/main/platform/controlled-file-win32.ts', expression:'requireNative(koffiPath)', reason:'专用 utility 的私有参数仅由 Main 固定 resources/koffi 或 require.resolve(koffi) 注入；独立 Electron 测试宿主同样使用真实第三方库，不来自模型或桌面 IPC'},
  {file:'src/backend/main/platform/isolation-recovery-win32.ts', expression:'requireNative(koffiPath)', reason:'只接受Main私有装配的resources/koffi或require.resolve(koffi)，用于实际原进程/Job/目录核实，不接模型或桌面路径'},
  {file:'src/backend/main/platform/isolated-node-win32.ts', expression:'requireNative(koffiPath)', reason:'隔离平台装配固定 resources/koffi 或 require.resolve(koffi)；仅加载第三方原生库，业务请求不能提供该私有参数'},
  {file:'tests/model-catalog.test.ts', expression:"import(pathToFileURL(path.resolve('node_modules/@earendil-works/pi-ai/dist/api/simple-options.js')).href)", reason:'测试固定版本的第三方 Pi 内部容量函数'},
];

/** 返回强连通分量及其中全部依赖边，不遗漏类型环、长环或自引用。 */
function cycles(nodes, edges) {
  const graph = new Map(nodes.map(n => [n, []]));
  for (const edge of edges) graph.get(edge.from).push(edge.to);
  let sequence = 0;
  const indices = new Map(), low = new Map(), stack = [], active = new Set(), result = [];
  function visit(node) {
    indices.set(node, sequence); low.set(node, sequence++); stack.push(node); active.add(node);
    for (const next of graph.get(node)) {
      if (!indices.has(next)) {visit(next); low.set(node, Math.min(low.get(node), low.get(next)));}
      else if (active.has(next)) low.set(node, Math.min(low.get(node), indices.get(next)));
    }
    if (low.get(node) !== indices.get(node)) return;
    const group = []; let next;
    do {next = stack.pop(); active.delete(next); group.push(next);} while (next !== node);
    if (group.length > 1 || graph.get(node).includes(node)) {
      const members = new Set(group);
      result.push({files:group.sort(), edges:edges.filter(e => members.has(e.from) && members.has(e.to))});
    }
  }
  for (const node of nodes) if (!indices.has(node)) visit(node);
  return result;
}

/** 只读扫描。默认覆盖全部 src、测试、脚本及根配置；显式返回无法静态判断的加载。 */
export function auditDependencies(root = process.cwd(), options = {}) {
  root = path.resolve(root);
  const relative = file => slash(path.relative(root, file));
  const files = [];
  function walk(dir) {
    if (!fs.existsSync(dir)) return;
    for (const entry of fs.readdirSync(dir, {withFileTypes:true})) {
      if (entry.isSymbolicLink()) throw new Error(`扫描范围中存在符号链接，请明确其源代码归属：${relative(path.join(dir,entry.name))}`);
      if (['node_modules', '.git', 'build', '.vite', 'test-results', '__pycache__'].includes(entry.name)) continue;
      const file = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(file);
      else if (code.test(file)) files.push(file);
    }
  }
  for (const dir of options.roots ?? roots) walk(path.join(root, dir));
  for (const entry of fs.readdirSync(root, {withFileTypes:true})) if (entry.isFile() && code.test(entry.name)) files.push(path.join(root,entry.name));
  const unique = [...new Set(files)].sort();
  const known = new Map(unique.map(file => [key(file), relative(file)]));
  const configFile = path.join(root, 'tsconfig.json');
  let compilerOptions = {moduleResolution:ts.ModuleResolutionKind.Bundler, allowJs:true};
  if (fs.existsSync(configFile)) {
    const config = ts.readConfigFile(configFile, ts.sys.readFile);
    if (config.error) throw new Error(ts.flattenDiagnosticMessageText(config.error.messageText, '\n'));
    const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, root);
    const errors = parsed.errors.filter(e => e.code !== 18003);
    if (errors.length) throw new Error(errors.map(e => ts.flattenDiagnosticMessageText(e.messageText,'\n')).join('\n'));
    compilerOptions = {...compilerOptions, ...parsed.options};
  }
  const edges = [], unresolved = [], dynamic = [], external = [];
  for (const file of unique) {
    const ast = ts.createSourceFile(file, fs.readFileSync(file,'utf8'), ts.ScriptTarget.Latest, true);
    if (ast.parseDiagnostics.length) throw new Error(`无法解析 ${relative(file)}：${ast.parseDiagnostics.map(e => ts.flattenDiagnosticMessageText(e.messageText,'\n')).join('\n')}`);
    // createRequire 的本地别名也要纳入，避免仅匹配名为 require 的调用。
    const loaders = new Set(['require', 'requireRuntime', 'requireNative']);
    function collect(node) {
      if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer && ts.isCallExpression(node.initializer) && /(?:^|\.)createRequire$/.test(node.initializer.expression.getText(ast))) loaders.add(node.name.text);
      ts.forEachChild(node,collect);
    }
    collect(ast);
    function add(node, literal, kind) {
      const info = {file:relative(file), line:ast.getLineAndCharacterOfPosition(node.getStart(ast)).line+1, kind};
      if (!literal || !ts.isStringLiteralLike(literal)) {
        const expression = node.getText(ast);
        const approved = (options.externalLoads ?? externalLoads).find(e => e.file === info.file && e.expression === expression);
        (approved ? external : dynamic).push({...info, expression, ...(approved ? {reason:approved.reason} : {})});
        return;
      }
      const spec = literal.text;
      // TS 可能优先解析相邻 .d.mts；同时保留真实 JS 实现边，避免声明文件遮蔽运行依赖。
      const actual = spec.startsWith('.') ? path.resolve(path.dirname(file),spec) : undefined;
      let target = ts.resolveModuleName(spec,file,compilerOptions,ts.sys).resolvedModule?.resolvedFileName;
      if (!target && spec.startsWith('.')) {
        const base = path.resolve(path.dirname(file),spec);
        target = [base,...['.ts','.tsx','.js','.mjs','.cjs','.mts','.cts','/index.ts','/index.js'].map(ext => base+ext)].find(p => fs.existsSync(p) && fs.statSync(p).isFile());
      }
      if (target && known.has(key(target))) edges.push({from:info.file, to:known.get(key(target)), line:info.line, kind, spec});
      else if (target && !slash(target).includes('/node_modules/') && code.test(target)) unresolved.push({...info, spec, reason:'目标代码在扫描范围之外'});
      else if (!target && (spec.startsWith('.') || path.isAbsolute(spec) || Object.keys(compilerOptions.paths ?? {}).some(pattern => spec.startsWith(pattern.split('*')[0])))) unresolved.push({...info, spec, reason:'本地引用无法解析'});
      if (actual && known.has(key(actual)) && (!target || key(target) !== key(actual))) edges.push({from:info.file,to:known.get(key(actual)),line:info.line,kind,spec});
    }
    function visit(node) {
      if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) {if (node.moduleSpecifier) add(node,node.moduleSpecifier,node.isTypeOnly || node.importClause?.isTypeOnly ? 'type' : 'import/export');}
      else if (ts.isImportTypeNode(node)) add(node,ts.isLiteralTypeNode(node.argument) ? node.argument.literal : undefined,'import type');
      else if (ts.isImportEqualsDeclaration(node) && ts.isExternalModuleReference(node.moduleReference)) add(node,node.moduleReference.expression,'import equals');
      else if (ts.isCallExpression(node) && (node.expression.kind === ts.SyntaxKind.ImportKeyword || loaders.has(node.expression.getText(ast)))) add(node,node.arguments[0],'dynamic/require');
      ts.forEachChild(node,visit);
    }
    visit(ast);
    for (const reference of ast.referencedFiles) {
      const spec = reference.fileName.startsWith('.') ? reference.fileName : './'+reference.fileName;
      add({getStart:()=>reference.pos},ts.factory.createStringLiteral(spec),'reference path');
    }
  }
  const violations = edges.filter(e => {
    if (!e.from.startsWith('src/') || !e.to.startsWith('src/')) return false;
    const a = layerOf(e.from), b = layerOf(e.to);
    return !layers[a] || !layers[a].includes(b);
  });
  const circular = cycles([...known.values()],edges);
  return {ok:!circular.length && !unresolved.length && !dynamic.length && !violations.length, files:unique.length, edges, cycles:circular, unresolved, dynamic, external, violations};
}

if (process.argv[1] && key(fileURLToPath(import.meta.url)) === key(process.argv[1])) {
  try {
    const report = auditDependencies();
    console.log(`依赖检查：${report.files} 个文件，${report.edges.length} 条依赖（包含类型），${report.cycles.length} 个循环。`);
    for (const cycle of report.cycles) for (const edge of cycle.edges) console.error(`${edge.from}:${edge.line} -> ${edge.to} [${edge.kind}]`);
    for (const field of ['unresolved','dynamic','violations']) if (report[field].length) console.error(field,JSON.stringify(report[field],null,2));
    console.log(`已审核外部动态加载：${report.external.length} 处；不将其视为项目内部依赖。`);
    if (!report.ok) process.exitCode = 1;
  } catch (error) {console.error(error); process.exitCode = 1;}
}
