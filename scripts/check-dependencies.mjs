import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {builtinModules} from 'node:module';
import ts from 'typescript';
import {isTestSupport, isUnitTestPath} from './test-paths.mjs';
import {checkLogicalBoundaries} from './architecture-boundaries.mjs';
import {isDomainFile,domainPublicEntries} from './logic-domain-entries.mjs';
import {isService,servicePublicEntries,businessDataEntries} from './logic-service-entries.mjs';
import {isEngine,runtimePublicEntries} from './logic-runtime-entries.mjs';

// 检查维护中的代码，而非编译后的 JS；类型边和 re-export 同样构成架构依赖。
// .agents 是宿主提供的 Skill 符号链接入口，实际文件归 .claude 扫描，避免重复遍历。
export const roots = ['src', 'tests', 'unittest', 'scripts', 'design', 'ainative/docs', '.claude', '.codex'];
const code = /\.(?:[cm]?[jt]sx?)$/;
const slash = value => value.replaceAll('\\', '/');
const key = value => process.platform === 'win32' ? slash(path.resolve(value)).toLowerCase() : path.resolve(value);
// 前后端分组不能掩盖后端内部边界；类型重导出只允许通过通信契约访问 Core。
const layers = {
  core:['core'],
  'core/platform/node':['core/platform/node','core'],
  'core/platform/browser':['core/platform/browser','core'],
  'core/platform/electron':['core/platform/electron','core/platform/node','core'],
  'engine-plugins':['engine-plugins','logic','core','core/platform/node'],
  'resource/plugins':['core','core/platform/node','resource/plugins'],
  resource:['resource','core','core/platform/node'],
  'framework/monitor':['framework/monitor','framework'],
  framework:['framework','core'],
  'logic':['logic','resource/plugins','framework','framework/monitor','core','core/platform/node'],
  'framework-ui':['framework-ui'],
  'view':['view','framework-ui','bridge/contracts'],
  updater:['updater'],
  'bridge/client':['bridge/client','bridge/contracts','core','core/platform/browser'],
  'bridge/server':['logic','bridge/server','bridge/contracts','core','core/platform/node','core/platform/electron'],
  'bridge/contracts':['bridge/contracts','core'],
  'bridge/preload':['bridge/preload','bridge/contracts','core'],
};
// 四层已经落地；平台与桥接子边界继续独立检查，不接受已退出的源码层级。
const layerOf = file => {
  if(['src/core/io/node.ts','src/core/io/text-files.ts','src/core/io/digest.ts','src/core/io/compression.ts','src/core/io/locking.ts','src/core/io/serialization.ts'].includes(file))return 'core/platform/node';
  if(file==='src/core/debug/node.ts')return 'core/platform/node';
  if(file==='src/core/io/electron.ts')return 'core/platform/electron';
  if(['node','page-reader','public-http','browser-proxy'].some(name=>file==='src/core/web/'+name+'.ts'))return 'core/platform/node';
  if(file==='src/core/web/electron.ts')return 'core/platform/electron';
  if(file.startsWith('src/core/platform/'))return file.split('/').slice(1,4).join('/');
  for(const layer of ['core','engine-plugins','resource/plugins','resource','framework/monitor','framework','logic','view','framework-ui','updater'])if(file.startsWith('src/'+layer+'/'))return layer;
  return file.split('/').slice(1,3).join('/');
};

