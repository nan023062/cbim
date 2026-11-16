/** 作用定位：只更新各目录 ARCHITECTURE.md 的文件清单、真实类图及子目录导航。
 * 设计原因：设计与契约直接在同一文件维护；生成区域外的内容逐字保留，批次预检后写入，--check 始终只读。 */
import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';

const norm=p=>p.replaceAll('\\','/');
const walk=p=>fs.readdirSync(p,{withFileTypes:true}).flatMap(e=>e.isDirectory()?walk(p+'/'+e.name):[p+'/'+e.name]);
const allFiles=walk('src');
const files=allFiles.filter(f=>/\.(tsx?|jsx?|mjs|cjs|css)$/.test(f));
const directories=[...new Set(allFiles.flatMap(f=>{const a=[];let d=path.posix.dirname(f);while(d==='src'||d.startsWith('src/')){a.push(d);if(d==='src')break;d=path.posix.dirname(d)}return a}))].sort();
const generatedStart='<!-- architecture:generated:start -->';
const generatedEnd='<!-- architecture:generated:end -->';
const extraDocuments=allFiles.filter(f=>/\.(md|mdx)$/i.test(f)&&path.posix.basename(f)!=='ARCHITECTURE.md');
if(extraDocuments.length)throw Error('源码目录只保留 ARCHITECTURE.md，请先合并说明内容：'+extraDocuments.join('、'));
if(!directories.length)throw Error('src 中没有维护目录，不能报告通过');

