import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {afterEach,expect,test} from 'vitest';

const generator=path.resolve('scripts/source-architecture.mjs');
const temporary:string[]=[];
afterEach(()=>{for(const root of temporary.splice(0))fs.rmSync(root,{recursive:true,force:true})});

function manual(name:string,contract='完成不表示验收。'){
  return `# ${name}\n\n## 封装意图\n\n测试封装：${name}，接口供夹具调用。\n\n## 类与模块的设计意图\n\nSample 保存本次测试的独立状态。\n\n## 接口设计契约\n\n${contract}\n\n## 开闭边界\n\n测试只组合已声明入口，不增加运行服务。\n`;
}

function fixture(files:Record<string,string>){
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'cbim-architecture-'));temporary.push(root);
  for(const [name,content] of Object.entries(files)){
    const file=path.join(root,name);fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,content);
    let directory=path.posix.dirname(name);
    while(directory==='src'||directory.startsWith('src/')){
      const document=path.join(root,directory,'ARCHITECTURE.md');
      if(!fs.existsSync(document))fs.writeFileSync(document,manual(directory));
      if(directory==='src')break;
      directory=path.posix.dirname(directory);
    }
  }
  return {
    run:(check=false)=>spawnSync(process.execPath,[generator,...(check?['--check']:[])],{cwd:root,encoding:'utf8',timeout:15000}),
    read:(file:string)=>fs.readFileSync(path.join(root,file),'utf8'),
    write:(file:string,content:string)=>fs.writeFileSync(path.join(root,file),content),
  };
}

test('同一模块的类型字段与公开函数均入图，不把内部 helper 伪装成公开入口',()=>{
  const project=fixture({'src/logic/tasks/rules/sample.ts':`
    export type Identity={workspaceId:string;taskId:string};
    export type Cursor=Identity & {seq:number};
    export interface Port {read():Promise<Identity>}
    export type Empty=null;
    export interface ChildPort extends Port {write(value:Identity):void}
    export function validateIdentity(value:Identity){return value}
    export const mergeCursor=(value:Cursor)=>value;
    export const inspect=function(value:Identity){return value};
    function internalHelper(){return null}
  `});
  const result=project.run();expect(result.status,result.stderr).toBe(0);
  const document=project.read('src/logic/tasks/rules/ARCHITECTURE.md');
  expect(document).toContain('["Identity"] {\n  <<type>>\n  +workspaceId\n  +taskId');
  expect(document).toContain('["Cursor"] {\n  <<type>>\n  +seq');
  for(const name of ['validateIdentity','mergeCursor','inspect'])expect(document).toContain(`+${name}()`);
  expect(document).not.toContain('+internalHelper()');
  expect(document).not.toContain('Port (外部契约)');
  expect(document).toContain('N_src_logic_tasks_rules_sample_ts_Port <|-- N_src_logic_tasks_rules_sample_ts_ChildPort');
});

