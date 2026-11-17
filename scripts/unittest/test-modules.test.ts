import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {execFileSync} from 'node:child_process';
import {afterEach,expect,it} from 'vitest';
import {checkTestModules,selectModuleTests} from '../test-modules.mjs';

const roots:string[]=[];
afterEach(()=>{for(const root of roots.splice(0))fs.rmSync(root,{recursive:true,force:true})});
function sample(extra:Record<string,string>={},kind='unit'){
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'cbim-test-modules-'));roots.push(root);
  const files={'src/logic/example/index.ts':'export const value=1;','src/logic/example/unittest/example.test.ts':"import {value} from '..';",...extra};
  for(const [file,body] of Object.entries(files)){fs.mkdirSync(path.dirname(path.join(root,file)),{recursive:true});fs.writeFileSync(path.join(root,file),body)}
  const catalog={version:1,modules:{'logic/example':{roots:['src/logic/example/'],tests:{[kind]:['src/logic/example/unittest/example.test.ts']}}}};
  return {root,catalog,run:()=>checkTestModules(root,{catalog,files:['src/logic/example/unittest/example.test.ts']})};
}
it('合法单模块单元可选中，空模块及非法测试类型不会降级为全仓执行',()=>{
  const f=sample(),result=f.run();expect(result.errors).toEqual([]);
  expect(selectModuleTests(result.entries,'logic/example')).toEqual(['src/logic/example/unittest/example.test.ts']);
  expect(()=>selectModuleTests(result.entries,'missing')).toThrow('No unit tests');
  expect(()=>selectModuleTests(result.entries,'logic/example','unknown')).toThrow();
});
it('单元必须在其责任模块的 unittest，不能只登记新标签保留散落路径',()=>{
  const f=sample();
  fs.mkdirSync(path.join(f.root,'unittest'));
  fs.writeFileSync(path.join(f.root,'unittest/misplaced.test.ts'),'');
  f.catalog.modules['logic/example'].tests.unit=['unittest/misplaced.test.ts'];
  expect(f.run().errors.some(error=>error.includes('Test must live'))).toBe(true);
});
it('不允许单元通过辅助文件间接加载完整应用，也禁止类型引用掩盖依赖',()=>{
  for(const clause of ['import','import type']){
    const f=sample({'src/logic/example/unittest/example.test.ts':"import './fixture';",'src/logic/example/unittest/fixture.ts':`${clause} {Application} from '../../application/application';`,'src/logic/application/application.ts':'export class Application {}'});
    expect(f.run().errors.some(error=>error.includes('Unit loads application'))).toBe(true);
  }
});
it('拒绝跨模块单元和未登记的新测试；契约测试显式保留跨模块协作',()=>{
  const extra={'src/logic/example/unittest/example.test.ts':"import {value} from '..';import {other} from '../../other';",'src/logic/other/index.ts':'export const other=2;'};
  expect(sample(extra).run().errors.some(error=>error.includes('Unit crosses module'))).toBe(true);
  expect(sample(extra,'contract').run().ok).toBe(true);
  const f=sample();expect(checkTestModules(f.root,{catalog:f.catalog,files:['unittest/new.test.ts']}).errors).toContain('Unregistered test: unittest/new.test.ts');
});
it('任何测试类型都禁止直接或通过辅助模块导入其它测试套件',()=>{
  const f=sample({'src/logic/example/unittest/example.test.ts':"import './fixture';",'src/logic/example/unittest/fixture.ts':"import './other.test';",'src/logic/example/unittest/other.test.ts':'export const other=1;'},'integration');
  expect(f.run().errors.some(error=>error.includes('Test imports another suite'))).toBe(true);
});
it('已提交的旧 tests 目录套件必须报告遗漏，不能因不再发现该目录而静默跳过',()=>{
  const f=sample({'tests/forgotten.test.ts':''});
  execFileSync('git',['init','--quiet'],{cwd:f.root});
  execFileSync('git',['add','--','tests/forgotten.test.ts'],{cwd:f.root});
  const result=checkTestModules(f.root,{catalog:f.catalog});
  expect(result.errors).toContain('Unregistered test: tests/forgotten.test.ts');
});
it('整体测试只属于工程根模块且登记为集成；模块契约和集成不能放在根目录',()=>{
  for(const kind of ['contract','integration']){
    const f=sample({},kind),file='unittest/application.test.ts';
    fs.mkdirSync(path.join(f.root,'unittest'));
    fs.writeFileSync(path.join(f.root,file),"import '../src/logic/example';");
    f.catalog.modules['logic/example'].tests[kind]=[file];
    expect(f.run().errors.some(error=>error.includes('Test must live'))).toBe(true);
    const catalog={version:1,modules:{project:{directory:'.',roots:['src/logic/example/'],tests:{[kind]:[file]}}}};
    const result=checkTestModules(f.root,{catalog,files:[file]});
    expect(result.ok).toBe(kind==='integration');
    if(kind==='contract')expect(result.errors.some(error=>error.includes('Project-wide tests must be integration'))).toBe(true);
  }
});
it.each([
  "import {} from '../../other';",
  "import * as other from '../../other';",
  "import {type Other,other} from '../../other';",
  "import {type Other} from '../../other';import {other} from '../../other';",
  "import {type Other} from '../../other';void import('../../other');",
])('空导入、混合导入和同源同一行动态导入仍算运行时依赖：%s',declaration=>{
  const f=sample({'src/logic/example/unittest/example.test.ts':declaration,'src/logic/other/index.ts':'export interface Other {} export const other=1;'});
  expect(f.run().errors.some(error=>error.includes('Unit crosses module'))).toBe(true);
});
it('删除、重复登记和未知类型均失败；类型数据不会被误判为跨模块运行实现',()=>{
  const f=sample({'src/logic/example/unittest/example.test.ts':"import {value} from '..';import {type Other} from '../../other';",'src/logic/other/index.ts':'export interface Other {}'});
  expect(f.run().ok).toBe(true);
  f.catalog.modules['logic/example'].tests.unit.push('src/logic/example/unittest/example.test.ts');expect(f.run().errors.some(error=>error.includes('Duplicate owner'))).toBe(true);
  fs.unlinkSync(path.join(f.root,'src/logic/example/unittest/example.test.ts'));expect(f.run().errors.some(error=>error.includes('Missing/invalid test'))).toBe(true);
  expect(sample({},'unknown').run().errors.some(error=>error.includes('Unknown test kind'))).toBe(true);
});
