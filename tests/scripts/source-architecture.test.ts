import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {afterEach,expect,test} from 'vitest';

const generator=path.resolve('scripts/source-architecture.mjs');
const temporary:string[]=[];
const start='<!-- architecture:generated:start -->',end='<!-- architecture:generated:end -->';

test('模块内 unittest 不是业务子模块，忽略其模型与测试辅助依赖',()=>{
  const project=fixture({'src/logic-new/sample/index.ts':'export class Service {}'});
  project.write('src/logic-new/sample/unittest/service.test.ts',"import {Service} from '..'; import {helper} from '../../../../unittest/helper';");
  project.write('tests/helper.ts','export const helper=1;');
  const result=project.run();expect(result.status,result.stderr).toBe(0);
  const document=project.read('src/logic-new/sample/ARCHITECTURE.md');
  expect(document).not.toContain('unittest');expect(document).not.toContain('helper');
});
afterEach(()=>{for(const root of temporary.splice(0))fs.rmSync(root,{recursive:true,force:true})});

function manual(name:string,rows:string[]=[]){
  return `# ${name}\n\n## 设计意图\n\n测试封装：${name}，保存独立状态。\n\n## 主要组成\n\n${rows.length?'| 组成 | 定位 |\n| --- | --- |\n'+rows.join('\n'):'本层由子模块组合。'}\n\n${start}\n${end}\n`;
}

function fixture(files:Record<string,string>){
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'cbim-architecture-'));temporary.push(root);
  const directories=new Set<string>();
  for(const [name,content] of Object.entries(files)){
    const file=path.join(root,name);fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,content);
    for(let directory=path.posix.dirname(name);directory==='src'||directory.startsWith('src/');directory=path.posix.dirname(directory))directories.add(directory);
  }
  for(const directory of directories){
    const document=path.join(root,directory,'ARCHITECTURE.md');
    if(fs.existsSync(document))continue;
    const rows=Object.entries(files).filter(([name])=>path.posix.dirname(name)===directory&&/\.(?:[cm]?[jt]s|tsx|jsx)$/.test(name)).flatMap(([name,content])=>{
      const classes=[...content.matchAll(/\bclass\s+(\w+)/g)].map(match=>match[1]);
      return (classes.length?classes:[path.posix.basename(name)]).map(label=>`| [${label}](${path.posix.basename(name)}) | 保存测试状态，供本层协作。 |`);
    });
    fs.writeFileSync(document,manual(directory,rows));
  }
  return {
    run:(check=false)=>spawnSync(process.execPath,[generator,...(check?['--check']:[])],{cwd:root,encoding:'utf8',timeout:15000}),
    read:(file:string)=>fs.readFileSync(path.join(root,file),'utf8'),
    write:(file:string,content:string)=>{const target=path.join(root,file);fs.mkdirSync(path.dirname(target),{recursive:true});fs.writeFileSync(target,content)},
    mkdir:(directory:string)=>fs.mkdirSync(path.join(root,directory),{recursive:true}),
  };
}

function node(document:string,name:string){
  const line=document.split('\n').find(value=>value.startsWith('class ')&&value.includes(`["${name}"]`));
  expect(line,`图中应有 ${name}`).toBeDefined();
  return line!.split('[')[0].slice(6);
}

test('本层模型保留类定位和选定契约，不再生成文件、函数与成员清单',()=>{
  const project=fixture({
    'src/sample.ts':'export interface Port {Read():void} export type Hidden={secret:string}; export class Service implements Port {private cache=0; Read(){} HiddenMethod(){}} export function helper(){}',
    'src/style.css':'.sample {}','src/defaults.json':'{}',
    'src/ARCHITECTURE.md':manual('服务',[ '| [Service](sample.ts) | 组合调用入口。 |','| [Port](sample.ts) | 必要的协作契约。 |']),
  });
  const result=project.run();expect(result.status,result.stderr).toBe(0);
  const document=project.read('src/ARCHITECTURE.md');
  expect(document).toContain(`${node(document,'Port')} <|.. ${node(document,'Service')}`);
  for(const omitted of ['HiddenMethod','cache','helper','defaults.json','style.css','文件清单','["Hidden"]'])expect(document).not.toContain(omitted);
  expect(document).toContain('组合调用入口。');
  expect(document).toContain(`click ${node(document,'Service')} href "sample.ts"`);
});

