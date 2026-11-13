import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {afterEach,expect,it} from 'vitest';
import {checkTestModules,selectModuleTests} from '../scripts/test-modules.mjs';

const roots:string[]=[];
afterEach(()=>{for(const root of roots.splice(0))fs.rmSync(root,{recursive:true,force:true})});
function sample(extra:Record<string,string>={},kind='unit'){
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'cbim-test-modules-'));roots.push(root);
  const files={'src/backend/core/foundation/example/index.ts':'export const value=1;','tests/example.test.ts':"import {value} from '../src/backend/core/foundation/example';",...extra};
  for(const [file,body] of Object.entries(files)){fs.mkdirSync(path.dirname(path.join(root,file)),{recursive:true});fs.writeFileSync(path.join(root,file),body)}
  const catalog={version:1,modules:{'foundations/example':{roots:['src/backend/core/foundation/example/'],tests:{[kind]:['tests/example.test.ts']}}}};
  return {root,catalog,run:()=>checkTestModules(root,{catalog,files:['tests/example.test.ts']})};
}
it('合法单模块单元可选中，空模块及非法测试类型不会降级为全仓执行',()=>{
  const f=sample(),result=f.run();expect(result.errors).toEqual([]);
  expect(selectModuleTests(result.entries,'foundations/example')).toEqual(['tests/example.test.ts']);
  expect(()=>selectModuleTests(result.entries,'missing')).toThrow('No unit tests');
  expect(()=>selectModuleTests(result.entries,'foundations/example','unknown')).toThrow();
});
it('不允许单元通过辅助文件间接加载完整应用，也禁止类型引用掩盖依赖',()=>{
  for(const clause of ['import','import type']){
    const f=sample({'tests/example.test.ts':"import './fixture';",'tests/fixture.ts':`${clause} {Application} from '../src/backend/main/assembly/application';`,'src/backend/main/assembly/application.ts':'export class Application {}'});
    expect(f.run().errors.some(error=>error.includes('Unit loads application'))).toBe(true);
  }
});
it('拒绝跨模块单元和未登记的新测试；契约测试显式保留跨模块协作',()=>{
  const extra={'tests/example.test.ts':"import {value} from '../src/backend/core/foundation/example';import {other} from '../src/backend/core/foundation/other';",'src/backend/core/foundation/other/index.ts':'export const other=2;'};
  expect(sample(extra).run().errors.some(error=>error.includes('Unit crosses module'))).toBe(true);
  expect(sample(extra,'contract').run().ok).toBe(true);
  const f=sample();expect(checkTestModules(f.root,{catalog:f.catalog,files:['tests/new.test.ts']}).errors).toContain('Unregistered test: tests/new.test.ts');
});
it('任何测试类型都禁止直接或通过辅助模块导入其它测试套件',()=>{
  const f=sample({'tests/example.test.ts':"import './fixture';",'tests/fixture.ts':"import './other.test';",'tests/other.test.ts':'export const other=1;'},'integration');
  expect(f.run().errors.some(error=>error.includes('Test imports another suite'))).toBe(true);
});
it.each([
  "import {} from '../src/backend/core/foundation/other';",
  "import * as other from '../src/backend/core/foundation/other';",
  "import {type Other,other} from '../src/backend/core/foundation/other';",
  "import {type Other} from '../src/backend/core/foundation/other';import {other} from '../src/backend/core/foundation/other';",
  "import {type Other} from '../src/backend/core/foundation/other';void import('../src/backend/core/foundation/other');",
])('空导入、混合导入和同源同一行动态导入仍算运行时依赖：%s',declaration=>{
  const f=sample({'tests/example.test.ts':declaration,'src/backend/core/foundation/other/index.ts':'export interface Other {} export const other=1;'});
  expect(f.run().errors.some(error=>error.includes('Unit crosses module'))).toBe(true);
});
it('删除、重复登记和未知类型均失败；类型数据不会被误判为跨模块运行实现',()=>{
  const f=sample({'tests/example.test.ts':"import {value} from '../src/backend/core/foundation/example';import {type Other} from '../src/backend/core/foundation/other';",'src/backend/core/foundation/other/index.ts':'export interface Other {}'});
  expect(f.run().ok).toBe(true);
  f.catalog.modules['foundations/example'].tests.unit.push('tests/example.test.ts');expect(f.run().errors.some(error=>error.includes('Duplicate owner'))).toBe(true);
  fs.unlinkSync(path.join(f.root,'tests/example.test.ts'));expect(f.run().errors.some(error=>error.includes('Missing/invalid test'))).toBe(true);
  expect(sample({},'unknown').run().errors.some(error=>error.includes('Unknown test kind'))).toBe(true);
});
