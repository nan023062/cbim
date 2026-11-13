// 测试归属与局部执行入口。显式登记单一责任模块，不自动把越界单元改名为集成测试来放行。
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFileSync,spawnSync} from 'node:child_process';
import {createRequire} from 'node:module';
import ts from 'typescript';
import {auditDependencies} from './check-dependencies.mjs';

const kinds=['unit','contract','integration'];
const testFile=/^tests\/.*\.test\.(?:ts|mjs)$/;
const belongs=(file,root)=>file===root||root.endsWith('/')&&path.posix.dirname(file)+'/'===root;
// 这些是数据/契约支持，不是允许导入其它领域实现的豁免；完整应用和跨套件依赖仍独立检查。
const supportRoots=['src/backend/core/foundation/','src/bridge/contracts/','src/foundations/files/','src/foundations/concurrency/'];

/** 包含类型边的可达性用于拒绝隐藏的应用装配；不能仅检查测试文件的直接 import。 */
function reachable(start,graph){
  const seen=new Set([start]),queue=[start];
  for(let i=0;i<queue.length;i++)for(const next of graph.get(queue[i])??[])if(!seen.has(next)){seen.add(next);queue.push(next)}
  return seen;
}

/** 把 named import 全为 type 的边也识别为类型边；依赖检查器仍把它们纳入循环检测。 */
export function runtimeReference(root,edge){
  if(/\.d\.[cm]?ts$/.test(edge.to))return false;
  if(['type','import type','reference path'].includes(edge.kind))return false;
  if(edge.kind!=='import/export')return true;
  const source=fs.readFileSync(path.join(root,edge.from),'utf8');
  const ast=ts.createSourceFile(edge.from,source,ts.ScriptTarget.Latest,true);
  // 同一行可以包含多条 import，不能把第一条声明的类型属性套到后续导入。
  const declarations=ast.statements.filter(node=>ast.getLineAndCharacterOfPosition(node.getStart(ast)).line+1===edge.line
    &&(ts.isImportDeclaration(node)||ts.isExportDeclaration(node))&&node.moduleSpecifier
    &&ts.isStringLiteral(node.moduleSpecifier)&&node.moduleSpecifier.text===edge.spec);
  // 同一行、同一 spec 的多次导入保守合并；只要存在运行时引用，就不能作为纯类型豁免。
  return !declarations.length||declarations.some(declaration=>{
    if(ts.isExportDeclaration(declaration))return !declaration.isTypeOnly;
    const clause=declaration.importClause;
    if(clause?.isTypeOnly)return false;
    if(!clause?.name&&clause?.namedBindings&&ts.isNamedImports(clause.namedBindings)
      &&clause.namedBindings.elements.length>0&&clause.namedBindings.elements.every(item=>item.isTypeOnly))return false;
    return true;
  });
}

/** 只沿测试辅助下钻；被测实现内部的合法依赖不被误认为另一个被测模块。 */
export function testSubjects(root,file,edges){
  const queue=[file],seen=new Set(),subjects=new Set();
  for(let i=0;i<queue.length;i++){
    if(seen.has(queue[i]))continue;seen.add(queue[i]);
    for(const edge of edges.filter(item=>item.from===queue[i])){
      if(!runtimeReference(root,edge))continue;
      if(edge.to.startsWith('tests/'))queue.push(edge.to);
      else if(edge.to.startsWith('src/')||edge.to.startsWith('scripts/'))subjects.add(edge.to);
    }
  }
  return [...subjects].sort();
}

/** 目录是版本控制中的测试以及显式登记的新测试；不接管别人的未跟踪本地工作。CI 中新增测试必被纳入。 */
function maintainedTests(root){
  return execFileSync('git',['ls-files','-z','--','tests'],{cwd:root,encoding:'utf8'}).split('\0').filter(file=>testFile.test(file));
}

