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
  expect({cycles:result.cycles,unresolved:result.unresolved,dynamic:result.dynamic,violations:result.violations}).toEqual({cycles:[],unresolved:[],dynamic:[],violations:[]});
  expect(result.ok).toBe(true);
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
  const query='src/backend/scheduler-engine/context/knowledge-queries.ts';
  const denied=[
    [contracts,snapshot],[snapshot,team],[team,workspace],[workspace,team],
    [team,port],[query,port],['src/backend/core/foundation/json.ts',contracts],
    ['tests/knowledge-data.ts','tests/helpers.ts'],
    ['tests/knowledge-fixture.ts','src/backend/main/application.ts'],
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
    [query]:"import type {T} from '../../core/knowledge/snapshot'; import '../../core/team/model'; import '../../core/workspace/model';",
  }).ok).toBe(true);
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
