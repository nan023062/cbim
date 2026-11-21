import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {afterEach, expect, test} from 'vitest';
import {auditDependencies} from '../../scripts/check-dependencies.mjs';

test.each([
  "import { value } from '../../resource';",
  "import type { ResourceKind } from '../../resource/contracts';",
  "export { value } from '../../resource';",
  "void import('../../resource');",
])('View rejects direct Resource access: %s', source => {
  const from = 'src/view-new/settings/example.tsx';
  const result = audit({
    [from]: source,
    'src/resource/index.ts': 'export const value = 1;',
    'src/resource/contracts.ts': 'export type ResourceKind = string;',
  });
  expect(result.violations).toContainEqual(expect.objectContaining({ from, to: expect.stringMatching(/^src\/resource\//) }));
});

test('View can use a Resource type through the public Bridge contract', () => {
  const result = audit({
    'src/view-new/settings/example.tsx': "import type { ResourceKind } from '../../bridge/contracts/resources';",
    'src/bridge/contracts/resources.ts': "export type { ResourceKind } from '../../resource';",
    'src/resource/index.ts': 'export type ResourceKind = string;',
  });
  expect(result.ok).toBe(true);
});

test.each(["import { value } from '../../resource/plugins';", "import type { Artifact } from '../../resource/plugins';"])('Framework rejects Resource imports: %s', source => {
  const from = 'src/framework/monitor/example.ts';
  const to = 'src/resource/plugins/index.ts';
  const result = audit({ [from]: source, [to]: 'export const value = 1; export interface Artifact {}' });
  expect(result.violations).toContainEqual(expect.objectContaining({ from, to }));
  expect(result.ok).toBe(false);
});

test('ainative/docs 中维护的示例源码仍参与依赖和类型环检查',()=>{
  const valid=audit({'ainative/docs/example.ts':'export const value=1;'});
  expect(valid.ok).toBe(true);
  expect(valid.sourceFiles).toContain('ainative/docs/example.ts');
  const circular=audit({'ainative/docs/a.ts':"export type {B} from './b'; export type A=string;",'ainative/docs/b.ts':"export type {A} from './a'; export type B=string;"});
  expect(circular.ok).toBe(false);
  expect(circular.cycles).toHaveLength(1);
});

test.each(['node:fs','electron','@anthropic-ai/claude-agent-sdk'])('静态引擎清单不得直接加载平台或 SDK：%s',spec=>{
  expect(audit({'src/logic-new/engines/catalog/supported-engines.ts':`import '${spec}';`}).ok).toBe(false);
});

test.each(['src/backend/core/unused.ts','src/frontend/unused.ts','src/foundations/unused.ts'])('retired source layer is rejected even without imports: %s',file=>{
  const result=audit({[file]:'export const value=1;'});
  expect(result.ok).toBe(false);
  expect(result.logicalViolations).toContainEqual(expect.objectContaining({file,rule:'unknown-source-layer'}));
});

const temporary:string[]=[];
const foundationFile=(target:string)=>target==='web/index.ts'?'src/core/web/node.ts':target.startsWith('web/')?'src/core/'+target:target==='files/index.ts'?'src/core/io/text-files.ts':target==='utility/node.ts'?'src/core/io/digest.ts':(target.startsWith('utility/')||target.startsWith('io/'))?'src/core/'+target:/^(files|web)\//.test(target)?'src/core/platform/node/'+target:'src/logic/fixtures/foundation/'+target;
test('新 Core 未登记模块与便携模块中的 Node 导入都被拒绝',()=>{
  const unknown=audit({'src/core/hidden.ts':"import fs from 'node:fs';"});
  expect(unknown.logicalViolations).toContainEqual(expect.objectContaining({rule:'unregistered-core-module'}));
  const hiddenNode=audit({'src/core/utility/extra.ts':"import fs from 'node:fs';"});
  expect(hiddenNode.logicalViolations).toContainEqual(expect.objectContaining({rule:'external-dependency',boundary:'utility-foundations'}));
});
test.each(['src/view-new/example/model.ts','src/framework-ui/controls.tsx','src/bridge/client/call.ts','src/bridge/contracts/example.ts'])('浏览器或纯通信文件 %s 不得直接导入 Node/Electron',from=>{
  for(const spec of ['node:fs','fs/promises','electron','electron/main']){
    const result=audit({[from]:`import '${spec}';`});
    expect(result.logicalViolations).toContainEqual(expect.objectContaining({rule:'runtime-environment',file:from}));
    expect(result.ok).toBe(false);
  }
});
test('foundations is independent even for type dependencies; Main consumes only public web entries',()=>{
  const foundation='src/core/web/node.ts';
  expect(audit({[foundation]:'export const value=1;', 'src/bridge/server/a.ts':"import {value} from '../../core/web/node';"}).ok).toBe(true);
  for(const target of ['logic/knowledge/rules','logic/application','engine-plugins','view','bridge/contracts']){
    const relative=path.posix.relative(path.posix.dirname(foundation),`src/${target}/a.ts`);
    const result=audit({[foundation]:`import type {Value} from '${relative}';`,[`src/${target}/a.ts`]:'export interface Value {}'});
    expect(result.unresolved).toEqual([]);
    expect(result.ok).toBe(false);expect(result.violations).not.toEqual([]);
  }
  const privateEntry=audit({'src/core/web/page-reader.ts':'export class WebPageReader {}','src/bridge/server/a.ts':"import {WebPageReader} from '../../core/web/page-reader';"});
  expect(privateEntry.logicalViolations).toContainEqual(expect.objectContaining({rule:'private-entry',boundary:'web-node'}));
});
afterEach(()=>{for(const root of temporary.splice(0))fs.rmSync(root,{recursive:true,force:true})});
function audit(files:Record<string,string>){
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'cbim-dependencies-'));temporary.push(root);
  for(const [name,content] of Object.entries(files)){const file=path.join(root,name);fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,content)}
  return auditDependencies(root,{externalLoads:[]});
}

test('utility 通用入口禁止通过重导出连带装载 Node 入口',()=>{
  const result=audit({'src/core/utility/index.ts':"export {sha256} from '../io/digest';",'src/core/io/digest.ts':"export const sha256=()=>'';"});
  expect(result.unresolved).toEqual([]);
  expect(result.violations).not.toEqual([]);
  const direct=audit({'src/core/utility/json.ts':"import {createHash} from 'node:crypto';"});
  expect(direct.logicalViolations).toContainEqual(expect.objectContaining({rule:'external-dependency',boundary:'utility-foundations'}));
});

test('fixed bootstrap generated loading remains a real source edge and cannot hide cycles or missing code',()=>{
  const load="import {createRequire} from 'node:module'; const loadApplication=createRequire(import.meta.url); loadApplication(entry);";
  const valid=audit({'src/bridge/server/bootstrap/desktop.ts':load,'src/bridge/server/desktop/main.ts':'export function startDesktop(){}'});
  expect(valid.ok).toBe(true);expect(valid.edges).toContainEqual(expect.objectContaining({from:'src/bridge/server/bootstrap/desktop.ts',to:'src/bridge/server/desktop/main.ts',kind:'generated-dynamic/require'}));
  expect(audit({'src/bridge/server/bootstrap/desktop.ts':load}).unresolved).not.toEqual([]);
  const reverse=audit({'src/bridge/server/bootstrap/desktop.ts':load,'src/bridge/server/desktop/main.ts':"import '../bootstrap/desktop';"});expect(reverse.cycles).toHaveLength(1);expect(reverse.ok).toBe(false);
  expect(audit({'src/bridge/server/bootstrap/desktop.ts':load.replace('loadApplication(entry)','loadApplication(other)'),'src/bridge/server/desktop/main.ts':''}).dynamic).not.toEqual([]);
});
test('detects dynamic imports, CommonJS and createRequire aliases',()=>{
  const result=audit({'scripts/a.mjs':"import('./b.cjs');",'scripts/b.cjs':"require('./c.mjs');",'scripts/c.mjs':"import {createRequire} from 'node:module'; const load=createRequire(import.meta.url); load('./a.mjs');"});
  expect(result.cycles[0].files).toHaveLength(3);
});

test('engines may use portable utility but not other foundation capabilities',()=>{
  const from='src/engine-plugins/pi/rpc.ts';
  for(const target of ['utility/index.ts','utility/node.ts','utility/strings.ts','utility/graphs.ts','files/index.ts','web/index.ts']){
    const to=foundationFile(target),relative=path.posix.relative(path.posix.dirname(from),to);
    expect(audit({[from]:`import type {T} from '${relative}';`,[to]:'export type T=string;'}).ok).toBe(target==='utility/index.ts');
  }
});
test('记忆包仅私有存储实现可用原子文件机制，不能扩散到其它适配器',()=>{
  const target='src/core/io/text-files.ts';
  for(const from of ['src/engine-plugins/memory/storage.ts','src/engine-plugins/memory/engine.ts','src/engine-plugins/pi/engine.ts']){
    const spec=path.posix.relative(path.posix.dirname(from),target),result=audit({[from]:`import {atomic} from '${spec}';`,[target]:'export const atomic=()=>{};'});
    expect(result.ok).toBe(from.endsWith('/memory/storage.ts'));
  }
});

test.each(["import type { Value } from '../io/bytes';","export { value } from '../io/bytes';"])('Core 一级子模块禁止单向引用 %s',source=>{
  const result=audit({'src/core/web/contracts.ts':source,'src/core/io/bytes.ts':'export type Value=string;export const value=1;'});
  expect(result.violations).toContainEqual(expect.objectContaining({from:'src/core/web/contracts.ts',to:'src/core/io/bytes.ts'}));
});

// Retired application policies are replaced by the current host and engine boundaries.
test.each([
 ['src/view-new/office/a.ts','src/logic-new/projects/project.ts',false],
 ['src/core/utility/a.ts','src/logic-new/models/index.ts',false],
 ['src/framework/cability/a.ts','src/logic-new/projects/project.ts',false],
 ['src/resource/a.ts','src/logic-new/models/index.ts',false],
 ['src/engine-plugins/pi/a.ts','src/logic-new/execution/rules/types.ts',true],
 ['src/engine-plugins/pi/a.ts','src/logic-new/models/service/llm-profiles.ts',false],
 ['src/logic-new/execution/rules/engine-tools.ts','src/logic-new/projects/project.ts',false],
 ['src/logic-new/projects/office-engine-loader.ts','src/engine-plugins/pi/engine.ts',false],
 ['src/logic-new/projects/a.ts','src/engine-plugins/pi/engine.ts',false],
 ['src/bridge/server/desktop/main.ts','src/logic-new/projects/organization-contract.ts',true],
 ['src/bridge/server/bootstrap/desktop.ts','src/logic-new/projects/project.ts',false],
 ['src/logic-new/resource-management/connector-runtime.ts','src/framework/connectors/index.ts',true],
 ['src/logic-new/updates/service/desktop-releases.ts','src/updater/release-policy.ts',true],
])('current source boundary %s -> %s = %s',(from,to,allowed)=>{
 const spec=path.posix.relative(path.posix.dirname(from),to);
 const result=audit({[from]:"import type {T} from '"+(spec.startsWith('.')?spec:'./'+spec)+"';",[to]:'export type T=string;'});
 expect(result.unresolved).toEqual([]);expect(result.ok).toBe(allowed);
});

test('retired Logic cannot be restored through a type or runtime import',()=>{
 for(const from of ['src/bridge/server/desktop/main.ts','src/logic-new/projects/a.ts','src/engine-plugins/pi/a.ts']){
  const target='src/logic/a.ts',spec=path.posix.relative(path.posix.dirname(from),target);
  expect(audit({[from]:"import type {T} from '"+spec+"';",[target]:'export type T=string;'}).ok).toBe(false);
 }
});

// All packaged adapter implementations participate in the graph; no unused source table is needed.
test('engine loader audits every registered package target',()=>{
 const result=audit({'src/logic-new/projects/office-engine-loader.ts':"import {createRequire} from 'node:module'; const loadAdapter=createRequire(import.meta.url); loadAdapter(descriptor.entry);",...Object.fromEntries(['pi','claude','codex','memory'].map(id=>['src/engine-plugins/'+id+'/package.ts','export const engineAdapter={};']))});
 expect(result.unresolved).toEqual([]);expect(result.violations).toEqual([]);expect(result.edges.filter(edge=>edge.kind==='generated-dynamic/require')).toHaveLength(4);
});