// 已迁移的查询边界按真实职责约束，而非把整个 core 的同层引用视为自由访问。
// 精确文件是公开入口；以 / 结尾的路径表示已核实的完整边界（Foundation 不认识业务）。
const foundation='@shared-domain-foundations';
const foundationEntries=['src/logic/io-errors/json.ts','src/core/io/json.ts','src/core/io/serialization.ts','src/logic/execution/ports/identity.ts'];
// utility 通用入口只能组合环境无关实现，Node 算法必须显式选用独立入口。
const utilityPortable=['src/core/utility/index.ts','src/core/utility/async.ts','src/core/utility/graphs.ts'];
const enginePublic='src/logic/engines/index.ts',engineService='src/logic/engines/service/index.ts';
const allowsEngineAccess=(from,to)=>from==='src/logic/engines/package-status.ts'&&to==='src/logic/updates/engine-artifacts.ts'||to===enginePublic&&(from.startsWith('src/logic/'))||to===engineService&&(from.startsWith('src/bridge/server/')||isService(from));
const modelPublic='src/logic/models/index.ts';
const modelService='src/logic/models/service/index.ts';
// 纯模型与有副作用的服务入口分开；引擎和编排的访问权由模块边界进一步收紧。
export function allowsModelAccess(from,to){
  if(to===modelPublic)return from.startsWith('src/logic/');
  return to===modelService&&(from.startsWith('src/bridge/server/')||isService(from));
}
// 反馈范围与纯协议由 Logic 拥有，平台服务只向宿主装配开放。
const feedbackPublic='src/logic/feedback/index.ts';
const allowsFeedbackAccess=(from,to)=>to===feedbackPublic&&from.startsWith('src/logic/');
const resourcePublic='src/resource/index.ts',resourceService='src/resource/service/index.ts';
const allowsResourceAccess=(from,to)=>from==='src/logic/models/service/llm-profiles.ts'&&to==='src/resource/models/local-profiles.ts'||['src/logic/resource-management/connector-packages.ts','src/logic/engines/packages/engine-packages.ts'].includes(from)&&to==='src/resource/plugins/index.ts'||from==='src/logic/projects/resources.ts'&&to==='src/resource/project-architecture.ts'||['src/logic/projects/offices.ts','src/logic/projects/navigation.ts'].includes(from)&&to==='src/resource/office-history.ts'||from==='src/logic/resource-management/index.ts'&&[resourcePublic,resourceService].includes(to)||from==='src/logic/application/index.ts'&&to===resourceService||from==='src/logic/models/service/llm-profiles.ts'&&to==='src/resource/models/local-profiles.ts'||to===resourcePublic&&(from.startsWith('src/logic/'))||to===resourceService&&(from.startsWith('src/bridge/server/')||isService(from));
const moduleBoundaries=[
  {sources:['src/view/desktop/'],allow:['src/view/desktop/','src/view/office/','src/view/settings/','src/view/discovery/','src/view/extension/','src/view/shared/','src/framework-ui/','src/bridge/contracts/']},
  ...['discovery','extension','monitor','office','settings','shared'].map(name=>({sources:['src/view/'+name+'/'],allow:['src/view/'+name+'/','src/view/shared/','src/framework-ui/','src/bridge/contracts/']})),
  // 冷壳只持有更新状态和已验证业务入口，不直接装配普通业务服务。
  {sources:['src/bridge/server/bootstrap/'],allow:['src/bridge/server/bootstrap/','src/bridge/server/desktop/main.ts','src/logic/updates/service/','src/updater/index.ts']},
  {sources:utilityPortable,allow:utilityPortable},
  // 记忆包仅此存储实现使用公开原子单文件机制，目录权限与正式知识仍由业务边界负责。
  {sources:['src/engine-plugins/memory/storage.ts'],allow:['src/engine-plugins/memory/','@domain-public','src/core/io/text-files.ts']},
  // 其它引擎只组合可移植算法，不借此接入 files/web、平台适配或 Node 私有实现。
  {sources:['src/engine-plugins/'],allow:['src/engine-plugins/','@domain-public','src/core/utility/index.ts','src/core/io/index.ts',modelPublic,enginePublic]},
  // 更新子系统仅复用环境无关的数据消费入口，不因此取得 Main 服务或其他基础方案的依赖权。
  {sources:['src/logic/updates/service/engine-artifacts.ts'],allow:['src/logic/updates/service/','src/logic/updates/engine-artifacts.ts','src/core/utility/index.ts','src/core/io/text-files.ts']},
  {sources:['src/logic/updates/service/runtime-manifest.ts'],allow:['src/framework/kernel/index.ts']},
  {sources:['src/logic/updates/service/desktop-releases.ts'],allow:['src/logic/updates/service/','src/logic/updates/contracts.ts','src/updater/release-policy.ts']},
  {sources:['src/logic/updates/service/runtime-download.ts'],allow:['src/logic/updates/service/','src/core/io/index.ts','src/core/io/node.ts']},
  {sources:['src/logic/updates/service/'],allow:['src/logic/updates/service/','src/logic/updates/contracts.ts','src/logic/updates/engine-artifacts.ts','src/core/utility/index.ts','src/core/io/index.ts']},
  {sources:['src/core/io/serialization.ts'],allow:['src/core/io/index.ts','src/core/io/digest.ts']},
  {sources:[foundation],allow:[foundation,'src/core/utility/index.ts','src/core/io/digest.ts']},
  // 文件索引只实现稳定存储契约；工作区身份、服务和日志读取由 workspace 装配。
  {sources:['src/logic/execution/rules/engine-tools.ts'],allow:[]},
  // 领域样本不能通过 helpers 或其他中间文件重新加载完整应用。
  // 调度器只组合可移植公开算法，不取得 Node、files 或 web 的访问权。
];
const matchesBoundary=(file,entry)=>{
  if(entry==='@domain-public')return isDomainFile(file)&&domainPublicEntries.has(file)||['src/core/io/json.ts','src/core/io/serialization.ts'].includes(file);
  if(entry===foundation)return foundationEntries.includes(file);
  return file===entry||entry.endsWith('/')&&file.startsWith(entry);
};

