/** 作用定位：只更新各目录 ARCHITECTURE.md 的文件清单、真实类图及子目录导航。
 * 设计原因：设计与契约直接在同一文件维护；严格核对人工章节、成对标记和真实声明来源后整批写入，--check 始终只读。
 * 验证边界：结构一致不证明人工契约正确；不生成业务知识模板，不扫描第三方或构建目录。 */
import fs from 'node:fs';
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
 if(!fs.existsSync(file))throw Error('请先编写 '+file+' 的封装意图、类与模块的设计意图、接口设计契约及开闭边界');
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
 for(const title of ['封装意图','类与模块的设计意图','接口设计契约','开闭边界'])if(!sections.get(title))throw Error(file+'：缺少人工说明章节 '+title);
 return {original,prefix,suffix,intent:sections.get('封装意图').split(/\r?\n\s*\r?\n/)[0].replace(/\r?\n/g,' ')};
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
const id=s=>'N_'+s.replace(/[^a-zA-Z0-9_]/g,'_');
const link=(from,to)=>norm(path.relative(from,to));
const clean=s=>s.replace(/[<>"{}|\r\n]/g,' ');
function role(f){return text.get(f).match(/作用定位：([^\r\n]+)/)?.[1]?.trim()||(f.endsWith('.css')?'对应界面的布局与视觉样式。':'源码入口，见文件正文。')}
/** 文件清单包含说明与资源；这些文件不参与代码依赖或伪装成类图节点。 */
function fileRole(f){
 if(text.has(f))return role(f);
 const name=path.posix.basename(f);
 const documents={
  'ARCHITECTURE.md':'本目录的文件清单、真实声明、依赖与子封装导航。',
 };
 if(documents[name])return documents[name];
 if(f.endsWith('.md'))return fs.readFileSync(f,'utf8').match(/^#\s+(.+)$/m)?.[1]?.trim()||'配套说明；具体用途见正文。';
 return '本目录配套资源或配置；具体用途见文件及其调用方。';
}
function fileForm(f){
 if(f.endsWith('.md'))return '说明文档';
 if(f.endsWith('.css'))return '样式';
 if(f.endsWith('.tsx')||f.endsWith('.jsx'))return '组件模块';
 return ast.has(f)?'源码模块':'资源／配置';
}
function node(f,label=path.posix.basename(f),directory=false,entries=[]){return `class ${id(f)}["${clean(label)}"] {\n  <<${directory?'directory':/\.[jt]sx$/.test(f)?'component':f.endsWith('.css')?'stylesheet':'module'}>>\n${entries.length?entries.join('\n')+'\n':''}}`}
function declarations(f){
 const result=[];
 function visit(node){
  if(ts.isClassDeclaration(node)||ts.isInterfaceDeclaration(node)||ts.isTypeAliasDeclaration(node)||ts.isEnumDeclaration(node))result.push(node);
  else if(ts.isSourceFile(node)||ts.isModuleDeclaration(node)||ts.isModuleBlock(node))ts.forEachChild(node,visit);
 }
 if(ast.has(f))visit(ast.get(f));
 return result;
}
function declarationName(node){
 const scopes=[];for(let parent=node.parent;parent&&!ts.isSourceFile(parent);parent=parent.parent)if(ts.isModuleDeclaration(parent))scopes.unshift(parent.name.getText());
 return [...scopes,node.name?.text||'default'].join('.');
}
const declarationKind=node=>ts.isClassDeclaration(node)?null:ts.isInterfaceDeclaration(node)?'interface':ts.isEnumDeclaration(node)?'enumeration':'type';
const chunks=(values,size)=>Array.from({length:Math.ceil(values.length/size)},(_,i)=>values.slice(i*size,(i+1)*size));
/** 类型别名只展开本地声明的对象字段；引用和联合分支不伪装成无条件拥有的成员。 */
function objectMembers(type){
 if(ts.isTypeLiteralNode(type))return [...type.members];
 if(ts.isFunctionTypeNode(type)||ts.isConstructorTypeNode(type))return [type];
 if(ts.isParenthesizedTypeNode(type))return objectMembers(type.type);
 return ts.isIntersectionTypeNode(type)?type.types.flatMap(objectMembers):[];
}
function members(n,a){
 const declared=ts.isTypeAliasDeclaration(n)?objectMembers(n.type):[...(n.members||[])];
 const properties=declared.filter(ts.isConstructorDeclaration).flatMap(c=>c.parameters.filter(p=>p.modifiers?.some(m=>[ts.SyntaxKind.PublicKeyword,ts.SyntaxKind.PrivateKeyword,ts.SyntaxKind.ProtectedKeyword,ts.SyntaxKind.ReadonlyKeyword].includes(m.kind))));
 const visibility=m=>(m.name&&ts.isPrivateIdentifier(m.name))||m.modifiers?.some(x=>x.kind===ts.SyntaxKind.PrivateKeyword)?'-':m.modifiers?.some(x=>x.kind===ts.SyntaxKind.ProtectedKeyword)?'#':'+';
 // 公开入口先展示，后续分段保留其余成员；不能用私有字段占满固定名额后截掉生命周期接口。
 return [...new Set([...properties,...declared.filter(m=>m.name||ts.isConstructorDeclaration(m)||ts.isCallSignatureDeclaration(m)||ts.isConstructSignatureDeclaration(m)||ts.isIndexSignatureDeclaration(m)||ts.isFunctionTypeNode(m)||ts.isConstructorTypeNode(m))]
  .sort((a,b)=>Number(visibility(a)!=='+')-Number(visibility(b)!=='+'))
  .map(m=>{
   if(ts.isCallSignatureDeclaration(m)||ts.isFunctionTypeNode(m))return '  +调用签名()';
   if(ts.isConstructSignatureDeclaration(m)||ts.isConstructorTypeNode(m))return '  +构造签名()';
   if(ts.isIndexSignatureDeclaration(m))return `  +[${m.parameters.map(p=>p.name.getText(a)).join(', ')}] : 索引签名`;
   const name=ts.isConstructorDeclaration(m)?'constructor':m.name.getText(a);
   const callable=ts.isConstructorDeclaration(m)||ts.isMethodDeclaration(m)||ts.isMethodSignature(m);
   const isStatic=m.modifiers?.some(x=>x.kind===ts.SyntaxKind.StaticKeyword);
   const accessor=ts.isGetAccessorDeclaration(m)?'get':ts.isSetAccessorDeclaration(m)?'set':undefined;
   const functionValue=!callable&&!accessor&&checker.getSignaturesOfType(checker.getNonNullableType(checker.getTypeAtLocation(m)),ts.SignatureKind.Call).length>0;
   return `  ${visibility(m)}${clean(name)}${callable?'()':''}${accessor?' : '+accessor:functionValue?' : function':''}${isStatic?'$':''}`;
  }))];
}
/** 模块公开函数单独成图，文件同时声明接口或类型时也不丢失入口。 */
function valueExports(f,visited=new Set()){
 if(visited.has(f)||!ast.has(f))return new Set();
 const next=new Set([...visited,f]),names=new Set();
 function binding(name){if(ts.isIdentifier(name))names.add(name.text);else for(const element of name.elements)if(ts.isBindingElement(element))binding(element.name)}
 for(const statement of ast.get(f).statements){
  if(ts.isExportDeclaration(statement)){
   if(statement.isTypeOnly)continue;
   if(statement.exportClause){
    if(ts.isNamedExports(statement.exportClause))for(const element of statement.exportClause.elements){if(!element.isTypeOnly)names.add(element.name.text)}
    else names.add(statement.exportClause.name.text);
   }else{
    const target=dependencyReport.edges.find(edge=>edge.from===f&&edge.spec===statement.moduleSpecifier?.text)?.to;
    for(const name of valueExports(target,next))if(name!=='default')names.add(name);
   }
  }else if(ts.isExportAssignment(statement))names.add('default');
  else if(statement.modifiers?.some(modifier=>modifier.kind===ts.SyntaxKind.ExportKeyword)){
   if(statement.modifiers.some(modifier=>modifier.kind===ts.SyntaxKind.DefaultKeyword))names.add('default');
   else if(ts.isVariableStatement(statement))for(const declaration of statement.declarationList.declarations)binding(declaration.name);
   else if(statement.name)names.add(statement.name.text);
  }
 }
 return names;
}
function exportedFunctions(f){
 const entries=[];
 const module=ast.has(f)&&checker.getSymbolAtLocation(ast.get(f));
 const values=valueExports(f);
 for(const exported of module?checker.getExportsOfModule(module):[]){
  if(!values.has(exported.name))continue;
  if(exported.declarations?.some(n=>ts.isExportSpecifier(n)&&(n.isTypeOnly||n.parent.parent.isTypeOnly)))continue;
  const symbol=exported.flags&ts.SymbolFlags.Alias?checker.getAliasedSymbol(exported):exported;
  const declaration=symbol.valueDeclaration;
  if(!declaration)continue;
  if(ts.isFunctionDeclaration(declaration))entries.push(`  +${clean(exported.name)}()`);
  else if(checker.getSignaturesOfType(checker.getTypeOfSymbolAtLocation(symbol,declaration),ts.SignatureKind.Call).length)entries.push(`  +${clean(exported.name)} : function`);
 }
 return [...new Set(entries)];
}
function functionDiagrams(f){
 const groups=chunks(exportedFunctions(f),12);
 return groups.map((group,index)=>(groups.length>1?`公开入口 ${index+1}/${groups.length}（同一模块）。\n\n`:'')+diagram([node(f,undefined,false,group)])+'\n').join('');
}
/** 跨文件继承保留实际 import 来源和本地别名；不能把项目内契约笼统写成第三方类。 */
function heritageOrigin(f,expression){
 const name=expression.getText(ast.get(f));
 let symbol=checker.getSymbolAtLocation(expression);
 if(symbol?.flags&ts.SymbolFlags.Alias)symbol=checker.getAliasedSymbol(symbol);
 const declaration=symbol?.declarations?.[0];
 const declaredFile=declaration&&norm(path.relative(process.cwd(),path.resolve(declaration.getSourceFile().fileName)));
 const resolved=declaredFile&&ast.has(declaredFile)?{target:declaredFile,declaration,name:declaration.name?.getText()||symbol.getName()}:{};
 const local=name.split('.')[0];
 for(const statement of ast.get(f).statements){
  if(!ts.isImportDeclaration(statement)||!ts.isStringLiteral(statement.moduleSpecifier))continue;
  const clause=statement.importClause,bindings=clause?.namedBindings;
  if(clause?.name?.text!==local&&!(bindings&&(ts.isNamespaceImport(bindings)?bindings.name.text===local:bindings.elements.some(element=>element.name.text===local))))continue;
  const spec=statement.moduleSpecifier.text;
  const imported=dependencyReport.edges.find(edge=>edge.from===f&&edge.spec===spec)?.to;
  if(imported&&!resolved.target)throw Error('继承／实现声明无法解析：'+f+' → '+name+' ('+spec+')');
  return {spec,...resolved};
 }
 return {spec:'全局或跨文件声明，见源码',...resolved};
}
function heritage(f,n,key,decl,a,visible){
 const lines=[];
 for(const h of n.heritageClauses||[])for(const t of h.types){
  const name=t.expression.getText(a),origin=heritageOrigin(f,t.expression),parent=decl.find(x=>x===origin.declaration);
  const target=parent?id(f+'_'+declarationName(parent)):id(f+'_external_'+name);
  if(!parent){lines.push(`class ${target}["${clean(name+' ('+origin.spec+')')}"] {\n  <<${origin.target?'boundary':'external'}>>\n}`)}
  // 分图不改变声明归属：同文件的父接口在另一段时，仍以同一节点表示其边界。
  else if(!visible.includes(parent)){const kind=declarationKind(parent);lines.push(`class ${target}["${clean(declarationName(parent))}"] {\n${kind?'  <<'+kind+'>>\n':''}}`)}
  lines.push(`${target} <|${h.token===ts.SyntaxKind.ImplementsKeyword?'..':'--'} ${key}`);
 }
 return lines;
}
function diagram(lines){return '```mermaid\nclassDiagram\n'+lines.join('\n')+'\n```\n'}
/** 叶子和父层的直接文件共用声明展示；有子目录不能成为省略本层类、接口和成员的理由。 */
function fileDiagrams(f,d){
 let out=`### ${path.posix.basename(f)}\n\n[查看源码](${link(d,f)})。\n\n`;
 const a=ast.get(f),decl=declarations(f),functions=functionDiagrams(f);out+=functions;
 if(!decl.length&&!functions)out+=diagram([node(f)]);
 for(const group of chunks(decl,4)){
  const memberGroups=group.map(n=>{const parts=chunks(members(n,a),16);return parts.length?parts:[[]]});
  const count=Math.max(...memberGroups.map(parts=>parts.length));
  for(let section=0;section<count;section++){
   if(count>1)out+=`成员 ${section+1}/${count}（同名节点为同一声明，跨图合并阅读）。\n\n`;
   const lines=[node(f)],visible=group.filter((_,index)=>memberGroups[index][section]);
   group.forEach((n,index)=>{const part=memberGroups[index][section];if(!part)return;const key=id(f+'_'+declarationName(n)),kind=declarationKind(n);lines.push(`class ${key}["${clean(declarationName(n))}"] {\n${kind?'  <<'+kind+'>>\n':''}${part.join('\n')}\n}`);lines.push(`${id(f)} ..> ${key} : 声明`);lines.push(...heritage(f,n,key,decl,a,visible))});
   out+=diagram(lines)+'\n';
  }
 }
 const origins=new Map();
 for(const n of decl){
  for(const h of n.heritageClauses||[])for(const t of h.types){const name=t.expression.getText(a),origin=heritageOrigin(f,t.expression);if(!decl.includes(origin.declaration))origins.set(name,origin)}
  for(const member of ts.isTypeAliasDeclaration(n)?objectMembers(n.type):n.members||[]){
   if(ts.isCallSignatureDeclaration(member)||ts.isConstructSignatureDeclaration(member)||ts.isIndexSignatureDeclaration(member)||ts.isFunctionTypeNode(member)||ts.isConstructorTypeNode(member))out+=`匿名签名（${declarationName(n)}，不是具名方法）：\`${member.getText(a).replace(/\s+/g,' ').replaceAll('`','&#96;')}\`。\n`;
  }
 }
 for(const [name,origin] of origins)out+=`继承／实现来源：\`${name}\` → ${origin.target?`[${link(d,origin.target)}](${link(d,origin.target)})（声明 \`${origin.name}\`）`:'`'+origin.spec+'`'}。\n`;
 const references=deps.get(f)||[];
 if(references.length)out+='直接依赖：'+references.map(t=>`[${link(d,t)}](${link(d,t)})`).join('、')+'。\n';
 return out+'\n';
}
const changed=[];
for(const d of directories){
 const own=files.filter(f=>path.posix.dirname(f)===d),children=directories.filter(c=>path.posix.dirname(c)===d);
 // 首次生成也列出自身，保证下一次 --check 不因新建说明文件产生漂移。
 const directFiles=[...new Set([...allFiles.filter(f=>path.posix.dirname(f)===d),d+'/ARCHITECTURE.md'])].sort();
 let out='## 文件清单\n\n';
 out+='| 文件 | 形式 | 当前职责 |\n| --- | --- | --- |\n'+directFiles.map(f=>`| [${path.posix.basename(f)}](${path.posix.basename(f)}) | ${fileForm(f)} | ${fileRole(f).replaceAll('|','／')} |`).join('\n')+'\n';
 if(!own.length)out+='\n本层无直接代码文件。\n';
 out+='\n## 架构类图\n\n成员标记：`+` 公开、`-` 私有、`#` 受保护、`$` 静态；`function` 为函数值成员，`get`／`set` 为访问器。调用／构造／索引签名按匿名签名列出，不虚构方法名；`global.` 表示全局声明补充，非运行时嵌套类。构造函数单独列出，运行时私有字段保留 `#`。文档和资源仅在文件清单中导航，不作为代码节点。\n\n';
 if(children.length){
  const boundaries=[...children,...own];
  const owner=f=>own.includes(f)?f:children.find(c=>f.startsWith(c+'/'));
  const edges=new Set();for(const f of files.filter(f=>f.startsWith(d+'/'))){const a=owner(f);for(const dep of deps.get(f)||[]){const b=owner(dep);if(a&&b&&a!==b)edges.add(`${id(a)} ..> ${id(b)} : 导入依赖`)}}
  // 分组展示较大的目录边界，跨组关系另列，避免缩成不可读的大图。
  for(let i=0;i<boundaries.length;i+=6){const group=boundaries.slice(i,i+6),ids=new Set(group.map(id));out+=diagram([...group.map(f=>node(f,path.posix.basename(f)+(children.includes(f)?'/':''),children.includes(f))),...[...edges].filter(e=>{const [a,,b]=e.split(' ');return ids.has(a)&&ids.has(b)})])+'\n'}
  out+='各图中的同名节点表示同一目录边界；跨组及完整直接依赖如下（无边不代表继承）：\n\n';
  out+=[...edges].map(e=>{const [a,,b]=e.split(' ');const f=boundaries.find(f=>id(f)===a),t=boundaries.find(f=>id(f)===b);return `- \`${path.posix.basename(f)}\` → \`${path.posix.basename(t)}\`：导入。`}).join('\n')||'本层无目录间直接导入关系。';out+='\n';
  for(const f of own)out+='\n'+fileDiagrams(f,d);
 }else{
  for(const f of own)out+=fileDiagrams(f,d);
  const edges=[];for(const f of own)for(const t of deps.get(f)||[])if(own.includes(t))edges.push([f,t]);
  if(edges.length){out+='### 本目录调用边界\n\n';for(let i=0;i<edges.length;i+=4){const group=edges.slice(i,i+4),nodes=[...new Set(group.flat())];out+=diagram([...nodes.map(f=>node(f)),...group.map(([f,t])=>`${id(f)} ..> ${id(t)} : 导入依赖`)])+'\n'}}
 }
 if(!own.length&&!children.length)out+='本目录无代码，无类图。\n';
 out+='\n## 子目录导航\n\n'+(children.length?children.map(c=>`- [${path.posix.basename(c)}/](${path.posix.basename(c)}/ARCHITECTURE.md)：${documents.get(c).intent}`).join('\n'):'无子目录。')+'\n';
 if(d!=='src')out+='\n[返回上层](../ARCHITECTURE.md)。\n';
 out+='\n每次修改本目录代码，同步维护文件头、关键契约说明及本图。未实现的治理、证据验收和自动编排能力不列入当前类图。\n';
 const document=documents.get(d);
 const updated=document.prefix+generatedStart+'\n\n'+out+'\n'+generatedEnd+document.suffix;
 if(document.original!==updated)changed.push({target:d+'/ARCHITECTURE.md',text:updated});
}
if(!process.argv.includes('--check'))for(const item of changed)fs.writeFileSync(item.target,item.text);
console.log(`${directories.length} 个目录，${files.length} 个代码/样式文件；${changed.length} 份架构文档${process.argv.includes('--check')?'存在差异':'已更新'}。`);
if(process.argv.includes('--check')&&changed.length)process.exitCode=1;