/** 人工区是唯一语义来源；缺少说明或标记损坏时拒绝整批写入，不猜测目录职责。 */
function documentParts(directory){
 const file=directory+'/ARCHITECTURE.md';
 if(!fs.existsSync(file))throw Error('请先编写 '+file+' 的封装意图、类与模块的设计意图、接口设计契约及开闭边界');
 const original=fs.readFileSync(file,'utf8');
 const starts=[...original.matchAll(/^<!-- architecture:generated:start -->\r?$/gm)],ends=[...original.matchAll(/^<!-- architecture:generated:end -->\r?$/gm)];
 if(starts.length!==ends.length||starts.length>1||starts.length===1&&starts[0].index>=ends[0].index)throw Error(file+'：生成区域标记不完整、重复或顺序错误');
 const prefix=starts.length?original.slice(0,starts[0].index):original+(original.endsWith('\n')?'\n':'\n\n');
 const suffix=ends.length?original.slice(ends[0].index+ends[0][0].length):'\n';
 const manual=(starts.length?prefix+suffix:original).replace(/^(`{3,}|~{3,}).*\r?\n[\s\S]*?^\1\s*$/gm,'');
 const sections=new Map([...manual.matchAll(/^## ([^\r\n]+)\r?\n([\s\S]*?)(?=^## |$(?![\s\S]))/gm)].map(match=>[match[1],match[2].trim()]));
 for(const title of ['封装意图','类与模块的设计意图','接口设计契约','开闭边界'])if(!sections.get(title))throw Error(file+'：缺少人工说明章节 '+title);
 return {original,prefix,suffix,intent:sections.get('封装意图').split(/\r?\n\s*\r?\n/)[0].replace(/\r?\n/g,' ')};
}
const documents=new Map(directories.map(directory=>[directory,documentParts(directory)]));
const text=new Map(files.map(f=>[f,fs.readFileSync(f,'utf8')]));
const ast=new Map(files.filter(f=>!f.endsWith('.css')).map(f=>[f,ts.createSourceFile(f,text.get(f),ts.ScriptTarget.Latest,true)]));
function imports(f){const s=ast.get(f);if(!s)return [];const out=[];const visit=n=>{if(ts.isStringLiteral(n)&&n.text.startsWith('.')){const p=n.parent;if(ts.isImportDeclaration(p)||ts.isExportDeclaration(p)||(ts.isLiteralTypeNode(p)&&ts.isImportTypeNode(p.parent))){const t=norm(path.normalize(path.join(path.dirname(f),n.text)));const resolved=[t,t+'.ts',t+'.tsx',t+'/index.ts'].find(x=>text.has(x));if(resolved)out.push(resolved)}}ts.forEachChild(n,visit)};visit(s);return [...new Set(out)]}
const deps=new Map(files.map(f=>[f,imports(f)]));
const id=s=>'N_'+s.replace(/[^a-zA-Z0-9_]/g,'_');
const link=(from,to)=>norm(path.relative(from,to));
const clean=s=>s.replace(/[<>"{}|\r\n]/g,' ').slice(0,95);
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
function node(f,label=path.posix.basename(f),directory=false,entries=[]){return `class ${id(f)}["${clean(label)}"] {\n  <<${directory?'directory':f.endsWith('.tsx')?'component':f.endsWith('.css')?'stylesheet':'module'}>>\n${entries.length?entries.join('\n')+'\n':''}}`}
function declarations(f){const a=ast.get(f);return a?a.statements.filter(n=>(ts.isClassDeclaration(n)||ts.isInterfaceDeclaration(n)||ts.isTypeAliasDeclaration(n))&&n.name):[]}
const chunks=(values,size)=>Array.from({length:Math.ceil(values.length/size)},(_,i)=>values.slice(i*size,(i+1)*size));
/** 类型别名只展开本地声明的对象字段；引用和联合分支不伪装成无条件拥有的成员。 */
function objectMembers(type){
 if(ts.isTypeLiteralNode(type))return [...type.members];
 if(ts.isParenthesizedTypeNode(type))return objectMembers(type.type);
 return ts.isIntersectionTypeNode(type)?type.types.flatMap(objectMembers):[];
}
function members(n,a){
 const declared=ts.isTypeAliasDeclaration(n)?objectMembers(n.type):[...(n.members||[])];
 const properties=declared.filter(ts.isConstructorDeclaration).flatMap(c=>c.parameters.filter(p=>p.modifiers?.some(m=>[ts.SyntaxKind.PublicKeyword,ts.SyntaxKind.PrivateKeyword,ts.SyntaxKind.ProtectedKeyword,ts.SyntaxKind.ReadonlyKeyword].includes(m.kind))));
 const visibility=m=>(m.name&&ts.isPrivateIdentifier(m.name))||m.modifiers?.some(x=>x.kind===ts.SyntaxKind.PrivateKeyword)?'-':m.modifiers?.some(x=>x.kind===ts.SyntaxKind.ProtectedKeyword)?'#':'+';
 // 公开入口先展示，后续分段保留其余成员；不能用私有字段占满固定名额后截掉生命周期接口。
 return [...new Set([...properties,...declared.filter(m=>m.name||ts.isConstructorDeclaration(m))]
  .sort((a,b)=>Number(visibility(a)!=='+')-Number(visibility(b)!=='+'))
  .map(m=>{
   const name=ts.isConstructorDeclaration(m)?'constructor':ts.isPrivateIdentifier(m.name)?m.name.text.slice(1):m.name.getText(a);
   const callable=ts.isConstructorDeclaration(m)||ts.isMethodDeclaration(m)||ts.isMethodSignature(m);
   const isStatic=m.modifiers?.some(x=>x.kind===ts.SyntaxKind.StaticKeyword);
   return `  ${visibility(m)}${clean(name)}${callable?'()':''}${isStatic?'$':''}`;
  }))];
}
/** 模块公开函数单独成图，文件同时声明接口或类型时也不丢失入口。 */
function exportedFunctions(f){
 const entries=[];
 for(const statement of ast.get(f)?.statements||[]){
  if(!statement.modifiers?.some(m=>m.kind===ts.SyntaxKind.ExportKeyword))continue;
  if(ts.isFunctionDeclaration(statement))entries.push(`  +${clean(statement.name?.text||'default')}()`);
  else if(ts.isVariableStatement(statement))for(const declaration of statement.declarationList.declarations){
   if(ts.isIdentifier(declaration.name)&&declaration.initializer&&(ts.isArrowFunction(declaration.initializer)||ts.isFunctionExpression(declaration.initializer)))entries.push(`  +${clean(declaration.name.text)}()`);
  }
 }
 return [...new Set(entries)];
}
function functionDiagrams(f){
 const groups=chunks(exportedFunctions(f),12);
 return groups.map((group,index)=>(groups.length>1?`公开入口 ${index+1}/${groups.length}（同一模块）。\n\n`:'')+diagram([node(f,undefined,false,group)])+'\n').join('');
}
function heritage(f,n,key,decl,a,visible){
 const lines=[];
 for(const h of n.heritageClauses||[])for(const t of h.types){
  const name=t.expression.getText(a),parent=decl.find(x=>x.name.text===name);
  const target=parent?id(f+'_'+parent.name.text):id(f+'_external_'+name);
  if(!parent)lines.push(`class ${target}["${clean(name)} (外部契约)"] {\n  <<external>>\n}`);
  // 分图不改变声明归属：同文件的父接口在另一段时，仍以同一节点表示其边界。
  else if(!visible.includes(parent)){const kind=ts.isInterfaceDeclaration(parent)?'interface':ts.isTypeAliasDeclaration(parent)?'type':null;lines.push(`class ${target}["${parent.name.text}"] {\n${kind?'  <<'+kind+'>>\n':''}}`)}
  lines.push(`${target} <|${h.token===ts.SyntaxKind.ImplementsKeyword?'..':'--'} ${key}`);
 }
 return lines;
}
function diagram(lines){return '```mermaid\nclassDiagram\n'+lines.join('\n')+'\n```\n'}
const changed=[];
for(const d of directories){
 const own=files.filter(f=>path.posix.dirname(f)===d),children=directories.filter(c=>path.posix.dirname(c)===d);
 // 首次生成也列出自身，保证下一次 --check 不因新建说明文件产生漂移。
 const directFiles=[...new Set([...allFiles.filter(f=>path.posix.dirname(f)===d),d+'/ARCHITECTURE.md'])].sort();
 let out='## 文件清单\n\n';
 out+='| 文件 | 形式 | 当前职责 |\n| --- | --- | --- |\n'+directFiles.map(f=>`| [${path.posix.basename(f)}](${path.posix.basename(f)}) | ${fileForm(f)} | ${fileRole(f).replaceAll('|','／')} |`).join('\n')+'\n';
 if(!own.length)out+='\n本层无直接代码文件。\n';
 out+='\n## 架构类图\n\n成员标记：`+` 公开、`-` 私有、`#` 受保护、`$` 静态；构造函数单独列出。文档和资源仅在文件清单中导航，不作为代码节点。\n\n';
 if(children.length){
  const boundaries=[...children,...own];
  const owner=f=>own.includes(f)?f:children.find(c=>f.startsWith(c+'/'));
  const edges=new Set();for(const f of files.filter(f=>f.startsWith(d+'/'))){const a=owner(f);for(const dep of deps.get(f)||[]){const b=owner(dep);if(a&&b&&a!==b)edges.add(`${id(a)} ..> ${id(b)} : 导入依赖`)}}
  // 分组展示较大的目录边界，跨组关系另列，避免缩成不可读的大图。
  for(let i=0;i<boundaries.length;i+=6){const group=boundaries.slice(i,i+6),ids=new Set(group.map(id));out+=diagram([...group.map(f=>node(f,path.posix.basename(f)+(children.includes(f)?'/':''),children.includes(f))),...[...edges].filter(e=>{const [a,,b]=e.split(' ');return ids.has(a)&&ids.has(b)})])+'\n'}
  out+='各图中的同名节点表示同一目录边界；跨组及完整直接依赖如下（无边不代表继承）：\n\n';
  out+=[...edges].map(e=>{const [a,,b]=e.split(' ');const f=boundaries.find(f=>id(f)===a),t=boundaries.find(f=>id(f)===b);return `- \`${path.posix.basename(f)}\` → \`${path.posix.basename(t)}\`：导入。`}).join('\n')||'本层无目录间直接导入关系。';out+='\n';
  for(const f of own){const functions=functionDiagrams(f);if(functions)out+=`\n### ${path.posix.basename(f)} 公开入口\n\n`+functions}
 }else{
  for(const f of own){out+=`### ${path.posix.basename(f)}\n\n`;const a=ast.get(f),decl=declarations(f);
   const functions=functionDiagrams(f);out+=functions;
   if(!decl.length&&!functions)out+=diagram([node(f)]);
   for(const group of chunks(decl,4)){
    const memberGroups=group.map(n=>{const parts=chunks(members(n,a),16);return parts.length?parts:[[]]});
    const count=Math.max(...memberGroups.map(parts=>parts.length));
    for(let section=0;section<count;section++){
     if(count>1)out+=`成员 ${section+1}/${count}（同名节点为同一声明，跨图合并阅读）。\n\n`;
     const lines=[node(f)];
     const visible=group.filter((_,index)=>memberGroups[index][section]);
     group.forEach((n,index)=>{const part=memberGroups[index][section];if(!part)return;const key=id(f+'_'+n.name.text),kind=ts.isClassDeclaration(n)?null:ts.isInterfaceDeclaration(n)?'interface':'type';lines.push(`class ${key}["${n.name.text}"] {\n${kind?'  <<'+kind+'>>\n':''}${part.join('\n')}\n}`);lines.push(`${id(f)} ..> ${key} : 声明`);lines.push(...heritage(f,n,key,decl,a,visible))});
     out+=diagram(lines)+'\n';
    }
   }
   const references=deps.get(f)||[];if(references.length)out+='直接依赖：'+references.map(t=>`[${link(d,t)}](${link(d,t)})`).join('、')+'。\n';
   out+='\n';
  }
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
