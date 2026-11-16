/** 作用定位：按人工选择的本层组成与直接子模块生成架构关系图和下钻导航。
 * 设计原因：设计意图与类定位由维护者在同一文档维护；生成器核实组成与关系，不展开成员清单，--check 始终只读。
 * 验证边界：结构一致不证明设计意图正确；不生成业务知识模板，不扫描第三方或构建目录。 */
import fs from 'node:fs';
import crypto from 'node:crypto';
import path from 'node:path';
import ts from 'typescript';
import { auditDependencies } from './check-dependencies.mjs';

const norm=p=>p.replaceAll('\\','/');
// 与依赖扫描的排除范围一致；目录本身也登记，不能漏过尚未编写说明的空目录。
const excludedDirectories=new Set(['node_modules','.git','build','.vite','test-results','__pycache__']);
const sourceDirectories=[];
function walk(directory){
 sourceDirectories.push(directory);
 return fs.readdirSync(directory,{withFileTypes:true}).flatMap(entry=>entry.isDirectory()?(excludedDirectories.has(entry.name)?[]:walk(directory+'/'+entry.name)):[directory+'/'+entry.name]);
}
const allFiles=walk('src');
const files=allFiles.filter(f=>/\.(tsx?|jsx?|mjs|cjs|mts|cts|css)$/.test(f));
const directories=sourceDirectories.sort();
const generatedStart='<!-- architecture:generated:start -->';
const generatedEnd='<!-- architecture:generated:end -->';
const extraDocuments=allFiles.filter(f=>/\.(md|mdx)$/i.test(f)&&path.posix.basename(f)!=='ARCHITECTURE.md');
if(extraDocuments.length)throw Error('源码目录只保留 ARCHITECTURE.md，请先合并说明内容：'+extraDocuments.join('、'));
if(!directories.length)throw Error('src 中没有维护目录，不能报告通过');

