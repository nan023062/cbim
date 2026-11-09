import {it,expect} from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fixture} from './helpers';
import {guard} from '../src/backend/main/platform/tool-guard';

it('根目录可非递归列出并创建业务文件，递归知识访问被拒绝',()=>{
  const root=path.resolve('test-results/guard-root');
  const check=(name:string,input:any)=>guard({name,input},root);
  expect(check('ls',{path:'.'})).toBeUndefined();
  expect(check('write',{path:'game/index.html',content:'<!doctype html>Game'})).toBeUndefined();
  expect(check('read',{path:'game/index.html'})).toBeUndefined();
  for(const input of [{path:'.cbim'},{path:'.',recursive:true}])expect(check('ls',input)).toBeTruthy();
  expect(check('grep',{path:'.',pattern:'secret'})).toBeTruthy();
});
it('原生工具拒绝显式知识文件、补丁和宽泛搜索，放行普通源码及命令',()=>{
  const root=path.resolve('test-results/guard-root'),check=(name:string,input:any)=>guard({name,input},root);
  for(const [name,input] of [
    ['Read',{file_path:'.cbim/team/a/agent.json'}],['Edit',{file_path:'.CBIM/README.md'}],
    ['apply_patch',{patch:'*** Update File: .cbim/README.md'}],['Bash',{command:'cat .cbim/README.md'}],
    ['Grep',{path:'.',pattern:'secret'}],['Bash',{command:'rg secret .'}],['Read',{path:'%2ecbim%2fREADME.md'}]
  ] as const)expect(check(name,input)).toBeTruthy();
  expect(check('Read',{file_path:'src/app.ts'})).toBeUndefined();expect(check('Bash',{command:'pnpm test'})).toBeUndefined();
  expect(check('Bash',{command:'rg secret src/app.ts'})).toBeUndefined();
  // 工具名不能成为绕过知识目录保护的后门。
  expect(check('cbim_knowledge_snapshot',{path:'.cbim/README.md'})).toBeTruthy();
});
it('目录别名不能绕过内部知识访问保护，普通业务别名不受影响',async()=>{
  const f=await fixture();try{
    await f.app.dispatch('add',{path:f.a});await fs.mkdir(path.join(f.a,'src'));
    await fs.symlink(path.join(f.a,'.cbim'),path.join(f.a,'hidden-knowledge'),'junction');
    await fs.symlink(path.join(f.a,'src'),path.join(f.a,'business'),'junction');
    expect(guard({name:'read',input:{path:'hidden-knowledge/README.md'}},f.a)).toBeTruthy();
    expect(guard({name:'ls',input:{path:'hidden-knowledge'}},f.a)).toBeTruthy();
    expect(guard({name:'ls',input:{path:'business'}},f.a)).toBeUndefined();
  }finally{await f.cleanup()}
});
