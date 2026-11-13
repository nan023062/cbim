import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {afterEach, expect, test} from 'vitest';
import {auditDependencies} from '../scripts/check-dependencies.mjs';

const temporary:string[]=[];
test('调度器仅可组合 portable utility 公开入口',()=>{
  const from='src/backend/scheduler-engine/context/a.ts';
  for(const target of ['utility/index.ts','utility/node.ts','utility/json.ts','utility/graphs.ts','files/index.ts','web/index.ts']){
    const to='src/backend/core/foundation/'+target,relative=path.posix.relative(path.posix.dirname(from),to).replace(/\.ts$/,'');
    expect(audit({[from]:`import type {T} from '${relative}';`,[to]:'export type T=string;'}).ok).toBe(target==='utility/index.ts');
  }
});
test('foundations is independent even for type dependencies; Main consumes only public web entries',()=>{
  const foundation='src/backend/core/foundation/web/index.ts';
  expect(audit({[foundation]:'export const value=1;', 'src/backend/main/a.ts':"import {value} from '../core/foundation/web';"}).ok).toBe(true);
  for(const target of ['backend/core','backend/main','backend/scheduler-engine','frontend','bridge/contracts']){
    const relative=path.posix.relative(path.posix.dirname(foundation),`src/${target}/a.ts`);
    const result=audit({[foundation]:`import type {Value} from '${relative}';`,[`src/${target}/a.ts`]:'export interface Value {}'});
    expect(result.unresolved).toEqual([]);
    expect(result.ok).toBe(false);expect(result.violations).not.toEqual([]);
  }
  const privateEntry=audit({'src/backend/core/foundation/web/page-reader.ts':'export class WebPageReader {}','src/backend/main/a.ts':"import {WebPageReader} from '../core/foundation/web/page-reader';"});
  expect(privateEntry.logicalViolations).toContainEqual(expect.objectContaining({rule:'private-entry',boundary:'web-foundations'}));
});
afterEach(()=>{for(const root of temporary.splice(0))fs.rmSync(root,{recursive:true,force:true})});
test.each(['utility','files','web'])('合并后的 %s 子库仍不能反向依赖父层约定或业务',(capability)=>{
  const from=`src/backend/core/foundation/${capability}/index.ts`;
  for(const to of ['src/backend/core/foundation/errors.ts','src/backend/core/foundation/identity.ts','src/backend/core/foundation/paths.ts','src/backend/core/tasks/example.ts']){
    const relative=path.posix.relative(path.posix.dirname(from),to);
    const result=audit({[from]:`export type {Value} from '${relative}';`,[to]:'export type Value=string;'});
    expect(result.unresolved).toEqual([]);expect(result.violations).not.toEqual([]);
  }
});
test('Updater 与 Bridge 不因目录合并取得额外 Core 或基础库访问权',()=>{
  for(const [from,to] of [['src/backend/updater/example.ts','src/backend/core/foundation/errors.ts'],['src/bridge/contracts/example.ts','src/backend/core/foundation/utility/index.ts']]){
    const relative=path.posix.relative(path.posix.dirname(from),to);
    const result=audit({[from]:`import type {Value} from '${relative}';`,[to]:'export type Value=string;'});
    expect(result.unresolved).toEqual([]);expect(result.violations).not.toEqual([]);
  }
});
test('前端工具库仅向前端公开，私有实现与跨域依赖被拒绝',()=>{
  const entry='src/frontend/foundations/utility/index.ts',inner='src/frontend/foundations/utility/json.ts';
  expect(audit({[entry]:"export {equalJson} from './json';",[inner]:'export const equalJson=()=>true;','src/frontend/tasks/a.ts':"import {equalJson} from '../foundations/utility';"}).ok).toBe(true);
  const privateImport=audit({[inner]:'export const equalJson=()=>true;','src/frontend/team/a.ts':"import {equalJson} from '../foundations/utility/json';"});
  expect(privateImport.logicalViolations).toContainEqual(expect.objectContaining({rule:'private-entry',boundary:'frontend-utility'}));
  for(const from of ['src/backend/core/a.ts','src/backend/core/foundation/utility/index.ts','src/bridge/contracts/a.ts']){
    const relative=path.posix.relative(path.posix.dirname(from),entry);
    expect(audit({[entry]:'export type Value=string;',[from]:`import type {Value} from '${relative}';`}).ok).toBe(false);
  }
});
test('前端工具库不能反向引用页面、通信契约或后端工具，包含类型与第三方依赖',()=>{
  const inner='src/frontend/foundations/utility/json.ts';
  for(const target of ['src/frontend/team/a.ts','src/bridge/contracts/a.ts','src/backend/core/foundation/utility/index.ts']){
    const relative=path.posix.relative(path.posix.dirname(inner),target);
    expect(audit({[inner]:`import type {Value} from '${relative}';`,[target]:'export type Value=string;'}).ok).toBe(false);
  }
  const external=audit({[inner]:"import {useState} from 'react';"});
  expect(external.logicalViolations).toContainEqual(expect.objectContaining({rule:'external-dependency',boundary:'frontend-utility'}));
  const crossDomain=audit({'src/frontend/tasks/a.ts':"export {value} from '../../backend/core/foundation/utility';",'src/backend/core/foundation/utility/index.ts':'export const value=1;'});
  expect(crossDomain.unresolved).toEqual([]);expect(crossDomain.ok).toBe(false);
});
test.each([['files','text-files','file-foundations'],['utility','async','utility-foundations']])('Core 可组合 %s 公开入口，基础库不能反向引用业务或暴露私有实现',(capability,implementation,boundary)=>{
  const entry=`src/backend/core/foundation/${capability}/index.ts`,inner=`src/backend/core/foundation/${capability}/${implementation}.ts`;
  expect(audit({[entry]:'export const value=1;','src/backend/core/example.ts':`import {value} from './foundation/${capability}';`}).ok).toBe(true);
  const reverse=audit({[entry]:"import type {Value} from '../../example';",'src/backend/core/example.ts':'export interface Value {}'});
  expect(reverse.unresolved).toEqual([]);
  expect(reverse.violations).not.toEqual([]);
  const privateEntry=audit({[inner]:'export const value=1;','src/backend/main/example.ts':`import {value} from '../core/foundation/${capability}/${implementation}';`});
  expect(privateEntry.logicalViolations).toContainEqual(expect.objectContaining({rule:'private-entry',boundary}));
});
function audit(files:Record<string,string>){
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'cbim-dependencies-'));temporary.push(root);
  for(const [name,content] of Object.entries(files)){const file=path.join(root,name);fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,content)}
  return auditDependencies(root,{externalLoads:[]});
}

