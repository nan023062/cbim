import {it,expect} from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';

const root=path.resolve('src');
const walk=(p:string):string[]=>fs.readdirSync(p,{withFileTypes:true}).flatMap(e=>e.isDirectory()?walk(path.join(p,e.name)):/\.tsx?$/.test(e.name)?[path.join(p,e.name)]:[]);
const files=walk(root);

it('所有跨层依赖（含重导出和 import 类型）遵循单向边界',()=>{
  for(const file of files){
    const layerOf=(file:string)=>{const parts=path.relative(root,file).split(path.sep);return ['frontend','foundations'].includes(parts[0])?parts[0]:parts.slice(0,2).join('/')};
    const layer=layerOf(file);
    // 固定冷壳只装配业务入口及更新端口；不直接认识工作区、调度器或引擎实现。
    const allowed:Record<string,string[]>={foundations:['foundations'],'backend/bootstrap':['backend/bootstrap','backend/main','backend/updater'],'backend/core':['backend/core','foundations'],'backend/engines':['backend/engines','backend/core','foundations'],'backend/scheduler-engine':['backend/scheduler-engine','backend/engines','backend/core'],'backend/main':['backend/main','backend/scheduler-engine','backend/core','backend/updater','bridge/contracts','foundations'],'backend/updater':['backend/updater','bridge/contracts','foundations'],'bridge/contracts':['bridge/contracts','backend/core'],'bridge/preload':['bridge/preload','bridge/contracts'],frontend:['frontend','bridge/contracts']};
    expect(allowed[layer],`未知源码边界：${file}`).toBeDefined();
    const source=ts.createSourceFile(file,fs.readFileSync(file,'utf8'),ts.ScriptTarget.Latest,true);
    const visit=(node:ts.Node)=>{
      if(ts.isStringLiteral(node)&&node.text.startsWith('.')){
        const parent=node.parent;
        const imported=ts.isImportDeclaration(parent)||ts.isExportDeclaration(parent)||(ts.isLiteralTypeNode(parent)&&ts.isImportTypeNode(parent.parent))||(ts.isCallExpression(parent)&&parent.expression.kind===ts.SyntaxKind.ImportKeyword);
        if(imported){
          const target=path.resolve(path.dirname(file),node.text),targetLayer=layerOf(target);
          // 与依赖检查器一致：已存在的 SVG/CSS 等非代码资源没有代码层归属；无扩展名模块仍须检查。
          const asset=fs.existsSync(target)&&fs.statSync(target).isFile()&&!/\.[cm]?[jt]sx?$/.test(target);
          if(!asset&&layer==='backend/scheduler-engine'&&targetLayer==='backend/engines')expect(path.relative(root,file).replaceAll('\\','/')).toMatch(/^backend\/scheduler-engine\/assembly\//);
          if(!asset&&allowed[layer])expect(allowed[layer],`${path.relative(root,file)} → ${node.text}`).toContain(targetLayer);
        }
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
