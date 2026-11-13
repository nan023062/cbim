import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {builtinModules} from 'node:module';
import ts from 'typescript';
import {checkLogicalBoundaries} from './architecture-boundaries.mjs';

// 检查维护中的代码，而非编译后的 JS；类型边和 re-export 同样构成架构依赖。
// .agents 是宿主提供的 Skill 符号链接入口，实际文件归 .claude 扫描，避免重复遍历。
export const roots = ['src', 'tests', 'scripts', 'design', 'docs', '.claude', '.codex'];
const code = /\.(?:[cm]?[jt]sx?)$/;
const slash = value => value.replaceAll('\\', '/');
const key = value => process.platform === 'win32' ? slash(path.resolve(value)).toLowerCase() : path.resolve(value);
// 前后端分组不能掩盖后端内部边界；类型重导出只允许通过通信契约访问 Core。
const layers = {
  core:['core'],
  'core/platform/node':['core/platform/node','core'],
  'core/platform/browser':['core/platform/browser','core'],
  'core/platform/electron':['core/platform/electron','core/platform/node','core'],
  logic:['logic','core','core/platform/node','core/platform/electron'],
  view:['view','bridge/client','bridge/contracts','core','core/platform/browser'],
  'bridge/client':['bridge/client','bridge/contracts','core','core/platform/browser'],
  'bridge/server':['bridge/server','bridge/contracts','logic','core','core/platform/node'],
  foundations:['foundations'],
  'backend/bootstrap':['backend/bootstrap','backend/updater','backend/main'],
  'backend/core':['backend/core','foundations','core','core/platform/node'],'backend/engines':['backend/engines','backend/core','foundations','core'],
  'backend/scheduler-engine':['backend/scheduler-engine','backend/engines','backend/core','foundations','core'],
  'backend/main':['backend/main','backend/scheduler-engine','backend/core','backend/updater','bridge/contracts','foundations','core','core/platform/node'],
  'backend/updater':['backend/updater','bridge/contracts','foundations','core'],
  // 旧 Bridge 的 backend/core 纯契约重导出仍由逻辑边界逐项约束，随 DTO 迁移退出。
  'bridge/contracts':['bridge/contracts','backend/core','core'],
  'bridge/preload':['bridge/preload','bridge/contracts','core'],
  frontend:['frontend','bridge/contracts','core'],
};
// 新四层与旧目录并存；旧 backend/core 是业务，不属于共享 Core。
const layerOf = file => {
  if(file.startsWith('src/core/platform/'))return file.split('/').slice(1,4).join('/');
  for(const layer of ['core','logic','view','frontend'])if(file.startsWith(`src/${layer}/`))return layer;
  if(/^src\/backend\/core\/foundation\/(files|web)\//.test(file))return 'foundations';
  return file.split('/').slice(1,3).join('/');
};

// 已迁移的查询边界按真实职责约束，而非把整个 core 的同层引用视为自由访问。
// 精确文件是公开入口；以 / 结尾的路径表示已核实的完整边界（Foundation 不认识业务）。
const foundation='src/backend/core/foundation/';
const knowledgeTypes='src/backend/core/knowledge/types.ts';
const knowledgeSnapshot='src/backend/core/knowledge/read-models/snapshot.ts';
const teamView='src/backend/core/knowledge/read-models/team.ts';
const businessView='src/backend/core/knowledge/read-models/workspace.ts';
const projectRoot='src/backend/core/workspace/project-root.ts';
// utility 通用入口只能组合环境无关实现，Node 算法必须显式选用独立入口。
const utilityPortable=['src/core/utility/index.ts','src/core/utility/json.ts','src/core/utility/async.ts','src/core/utility/strings.ts','src/core/utility/bytes.ts','src/core/utility/graphs.ts'];
const modelPublic='src/logic/models/index.ts';
const modelService='src/logic/models/service/index.ts';
// 迁移期只开放模型的两个具名入口；旧引擎/调度仅可读纯规则，只有宿主装配可加载服务。
export function allowsModelMigration(from,to){
  if(to===modelPublic)return /^src\/backend\/(core|engines|scheduler-engine|main)\//.test(from)||from==='src/bridge/contracts/models.ts';
  return to===modelService&&(from.startsWith('src/backend/main/')||from.startsWith('src/bridge/server/'));
}
const modelBridgeNames=new Set(['LlmDefinition','LlmModel','LlmProfile','LlmSettings','LlmApi','AlternateConnection','llmApiSchema','connectionSchema','definition','providerPresets','identifyProvider','connectionForEngine','providerSupportsEngine','DiscoveredModel','engineSupportsApi','engineLabel','engineApi','loopEngineSchema','agentModelSelectionSchema','LoopEngine','AgentModelSelection']);
// Web 仅按已迁移的纯契约/服务入口放行；Electron 只由桌面入口装配。
const webPublic='src/logic/web/index.ts';
const webService='src/logic/web/service/index.ts';
const allowsWebMigration=(from,to)=>
  to===webPublic&&(/^src\/backend\/(core|main|scheduler-engine)\//.test(from)||from==='src/bridge/contracts/web.ts')||
  to===webService&&(from.startsWith('src/backend/main/')||from.startsWith('src/bridge/server/'))||
  from==='src/backend/main/main.ts'&&to==='src/core/platform/electron/web-reader.ts';
// 反馈范围与纯协议由 Logic 拥有，平台服务只向宿主装配开放。
const feedbackPublic='src/logic/feedback/index.ts';
const feedbackService='src/logic/feedback/service/index.ts';
const allowsFeedbackMigration=(from,to)=>
  to===feedbackPublic&&(/^src\/backend\/(core|main|scheduler-engine)\//.test(from)||from==='src/bridge/contracts/github-feedback.ts')||
  to===feedbackService&&(from.startsWith('src/backend/main/')||from.startsWith('src/bridge/server/'));
const moduleBoundaries=[
  // 视图专属适配可以组合共享 Core，但不反向依赖页面、通信契约或后端实现。
  {sources:['src/frontend/foundations/'],allow:['src/frontend/foundations/','src/core/utility/index.ts']},
  {sources:utilityPortable,allow:utilityPortable},
  // 引擎只组合可移植算法，不借此接入 files/web、平台适配或 Node 私有实现。
  {sources:['src/backend/engines/'],allow:['src/backend/engines/','src/backend/core/','src/core/utility/index.ts',modelPublic]},
  // 更新子系统仅复用环境无关的数据消费入口，不因此取得 Main 服务或其他基础方案的依赖权。
  {sources:['src/backend/updater/'],allow:['src/backend/updater/','src/bridge/contracts/','src/core/utility/index.ts']},
  {sources:['src/frontend/execution-view/'],allow:['src/frontend/execution-view/','src/frontend/components/','src/bridge/contracts/']},
  {sources:['src/frontend/tasks/'],allow:['src/frontend/tasks/','src/frontend/execution-view/','src/frontend/components/','src/frontend/foundations/utility/index.ts','src/bridge/contracts/']},
  {sources:[foundation],allow:[foundation,'src/core/errors.ts','src/core/utility/index.ts','src/core/platform/node/digest.ts']},
  {sources:[knowledgeTypes],allow:[]},
  {sources:[knowledgeSnapshot],allow:[knowledgeTypes,foundation]},
  {sources:[teamView],allow:[knowledgeTypes,knowledgeSnapshot,foundation]},
  {sources:[projectRoot],allow:[]},
  {sources:[businessView],allow:[knowledgeTypes,knowledgeSnapshot,projectRoot,foundation]},
  {sources:['src/backend/core/knowledge/knowledge-queries.ts'],allow:['src/backend/core/knowledge/read-models/index.ts',knowledgeTypes,foundation]},
  // 文件索引只实现稳定存储契约；工作区身份、服务和日志读取由 workspace 装配。
  {sources:['src/backend/main/history/file-store.ts'],allow:[foundation,'src/core/platform/node/files/index.ts','src/backend/core/team/session-history-storage.ts']},
  {sources:['src/backend/core/budget/model-request-budget-storage.ts'],allow:['src/backend/core/budget/scope-budget.ts','src/backend/core/budget/model-request-budget.ts']},
  {sources:['src/backend/core/execution/engine-tools.ts'],allow:[]},
  {sources:['src/backend/core/execution/index.ts'],allow:['src/backend/core/execution/types.ts','src/backend/core/execution/storage.ts','src/backend/core/execution/runtime/runtime.ts','src/backend/core/execution/member-run.ts','src/backend/core/execution/input-source.ts','src/backend/core/execution/conversation-binding.ts']},
  {sources:['src/backend/scheduler-engine/budget/model-request-budget-service.ts'],allow:[foundation,'src/backend/core/budget/model-request-budget-storage.ts','src/backend/core/budget/model-request-budget.ts','src/backend/core/budget/model-request-budget-rules.ts',modelPublic,'src/backend/core/models/request-budget.ts','src/backend/core/team/workspace-member-rules.ts','src/backend/scheduler-engine/budget/scope-budget-service.ts']},
  // 领域样本不能通过 helpers 或其他中间文件重新加载完整应用。
  {sources:['tests/knowledge-data.ts'],allow:[knowledgeTypes,foundation]},
  {sources:['tests/knowledge-fixture.ts'],allow:[knowledgeTypes,foundation,'src/backend/core/knowledge/knowledge.ts','tests/knowledge-data.ts']},
  // 调度器只组合可移植公开算法，不取得 Node、files 或 web 的访问权。
  {sources:['src/backend/scheduler-engine/'],allow:['src/backend/scheduler-engine/','src/backend/engines/','src/backend/core/','src/core/utility/index.ts',modelPublic,webPublic,feedbackPublic]},
];
const matchesBoundary=(file,entry)=>{
  if(file===entry)return true;
  if(!entry.endsWith('/')||!file.startsWith(entry))return false;
  // Core 的宽入口不包含独立逻辑基础层；根层领域约定也不包含技术子库。
  // 保留原消费者许可，防止目录合并使引擎/调度或只读契约取得 files/web/Node 能力。
  if(entry==='src/backend/core/'&&layerOf(file)==='foundations')return false;
  if(entry===foundation&&file.slice(entry.length).includes('/'))return false;
  return true;
};

// 非字面量加载不能静态证明目标，只允许逐项核实的外部依赖；表达式变化必须重新审核。
export const externalLoads = [
  {file:'scripts/runtime-build.ts',expression:"require(path.join(plugin,'ViteConfig.js'))",reason:'只从锁定的 @electron-forge/plugin-vite 包路径读取生产配置生成器；与冷包共用构建参数，无运行时用户输入'},
  {file:'src/backend/engines/native-tools.ts',expression:'import(pathToFileURL(entry).href)',reason:'仅从冷壳验签固定的 E 目录、旧 pi-runtime 或开发依赖加载 1.5.0 的独立文件/命令操作，不接受模型或工作区给定的模块路径'},
  {file:'src/backend/engines/claude/sdk.ts',expression:'import(pathToFileURL(entry).href)',reason:'仅从固定 CBIM claude-runtime 或开发依赖解析官方 Claude Agent SDK，不接受外部路径'},
  {file:'src/core/platform/node/locking.ts', expression:"requireNative(packagedNative&&fs.existsSync(packagedNative)?packagedNative:'koffi')", reason:'仅从安装包或 node_modules 加载第三方 koffi 原生库'},
  {file:'src/backend/main/platform/files/controlled-file-win32.ts', expression:'requireNative(koffiPath)', reason:'专用 utility 的私有参数仅由 Main 固定 resources/koffi 或 require.resolve(koffi) 注入；独立 Electron 测试宿主同样使用真实第三方库，不来自模型或桌面 IPC'},
  {file:'src/backend/main/platform/isolation/isolation-recovery-win32.ts', expression:'requireNative(koffiPath)', reason:'只接受Main私有装配的resources/koffi或require.resolve(koffi)，用于实际原进程/Job/目录核实，不接模型或桌面路径'},
  {file:'src/backend/main/platform/isolation/isolated-node-win32.ts', expression:'requireNative(koffiPath)', reason:'隔离平台装配固定 resources/koffi 或 require.resolve(koffi)；仅加载第三方原生库，业务请求不能提供该私有参数'},
  {file:'tests/model-capacity-sdk.test.ts', expression:"import(pathToFileURL(path.resolve('node_modules/@earendil-works/pi-ai/dist/api/simple-options.js')).href)", reason:'测试固定版本的第三方 Pi 内部容量函数'},
];
// 冷壳从已验证的构建目录加载固定业务入口；仍把源码边纳入分层与循环检查，不作为外部豁免。
export const generatedLoads = [
  {file:'src/backend/bootstrap/desktop.ts',expression:'loadApplication(entry)',source:'src/backend/main/main.ts'},
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
  const edges = [], unresolved = [], dynamic = [], external = [], externalReferences = [], modelFacadeViolations=[];
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
        const generated=(options.generatedLoads??generatedLoads).find(item=>item.file===info.file&&item.expression===expression);
        if(generated){
          if(!known.has(key(path.join(root,generated.source))))unresolved.push({...info,spec:generated.source});
          else edges.push({from:info.file,to:generated.source,line:info.line,kind:'generated-'+kind,spec:expression});
          return;
        }
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
      // 相对或绝对路径直达 node_modules 也属于外部依赖，不能靠改写导入拼法绕过逻辑边界。
      if (target && slash(target).includes('/node_modules/') || !target && !spec.startsWith('.') && !path.isAbsolute(spec)) externalReferences.push({...info,spec});
      if (actual && known.has(key(actual)) && (!target || key(target) !== key(actual))) edges.push({from:info.file,to:known.get(key(actual)),line:info.line,kind,spec});
    }
    function visit(node) {
      if(relative(file)==='src/bridge/contracts/github-feedback.ts'&&(ts.isImportDeclaration(node)||ts.isExportDeclaration(node))&&node.moduleSpecifier&&ts.isStringLiteral(node.moduleSpecifier)&&/logic\/feedback(?:\/index)?(?:\.ts)?$/.test(node.moduleSpecifier.text)){
        const names=ts.isExportDeclaration(node)?node.exportClause:node.importClause?.namedBindings;
        if(!names||!(ts.isNamedExports(names)||ts.isNamedImports(names))||names.elements.some(item=>!['githubFeedbackConfigSchema','GitHubFeedbackConfig','GitHubFeedbackStatus'].includes((item.propertyName??item.name).text)))modelFacadeViolations.push({file:relative(file),rule:'feedback-bridge-export',boundary:'feedback-bridge-compatibility'});
      }
      if(relative(file)==='src/bridge/contracts/web.ts'&&(ts.isImportDeclaration(node)||ts.isExportDeclaration(node))&&node.moduleSpecifier&&ts.isStringLiteral(node.moduleSpecifier)&&/logic\/web(?:\/index)?(?:\.ts)?$/.test(node.moduleSpecifier.text)){
        const names=ts.isExportDeclaration(node)?node.exportClause:node.importClause?.namedBindings;
        if(!names||!(ts.isNamedExports(names)||ts.isNamedImports(names))||names.elements.some(item=>!['webConfigureInput','WebSettingsView'].includes((item.propertyName??item.name).text)))modelFacadeViolations.push({file:relative(file),rule:'web-bridge-export',boundary:'web-bridge-compatibility'});
      }
      if(relative(file)==='src/bridge/contracts/models.ts'&&(ts.isImportDeclaration(node)||ts.isExportDeclaration(node))&&node.moduleSpecifier&&ts.isStringLiteral(node.moduleSpecifier)&&/logic\/models(?:\/index)?(?:\.ts)?$/.test(node.moduleSpecifier.text)){
        const names=ts.isExportDeclaration(node)?node.exportClause:node.importClause?.namedBindings;
        const named=names&&(ts.isNamedExports(names)||ts.isNamedImports(names));
        if(!named||names.elements.some(item=>!modelBridgeNames.has((item.propertyName??item.name).text)))modelFacadeViolations.push({file:relative(file),line:ast.getLineAndCharacterOfPosition(node.getStart(ast)).line+1,rule:'model-bridge-export',boundary:'model-bridge-compatibility'});
      }
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
    if(e.from.startsWith('src/')&&e.to.startsWith('src/')){
      const a=layerOf(e.from),b=layerOf(e.to);
      const modelMigration=allowsModelMigration(e.from,e.to)||allowsWebMigration(e.from,e.to)||allowsFeedbackMigration(e.from,e.to);
      if((!layers[a]||!layers[a].includes(b))&&!modelMigration)return true;
      // 新逻辑业务模块只通过各自 index.ts 对外；桥服务不得穿透存储和规则实现。
      if(b==='logic'&&(!e.from.startsWith('src/logic/')||e.from.split('/')[2]!==e.to.split('/')[2])&&!/^src\/logic\/[^/]+\/index\.ts$/.test(e.to)&&!modelMigration)return true;
      // 具体引擎选择仅属于调度装配，普通业务编排仍面向 Core 的契约。
      if(a==='backend/scheduler-engine'&&b==='backend/engines'&&!e.from.startsWith('src/backend/scheduler-engine/assembly/'))return true;
    }
    const boundary=moduleBoundaries.find(rule=>rule.sources.some(source=>matchesBoundary(e.from,source)));
    return !!boundary&&!boundary.allow.some(target=>matchesBoundary(e.to,target));
  });
  const circular = cycles([...known.values()],edges);
  const logical = checkLogicalBoundaries([...known.values()],edges,externalReferences);
  logical.violations.push(...modelFacadeViolations);
  // 运行环境限制同时覆盖 npm/内置模块导入，避免绕过 Core 平台入口直接取得 Node/Electron。
  for(const reference of externalReferences){
    const layer=layerOf(reference.file);
    if(['view','frontend','bridge/client','bridge/contracts','core/platform/browser'].includes(layer)
      &&(reference.spec.startsWith('node:')||builtinModules.includes(reference.spec)||reference.spec==='electron'||reference.spec.startsWith('electron/'))){
      logical.violations.push({...reference,rule:'runtime-environment',boundary:layer});
    }
  }
  return {ok:!circular.length && !unresolved.length && !dynamic.length && !violations.length && !logical.violations.length, files:unique.length, edges, cycles:circular, unresolved, dynamic, external, violations, logicalViolations:logical.violations, logicalCoverage:logical.coverage};
}

if (process.argv[1] && key(fileURLToPath(import.meta.url)) === key(process.argv[1])) {
  try {
    const report = auditDependencies();
    console.log(`依赖检查：${report.files} 个文件，${report.edges.length} 条依赖（包含类型），${report.cycles.length} 个循环。`);
    for (const cycle of report.cycles) for (const edge of cycle.edges) console.error(`${edge.from}:${edge.line} -> ${edge.to} [${edge.kind}]`);
    for (const field of ['unresolved','dynamic','violations','logicalViolations']) if (report[field].length) console.error(field,JSON.stringify(report[field],null,2));
    console.log(`逻辑边界：${report.logicalCoverage.map(item=>`${item.id}=${item.files}`).join('，')}；违规 ${report.logicalViolations.length}。`);
    console.log(`已审核外部动态加载：${report.external.length} 处；不将其视为项目内部依赖。`);
    if (!report.ok) process.exitCode = 1;
  } catch (error) {console.error(error); process.exitCode = 1;}
}
