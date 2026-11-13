import {it,expect} from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';

const root=path.resolve('src');
const walk=(p:string):string[]=>fs.readdirSync(p,{withFileTypes:true}).flatMap(e=>e.isDirectory()?walk(path.join(p,e.name)):/\.tsx?$/.test(e.name)?[path.join(p,e.name)]:[]);
const files=walk(root);

it('所有跨层依赖（含重导出和 import 类型）遵循单向边界',()=>{
  for(const file of files){
    const layerOf=(file:string)=>{const parts=path.relative(root,file).split(path.sep);if(parts[0]==='core')return parts[1]==='platform'?parts.slice(0,3).join('/'):'core';if(/^backend\/core\/foundation\/(files|web)(\/|$)/.test(parts.join('/')))return 'foundations';return ['frontend','logic','view'].includes(parts[0])?parts[0]:parts.slice(0,2).join('/')};
    const layer=layerOf(file);
    // 固定冷壳只装配业务入口及更新端口；不直接认识工作区、调度器或引擎实现。
    const allowed:Record<string,string[]>={logic:['logic','core','core/platform/node','core/platform/electron'],view:['view','bridge/client','bridge/contracts','core','core/platform/browser'],'bridge/client':['bridge/client','bridge/contracts','core','core/platform/browser'],'bridge/server':['bridge/server','bridge/contracts','logic','core','core/platform/node'],'core/platform/browser':['core/platform/browser','core'],'core/platform/electron':['core/platform/electron','core/platform/node','core'],core:['core'],'core/platform/node':['core/platform/node','core'],foundations:['foundations'],'backend/bootstrap':['backend/bootstrap','backend/main','backend/updater'],'backend/core':['backend/core','foundations','core','core/platform/node'],'backend/engines':['backend/engines','backend/core','foundations','core'],'backend/scheduler-engine':['backend/scheduler-engine','backend/engines','backend/core','foundations','core'],'backend/main':['backend/main','backend/scheduler-engine','backend/core','backend/updater','bridge/contracts','foundations','core','core/platform/node'],'backend/updater':['backend/updater','bridge/contracts','foundations','core'],'bridge/contracts':['bridge/contracts','backend/core','core'],'bridge/preload':['bridge/preload','bridge/contracts','core'],frontend:['frontend','bridge/contracts','core']};
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
          const from=path.relative(root,file).replaceAll('\\','/'),to=path.relative(root,target).replaceAll('\\','/').replace(/\.ts$/,'').replace(/\/index$/,'');
          // 单独核对迁移期的具名入口，不让旧目录获得整个 Logic 的访问权。
          const modelCompatibility=to==='logic/models'&&(/^backend\/(core|engines|scheduler-engine|main)\//.test(from)||from==='bridge/contracts/models.ts');
          const modelService=to==='logic/models/service'&&(from.startsWith('backend/main/')||from.startsWith('bridge/server/'));
          const webCompatibility=to==='logic/web'&&(/^backend\/(core|main|scheduler-engine)\//.test(from)||from==='bridge/contracts/web.ts');
          const webService=to==='logic/web/service'&&(from.startsWith('backend/main/')||from.startsWith('bridge/server/'));
          const webDesktop=from==='backend/main/main.ts'&&to==='core/platform/electron/web-reader';
          const feedbackCompatibility=to==='logic/feedback'&&(/^backend\/(core|main|scheduler-engine)\//.test(from)||from==='bridge/contracts/github-feedback.ts');
          const feedbackService=to==='logic/feedback/service'&&(from.startsWith('backend/main/')||from.startsWith('bridge/server/'));
          if(!asset&&allowed[layer]&&!modelCompatibility&&!modelService&&!webCompatibility&&!webService&&!webDesktop&&!feedbackCompatibility&&!feedbackService)expect(allowed[layer],`${path.relative(root,file)} → ${node.text}`).toContain(targetLayer);
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