export function checkTestModules(root=process.cwd(),options={}){
  const catalog=options.catalog??JSON.parse(fs.readFileSync(path.join(root,'tests/modules.json'),'utf8'));
  const report=options.dependencies??auditDependencies(root);
  const errors=[],entries=[],seen=new Set(),graph=new Map();
  if(report.ok===false)errors.push('Dependency audit failed; resolve invalid imports before selecting tests');
  for(const edge of report.edges){if(!graph.has(edge.from))graph.set(edge.from,[]);graph.get(edge.from).push(edge.to)}
  if(catalog.version!==1||!catalog.modules||typeof catalog.modules!=='object')return {ok:false,errors:['Invalid module catalog'],entries:[]};
  for(const [module,definition] of Object.entries(catalog.modules)){
    if(!/^[a-z0-9][a-z0-9/_-]*$/.test(module)||!Array.isArray(definition.roots)||definition.roots.some(root=>!root.startsWith('src/')&&!root.startsWith('scripts/')))errors.push(`Invalid module: ${module}`);
    for(const kind of Object.keys(definition.tests??{})){
      if(!kinds.includes(kind)){errors.push(`Unknown test kind: ${module}/${kind}`);continue}
      for(const file of definition.tests[kind]){
        if(!testFile.test(file)||file.split('/').includes('..')||!fs.existsSync(path.join(root,file))){errors.push(`Missing/invalid test: ${file}`);continue}
        if(seen.has(file))errors.push(`Duplicate owner: ${file}`);seen.add(file);entries.push({file,module,kind});
        if(kind!=='unit')continue;
        const dependencies=reachable(file,graph);
        const assembly=[...dependencies].find(value=>value==='src/backend/main/assembly/application.ts'||value==='tests/helpers.ts');
        if(assembly)errors.push(`Unit loads application: ${file} -> ${assembly}`);
        const foreign=testSubjects(root,file,report.edges).filter(target=>![...definition.roots,...supportRoots].some(prefix=>belongs(target,prefix)));
        if(foreign.length)errors.push(`Unit crosses module: ${file} -> ${foreign.join(', ')}`);
      }
    }
  }
  for(const file of options.files??maintainedTests(root))if(!seen.has(file))errors.push(`Unregistered test: ${file}`);
  for(const edge of report.edges)if(edge.from.startsWith('tests/')&&testFile.test(edge.to))errors.push(`Test imports another suite: ${edge.from} -> ${edge.to}`);
  return {ok:errors.length===0,errors,entries};
}

/** 默认只选模块单元；契约/集成须显式选择，未知模块或空选择直接失败，不退回全仓。 */
export function selectModuleTests(entries,module,kind='unit'){
  if(![...kinds,'all'].includes(kind))throw Error(`Unknown test kind: ${kind}`);
  const files=entries.filter(entry=>entry.module===module&&(kind==='all'||entry.kind===kind)).map(entry=>entry.file);
  if(!files.length)throw Error(`No ${kind} tests for module ${module}`);
  return files.sort();
}

function main(){
  const args=process.argv.slice(2),value=name=>{const i=args.indexOf(name);return i<0?undefined:args[i+1]};
  for(let i=0;i<args.length;i++){
    if(['--module','--kind'].includes(args[i])){if(!args[++i]||args[i].startsWith('--'))throw Error('Missing option value')}
    else if(!['--check','--list'].includes(args[i]))throw Error(`Unknown option: ${args[i]}`);
  }
  const report=checkTestModules();
  if(!report.ok)throw Error(report.errors.join('\n'));
  if(args.includes('--check')){console.log(`测试边界通过：${report.entries.length} 文件，${kinds.map(kind=>`${kind}=${report.entries.filter(entry=>entry.kind===kind).length}`).join('，')}`);return}
  const module=value('--module');
  if(!module){
    if(!args.includes('--list'))throw Error('Specify --module <name>, --list or --check');
    for(const name of [...new Set(report.entries.map(entry=>entry.module))].sort())console.log(`${name}: ${kinds.map(kind=>`${kind}=${report.entries.filter(entry=>entry.module===name&&entry.kind===kind).length}`).join(' ')}`);
    return;
  }
  const files=selectModuleTests(report.entries,module,value('--kind'));
  if(args.includes('--list')){console.log(files.join('\n'));return}
  const require=createRequire(import.meta.url),cli=path.join(path.dirname(require.resolve('vitest/package.json')),'vitest.mjs');
  const result=spawnSync(process.execPath,[cli,'run',...files],{stdio:'inherit',windowsHide:true});
  if(result.error)throw result.error;process.exitCode=result.status??1;
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))try{main()}catch(error){console.error(error.message);process.exitCode=1}