test('utility 通用入口禁止通过重导出连带装载 Node 入口',()=>{
  const result=audit({'src/backend/core/foundation/utility/index.ts':"export {sha256} from './node';",'src/backend/core/foundation/utility/node.ts':"export const sha256=()=>'';"});
  expect(result.violations).not.toEqual([]);
  const direct=audit({'src/backend/core/foundation/utility/json.ts':"import {createHash} from 'node:crypto';"});
  expect(direct.logicalViolations).toContainEqual(expect.objectContaining({rule:'external-dependency',boundary:'utility-foundations'}));
});
test('Updater 只组合 utility 通用入口，不能借基础层依赖其他方案或 Node 入口',()=>{
  expect(audit({'src/backend/updater/a.ts':"import {value} from '../core/foundation/utility';",'src/backend/core/foundation/utility/index.ts':'export const value=1;'}).ok).toBe(true);
  for(const target of ['utility/node','files','web']){
    const file=target==='utility/node'?`src/backend/core/foundation/${target}.ts`:`src/backend/core/foundation/${target}/index.ts`;
    const result=audit({'src/backend/updater/a.ts':`import {value} from '../core/foundation/${target}';`,[file]:'export const value=1;'});
    expect(result.unresolved).toEqual([]);expect(result.violations).not.toEqual([]);
  }
});