// 非字面量加载不能静态证明目标，只允许逐项核实的外部依赖；表达式变化必须重新审核。
export const externalLoads = [
  {file:'src/logic/projects/office-engine-loader.ts',expression:'loadAdapter(descriptor.entry)',reason:'Load the verified immutable engine package entry.'},
  {file:'src/logic/resource-management/connector-packages.ts',expression:'loadProduct(entry)',reason:'Load the registered connector package entry.'},
  {file:'src/logic/resource-management/connector-runtime.ts',expression:'loadProduct(entry)',reason:'仅加载宿主按产品 ID 登记的绝对 CJS 入口'},
  {file:'scripts/runtime-build.ts',expression:"require(path.join(plugin,'ViteConfig.js'))",reason:'只从锁定的 @electron-forge/plugin-vite 包路径读取生产配置生成器；与冷包共用构建参数，无运行时用户输入'},
  {file:'src/engine-plugins/native-tools.ts',expression:'import(pathToFileURL(entry).href)',reason:'仅从冷壳验签固定的 E 目录、旧 pi-runtime 或开发依赖加载 1.5.0 的独立文件/命令操作，不接受模型或工作区给定的模块路径'},
  {file:'src/engine-plugins/claude/sdk.ts',expression:'import(pathToFileURL(entry).href)',reason:'仅从固定 CBIM claude-runtime 或开发依赖解析官方 Claude Agent SDK，不接受外部路径'},
  {file:'src/core/io/locking.ts', expression:"requireNative(packagedNative && fs.existsSync(packagedNative) ? packagedNative : 'koffi')", reason:'仅从安装包或 node_modules 加载第三方 koffi 原生库'},
  {file:'tests/src/engine-plugins/pi/model-capacity-sdk.test.ts', expression:"import(pathToFileURL(path.resolve('node_modules/@earendil-works/pi-ai/dist/api/simple-options.js')).href)", reason:'测试固定版本的第三方 Pi 内部容量函数'},
];
// 冷壳从已验证的构建目录加载固定业务入口；仍把源码边纳入分层与循环检查，不作为外部豁免。
export const generatedLoads = [
  ...['pi','claude','codex','memory'].flatMap(engine=>[
    {file:'src/logic/projects/office-engine-loader.ts',expression:'loadAdapter(descriptor.entry)',source:'src/engine-plugins/'+engine+'/package.ts'},
    {file:'scripts/build-engine-adapters.mjs',expression:'load(file)',source:'src/engine-plugins/'+engine+'/package.ts'},
  ]),
  {file:'src/bridge/server/bootstrap/desktop.ts',expression:'loadApplication(entry)',source:'src/bridge/server/desktop/main.ts'},
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
      if(relative(file).startsWith('src/')&&!isEngine(relative(file))&&ts.isCallExpression(node)&&/(?:^|\.)(?:spawn|spawnSync|exec|execSync|execFile|execFileSync)$/.test(node.expression.getText(ast))){
        const command=node.arguments[0];
        if(command&&ts.isStringLiteralLike(command)&&/^(?:.*[\\/])?(?:codex|claude|pi)(?:\.(?:exe|cmd))?(?:\s|$)/i.test(command.text))
          modelFacadeViolations.push({file:relative(file),line:ast.getLineAndCharacterOfPosition(command.getStart(ast)).line+1,rule:'engine-cli-outside-adapter'});
      }
      ts.forEachChild(node,collect);
    }
    collect(ast);
    function add(node, literal, kind) {
      const info = {file:relative(file), line:ast.getLineAndCharacterOfPosition(node.getStart(ast)).line+1, kind};
      if (!literal || !ts.isStringLiteralLike(literal)) {
        const expression = node.getText(ast);
        const generated=(options.generatedLoads??generatedLoads).filter(item=>item.file===info.file&&item.expression===expression);
        if(generated.length){
          for(const target of generated){
            if(!known.has(key(path.join(root,target.source))))unresolved.push({...info,spec:target.source});
            else edges.push({from:info.file,to:target.source,line:info.line,kind:'generated-'+kind,spec:expression});
          }
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
    if(e.to.startsWith('src/resource/')&&(e.from.startsWith('src/view/')||e.from.startsWith('src/framework/')))return true;
    if(e.from.startsWith('src/')&&!isTestSupport(e.from)&&isTestSupport(e.to))return true;
    if(isUnitTestPath(e.from)){
      const boundary=moduleBoundaries.find(rule=>rule.sources.some(source=>isTestSupport(source)&&matchesBoundary(e.from,source)));
      return !!boundary&&!boundary.allow.some(target=>matchesBoundary(e.to,target));
    }
    if(e.from.startsWith('src/')&&e.to.startsWith('src/')){
      if(e.from.startsWith('src/core/')&&e.to.startsWith('src/core/')&&e.from.split('/')[2]!==e.to.split('/')[2])return true;
      if(e.to.startsWith('src/framework/kernel/')&&!e.from.startsWith('src/framework/kernel/')&&e.to!=='src/framework/kernel/index.ts')return true;
      const a=layerOf(e.from),b=layerOf(e.to);
      if (a==='view'&&b==='logic') return true;
      if(e.from==='src/bridge/contracts/desktop-models.ts' && e.to==='src/logic/settings/models/index.ts') return false;
      // Office 通信只具名转接纯 Agent 配置类型；不能引用设置存储或实例服务。
      if(e.from==='src/bridge/contracts/discovery.ts' && ['src/logic/projects/agent-configuration.ts','src/logic/projects/organization-contract.ts','src/logic/projects/data-architecture-contract.ts','src/logic/projects/business-contract.ts','src/logic/projects/office-queue-contract.ts', 'src/logic/projects/navigation-contract.ts'].includes(e.to) && ['type','import type'].includes(e.kind)) return false;
      if(e.to==='src/core/web/electron.ts'&&e.from!=='src/bridge/server/desktop/main.ts')return true;
      // 业务只消费桌面宿主注入的凭据类型；运行时引用仍受 Electron 分层限制。
      const cipherTypeAccess=e.kind==='type'&&e.to==='src/core/io/electron.ts'&&[
        'src/resource/models/local-profiles.ts',
        'src/logic/models/index.ts','src/logic/models/index.ts',
      ].includes(e.from);
      if(a==='logic'&&b==='core/platform/electron'&&!cipherTypeAccess)return true;
      if(e.to.startsWith('src/logic/application/')&&!e.from.startsWith('src/logic/application/')&&!e.from.startsWith('src/bridge/server/'))return true;
      const domainAccess=isDomainFile(e.to)&&domainPublicEntries.has(e.to)&&(e.from.startsWith('src/bridge/contracts/')||e.from.startsWith('src/bridge/server/')||e.from.startsWith('src/logic/'));
      const runtimeAccess=runtimePublicEntries.has(e.to)&&(e.from.startsWith('src/bridge/server/')||isService(e.from)||isEngine(e.from)&&isEngine(e.to));
      const serviceAccess=servicePublicEntries.has(e.to)&&(isService(e.from)||e.from.startsWith('src/bridge/server/'))||businessDataEntries.has(e.to)&&(isService(e.from)||e.from.startsWith('src/bridge/contracts/'))||isService(e.from)&&[modelPublic,enginePublic,feedbackPublic,resourcePublic].includes(e.to);
      const ioErrorAccess=a==='logic'&&e.to==='src/logic/io-errors/json.ts';
      const manifestAccess=['src/logic/engines/catalog/supported-engines.ts','src/logic/engines/catalog/supported-engines.ts','src/logic/resource-management/engine-catalog.ts'].includes(e.from)&&/^src\/engine-plugins\/(pi|claude|codex|memory)\/manifest\.ts$/.test(e.to);
      const adapterAccess=manifestAccess|| isEngine(e.from)&&domainPublicEntries.has(e.to);
      if(a==='resource'&&b==='logic')return true;
      const connectorContract=e.from.startsWith('src/resource/connections/')&&e.to==='src/framework/connectors/index.ts';
      // 新桌面复用已验证的受管连接器生命周期，逻辑新层仍不得依赖旧装配。
      const desktopEngineLoader=e.from==='src/bridge/server/desktop/office-plugin.ts'&&e.to==='src/logic/projects/office-engine-loader.ts'||['src/bridge/server/desktop/main.ts','src/bridge/server/desktop/office-plugin.ts'].includes(e.from)&&e.to==='src/logic/resource-management/connector-runtime.ts';
      const updaterAccess=e.from==='src/bridge/server/bootstrap/desktop.ts'&&e.to==='src/updater/index.ts'||e.from==='src/logic/updates/service/desktop-releases.ts'&&e.to==='src/updater/release-policy.ts';
      const applicationAccess=e.from==='src/logic/application/index.ts'&&(['src/logic/resource-management/index.ts','src/logic/monitor/index.ts'].includes(e.to)||['project.ts','data-architecture.ts','navigation.ts','office-queue.ts','offices.ts','paths.ts'].some(file=>e.to==='src/logic/projects/'+file));
      const desktopAccess=e.from.startsWith('src/bridge/server/desktop/')&&['src/logic/projects/navigation-contract.ts','src/logic/projects/agent-configuration.ts','src/logic/projects/office-queue-contract.ts','src/logic/projects/business-contract.ts','src/logic/projects/organization-contract.ts','src/logic/projects/data-architecture-contract.ts','src/logic/projects/office-operations.ts','src/logic/projects/offices.ts','src/logic/projects/office-usage.ts','src/logic/resource-management/plugin-installations.ts','src/logic/resource-management/engine-catalog.ts'].includes(e.to);
      const artifactContract=e.from.startsWith('src/logic/resource-management/')&&e.to==='src/logic/updates/engine-artifacts.ts';
      const adapterLoader=e.from==='src/logic/projects/office-engine-loader.ts'&&/^src\/engine-plugins\/(pi|claude|codex|memory)\/package\.ts$/.test(e.to)&&e.kind==='generated-dynamic/require';
      const publicAccess=applicationAccess||desktopAccess||artifactContract||adapterLoader||updaterAccess||desktopEngineLoader||connectorContract||adapterAccess||ioErrorAccess||cipherTypeAccess||allowsEngineAccess(e.from,e.to)||allowsModelAccess(e.from,e.to)||allowsFeedbackAccess(e.from,e.to)||allowsResourceAccess(e.from,e.to)||domainAccess||runtimeAccess||serviceAccess;
      if(isService(e.from)&&b==='logic'&&e.from.split('/')[2]!==e.to.split('/')[2]&&!publicAccess)return true;
      if(isEngine(e.to)&&!manifestAccess&&!adapterLoader&&!isEngine(e.from))return true;
      // 领域规则只组合领域与既有纯模型/反馈入口，不借目录迁移取得宿主服务权限。
      if(isDomainFile(e.from)&&e.to.startsWith('src/logic/')&&!isDomainFile(e.to)&&!ioErrorAccess&&![modelPublic,enginePublic,feedbackPublic].includes(e.to))return true;
      if((!layers[a]||!layers[a].includes(b))&&!publicAccess)return true;
      // 跨业务仅接受登记的细粒度入口或普通模块 index；较窄私有边界仍单独检查。
      if(b==='logic'&&(!e.from.startsWith('src/logic/')||e.from.split('/')[2]!==e.to.split('/')[2])&&!/^src\/logic\/[^/]+\/index\.ts$/.test(e.to)&&!publicAccess)return true;
      // 具体引擎选择限制见上方；普通编排只面向业务契约。
    }
    const boundary=moduleBoundaries.find(rule=>rule.sources.some(source=>matchesBoundary(e.from,source)));
    return !!boundary&&!boundary.allow.some(target=>matchesBoundary(e.to,target));
  });
  // 从新模块出发检查完整依赖链，包括桥接契约的类型导出。
  const pending = [...known.values()].filter(file => /^src\/(logic|view)\//.test(file));
  const visited = new Set(pending);
  const outgoing = new Map();
  for (const edge of edges) {
    if (!outgoing.has(edge.from)) outgoing.set(edge.from, []);
    outgoing.get(edge.from).push(edge);
  }
  for (let i = 0; i < pending.length; i++) {
    for (const edge of outgoing.get(pending[i]) ?? []) {
      if (/^src\/(logic-new|view-new)\//.test(edge.to)) {
        if (!violations.includes(edge)) violations.push(edge);
      } else if (!visited.has(edge.to)) {
        visited.add(edge.to);
        pending.push(edge.to);
      }
    }
  }
  const circular = cycles([...known.values()],edges);
  // 产品层规则不作用于验证设施，但迁移后的纯领域数据仍保留原有窄依赖/公开入口检查。
  const testData=file=>file.startsWith('tests/src/logic/knowledge/rules/data/');
  const logical = checkLogicalBoundaries([...known.values()].filter(file=>!isUnitTestPath(file)||testData(file)),edges.filter(edge=>(!isUnitTestPath(edge.from)&&!isUnitTestPath(edge.to))||testData(edge.from)||testData(edge.to)),externalReferences.filter(reference=>!isUnitTestPath(reference.file)||testData(reference.file)));
  for(const file of known.values())if(file.startsWith('src/')&&!isTestSupport(file)&&!layers[layerOf(file)])logical.violations.push({file,rule:'unknown-source-layer',boundary:layerOf(file)});
  logical.violations.push(...modelFacadeViolations);
  // 生产入口不能经工程辅助文件间接加载测试设施；类型边同样参与可达性判断。
  const reverse=new Map();
  for(const edge of edges){if(!reverse.has(edge.to))reverse.set(edge.to,[]);reverse.get(edge.to).push(edge.from)}
  const testing=new Set([...known.values()].filter(isTestSupport));
  for(const reference of externalReferences)if(/^(?:vitest(?:\/|$)|@vitest\/|node:test$)/.test(reference.spec))testing.add(reference.file);
  const testingQueue=[...testing];
  for(let i=0;i<testingQueue.length;i++)for(const source of reverse.get(testingQueue[i])??[])if(!testing.has(source)){testing.add(source);testingQueue.push(source)}
  for(const file of testing)if(file.startsWith('src/')&&!isTestSupport(file))logical.violations.push({file,rule:'production-test-dependency',boundary:'production'});
  // 运行环境限制同时覆盖 npm/内置模块导入，避免绕过 Core 平台入口直接取得 Node/Electron。
  for(const reference of externalReferences){
    if(isTestSupport(reference.file))continue;
    if(reference.file.startsWith('src/')&&/^(?:vitest(?:\/|$)|@vitest\/|node:test$)/.test(reference.spec))logical.violations.push({...reference,rule:'production-test-dependency',boundary:'production'});
    if(reference.file.startsWith('src/')&&!isEngine(reference.file)&&/^(?:@openai\/codex(?:-sdk)?|@anthropic-ai\/claude-agent-sdk|@earendil-works\/pi-coding-agent)(?:\/|$)/.test(reference.spec))
      logical.violations.push({...reference,rule:'engine-sdk-outside-adapter',boundary:'engine-instance'});
    const layer=layerOf(reference.file);
    if(['view','framework-ui','bridge/client','bridge/contracts','core/platform/browser'].includes(layer)
      &&(reference.spec.startsWith('node:')||builtinModules.includes(reference.spec)||reference.spec==='electron'||reference.spec.startsWith('electron/'))){
      logical.violations.push({...reference,rule:'runtime-environment',boundary:layer});
    }
  }
  return {ok:!circular.length && !unresolved.length && !dynamic.length && !violations.length && !logical.violations.length, files:unique.length, sourceFiles:[...known.values()], edges, cycles:circular, unresolved, dynamic, external, violations, logicalViolations:logical.violations, logicalCoverage:logical.coverage};
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