test('每层把直接子模块视为虚拟封装，内部类和孙模块只在下一层出现',()=>{
  const project=fixture({
    'src/service.ts':"import {Child} from './domain/api.js'; export class Service extends Child {}",
    'src/domain/api.ts':"import {Inner} from './storage/item.js'; export class Child {value=new Inner()}",
    'src/domain/storage/item.ts':'export class Inner {Secret(){}}',
  });
  const result=project.run();expect(result.status,result.stderr).toBe(0);
  const root=project.read('src/ARCHITECTURE.md'),child=project.read('src/domain/ARCHITECTURE.md');
  expect(root).toContain(`${node(root,'Service')} ..> ${node(root,'domain')} : 依赖`);
  expect(root).toContain('<<virtual>>');
  expect(root).toContain('[domain](domain/ARCHITECTURE.md)');
  for(const detail of ['Child','Inner','storage','Secret','api.ts','<|--'])expect(root).not.toContain(detail);
  expect(child).toContain('[storage](storage/ARCHITECTURE.md)');
  expect(child).toContain('["Child"]');
  expect(child).not.toContain('["Inner"]');
  expect(project.read('src/domain/storage/ARCHITECTURE.md')).toContain('["Inner"]');
});

test('引用同文件中的一个类不会伪造对其他类的依赖',()=>{
  const project=fixture({
    'src/core/utility/types.ts':'export class Used{} export class Unused{}',
    'src/core/utility/entry.ts':"import {Used} from './types.js'; export const Create=()=>new Used();",
  });
  expect(project.run().status).toBe(0);
  const document=project.read('src/core/utility/ARCHITECTURE.md');
  expect(document).toContain(`${node(document,'entry.ts')} ..> ${node(document,'Used')} : 依赖`);
  expect(document).not.toContain(`${node(document,'entry.ts')} ..> ${node(document,'Unused')}`);
});

test('真实别名与重导出继承指向来源声明，而非虚构新父类',()=>{
  const project=fixture({
    'src/core/utility/base.ts':'export class Base {}',
    'src/core/utility/index.ts':"export {Base as PublicBase} from './base.js';",
    'src/core/platform/node/child.ts':"import {PublicBase as Parent} from '../../utility/index.js'; export class Child extends Parent {}",
  });
  const result=project.run();expect(result.status,result.stderr).toBe(0);
  const document=project.read('src/core/platform/node/ARCHITECTURE.md');
  expect(document).toContain(`${node(document,'Base')} <|-- ${node(document,'Child')}`);
  expect(document).toContain('[Base](../../utility/base.ts)');
  expect(document).not.toContain('["Parent"]');
});

test('本层类依赖按实际符号核实，实例持有不自动变成组合或继承',()=>{
  const project=fixture({'src/core/utility/a.ts':'export class A {} export class B {constructor(private value:A){}} export class C {}'});
  expect(project.run().status).toBe(0);
  const document=project.read('src/core/utility/ARCHITECTURE.md');
  expect(document).toContain(`${node(document,'B')} ..> ${node(document,'A')} : 依赖`);
  expect(document).not.toMatch(/\*--|<\|--/);
  expect(document).not.toContain(`${node(document,'B')} ..> ${node(document,'C')}`);
});

test('未加载的外部父类保持外部边界，不误认本层无类模块',()=>{
  const project=fixture({
    'src/core/fault.ts':'export class Fault extends Error {}',
    'src/core/json.ts':'export function Parse(value:string){return JSON.parse(value)}',
  });
  const result=project.run();expect(result.status,result.stderr).toBe(0);
  const document=project.read('src/core/ARCHITECTURE.md');
  expect(document).toContain(`${node(document,'Error')} <|-- ${node(document,'Fault')}`);
  expect(document).not.toContain(`${node(document,'json.ts')} <|--`);
});

