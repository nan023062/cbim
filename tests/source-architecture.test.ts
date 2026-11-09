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
  const project=fixture({'src/backend/core/tasks/sample.ts':`
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
  const document=project.read('src/backend/core/tasks/ARCHITECTURE.md');
  expect(document).toContain('["Identity"] {\n  <<type>>\n  +workspaceId\n  +taskId');
  expect(document).toContain('["Cursor"] {\n  <<type>>\n  +seq');
  for(const name of ['validateIdentity','mergeCursor','inspect'])expect(document).toContain(`+${name}()`);
  expect(document).not.toContain('+internalHelper()');
  expect(document).not.toContain('Port (外部契约)');
  expect(document).toContain('N_src_backend_core_tasks_sample_ts_Port <|-- N_src_backend_core_tasks_sample_ts_ChildPort');
});

test('长类和多入口模块分段展示，保留全部公开生命周期接口及剩余字段',()=>{
  const privateFields=Array.from({length:20},(_,i)=>`private cache${i}=0;`).join('\n');
  const methods=['initialize','start','stop','events','acknowledge','close',...Array.from({length:16},(_,i)=>`action${i}`)];
  const functions=Array.from({length:15},(_,i)=>`export function entry${i}(){return ${i}}`).join('\n');
  const project=fixture({'src/backend/core/tasks/lifecycle.ts':`
    export class Lifecycle {
      ${privateFields}
      ${methods.map(name=>`${name}(){return this.cache0}`).join('\n')}
    }
    ${functions}
  `});
  const result=project.run();expect(result.status,result.stderr).toBe(0);
  const document=project.read('src/backend/core/tasks/ARCHITECTURE.md');
  for(const name of methods)expect(document).toContain(`+${name}()`);
  for(let i=0;i<20;i++)expect(document).toContain(`-cache${i}`);
  for(let i=0;i<15;i++)expect(document).toContain(`+entry${i}()`);
  expect(document.indexOf('+close()')).toBeLessThan(document.indexOf('-cache0'));
  expect(document.match(/class N_src_backend_core_tasks_lifecycle_ts_Lifecycle\[/g)).toHaveLength(3);
  expect(document).toContain('成员 3/3');
  expect(document).toContain('公开入口 2/2');
});

test('非叶子目录保持子目录边界，并列出本层模块公开入口',()=>{
  const project=fixture({
    'src/backend/core/brain/member-run.ts':'export interface Binding {runId:string}; export function checkedBinding(value:Binding){return value}',
    'src/backend/core/brain/llm/types.ts':'export interface Model {id:string}',
  });
  const result=project.run();expect(result.status,result.stderr).toBe(0);
  const document=project.read('src/backend/core/brain/ARCHITECTURE.md');
  expect(document).toContain('["llm/"] {\n  <<directory>>');
  expect(document).toContain('+checkedBinding()');
  expect(document).not.toContain('["Model"]');
  expect(document).toContain('[llm/](llm/ARCHITECTURE.md)');
});

test('--check 检测源码及契约漂移但不写文档，再生成时保留独立契约',()=>{
  const source='src/backend/core/tasks/sample.ts',contract='src/backend/core/tasks/CONTRACT.md',architecture='src/backend/core/tasks/ARCHITECTURE.md';
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
