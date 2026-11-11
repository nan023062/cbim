import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {afterEach, expect, test} from 'vitest';
import {auditDependencies} from '../scripts/check-dependencies.mjs';

const temporary:string[]=[];
afterEach(()=>{for(const root of temporary.splice(0))fs.rmSync(root,{recursive:true,force:true})});
function audit(files:Record<string,string>){
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'cbim-dependencies-'));temporary.push(root);
  for(const [name,content] of Object.entries(files)){const file=path.join(root,name);fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,content)}
  return auditDependencies(root,{externalLoads:[]});
}

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
    'src/backend/core/knowledge/read-models.ts':"export {Team} from '../team/model';",
    'src/backend/core/team/model.ts':'export class Team {}',
  };
  expect(audit({...files,'src/backend/scheduler-engine/a.ts':"import {Team} from '../core/knowledge/read-models';"}).ok).toBe(true);
  const result=audit({...files,'src/backend/scheduler-engine/a.ts':"import type {Team} from '../core/team/model';"});
  expect(result.logicalViolations).toContainEqual(expect.objectContaining({rule:'private-entry',boundary:'knowledge-read-models',kind:'type'}));
  expect(result.cycles).toEqual([]);expect(result.ok).toBe(false);
});
test('alias reexports and literal dynamic imports cannot bypass a private entry',()=>{
  const files={
    'tsconfig.json':JSON.stringify({compilerOptions:{baseUrl:'.',paths:{'@core/*':['src/backend/core/*']}}}),
    'src/backend/core/team/model.ts':'export class Team {}',
  };
  for(const source of ["export type {Team} from '@core/team/model';","export type T=import('@core/team/model').Team;","import('../core/team/model');"]){
    const result=audit({...files,'src/backend/scheduler-engine/a.ts':source});
    expect(result.logicalViolations).toContainEqual(expect.objectContaining({rule:'private-entry'}));expect(result.ok).toBe(false);
  }
});
test('snapshot data and read models reject reverse dependencies on orchestration without needing a file cycle',()=>{
  for(const file of ['src/backend/core/knowledge/types.ts','src/backend/core/knowledge/snapshot.ts']){
    const result=audit({[file]:"import type {Query} from './knowledge-queries';",'src/backend/core/knowledge/knowledge-queries.ts':'export interface Query {}'});
    expect(result.cycles).toEqual([]);expect(result.logicalViolations).toContainEqual(expect.objectContaining({rule:'logical-direction'}));expect(result.ok).toBe(false);
  }
});