/** 人工区是唯一语义来源；缺少说明或标记损坏时拒绝整批写入，不猜测目录职责。 */
function markdownLines(source){
 let fence;
 let offset=0;
 return source.match(/[^\n]*(?:\n|$)/g).filter(Boolean).map(raw=>{
  const value=raw.replace(/\r?\n$/,''),match=value.match(/^ {0,3}(`{3,}|~{3,})(.*)$/);
  const position=offset;offset+=raw.length;
  if(fence){if(match&&match[1][0]===fence[0]&&match[1].length>=fence.length&&!match[2].trim())fence=undefined;return {value:'',position,length:value.length}}
  if(match){fence=match[1];return {value:'',position,length:value.length}}
  return {value,position,length:value.length};
 });
}
function documentParts(directory){
 const file=directory+'/ARCHITECTURE.md';
 if(!fs.existsSync(file))throw Error('请先编写 '+file+' 的设计意图及主要组成');
 const original=fs.readFileSync(file,'utf8');
 const lines=markdownLines(original),starts=lines.filter(line=>line.value===generatedStart),ends=lines.filter(line=>line.value===generatedEnd);
 const malformed=lines.some(line=>/<!--\s*architecture\s*:\s*generated/i.test(line.value)&&line.value!==generatedStart&&line.value!==generatedEnd);
 if(malformed||starts.length!==1||ends.length!==1||starts[0].position>=ends[0].position)throw Error(file+'：生成区域标记缺失、不完整、重复、损坏或顺序错误');
 const prefix=original.slice(0,starts[0].position);
 const suffix=original.slice(ends[0].position+ends[0].length);
 const manual=markdownLines(prefix+suffix).map(line=>line.value).join('\n').replace(/<!--[\s\S]*?-->/g,'').replace(/<a\b[^>]*>\s*<\/a>/g,'');
 const sections=new Map();
 for(const match of manual.matchAll(/^## ([^\r\n]+)\r?\n([\s\S]*?)(?=^#{1,2} |$(?![\s\S]))/gm)){
  if(sections.has(match[1]))throw Error(file+'：重复人工说明章节 '+match[1]);
  sections.set(match[1],match[2].replace(/^#{3,6}[^\n]*$/gm,'').trim());
 }
 for(const title of ['设计意图','主要组成'])if(!sections.get(title))throw Error(file+'：缺少人工说明章节 '+title);
 return {original,prefix,suffix,sections,intent:sections.get('设计意图').split(/\r?\n\s*\r?\n/)[0].replace(/\r?\n/g,' ')};
}
const documents=new Map(directories.map(directory=>[directory,documentParts(directory)]));
const text=new Map(files.map(f=>[f,fs.readFileSync(f,'utf8')]));
const ast=new Map(files.filter(f=>!f.endsWith('.css')).map(f=>[f,ts.createSourceFile(f,text.get(f),ts.ScriptTarget.Latest,true)]));
// 与依赖检查共用实际解析结果，包含类型、动态导入、require 和已登记构建入口；CSS 单独补入。
const dependencyReport=auditDependencies(process.cwd(),{roots:['src']});
const unresolved=[...dependencyReport.unresolved,...dependencyReport.dynamic].filter(item=>item.file.startsWith('src/'));
if(unresolved.length)throw Error('源码依赖无法解析，不能生成不完整类图：'+JSON.stringify(unresolved));
function imports(f){
 const targets=dependencyReport.edges.filter(edge=>edge.from===f&&text.has(edge.to)).map(edge=>edge.to);
 function visit(node){
  const value=ts.isImportDeclaration(node)||ts.isExportDeclaration(node)?node.moduleSpecifier:ts.isCallExpression(node)&&(node.expression.kind===ts.SyntaxKind.ImportKeyword||ts.isIdentifier(node.expression)&&node.expression.text==='require')?node.arguments[0]:undefined;
  const spec=value&&ts.isStringLiteralLike(value)?value.text:undefined;
  if(spec?.startsWith('.')&&spec.endsWith('.css')){const target=norm(path.normalize(path.join(path.dirname(f),spec)));if(!text.has(target))throw Error('源码依赖无法解析：'+f+' → '+spec);targets.push(target)}
  ts.forEachChild(node,visit);
 }
 if(ast.has(f))visit(ast.get(f));
 return [...new Set(targets)].sort();
}
const deps=new Map(files.map(f=>[f,imports(f)]));
// 只绑定已扫描源码，不加载第三方声明或执行代码；类型符号用于追踪别名、重导出及函数值成员。
const compilerOptions={target:ts.ScriptTarget.Latest,module:ts.ModuleKind.ESNext,noLib:true,noResolve:true,allowJs:true};
const compilerHost=ts.createCompilerHost(compilerOptions);
const sourceByPath=new Map([...ast].map(([file,source])=>[norm(path.resolve(file)),source]));
compilerHost.getSourceFile=file=>sourceByPath.get(norm(path.resolve(file)));
compilerHost.resolveModuleNames=(names,containingFile)=>names.map(spec=>{
 const from=norm(path.relative(process.cwd(),containingFile));
 const target=dependencyReport.edges.find(edge=>edge.from===from&&edge.spec===spec)?.to;
 return target&&ast.has(target)?{resolvedFileName:path.resolve(target)}:undefined;
});
const checker=ts.createProgram([...ast.keys()],compilerOptions,compilerHost).getTypeChecker();

const id=value=>'N_'+crypto.createHash('sha256').update(value).digest('hex').slice(0,12);
const link=(from,to)=>norm(path.relative(from,to));
const label=value=>value.replace(/["<>\r\n]/g,' ');

function declarations(file){
 const result=[];
 function visit(node){
  if(ts.isClassDeclaration(node)||ts.isInterfaceDeclaration(node)||ts.isTypeAliasDeclaration(node)||ts.isEnumDeclaration(node))result.push(node);
  else if(ts.isSourceFile(node)||ts.isModuleDeclaration(node)||ts.isModuleBlock(node))ts.forEachChild(node,visit);
 }
 if(ast.has(file))visit(ast.get(file));
 return result;
}

function declarationName(node){
 const parents=[];
 for(let parent=node.parent;parent&&!ts.isSourceFile(parent);parent=parent.parent)if(ts.isModuleDeclaration(parent))parents.unshift(parent.name.getText());
 return [...parents,node.name?.text||'default'].join('.');
}

function resolvedDeclaration(node){
 let symbol=checker.getSymbolAtLocation(node);
 if(symbol?.flags&ts.SymbolFlags.Alias)symbol=checker.getAliasedSymbol(symbol);
 return symbol?.declarations?.[0];
}

function declarationFile(node){
 return norm(path.relative(process.cwd(),path.resolve(node.getSourceFile().fileName)));
}

/** 组成表是可阅读的模型选择，不是文件清单；直接子模块总是独立虚拟封装。 */
function model(directory){
 const document=documents.get(directory),entities=[];
 const own=files.filter(file=>path.posix.dirname(file)===directory);
 const children=directories.filter(child=>path.posix.dirname(child)===directory);
 for(const line of document.sections.get('主要组成').split('\n')){
  if(!/^\s*\|/.test(line)||!line.includes(']('))continue;
  const cells=line.trim().replace(/^\||\|$/g,'').split(/(?<!\\)\|/).map(cell=>cell.trim());
  if(cells.length!==2||!cells[1])throw Error(directory+'：主要组成须为“组成／定位”两列且定位非空');
  const references=[...cells[0].matchAll(/\[([^\]]+)\]\(([^)]+)\)/g)];
  if(!references.length)throw Error(directory+'：组成缺少源码链接');
  for(const [,name,href] of references){
   const file=norm(path.posix.normalize(path.posix.join(directory,decodeURIComponent(href.split('#')[0]))));
   if(!own.includes(file))throw Error(directory+'：本层组成必须指向本层源码，不展开子模块或外部实现：'+href);
   const declaration=declarations(file).find(node=>declarationName(node)===name);
   const kind=declaration?(ts.isClassDeclaration(declaration)?'class':ts.isInterfaceDeclaration(declaration)?'interface':'type'):/\.[jt]sx$/.test(file)?'component':'module';
   const key=id(file+'#'+name);
   if(entities.some(entity=>entity.id===key))throw Error(directory+'：重复组成 '+name);
   entities.push({id:key,name,file,kind,declaration,files:[file],role:cells[1]});
  }
 }
 for(const file of own)for(const declaration of declarations(file).filter(ts.isClassDeclaration)){
  if(!entities.some(entity=>entity.declaration===declaration))throw Error(directory+'：缺少本层类定位 '+declarationName(declaration)+'，请先更新主要组成');
 }
 for(const child of children)entities.push({id:id(child),name:path.posix.basename(child),file:child+'/ARCHITECTURE.md',kind:'virtual',directory:child,files:files.filter(file=>file.startsWith(child+'/')),role:documents.get(child).intent});
 if(own.some(file=>ast.has(file))&&!entities.some(entity=>entity.kind!=='virtual'))throw Error(directory+'：有本层代码，请说明必要的类或无类模块定位');
 return {entities,children};
}

function belongsTo(node,ancestor){
 for(let current=node;current;current=current.parent)if(current===ancestor)return true;
 return false;
}

const fileReferences=new Map();
function referencedDeclarations(file){
 if(fileReferences.has(file))return fileReferences.get(file);
 const result=new Set();
 function visit(node){
  if(ts.isIdentifier(node)){const declaration=resolvedDeclaration(node);if(declaration)result.add(declaration)}
  ts.forEachChild(node,visit);
 }
 if(ast.has(file))visit(ast.get(file));
 fileReferences.set(file,result);
 return result;
}

/** 图中的“依赖”只报告源码引用；不从字段持有或目录包含推断资源所有权。 */
function relationships(directory,entities){
 const edges=new Map(),boundaries=[];
 const add=(from,to,kind='依赖')=>{
  if(from.id===to.id)return;
  const key=from.id+'>'+to.id;
  if(!edges.has(key)||kind!=='依赖')edges.set(key,{from,to,kind});
 };
 for(const from of entities){
  if(from.declaration){
   function visit(node){
    if(ts.isIdentifier(node)){
     const declaration=resolvedDeclaration(node);
     if(declaration){
      const file=declarationFile(declaration);
      for(const to of entities)if(to.declaration?belongsTo(declaration,to.declaration):to.files.includes(file))add(from,to);
     }
    }
    ts.forEachChild(node,visit);
   }
   visit(from.declaration);
   for(const heritage of from.declaration.heritageClauses||[])for(const type of heritage.types){
    const declaration=resolvedDeclaration(type.expression),file=declaration&&declarationFile(declaration);
    let target=entities.find(entity=>declaration&&entity.declaration===declaration||entity.directory&&file?.startsWith(entity.directory+'/'));
    if(!target){
     const name=declaration?.name?.getText()||type.expression.getText();
     const key=id((file||'external')+'#'+name);
     target=boundaries.find(entity=>entity.id===key);
     if(!target){target={id:key,name,file:ast.has(file)?file:undefined,kind:'boundary'};boundaries.push(target)}
    }
    // 继承到子目录中的类型，在父层只呈现对虚拟封装的依赖，不把虚拟类画成代码父类。
    add(from,target,target.kind==='virtual'?'依赖':heritage.token===ts.SyntaxKind.ImplementsKeyword?'实现':'继承');
   }
  }else{
   const references=new Set(from.files.flatMap(file=>deps.get(file)||[]));
   const symbols=new Set(from.files.flatMap(file=>[...referencedDeclarations(file)]));
   for(const to of entities)if(to.declaration?[...symbols].some(declaration=>belongsTo(declaration,to.declaration)):to.files.some(file=>references.has(file)))add(from,to);
  }
 }
 return {nodes:[...entities,...boundaries],edges:[...edges.values()]};
}

/** 相互协作的节点尽量同图；跨图关系明确列出，避免缩小整张工程图。 */
function diagramGroups(nodes,edges){
 const pending=new Set(nodes),groups=[];
 const neighbours=node=>edges.filter(edge=>edge.from===node||edge.to===node).map(edge=>edge.from===node?edge.to:edge.from);
 while(pending.size){
  const seed=[...pending].sort((a,b)=>neighbours(b).length-neighbours(a).length||a.name.localeCompare(b.name))[0];
  const group=[],queue=[seed];
  while(queue.length&&group.length<6){
   const node=queue.shift();if(!pending.delete(node))continue;
   group.push(node);
   queue.push(...neighbours(node).filter(next=>pending.has(next)));
  }
  // 独立类也可以共同出现在一张图中，不虚构其间连线。
  for(const node of pending){if(group.length===6)break;pending.delete(node);group.push(node)}
  groups.push(group);
 }
 return groups;
}

function reference(directory,node){return node.file?'['+node.name+']('+link(directory,node.file)+')':'`'+node.name+'`'}

function render(directory){
 const {entities,children}=model(directory),{nodes,edges}=relationships(directory,entities);
 let out='## 架构关系\n\n';
 if(!nodes.length)out+='本层没有代码或子模块，不绘制类图。\n';
 else{
  if(children.length)out+='标注为 `virtual` 的节点是直接子模块的虚拟类封装；内部设计沿下方入口阅读。\n\n';
  const groups=diagramGroups(nodes,edges),groupOf=new Map();
  groups.forEach((group,index)=>group.forEach(node=>groupOf.set(node,index+1)));
  for(const [index,group] of groups.entries()){
   if(groups.length>1)out+='### 关系组 '+(index+1)+'\n\n';
   out+='```mermaid\nclassDiagram\n';
   for(const node of group){
    out+='class '+node.id+'["'+label(node.name)+'"]'+(node.kind==='class'?'\n':' {\n  <<'+node.kind+'>>\n}\n');
    if(node.file)out+='click '+node.id+' href "'+link(directory,node.file)+'"\n';
   }
   for(const edge of edges.filter(edge=>group.includes(edge.from)&&group.includes(edge.to)))out+=edge.kind==='依赖'?`${edge.from.id} ..> ${edge.to.id} : 依赖\n`:`${edge.to.id} <|${edge.kind==='实现'?'..':'--'} ${edge.from.id}\n`;
   out+='```\n\n';
  }
  const cross=edges.filter(edge=>groupOf.get(edge.from)!==groupOf.get(edge.to));
  if(cross.length){
   out+='### 跨图协作\n\n';
   for(const edge of cross)out+=`- ${reference(directory,edge.from)}（图 ${groupOf.get(edge.from)}）→ ${reference(directory,edge.to)}（图 ${groupOf.get(edge.to)}）：${edge.kind}。\n`;
   out+='\n';
  }
  const external=nodes.filter(node=>node.kind==='boundary');
  if(external.length)out+='外部继承／实现边界：'+external.map(node=>reference(directory,node)).join('、')+'。\n\n';
 }
 if(children.length){
  out+='## 子模块\n\n| 虚拟封装 | 整体职责 |\n| --- | --- |\n';
  for(const child of entities.filter(entity=>entity.kind==='virtual'))out+='| '+reference(directory,child)+' | '+child.role.replaceAll('|','／')+' |\n';
  out+='\n';
 }
 if(directory!=='src')out+='[上层设计](../ARCHITECTURE.md)\n';
 return out;
}

const changed=[];
for(const directory of directories){
 const document=documents.get(directory);
 const updated=document.prefix+generatedStart+'\n\n'+render(directory)+'\n'+generatedEnd+document.suffix;
 if(document.original!==updated)changed.push({target:directory+'/ARCHITECTURE.md',text:updated});
}
if(!process.argv.includes('--check'))for(const item of changed)fs.writeFileSync(item.target,item.text);
console.log(`${directories.length} 个目录，${files.length} 个代码/样式文件；${changed.length} 份架构文档${process.argv.includes('--check')?'存在差异':'已更新'}。`);
if(process.argv.includes('--check')&&changed.length)process.exitCode=1;