test('fixed bootstrap generated loading remains a real source edge and cannot hide cycles or missing code',()=>{
  const load="import {createRequire} from 'node:module'; const loadApplication=createRequire(import.meta.url); loadApplication(entry);";
  const valid=audit({'src/backend/bootstrap/desktop.ts':load,'src/backend/main/main.ts':'export function startDesktop(){}'});
  expect(valid.ok).toBe(true);expect(valid.edges).toContainEqual(expect.objectContaining({from:'src/backend/bootstrap/desktop.ts',to:'src/backend/main/main.ts',kind:'generated-dynamic/require'}));
  expect(audit({'src/backend/bootstrap/desktop.ts':load}).unresolved).not.toEqual([]);
  const reverse=audit({'src/backend/bootstrap/desktop.ts':load,'src/backend/main/main.ts':"import '../bootstrap/desktop';"});expect(reverse.cycles).toHaveLength(1);expect(reverse.ok).toBe(false);
  expect(audit({'src/backend/bootstrap/desktop.ts':load.replace('loadApplication(entry)','loadApplication(other)'),'src/backend/main/main.ts':''}).dynamic).not.toEqual([]);
});

test('all maintained code has no cycles including type dependencies and no unreviewed loads',()=>{
  const result=auditDependencies();
  expect(result.files).toBeGreaterThan(150);
  expect({cycles:result.cycles,unresolved:result.unresolved,dynamic:result.dynamic,violations:result.violations,logical:result.logicalViolations}).toEqual({cycles:[],unresolved:[],dynamic:[],violations:[],logical:[]});
  expect(result.ok).toBe(true);
  const reachable=(start:string)=>{
    const seen=new Set([start]),queue=[start];
    for(let i=0;i<queue.length;i++)for(const edge of result.edges.filter(e=>e.from===queue[i]))if(!seen.has(edge.to)){seen.add(edge.to);queue.push(edge.to)}
    return [...seen];
  };
  for(const file of result.edges.map(edge=>edge.from).filter(file=>file.startsWith('src/frontend/execution-view/'))){
    expect(reachable(file).filter(value=>value.startsWith('src/frontend/tasks/')||value.startsWith('src/frontend/conversation/')||value.startsWith('src/frontend/team/')),file).toEqual([]);
  }
  for(const file of ['tests/data/knowledge.ts','tests/data/domain-snapshot.ts','tests/core-domains.test.ts']){
    expect(reachable(file).filter(value=>value.startsWith('src/backend/main/')||value.startsWith('src/backend/scheduler-engine/')||value==='tests/helpers.ts'),file).toEqual([]);
  }
});

test('read models are accessible through their public entry, not private implementations',()=>{
  const files={
    'src/backend/core/knowledge/read-models/index.ts':"export {Team} from './team';",
    'src/backend/core/knowledge/read-models/team.ts':'export class Team {}',
  };
  expect(audit({...files,'src/backend/scheduler-engine/a.ts':"import {Team} from '../core/knowledge/read-models';"}).ok).toBe(true);
  const result=audit({...files,'src/backend/scheduler-engine/a.ts':"import type {Team} from '../core/knowledge/read-models/team';"});
  expect(result.logicalViolations).toContainEqual(expect.objectContaining({rule:'private-entry',boundary:'knowledge-read-models',kind:'type'}));
  expect(result.cycles).toEqual([]);expect(result.ok).toBe(false);
});
test('alias reexports and literal dynamic imports cannot bypass a private entry',()=>{
  const files={
    'tsconfig.json':JSON.stringify({compilerOptions:{baseUrl:'.',paths:{'@core/*':['src/backend/core/*']}}}),
    'src/backend/core/knowledge/read-models/team.ts':'export class Team {}',
  };
  for(const source of ["export type {Team} from '@core/knowledge/read-models/team';","export type T=import('@core/knowledge/read-models/team').Team;","import('../core/knowledge/read-models/team');"]){
    const result=audit({...files,'src/backend/scheduler-engine/a.ts':source});
    expect(result.logicalViolations).toContainEqual(expect.objectContaining({rule:'private-entry'}));expect(result.ok).toBe(false);
  }
});
test('snapshot data and read models reject reverse dependencies on orchestration without needing a file cycle',()=>{
  for(const file of ['src/backend/core/knowledge/types.ts','src/backend/core/knowledge/read-models/snapshot.ts']){
    const result=audit({[file]:`import type {Query} from '${file.endsWith('/types.ts')?'./knowledge-queries':'../knowledge-queries'}';`,'src/backend/core/knowledge/knowledge-queries.ts':'export interface Query {}'});
    expect(result.cycles).toEqual([]);expect(result.logicalViolations).toContainEqual(expect.objectContaining({rule:'logical-direction'}));expect(result.ok).toBe(false);
  }
});