test('长类和多入口模块分段展示，保留全部公开生命周期接口及剩余字段',()=>{
  const privateFields=Array.from({length:20},(_,i)=>`private cache${i}=0;`).join('\n');
  const methods=['initialize','start','stop','events','acknowledge','close',...Array.from({length:16},(_,i)=>`action${i}`)];
  const functions=Array.from({length:15},(_,i)=>`export function entry${i}(){return ${i}}`).join('\n');
  const project=fixture({'src/logic/tasks/rules/lifecycle.ts':`
    export class Lifecycle {
      ${privateFields}
      ${methods.map(name=>`${name}(){return this.cache0}`).join('\n')}
    }
    ${functions}
  `});
  const result=project.run();expect(result.status,result.stderr).toBe(0);
  const document=project.read('src/logic/tasks/rules/ARCHITECTURE.md');
  for(const name of methods)expect(document).toContain(`+${name}()`);
  for(let i=0;i<20;i++)expect(document).toContain(`-cache${i}`);
  for(let i=0;i<15;i++)expect(document).toContain(`+entry${i}()`);
  expect(document.indexOf('+close()')).toBeLessThan(document.indexOf('-cache0'));
  expect(document.match(/class N_src_logic_tasks_rules_lifecycle_ts_Lifecycle\[/g)).toHaveLength(3);
  expect(document).toContain('成员 3/3');
  expect(document).toContain('公开入口 2/2');
});

test('非叶子目录保持子目录边界，保留本层类、接口、类型、成员和公开入口',()=>{
  const project=fixture({
    'src/logic/execution/rules/member-run.ts':'export interface Binding {runId:string}; export type State={ready:boolean}; export class Runner {private active=false; Start(){this.active=true}}; export function checkedBinding(value:Binding){return value}',
    'src/logic/execution/rules/runtime/types.ts':'export interface Model {id:string}',
  });
  const result=project.run();expect(result.status,result.stderr).toBe(0);
  const document=project.read('src/logic/execution/rules/ARCHITECTURE.md');
  expect(document).toContain('["runtime/"] {\n  <<directory>>');
  expect(document).toContain('+checkedBinding()');
  for(const name of ['Binding','State','Runner'])expect(document).toContain(`["${name}"]`);
  for(const member of ['+runId','+ready','-active','+Start()'])expect(document).toContain(`  ${member}\n`);
  expect(document).not.toContain('["Model"]');
  expect(document).toContain('[runtime/](runtime/ARCHITECTURE.md)');
});

test('依赖图解析 js 到 ts、动态导入、require 和样式，并标明跨文件继承的真实来源',()=>{
  const project=fixture({
    'src/core/utility/base.ts':'export class Base {Start(){}}',
    'src/core/utility/types.mts':'export interface Input {id:string}',
    'src/core/platform/node/entry.ts':`import {Base as Parent} from '../../utility/base.js';
      import type {Input} from '../../utility/types.mjs';
      import './style.css';
      export class Child extends Parent {input?:Input}
      export const Load=()=>import('./lazy.js');
      const helper=require('./helper.cjs');`,
    'src/core/platform/node/lazy.ts':'export const ready=true;',
    'src/core/platform/node/helper.cts':'export const value=1;',
    'src/core/platform/node/style.css':'.sample {}',
  });
  const result=project.run();expect(result.status,result.stderr).toBe(0);
  const document=project.read('src/core/platform/node/ARCHITECTURE.md');
  for(const target of ['../../utility/base.ts','../../utility/types.mts','lazy.ts','helper.cts','style.css'])expect(document).toContain(`[${target}](${target})`);
  expect(document).toContain('Parent (../../utility/base.js)');
  expect(document).toContain('继承／实现来源：`Parent` → [../../utility/base.ts](../../utility/base.ts)');
  expect(project.read('src/core/ARCHITECTURE.md')).toContain('`platform` → `utility`');
  expect(project.run(true).status).toBe(0);
});

test('源码依赖无法解析时拒绝整批写入，不能用缺边的图报告一致',()=>{
  for(const source of ["export {missing} from './missing.js';","const entry='./runtime.js'; void import(entry);","import './missing.css';"]){
    const project=fixture({'src/core/sample.ts':source});
    const before=project.read('src/ARCHITECTURE.md');
    const result=project.run();
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('源码依赖无法解析');
    expect(project.read('src/ARCHITECTURE.md')).toBe(before);
  }
});

test('文件清单保留源码、样式和资源，契约只在唯一架构文档维护',()=>{
  const project=fixture({
    'src/view/foundations/utility/sample.ts':'export class Sample {}',
    'src/view/foundations/utility/ARCHITECTURE.md':manual('实际用途说明','状态独立。'),
    'src/view/foundations/utility/style.css':'.sample {}',
    'src/view/foundations/utility/defaults.json':'{"limit":12}',
  });
  expect(project.run().status).toBe(0);
  expect(project.run(true).status).toBe(0);
  const document=project.read('src/view/foundations/utility/ARCHITECTURE.md');
  for(const name of ['sample.ts','style.css','defaults.json','ARCHITECTURE.md']){
    expect(document).toContain(`| [${name}](${name}) |`);
  }
  expect(document).toContain('实际用途说明');
  expect(document).not.toContain('["defaults.json"]');
  expect(document).not.toContain('["CONTRACT.md"]');
});

test('类图区分静态与实例成员，保留私有构造及运行时私有字段',()=>{
  const project=fixture({'src/core/utility/sample.ts':`
    export class TextUtils {
      private static readonly replacement='hidden';
      private constructor(){}
      public static redact(){return TextUtils.replacement}
    }
    export class Counter {
      #count=0;
      constructor(public readonly label:string){}
      protected get count(){return this.#count}
      public increment(){return ++this.#count}
    }
  `});
  expect(project.run().status).toBe(0);
  const document=project.read('src/core/utility/ARCHITECTURE.md');
  for(const entry of ['-replacement$','-constructor()','+redact()$','-count','+constructor()','+label','#count','+increment()']){
    expect(document).toContain(`  ${entry}\n`);
  }
  expect(document).not.toContain('+increment()$');
  expect(document).not.toContain('+#count');
});

test('--check 检测生成区漂移，重新生成逐字保留同一文件前后的人工契约',()=>{
  const source='src/logic/tasks/rules/sample.ts',architecture='src/logic/tasks/rules/ARCHITECTURE.md';
  const project=fixture({[source]:'export function inspect(){}',[architecture]:manual('执行边界')});
  expect(project.run().status).toBe(0);
  expect(project.run(true).status).toBe(0);
  const initial=project.read(architecture);
  project.write(source,'export function inspect(){}\nexport function recover(){}');
  expect(project.run(true).status).toBe(1);
  expect(project.read(architecture)).toBe(initial);
  expect(project.run().status).toBe(0);
  const generated=project.read(architecture);
  expect(generated).toContain('+recover()');
  expect(generated).toContain('完成不表示验收。');
  const revised=generated.replace('完成不表示验收。','恢复不重放未知操作。')+'\n### 后置说明\n\n人工维护的字节原样保留。\n';
  project.write(architecture,revised);
  expect(project.run(true).status).toBe(0);
  project.write(source,'export function inspect(){}\nexport function recover(){}\nexport function close(){}');
  expect(project.run(true).status).toBe(1);
  expect(project.read(architecture)).toBe(revised);
  expect(project.run().status).toBe(0);
  const final=project.read(architecture);
  expect(final.split('<!-- architecture:generated:start -->')[0]).toBe(revised.split('<!-- architecture:generated:start -->')[0]);
  expect(final.split('<!-- architecture:generated:end -->')[1]).toBe(revised.split('<!-- architecture:generated:end -->')[1]);
  expect(final).toContain('+close()');
},20000);

test('多余说明文档拒绝整批生成，不能删除契约或覆盖已经维护的正文',()=>{
  const project=fixture({'src/sample.ts':'export function Read(){}','src/NOTES.md':'必须合并的重要约束'});
  const before=project.read('src/ARCHITECTURE.md');
  for(const check of [true,false]){
    const result=project.run(check);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('请先合并说明内容');
    expect(project.read('src/ARCHITECTURE.md')).toBe(before);
    expect(project.read('src/NOTES.md')).toBe('必须合并的重要约束');
  }
});

test('缺失、重复和倒置的生成标记拒绝写入，后续目录错误也不能留下部分更新',()=>{
  const marker='<!-- architecture:generated:start -->',end='<!-- architecture:generated:end -->';
  const project=fixture({'src/sample.ts':'export function Read(){}','src/core/sample.ts':'export class Value{}'});
  const before=project.read('src/ARCHITECTURE.md');
  for(const tail of [marker,end,`${end}\n${marker}`,`${marker}\n${end}\n${marker}\n${end}`]){
    const invalid=manual('core')+'\n'+tail;
    project.write('src/core/ARCHITECTURE.md',invalid);
    expect(project.run().status).toBe(1);
    expect(project.read('src/ARCHITECTURE.md')).toBe(before);
    expect(project.read('src/core/ARCHITECTURE.md')).toBe(invalid);
  }
});

test('目录意图只有一个来源，子目录修改会使父导航漂移',()=>{
  const project=fixture({'src/new-domain/item.ts':'export interface Input {name:string}'});
  expect(project.run().status).toBe(0);
  const child=project.read('src/new-domain/ARCHITECTURE.md');
  project.write('src/new-domain/ARCHITECTURE.md',child.replace('测试封装：src/new-domain，接口供夹具调用。','新边界说明：只读固定输入，不访问磁盘。'));
  expect(project.run(true).status).toBe(1);
  expect(project.run().status).toBe(0);
  expect(project.read('src/ARCHITECTURE.md')).toContain('新边界说明：只读固定输入，不访问磁盘。');
  expect(project.run(true).status).toBe(0);
});

test('只含资源的子目录也有清单和导航，未编写人工语义不能生成空壳',()=>{
  const project=fixture({'src/resources/defaults.json':'{}'});
  expect(project.run().status).toBe(0);
  const document=project.read('src/resources/ARCHITECTURE.md');
  expect(document).toContain('[defaults.json](defaults.json)');
  expect(document).toContain('本目录无代码，无类图');
  project.write('src/resources/ARCHITECTURE.md','# 只有标题');
  const result=project.run();
  expect(result.status).toBe(1);
  expect(result.stderr).toContain('缺少人工说明章节');
});