test('所有本层类都有定位，缺失时整批拒绝；主要组成不允许展开子目录源码',()=>{
  for(const rows of [[],['| [Child](child/c.ts) | 子模块内部类。 |'],['| [Missing](missing.ts) | 失效链接。 |']]){
    const project=fixture({'src/root.ts':'export class Root {}','src/child/c.ts':'export class Child {}','src/ARCHITECTURE.md':manual('根',rows)});
    const before=project.read('src/child/ARCHITECTURE.md');
    const result=project.run();expect(result.status).toBe(1);
    expect(project.read('src/child/ARCHITECTURE.md')).toBe(before);
  }
});

test('大型模型分图保留跨图边与导航，不截断类或缩小巨图',()=>{
  const project=fixture({'src/core/utility/chain.ts':Array.from({length:14},(_,i)=>`export class C${i} {${i?'value?:C'+(i-1):''}}`).join('\n')});
  expect(project.run().status).toBe(0);
  const document=project.read('src/core/utility/ARCHITECTURE.md');
  const blocks=[...document.matchAll(/```mermaid\n([\s\S]*?)```/g)].map(match=>match[1]);
  expect(blocks).toHaveLength(3);
  for(const block of blocks)expect((block.match(/^class /gm)||[]).length).toBeLessThanOrEqual(6);
  for(let i=0;i<14;i++)node(document,'C'+i);
  const direct=(document.match(/ \.\.> /g)||[]).length;
  const cross=document.split('\n').filter(line=>/^\| .* \| 依赖 \| /.test(line)).reduce((count,line)=>count+(line.split(' | ')[2].match(/（图 \d+）/g)||[]).length,0);
  expect(direct+cross).toBe(13);
  expect(document).toContain('### 跨图协作');
});

test('密集跨图关系按引用方归并，所有目标保留且不与继承混写',()=>{
  const files:Record<string,string>={};
  // 十二个类互相引用会产生分图；每个来源的多个跨图目标须完整保留。
  for(let i=0;i<12;i++)files[`src/core/utility/c${i}.ts`]=Array.from({length:12},(_,j)=>i===j?'':`import ${i===11&&j===0?'':'type '}{C${j}} from './c${j}.js';`).join('\n')+`\nexport class C${i}${i===11?' extends C0':''} {`+Array.from({length:12},(_,j)=>i===j?'':`value${j}?:C${j};`).join('')+'}';
  const project=fixture(files);
  expect(project.run().status).toBe(0);
  const document=project.read('src/core/utility/ARCHITECTURE.md');
  const edges=new Set<string>();
  const ids=new Map(Array.from({length:12},(_,i)=>[node(document,'C'+i),'C'+i]));
  for(const match of document.matchAll(/^(\w+) \.\.> (\w+) : 依赖$/gm))edges.add(ids.get(match[1])+'>'+ids.get(match[2]));
  const rows=document.split('\n').filter(line=>/^\| .* \| 依赖 \| /.test(line));
  expect(rows).toHaveLength(12);
  for(const row of rows){
    const [,source,,targets]=row.split('|').map(value=>value.trim());
    const from=source.match(/\[(C\d+)\]/)![1];
    const names=[...targets.matchAll(/\[(C\d+)\]/g)].map(match=>match[1]);
    expect(names).toHaveLength(from==='C11'?5:6);
    for(const to of names)edges.add(from+'>'+to);
  }
  const inheritance=document.split('\n').filter(line=>/^\| .* \| 继承 \| /.test(line));
  expect(inheritance).toHaveLength(1);
  expect(inheritance[0]).toContain('[C11](c11.ts)（图 2） | 继承 | [C0](c0.ts)（图 1）');
  edges.add('C11>C0');
  expect(edges.size).toBe(132);
  for(let i=0;i<12;i++)for(let j=0;j<12;j++)if(i!==j)expect(edges.has(`C${i}>C${j}`)).toBe(true);
  expect(project.run(true).status).toBe(0);
});