test('P1 narrow boundaries reject restored write access, shared stores and business tool registration',()=>{
  const cases=[
    ['src/backend/core/knowledge/knowledge-queries.ts','./ports','src/backend/core/knowledge/ports.ts','knowledge-query-orchestration'],
    ['src/backend/core/knowledge/knowledge-queries.ts','./knowledge-refresh','src/backend/core/knowledge/knowledge-refresh.ts','knowledge-query-orchestration'],
    ['src/backend/core/tasks/model-request-budget-storage.ts','./dispatch-storage','src/backend/core/tasks/dispatch-storage.ts','request-budget-port'],
    ['src/backend/scheduler-engine/execution/model-request-budget-service.ts','../../core/tasks/dispatch-storage','src/backend/core/tasks/dispatch-storage.ts','request-budget-service'],
    ['src/backend/scheduler-engine/execution/model-request-budget-service.ts','./scope-budget-service','src/backend/scheduler-engine/execution/scope-budget-service.ts','request-budget-service'],
    ['src/backend/core/brain/engine-tools.ts','./member-tool-capabilities','src/backend/core/brain/member-tool-capabilities.ts','engine-tool-registry'],
  ];
  for(const [file,spec,target,boundary] of cases){
    const result=audit({[file]:`import type {T} from '${spec}';`,[target]:'export interface T {}'});
    expect(result.cycles).toEqual([]);expect(result.logicalViolations).toContainEqual(expect.objectContaining({rule:'logical-direction',boundary}));expect(result.ok).toBe(false);
  }
});
test('test data rejects Application imports and private helper reexports',()=>{
  const direct=audit({'tests/data/knowledge.ts':"import type {App} from '../../src/backend/main/application';",'src/backend/main/application.ts':'export class App {}'});
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
    const result=audit({'src/backend/core/knowledge/snapshot.ts':`import type * as External from '${spec}';`});
    expect(result.logicalViolations).toContainEqual(expect.objectContaining({rule:'external-dependency',boundary:'knowledge-read-models'}));expect(result.ok).toBe(false);
  }
});
test('relative paths into node_modules cannot hide an external dependency',()=>{
  const result=audit({
    'src/backend/core/knowledge/snapshot.ts':"import type {Sdk} from '../../../../node_modules/private-sdk/index';",
    'node_modules/private-sdk/index.ts':'export interface Sdk {}',
  });
  expect(result.unresolved).toEqual([]);
  expect(result.logicalViolations).toContainEqual(expect.objectContaining({rule:'external-dependency',boundary:'knowledge-read-models',spec:'../../../../node_modules/private-sdk/index'}));
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
  const snapshot='src/backend/core/knowledge/snapshot.ts';
  const team='src/backend/core/team/model.ts';
  const workspace='src/backend/core/workspace/model.ts';
  const port='src/backend/core/knowledge/ports.ts';
  const query='src/backend/core/knowledge/knowledge-queries.ts';
  const denied=[
    [contracts,snapshot],[snapshot,team],[team,workspace],[workspace,team],
    [team,port],[query,port],['src/backend/core/foundation/json.ts',contracts],
    ['tests/knowledge-data.ts','tests/helpers.ts'],
    ['tests/knowledge-fixture.ts','src/backend/main/application.ts'],
    ['src/backend/core/tasks/model-request-budget-storage.ts','src/backend/core/tasks/dispatch-storage.ts'],
    ['src/backend/scheduler-engine/execution/model-request-budget-service.ts','src/backend/core/tasks/dispatch-storage.ts'],
    ['src/backend/core/brain/engine-tools.ts','src/backend/core/tasks/progress-tools.ts'],
    ['src/backend/core/brain/index.ts','src/backend/core/brain/pi/engine.ts'],
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
    [snapshot]:"export type {T} from './types';",
    [team]:"export type {T} from '../knowledge/types';",
    [workspace]:"export type {T} from '../knowledge/snapshot';",
    'src/backend/core/knowledge/read-models.ts':"export type {T} from './snapshot'; import '../team/model'; import '../workspace/model';",
    [query]:"import type {T} from './read-models';",
  }).ok).toBe(true);
});
test('history persistence rejects workspace and runtime assembly even through type dependencies',()=>{
  const from='src/backend/main/persistence/tasks/agent-history.ts';
  for(const to of ['src/backend/main/workspace/workspace.ts','src/backend/main/workspace/agent-history.ts','src/backend/scheduler-engine/runtime/agent-history.ts']){
    const relative=path.posix.relative(path.posix.dirname(from),to);
    const result=audit({[from]:`export type {T} from '${relative}';`,[to]:'export type T=string;'});
    expect(result.cycles).toEqual([]);expect(result.violations).toHaveLength(1);expect(result.ok).toBe(false);
  }
  expect(audit({[from]:"import type {T} from '../../../core/team/session-history-storage';",'src/backend/core/team/session-history-storage.ts':'export type T=string;'}).ok).toBe(true);
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
    ['src/backend/main/persistence/tasks/agent-history.ts','../../workspace/workspace','src/backend/main/workspace/workspace.ts','agent-history-file-store'],
    ['src/backend/main/persistence/tasks/agent-history.ts','../../../scheduler-engine/runtime/agent-history','src/backend/scheduler-engine/runtime/agent-history.ts','agent-history-file-store'],
    ['src/bridge/contracts/agent-history-ipc.ts','../../backend/main/application','src/backend/main/application.ts','ipc-contract'],
    ['src/bridge/contracts/ipc-loop.ts','../../backend/scheduler-engine/execution/execution-manager','src/backend/scheduler-engine/execution/execution-manager.ts','ipc-contract'],
    ['src/bridge/contracts/ipc-desktop.ts','../../backend/main/main','src/backend/main/main.ts','ipc-contract'],
  ];
  for(const [file,spec,target,boundary] of cases){
    const result=audit({[file]:`import type {T} from '${spec}';`,[target]:'export interface T {}'});
    expect(result.cycles).toEqual([]);expect(result.logicalViolations).toContainEqual(expect.objectContaining({rule:'logical-direction',boundary}));expect(result.ok).toBe(false);
  }
});
