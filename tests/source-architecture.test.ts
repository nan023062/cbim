import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {afterEach,expect,test} from 'vitest';

const generator=path.resolve('scripts/source-architecture.mjs');
const temporary:string[]=[];
afterEach(()=>{for(const root of temporary.splice(0))fs.rmSync(root,{recursive:true,force:true})});

function fixture(files:Record<string,string>){
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'cbim-architecture-'));temporary.push(root);
  for(const [name,content] of Object.entries(files)){
    const file=path.join(root,name);fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,content);
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

test('非叶子目录保持子目录边界，并列出本层模块公开入口',()=>{
  const project=fixture({
    'src/logic/execution/rules/member-run.ts':'export interface Binding {runId:string}; export function checkedBinding(value:Binding){return value}',
    'src/logic/execution/rules/runtime/types.ts':'export interface Model {id:string}',
  });
  const result=project.run();expect(result.status,result.stderr).toBe(0);
  const document=project.read('src/logic/execution/rules/ARCHITECTURE.md');
  expect(document).toContain('["runtime/"] {\n  <<directory>>');
  expect(document).toContain('+checkedBinding()');
  expect(document).not.toContain('["Model"]');
  expect(document).toContain('[runtime/](runtime/ARCHITECTURE.md)');
});

test('文件清单覆盖契约、说明、样式和资源，首次生成后即可通过漂移检查',()=>{
  const project=fixture({
    'src/view/foundations/utility/sample.ts':'export class Sample {}',
    'src/view/foundations/utility/CONTRACT.md':'# 本模块契约\n\n状态独立。\n',
    'src/view/foundations/utility/NOTES.md':'# 实际用途说明\n',
    'src/view/foundations/utility/style.css':'.sample {}',
    'src/view/foundations/utility/defaults.json':'{"limit":12}',
  });
  expect(project.run().status).toBe(0);
  expect(project.run(true).status).toBe(0);
  const document=project.read('src/view/foundations/utility/ARCHITECTURE.md');
  for(const name of ['sample.ts','CONTRACT.md','NOTES.md','style.css','defaults.json','ARCHITECTURE.md']){
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

test('--check 检测源码及契约漂移但不写文档，再生成时保留独立契约',()=>{
  const source='src/logic/tasks/rules/sample.ts',contract='src/logic/tasks/rules/CONTRACT.md',architecture='src/logic/tasks/rules/ARCHITECTURE.md';
  const project=fixture({[source]:'export function inspect(){}',[contract]:'# 执行边界\n\n完成不表示验收。\n'});
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
  project.write(contract,'# 执行边界\n\n恢复不重放未知操作。\n');
  expect(project.run(true).status).toBe(1);
  expect(project.read(architecture)).toBe(generated);
},20000);