test('P1 narrow boundaries reject restored write access, shared stores and business tool registration',()=>{
  const cases=[
    ['src/backend/core/knowledge/knowledge-queries.ts','./ports','src/backend/core/knowledge/ports.ts','knowledge-query-orchestration'],
    ['src/backend/core/knowledge/knowledge-queries.ts','./knowledge-refresh','src/backend/core/knowledge/knowledge-refresh.ts','knowledge-query-orchestration'],
    ['src/backend/core/budget/model-request-budget-storage.ts','../dispatch/dispatch-storage','src/backend/core/dispatch/dispatch-storage.ts','request-budget-port'],
    ['src/backend/scheduler-engine/budget/model-request-budget-service.ts','../../core/dispatch/dispatch-storage','src/backend/core/dispatch/dispatch-storage.ts','request-budget-service'],
    ['src/backend/scheduler-engine/budget/model-request-budget-service.ts','./scope-budget-service','src/backend/scheduler-engine/budget/scope-budget-service.ts','request-budget-service'],
    ['src/backend/core/execution/engine-tools.ts','./capabilities/member-tool-capabilities','src/backend/core/execution/capabilities/member-tool-capabilities.ts','engine-tool-registry'],
  ];
  for(const [file,spec,target,boundary] of cases){
    const result=audit({[file]:`import type {T} from '${spec}';`,[target]:'export interface T {}'});
    expect(result.cycles).toEqual([]);expect(result.logicalViolations).toContainEqual(expect.objectContaining({rule:'logical-direction',boundary}));expect(result.ok).toBe(false);
  }
});
test('test data rejects Application imports and private helper reexports',()=>{
  const direct=audit({'tests/data/knowledge.ts':"import type {App} from '../../src/backend/main/assembly/application';",'src/backend/main/assembly/application.ts':'export class App {}'});
  expect(direct.logicalViolations).toContainEqual(expect.objectContaining({rule:'logical-direction',boundary:'test-data'}));expect(direct.ok).toBe(false);
  const privateEntry=audit({'tests/data/private.ts':'export const value=1;','tests/sample.ts':"export {value} from './data/private';"});
  expect(privateEntry.logicalViolations).toContainEqual(expect.objectContaining({rule:'private-entry',boundary:'test-data'}));expect(privateEntry.ok).toBe(false);
});
test('a shared pure helper cannot hide an indirect filesystem or SDK dependency',()=>{
  const indirect=audit({
    'tests/data/knowledge.ts':"import {hash} from '../../src/backend/core/foundation/serialization';",
    'src/backend/core/foundation/serialization.ts':"import {write} from './files'; export const hash=write;",
    'src/backend/core/foundation/files.ts':'export const write=()=>{};',
  });
  expect(indirect.logicalViolations).toContainEqual(expect.objectContaining({rule:'logical-direction',boundary:'pure-foundation'}));expect(indirect.ok).toBe(false);
  for(const spec of ['node:fs/promises','@anthropic-ai/claude-agent-sdk']){
    const result=audit({'src/backend/core/knowledge/read-models/snapshot.ts':`import type * as External from '${spec}';`});
    expect(result.logicalViolations).toContainEqual(expect.objectContaining({rule:'external-dependency',boundary:'knowledge-read-models'}));expect(result.ok).toBe(false);
  }
});
test('relative paths into node_modules cannot hide an external dependency',()=>{
  const result=audit({
    'src/backend/core/knowledge/read-models/snapshot.ts':"import type {Sdk} from '../../../../../node_modules/private-sdk/index';",
    'node_modules/private-sdk/index.ts':'export interface Sdk {}',
  });
  expect(result.unresolved).toEqual([]);
  expect(result.logicalViolations).toContainEqual(expect.objectContaining({rule:'external-dependency',boundary:'knowledge-read-models',spec:'../../../../../node_modules/private-sdk/index'}));
  expect(result.ok).toBe(false);
});
test('detects the Application to dispatcher reverse type dependency',()=>{
  const result=audit({'src/backend/core/application.ts':"import {dispatch} from './dispatch'; export class App {}",'src/backend/core/dispatch.ts':"import type {App} from './application'; export const dispatch=(app:App)=>app;"});
  expect(result.cycles[0].files).toEqual(['src/backend/core/application.ts','src/backend/core/dispatch.ts']);
  expect(result.cycles[0].edges.some(e=>e.kind==='type'&&e.line===1)).toBe(true);
});
test('detects long cycles through type reexports and import types',()=>{
  const result=audit({'src/backend/core/a.ts':"export type {B} from './b'; export interface A {}",'src/backend/core/b.ts':"export type B=import('./c').C;",'src/backend/core/c.ts':"import {type A} from './a'; export type C=A;"});
  expect(result.cycles[0].files).toEqual(['src/backend/core/a.ts','src/backend/core/b.ts','src/backend/core/c.ts']);
});
test('detects dynamic imports, CommonJS and createRequire aliases',()=>{
  const result=audit({'scripts/a.mjs':"import('./b.cjs');",'scripts/b.cjs':"require('./c.mjs');",'scripts/c.mjs':"import {createRequire} from 'node:module'; const load=createRequire(import.meta.url); load('./a.mjs');"});
  expect(result.cycles[0].files).toHaveLength(3);
});
test('declaration companion cannot hide a JS runtime cycle',()=>{
  const result=audit({'src/backend/core/a.mjs':"import './b.mjs';",'src/backend/core/b.mjs':"import './a.mjs';",'src/backend/core/b.d.mts':'export interface B {}'});
  expect(result.cycles[0].files).toEqual(['src/backend/core/a.mjs','src/backend/core/b.mjs']);
});
test('detects import equals and self cycles',()=>{
  expect(audit({'src/backend/core/a.ts':"import x = require('./a'); export = x;"}).cycles[0].files).toEqual(['src/backend/core/a.ts']);
});
test('includes declaration triple slash path references',()=>{
  const result=audit({'src/backend/core/a.d.ts':'/// <reference path="b.d.ts" />\ninterface A {}','src/backend/core/b.d.ts':'/// <reference path="a.d.ts" />\ninterface B {}'});
  expect(result.cycles[0].files).toEqual(['src/backend/core/a.d.ts','src/backend/core/b.d.ts']);
});
test('resolves tsconfig aliases and index modules',()=>{
  const result=audit({'tsconfig.json':JSON.stringify({compilerOptions:{baseUrl:'.',paths:{'@/*':['src/backend/core/*']}}}),'src/backend/core/a.ts':"import '@/b';",'src/backend/core/b/index.ts':"export * from '../a';"});
  expect(result.cycles[0].files).toEqual(['src/backend/core/a.ts','src/backend/core/b/index.ts']);
});
test('acyclic shared contract passes; unresolvable paths and computed loads fail',()=>{
  expect(audit({'src/backend/core/a.ts':"import type {T} from './contract';",'src/backend/core/b.ts':"import type {T} from './contract';",'src/backend/core/contract.ts':'export type T=string;'}).ok).toBe(true);
  const bad=audit({'src/backend/core/a.ts':"import './missing'; import(target);"});
  expect(bad.ok).toBe(false);expect(bad.unresolved).toHaveLength(1);expect(bad.dynamic).toHaveLength(1);
});
test('cross layer type imports fail even without a cycle',()=>{
  const result=audit({'src/backend/core/a.ts':"import type {T} from '../main/b';",'src/backend/main/b.ts':'export type T=string;'});
  expect(result.violations).toHaveLength(1);expect(result.ok).toBe(false);
});
test('snapshot contracts and domain views reject reverse or private dependencies without a file cycle',()=>{
  const contracts='src/backend/core/knowledge/types.ts';
  const snapshot='src/backend/core/knowledge/read-models/snapshot.ts';
  const team='src/backend/core/knowledge/read-models/team.ts';
  const workspace='src/backend/core/knowledge/read-models/workspace.ts';
  const port='src/backend/core/knowledge/ports.ts';
  const query='src/backend/core/knowledge/knowledge-queries.ts';
  const denied=[
    [contracts,snapshot],[snapshot,team],[team,workspace],[workspace,team],
    [team,port],[query,port],['src/backend/core/foundation/json.ts',contracts],
    ['tests/knowledge-data.ts','tests/helpers.ts'],
    ['tests/knowledge-fixture.ts','src/backend/main/assembly/application.ts'],
    ['src/backend/core/budget/model-request-budget-storage.ts','src/backend/core/dispatch/dispatch-storage.ts'],
    ['src/backend/scheduler-engine/budget/model-request-budget-service.ts','src/backend/core/dispatch/dispatch-storage.ts'],
    ['src/backend/core/execution/engine-tools.ts','src/backend/core/evidence/progress-tools.ts'],
    ['src/backend/core/execution/index.ts','src/backend/engines/pi/engine.ts'],
    ['src/frontend/execution-view/WorkStatus.tsx','src/frontend/tasks/useExecutionRecovery.ts'],
    ['src/frontend/execution-view/ToolTimeline.tsx','src/frontend/conversation/Conversation.tsx'],
    ['src/frontend/tasks/MemberRunTranscript.tsx','src/frontend/conversation/ConversationTurn.tsx'],
  ];
  for(const [from,to] of denied){
    const relative=path.posix.relative(path.posix.dirname(from),to);
    const result=audit({[from]:`export type {T} from '${relative.startsWith('.')?relative:'./'+relative}';`,[to]:'export type T=string;'});
    expect(result.cycles).toEqual([]);
    expect(result.violations,`${from} -> ${to}`).toHaveLength(1);
    expect(result.ok).toBe(false);
  }
  expect(audit({
    [contracts]:'export type T=string;',
    [snapshot]:"export type {T} from '../types';",
    [team]:"export type {T} from '../types';",
    [workspace]:"export type {T} from './snapshot';",
    'src/backend/core/knowledge/read-models/index.ts':"export type {T} from './snapshot'; import './team'; import './workspace';",
    [query]:"import type {T} from './read-models';",
  }).ok).toBe(true);
});
test('history persistence rejects workspace and runtime assembly even through type dependencies',()=>{
  const from='src/backend/main/history/file-store.ts';
  for(const to of ['src/backend/main/workspace/workspace.ts','src/backend/main/workspace/agent-history.ts','src/backend/scheduler-engine/history/agent-history.ts']){
    const relative=path.posix.relative(path.posix.dirname(from),to);
    const result=audit({[from]:`export type {T} from '${relative}';`,[to]:'export type T=string;'});
    expect(result.cycles).toEqual([]);expect(result.violations).toHaveLength(1);expect(result.ok).toBe(false);
  }
  expect(audit({[from]:"import type {T} from '../../core/team/session-history-storage';",'src/backend/core/team/session-history-storage.ts':'export type T=string;'}).ok).toBe(true);
});

