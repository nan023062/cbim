import {it,expect} from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';

const root=path.resolve('src');
const walk=(p:string):string[]=>fs.readdirSync(p,{withFileTypes:true}).flatMap(e=>e.isDirectory()?walk(path.join(p,e.name)):/\.tsx?$/.test(e.name)?[path.join(p,e.name)]:[]);
const files=walk(root);

it('source imports, exports and type references obey the four layers',()=>{
  const allowed:Record<string,string[]>={core:['core'],'core/platform/node':['core/platform/node','core'],'core/platform/browser':['core/platform/browser','core'],'core/platform/electron':['core/platform/electron','core/platform/node','core'],logic:['logic','core','core/platform/node'],view:['view','bridge/contracts','bridge/client','core','core/platform/browser'],'bridge/client':['bridge/client','bridge/contracts','core','core/platform/browser'],'bridge/contracts':['bridge/contracts','logic','core'],'bridge/server':['bridge/server','bridge/contracts','logic','core','core/platform/node','core/platform/electron'],'bridge/preload':['bridge/preload','bridge/contracts','core']};
  const layerOf=(file:string)=>{const p=path.relative(root,file).replaceAll('\\','/').split('/');return p[0]==='core'&&p[1]==='platform'?p.slice(0,3).join('/'):['core','logic','view'].includes(p[0])?p[0]:p.slice(0,2).join('/')};
  for(const file of files){
    const layer=layerOf(file);expect(allowed[layer],file).toBeDefined();
    const source=ts.createSourceFile(file,fs.readFileSync(file,'utf8'),ts.ScriptTarget.Latest,true);
    const visit=(node:ts.Node)=>{
      if(ts.isStringLiteral(node)&&node.text.startsWith('.')){
        const p=node.parent,imported=ts.isImportDeclaration(p)||ts.isExportDeclaration(p)||ts.isLiteralTypeNode(p)&&ts.isImportTypeNode(p.parent)||ts.isCallExpression(p)&&p.expression.kind===ts.SyntaxKind.ImportKeyword;
        if(imported){const target=path.resolve(path.dirname(file),node.text),asset=fs.existsSync(target)&&fs.statSync(target).isFile()&&!/\.[cm]?[jt]sx?$/.test(target);if(!asset)expect(allowed[layer],file+' -> '+node.text).toContain(layerOf(target));}
      }
      ts.forEachChild(node,visit);
    };visit(source);
  }
});

it('每个维护中的源码目录有架构文档，源代码有定位与原因说明',()=>{
  const directories=new Set<string>();
  for(const file of files){
    let directory=path.dirname(file);while(directory.startsWith(root)){directories.add(directory);if(directory===root)break;directory=path.dirname(directory)}
    const header=fs.readFileSync(file,'utf8').slice(0,1600);
    expect(header,file).toContain('作用定位');expect(header,file).toContain('设计原因');
  }
  for(const directory of directories)expect(fs.existsSync(path.join(directory,'ARCHITECTURE.md')),directory).toBe(true);
});