test('当前组成与未实施目标分开，生成不将现状映射里的拟议封装画入模型',()=>{
  const file='src/core/ARCHITECTURE.md';
  const mapping='## 现状与目标边界\n\n当前 [Root](root.ts) 与子模块并存。拟议 facade 尚未实现，迁移需保持入口和状态归属。\n\n';
  const original=manual('core',['| [Root](root.ts) | 当前真实实现。 |']).replace(start,mapping+start);
  const project=fixture({'src/core/root.ts':'export class Root {}','src/core/utility/item.ts':'export const value=1;',[file]:original});
  expect(project.run().status).toBe(0);
  const document=project.read(file),generated=document.split(start)[1].split(end)[0];
  expect(document).toContain(mapping);
  expect(generated).toContain('["Root"]');expect(generated).toContain('["utility"]');
  expect(generated).not.toContain('facade');expect(generated).not.toContain('拟议');
});

test('模块依赖包括动态导入、require、类型和 CSS，父层聚合为虚拟封装关系',()=>{
  const project=fixture({
    'src/core/platform/entry.ts':"import type {Input} from '../contracts/types.mjs'; void import('../utility/lazy.js'); require('../utility/helper.cjs'); import '../utility/style.css'; export const value=1;",
    'src/core/contracts/types.mts':'export interface Input {}',
    'src/core/utility/lazy.ts':'export const ready=true;',
    'src/core/utility/helper.cts':'export const value=1;',
    'src/core/utility/style.css':'.sample {}',
  });
  const result=project.run();expect(result.status,result.stderr).toBe(0);
  const document=project.read('src/core/ARCHITECTURE.md');
  for(const name of ['contracts','utility'])expect(document).toContain(`${node(document,'platform')} ..> ${node(document,name)} : 依赖`);
  expect(project.run(true).status).toBe(0);
});

test('未解析依赖拒绝整批写入，不生成缺边模型',()=>{
  for(const source of ["export {missing} from './missing.js';","const entry='./runtime.js'; void import(entry);","import './missing.css';","void import('./missing.css');","require('./missing.css');"]){
    const project=fixture({'src/core/sample.ts':source});
    const before=project.read('src/ARCHITECTURE.md'),result=project.run();
    expect(result.status).toBe(1);expect(result.stderr).toContain('源码依赖无法解析');
    expect(project.read('src/ARCHITECTURE.md')).toBe(before);
  }
},20000);

test('--check 只读检测真实模型漂移；内部方法变化不生成成员噪声',()=>{
  const source='src/core/utility/sample.ts',architecture='src/core/utility/ARCHITECTURE.md';
  const project=fixture({[source]:'export class A {} export class B {}'});
  expect(project.run().status).toBe(0);
  project.write(source,'export class A {NewMethod(){}} export class B {}');
  expect(project.run(true).status).toBe(0);
  const initial=project.read(architecture);
  project.write(source,'export class A {NewMethod(){}} export class B {value?:A}');
  expect(project.run(true).status).toBe(1);
  expect(project.read(architecture)).toBe(initial);
  expect(project.run().status).toBe(0);
  expect(project.run(true).status).toBe(0);
});

test('生成逐字保留 CRLF 人工前后正文与围栏中的示例标记',()=>{
  const file='src/core/utility/ARCHITECTURE.md';
  const prefix=manual('工具',['| [A](sample.ts) | 独立工具。 |']).split(start)[0]+`\n~~~md\n${start}\n${end}\n~~~\n`;
  const suffix='\n\n## 协作说明\n\n这是人工说明。\n';
  const original=(prefix+start+'\n'+end+suffix).replaceAll('\n','\r\n');
  const project=fixture({'src/core/utility/sample.ts':'export class A {}',[file]:original});
  expect(project.run().status).toBe(0);
  const generated=project.read(file);
  expect(generated.startsWith(prefix.replaceAll('\n','\r\n'))).toBe(true);
  expect(generated.endsWith(suffix.replaceAll('\n','\r\n'))).toBe(true);
  expect(project.run(true).status).toBe(0);
});