test('updater stays independent of application runtime and business services',()=>{
  for(const target of ['main','scheduler-engine','core']){
    const result=audit({'src/backend/updater/a.ts':`import type {T} from '../${target}/b';`,[`src/backend/${target}/b.ts`]:'export type T=string;'});
    expect(result.violations).toHaveLength(1);
  }
  expect(audit({'src/backend/main/a.ts':"import type {T} from '../updater/b';",'src/backend/updater/b.ts':"export type {T} from '../../bridge/contracts/c';",'src/bridge/contracts/c.ts':'export type T=string;'}).ok).toBe(true);
});
test('frontend and backend can only meet through the public bridge contracts',()=>{
  const fixtures:Record<string,string>[]=[
    {'src/frontend/a.ts':"import type {T} from '../backend/core/b';",'src/backend/core/b.ts':'export type T=string;'},
    {'src/backend/main/a.ts':"import type {T} from '../../frontend/b';",'src/frontend/b.ts':'export type T=string;'},
    {'src/bridge/preload/a.ts':"import type {T} from '../../backend/main/b';",'src/backend/main/b.ts':'export type T=string;'},
  ];
  for(const files of fixtures)expect(audit(files).violations).toHaveLength(1);
  expect(audit({'src/frontend/a.ts':"import type {T} from '../bridge/contracts/b';",'src/bridge/contracts/b.ts':"export type {T} from '../../backend/core/c';",'src/backend/core/c.ts':'export type T=string;'}).ok).toBe(true);
});