test('缺失、重复、倒置和损坏的标记拒绝整批写入',()=>{
  const project=fixture({'src/sample.ts':'export const value=1;','src/core/value.ts':'export const value=2;'});
  const before=project.read('src/ARCHITECTURE.md');
  for(const markers of ['',start,end,`${end}\n${start}`,`${start}\n${end}\n${start}\n${end}`,'<!-- architecture:generated:start ->\n<!-- architecture:generated:end ->',` ${start}\n${end}`]){
    const invalid=manual('core',['| [value](value.ts) | 纯值。 |']).split(start)[0]+markers;
    project.write('src/core/ARCHITECTURE.md',invalid);
    for(const check of [true,false]){
      expect(project.run(check).status).toBe(1);
      expect(project.read('src/ARCHITECTURE.md')).toBe(before);
      expect(project.read('src/core/ARCHITECTURE.md')).toBe(invalid);
    }
  }
},30000);

test('缺少、重复或只有围栏/注释的设计章节拒绝生成',()=>{
  const project=fixture({'src/item.ts':'export const value=1;'});
  const valid=project.read('src/ARCHITECTURE.md');
  for(const invalid of [valid.replace('## 设计意图','## 旧标题'),valid.replace('测试封装：src，保存独立状态。','<!-- 只有注释 -->'),valid.replace('测试封装：src，保存独立状态。','```txt\n示例\n```'),valid+'\n## 主要组成\n\n重复\n']){
    project.write('src/ARCHITECTURE.md',invalid);
    expect(project.run().status).toBe(1);
    expect(project.read('src/ARCHITECTURE.md')).toBe(invalid);
  }
},20000);

test('子模块设计意图是唯一职责来源，内部细节变化不进入父层',()=>{
  const project=fixture({'src/domain/item.ts':'export const value=1;'});
  expect(project.run().status).toBe(0);
  const child=project.read('src/domain/ARCHITECTURE.md');
  project.write('src/domain/ARCHITECTURE.md',child.replace('测试封装：src/domain，保存独立状态。','只读固定输入，不访问磁盘。\n\n本层内部的详细协作说明。'));
  expect(project.run(true).status).toBe(1);
  expect(project.run().status).toBe(0);
  const root=project.read('src/ARCHITECTURE.md');
  expect(root).toContain('只读固定输入，不访问磁盘。');
  expect(root).not.toContain('本层内部的详细协作说明。');
});

test('额外说明文档拒绝生成，资源目录保持真实且不虚构类',()=>{
  const project=fixture({'src/resources/defaults.json':'{}'});
  expect(project.run().status).toBe(0);
  const document=project.read('src/resources/ARCHITECTURE.md');
  expect(document).toContain('本层没有代码或子模块，不绘制类图。');
  expect(document).not.toContain('classDiagram');
  project.write('src/resources/NOTES.md','尚未合并的说明');
  const result=project.run();expect(result.status).toBe(1);
  expect(result.stderr).toContain('请先合并说明内容');
  expect(project.read('src/resources/ARCHITECTURE.md')).toBe(document);
});

test('忽略第三方和产物，但空维护目录缺少说明不能漏过',()=>{
  const project=fixture({'src/item.ts':'export const value=1;'});
  for(const directory of ['node_modules','build','.vite','__pycache__'])project.write('src/'+directory+'/foreign.ts',"import './missing.js';");
  expect(project.run().status).toBe(0);
  project.mkdir('src/empty');
  const result=project.run();expect(result.status).toBe(1);
  expect(result.stderr).toContain('请先编写 src/empty/ARCHITECTURE.md');
  project.write('src/empty/ARCHITECTURE.md',manual('空模块'));
  expect(project.run().status).toBe(0);
  expect(project.read('src/ARCHITECTURE.md')).toContain('[empty](empty/ARCHITECTURE.md)');
});