test('P2 shared rendering, IPC contracts and history storage reject business control dependencies',()=>{
  const cases=[
    ['src/frontend/execution-view/WorkStatus.tsx','../tasks/useExecutionRecovery','src/frontend/tasks/useExecutionRecovery.ts','execution-view'],
    ['src/frontend/execution-view/ToolTimeline.tsx','../tasks/ToolActivity','src/frontend/tasks/ToolActivity.tsx','execution-view'],
    ['src/backend/main/history/file-store.ts','../workspace/workspace','src/backend/main/workspace/workspace.ts','agent-history-file-store'],
    ['src/backend/main/history/file-store.ts','../../scheduler-engine/history/agent-history','src/backend/scheduler-engine/history/agent-history.ts','agent-history-file-store'],
    ['src/bridge/contracts/agent-history-ipc.ts','../../backend/main/assembly/application','src/backend/main/assembly/application.ts','ipc-contract'],
    ['src/bridge/contracts/ipc-loop.ts','../../backend/scheduler-engine/conversation/execution-manager','src/backend/scheduler-engine/conversation/execution-manager.ts','ipc-contract'],
    ['src/bridge/contracts/ipc-desktop.ts','../../backend/main/main','src/backend/main/main.ts','ipc-contract'],
  ];
  for(const [file,spec,target,boundary] of cases){
    const result=audit({[file]:`import type {T} from '${spec}';`,[target]:'export interface T {}'});
    expect(result.cycles).toEqual([]);expect(result.logicalViolations).toContainEqual(expect.objectContaining({rule:'logical-direction',boundary}));expect(result.ok).toBe(false);
  }
});

test('engines may use portable utility but not other foundation capabilities',()=>{
  const from='src/backend/engines/pi/rpc.ts';
  for(const target of ['utility/index.ts','utility/node.ts','utility/strings.ts','utility/graphs.ts','files/index.ts','web/index.ts']){
    const to='src/backend/core/foundation/'+target,relative=path.posix.relative(path.posix.dirname(from),to);
    expect(audit({[from]:`import type {T} from '${relative}';`,[to]:'export type T=string;'}).ok).toBe(target==='utility/index.ts');
  }
});

test('concrete engines depend on Core; only scheduler assembly may select engines',()=>{
  const engine='src/backend/engines/pi/engine.ts',contract='src/backend/core/execution/types.ts';
  expect(audit({[engine]:"import type {T} from '../../core/execution/types';",[contract]:'export interface T {}'}).ok).toBe(true);
  const reversed=audit({[contract]:"import type {T} from '../../engines/pi/engine';",[engine]:'export interface T {}'});
  expect(reversed.violations).toHaveLength(1);expect(reversed.ok).toBe(false);
  const bypass=audit({'src/backend/main/assembly/entry.ts':"import type {T} from '../../engines/pi/engine';",[engine]:'export interface T {}'});
  expect(bypass.violations).toHaveLength(1);expect(bypass.ok).toBe(false);
  for(const directory of ['assembly','members']){
    const result=audit({['src/backend/scheduler-engine/'+directory+'/entry.ts']:"import type {T} from '../../engines/pi/engine';",[engine]:'export interface T {}'});
    expect(result.ok).toBe(directory==='assembly');
  }
});
