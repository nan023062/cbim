import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {afterEach, expect, test} from 'vitest';
import {auditDependencies} from '../scripts/check-dependencies.mjs';

test.each(['src/backend/core/unused.ts','src/frontend/unused.ts','src/foundations/unused.ts'])('retired source layer is rejected even without imports: %s',file=>{
  const result=audit({[file]:'export const value=1;'});
  expect(result.ok).toBe(false);
  expect(result.logicalViolations).toContainEqual(expect.objectContaining({file,rule:'unknown-source-layer'}));
});

test.each([
  ['src/logic/workspace/service/workspace.ts','src/logic/application/application.ts',false],
  ['src/logic/application/application.ts','src/bridge/server/ipc/dispatch.ts',false],
  ['src/logic/application/application.ts','src/core/platform/electron/secrets.ts',false],
  ['src/bridge/server/bootstrap/desktop.ts','src/logic/workspace/service/workspace.ts',false],
  ['src/bridge/server/application.ts','src/logic/application/application.ts',true],
  ['src/bridge/server/main.ts','src/core/platform/electron/secrets.ts',true],
] as const)('service migration preserves lifecycle and host boundaries: %s -> %s',(from,to,allowed)=>{
  const spec=path.posix.relative(path.posix.dirname(from),to);
  const result=audit({[from]:`import type {Value} from '${spec.startsWith('.')?spec:'./'+spec}';`,[to]:'export type Value=string;'});
  expect(result.unresolved).toEqual([]);expect(result.ok).toBe(allowed);
});

test.each([
  ['src/logic/tasks/rules/graph.ts','src/logic/models/service/index.ts',false],
  ['src/logic/tasks/rules/graph.ts','src/logic/workspace/service/workspace.ts',false],
  ['src/core/json.ts','src/logic/knowledge/rules/types.ts',false],
  ['src/logic/application/application.ts','src/logic/tasks/rules/unregistered.ts',false],
  ['src/logic/tasks/rules/graph.ts','src/logic/models/index.ts',true],
  ['src/logic/tasks/rules/scope-view.ts','src/logic/team/rules/team-session.ts',true],
  ['src/logic/team/runtime/member-execution.ts','src/logic/tasks/rules/member-topic-context.ts',true],
  ['src/logic/team/runtime/member-execution.ts','src/logic/tasks/rules/topic-interruption.ts',true],
  ['src/logic/dispatch/runtime/dispatch-service.ts','src/logic/tasks/runtime/topic-interruption-service.ts',true],
  ['src/bridge/contracts/ipc-loop.ts','src/logic/tasks/rules/topic-interruption.ts',true],
  ['src/logic/team/runtime/member-execution.ts','src/logic/tasks/rules/member-topic-context-rules.ts',true],
  ['src/logic/team/rules/team-session.ts','src/logic/team/runtime/agent-manager.ts',false],
] as const)('domain migration preserves rule/service boundaries: %s -> %s',(from,to,allowed)=>{
  const spec=path.posix.relative(path.posix.dirname(from),to);
  expect(audit({[from]:`import type {Value} from '${spec.startsWith('.')?spec:'./'+spec}';`,[to]:'export type Value=string;'}).ok).toBe(allowed);
});

test.each([
  ['src/logic/application/application.ts','src/logic/resources/service/index.ts',true],
  ['src/logic/resources/service/resource-store.ts','src/core/platform/node/locking.ts',true],
  ['src/logic/resources/service/resource-repository.ts','src/logic/workspace/service/paths.ts',false],
  ['src/logic/resources/service/resource-store.ts','src/bridge/contracts/resources.ts',false],
  ['src/logic/tools/runtime/repository-tools.ts','src/logic/resources/service/index.ts',false],
  ['src/logic/resources/index.ts','src/logic/resources/service/index.ts',false],
  ['src/view/resources/example.ts','src/logic/resources/index.ts',false],
  ['src/logic/application/application.ts','src/logic/resources/service/resource-store.ts',false],
] as const)('资源迁移边界 %s → %s = %s',(from,to,allowed)=>{
  const spec=path.posix.relative(path.posix.dirname(from),to);
  expect(audit({[from]:`import type {Value} from '${spec.startsWith('.')?spec:'./'+spec}';`,[to]:'export type Value=string;'}).ok).toBe(allowed);
});

test.each([
  ['src/logic/application/application.ts','src/logic/feedback/service/index.ts',true],
  ['src/logic/tools/rules/scope-schema.ts','src/logic/feedback/index.ts',true],
  ['src/logic/tools/runtime/feedback-tools.ts','src/logic/feedback/index.ts',true],
  ['src/logic/tools/runtime/feedback-tools.ts','src/logic/feedback/service/index.ts',false],
  ['src/logic/execution/engines/pi/engine.ts','src/logic/feedback/index.ts',false],
  ['src/logic/application/application.ts','src/logic/feedback/service/github-feedback.ts',false],
  ['src/logic/feedback/contracts.ts','src/logic/tools/rules/scope-schema.ts',false],
  ['src/logic/feedback/index.ts','src/logic/feedback/service/index.ts',false],
  ['src/logic/feedback/service/github-feedback.ts','src/core/platform/node/locking.ts',true],
  ['src/logic/feedback/service/github-feedback.ts','src/core/contracts/secrets.ts',true],
  ['src/logic/feedback/service/github-feedback.ts','src/logic/execution/platform/locking.ts',false],
  ['src/logic/feedback/service/github-feedback.ts','src/logic/models/index.ts',false],
  ['src/bridge/contracts/other.ts','src/logic/feedback/index.ts',false],
  ['src/view/settings/feedback.ts','src/logic/feedback/index.ts',false],
  ['src/bridge/client/feedback.ts','src/logic/feedback/service/index.ts',false],
  ['src/core/platform/node/locking.ts','src/logic/feedback/index.ts',false],
] as const)('反馈迁移边界 %s → %s = %s',(from,to,allowed)=>{
  const relative=path.posix.relative(path.posix.dirname(from),to),spec=relative.startsWith('.')?relative:'./'+relative;
  const result=audit({[from]:`import type {Value} from '${spec}';`,[to]:'export type Value=string;'});
  expect(result.unresolved).toEqual([]);expect(result.ok).toBe(allowed);
});
test('反馈桥仅公开连接设置，纯入口拒绝平台依赖',()=>{
  const entry='src/logic/feedback/index.ts',bridge='src/bridge/contracts/github-feedback.ts';
  expect(audit({[entry]:'export type GitHubFeedbackStatus={};',[bridge]:"export type {GitHubFeedbackStatus} from '../../logic/feedback';"}).ok).toBe(true);
  for(const source of ["export * from '../../logic/feedback';","export type {FeedbackToolsPort} from '../../logic/feedback';"]){
    expect(audit({[entry]:'export type FeedbackToolsPort={};',[bridge]:source}).logicalViolations).toContainEqual(expect.objectContaining({rule:'feedback-bridge-export'}));
  }
  for(const file of [entry,'src/logic/feedback/contracts.ts'])for(const spec of ['node:fs','koffi','electron'])expect(audit({[file]:`import '${spec}';`}).ok).toBe(false);
});

const temporary:string[]=[];
test.each([
  ['src/logic/web/service/web-service.ts','src/core/platform/node/web/index.ts',true],
  ['src/logic/web/service/web-settings.ts','src/core/contracts/secrets.ts',true],
  ['src/logic/application/application.ts','src/logic/web/service/index.ts',true],
  ['src/bridge/server/main.ts','src/core/platform/electron/web-reader.ts',true],
  ['src/bridge/server/other.ts','src/core/platform/electron/web-reader.ts',false],
  ['src/logic/tools/runtime/web-tools.ts','src/logic/web/index.ts',true],
  ['src/logic/tools/runtime/web-tools.ts','src/logic/web/service/index.ts',false],
  ['src/logic/tools/runtime/web-tools.ts','src/core/platform/node/web/index.ts',false],
  ['src/logic/web/index.ts','src/logic/web/service/index.ts',false],
  ['src/logic/web/service/web-service.ts','src/core/platform/electron/web-reader.ts',false],
  ['src/core/web/index.ts','src/core/platform/node/web/index.ts',false],
  ['src/core/platform/node/web/index.ts','src/core/platform/electron/web-reader.ts',false],
  ['src/view/settings/web.ts','src/logic/web/index.ts',false],
  ['src/bridge/client/web.ts','src/logic/web/service/index.ts',false],
  ['src/bridge/contracts/other.ts','src/logic/web/index.ts',false],
  ['src/logic/web/service/web-settings.ts','src/logic/budget/settings/budget-settings.ts',false],
] as const)('Web 迁移边界 %s → %s = %s',(from,to,allowed)=>{
  const relative=path.posix.relative(path.posix.dirname(from),to),spec=relative.startsWith('.')?relative:'./'+relative;
  const result=audit({[from]:`import type {Value} from '${spec}';`,[to]:'export type Value=string;'});
  expect(result.unresolved).toEqual([]);expect(result.ok).toBe(allowed);
});
test('Web 桥仅公开设置协议，便携入口禁止加载平台或网络实现',()=>{
  const entry='src/logic/web/index.ts';
  expect(audit({[entry]:'export type WebSettingsView={};','src/bridge/contracts/web.ts':"export type {WebSettingsView} from '../../logic/web';"}).ok).toBe(true);
  for(const source of ["export * from '../../logic/web';","export type {WebToolsPort} from '../../logic/web';"]){const result=audit({[entry]:'export type WebToolsPort={};','src/bridge/contracts/web.ts':source});expect(result.logicalViolations).toContainEqual(expect.objectContaining({rule:'web-bridge-export'}))}
  for(const file of ['src/core/web/extra.ts',entry])for(const dependency of ['node:http','electron'])expect(audit({[file]:`import '${dependency}';`}).ok).toBe(false);
});
test.each([
  ['src/logic/application/assembly/app.ts','src/logic/models/service/index.ts',true],
  ['src/logic/fixtures/team/example.ts','src/logic/models/index.ts',true],
  ['src/logic/execution/engines/example.ts','src/logic/models/index.ts',true],
  ['src/logic/execution/context/example.ts','src/logic/models/index.ts',true],
  ['src/bridge/contracts/models.ts','src/logic/models/index.ts',true],
  ['src/bridge/contracts/other.ts','src/logic/models/index.ts',false],
  ['src/bridge/contracts/models.ts','src/logic/models/service/index.ts',false],
  ['src/bridge/client/models.ts','src/logic/models/index.ts',false],
  ['src/view/settings/models.ts','src/logic/models/index.ts',false],
  ['src/logic/execution/engines/example.ts','src/logic/models/service/index.ts',false],
  ['src/logic/execution/context/example.ts','src/logic/models/service/index.ts',false],
  ['src/logic/application/assembly/app.ts','src/logic/models/service/llm-profiles.ts',false],
  ['src/logic/application/assembly/app.ts','src/logic/models/config.ts',false],
  ['src/logic/application/assembly/app.ts','src/logic/tasks/index.ts',false],
  ['src/logic/models/index.ts','src/logic/models/service/index.ts',false],
  ['src/logic/models/config.ts','src/core/errors.ts',false],
  ['src/logic/models/service/llm-profiles.ts','src/bridge/contracts/models.ts',false],
] as const)('模型迁移入口 %s → %s 许可为 %s',(from,to,allowed)=>{
  const relative=path.posix.relative(path.posix.dirname(from),to);
  const name=from==='src/bridge/contracts/models.ts'?'LoopEngine':'Value';
  const result=audit({[from]:`import type {${name}} from '${relative.startsWith('.')?relative:'./'+relative}';`,[to]:`export type ${name}=string;`});
  expect(result.unresolved).toEqual([]);expect(result.ok).toBe(allowed);
});
test.each(['src/logic/models/index.ts','src/logic/models/extra.ts'])('纯模型文件 %s 不得引入平台或第三方 SDK',file=>{
  for(const spec of ['node:fs','electron','@anthropic-ai/claude-agent-sdk'])expect(audit({[file]:`import '${spec}';`}).ok).toBe(false);
});
test.each(["export * from '../../logic/models';","export type {ResolvedLlm} from '../../logic/models';","export type {SecretCipher as PublicCipher} from '../../logic/models';"])('桥接模型兼容出口拒绝扩散：%s',source=>{
  const result=audit({'src/bridge/contracts/models.ts':source,'src/logic/models/index.ts':'export interface ResolvedLlm {} export interface SecretCipher {}'});
  expect(result.unresolved).toEqual([]);
  expect(result.logicalViolations).toContainEqual(expect.objectContaining({rule:'model-bridge-export'}));
});
const foundationFile=(target:string)=>target==='utility/node.ts'?'src/core/platform/node/digest.ts':target.startsWith('utility/')?'src/core/'+target:/^(files|web)\//.test(target)?'src/core/platform/node/'+target:'src/logic/fixtures/foundation/'+target;
test.each([
  ['src/view/example/model.ts','src/core/utility/index.ts',true],
  ['src/view/foundations/utility/json.ts','src/core/utility/index.ts',true],
  ['src/logic/tasks/service.ts','src/core/utility/index.ts',true],
  ['src/logic/tasks/service.ts','src/core/platform/node/digest.ts',true],
  ['src/bridge/contracts/example.ts','src/core/utility/index.ts',true],
  ['src/bridge/client/call.ts','src/bridge/contracts/example.ts',true],
  ['src/view/example/model.ts','src/bridge/client/call.ts',true],
  ['src/bridge/server/dispatch.ts','src/logic/tasks/index.ts',true],
  ['src/logic/tasks/service.ts','src/logic/knowledge/index.ts',true],
  ['src/core/utility/index.ts','src/logic/tasks/index.ts',false],
  ['src/core/utility/index.ts','src/bridge/contracts/example.ts',false],
  ['src/core/utility/index.ts','src/view/example/model.ts',false],
  ['src/core/utility/index.ts','src/core/errors.ts',false],
  ['src/view/example/model.ts','src/core/platform/node/digest.ts',false],
  ['src/bridge/client/call.ts','src/core/platform/node/digest.ts',false],
  ['src/logic/tasks/service.ts','src/bridge/contracts/example.ts',false],
  ['src/logic/tasks/service.ts','src/view/example/model.ts',false],
  ['src/view/example/model.ts','src/logic/tasks/index.ts',false],
  ['src/view/example/model.ts','src/bridge/server/dispatch.ts',false],
  ['src/bridge/client/call.ts','src/logic/tasks/index.ts',false],
  ['src/bridge/server/dispatch.ts','src/logic/tasks/storage.ts',false],
  ['src/logic/tasks/service.ts','src/logic/knowledge/storage.ts',false],
  ['src/view/example/model.ts','src/core/utility/json.ts',false],
  ['src/logic/tasks/service.ts','src/core/utility/json.ts',false],
] as const)('四层依赖 %s → %s 许可为 %s',(from,to,allowed)=>{
  let relative=path.posix.relative(path.posix.dirname(from),to);if(!relative.startsWith('.'))relative='./'+relative;
  const result=audit({[from]:`import type {Value} from '${relative}';`,[to]:'export type Value=string;'});
  expect(result.unresolved).toEqual([]);expect(result.ok).toBe(allowed);
});
test('新 Core 未登记模块与便携模块中的 Node 导入都被拒绝',()=>{
  const unknown=audit({'src/core/hidden.ts':"import fs from 'node:fs';"});
  expect(unknown.logicalViolations).toContainEqual(expect.objectContaining({rule:'unregistered-core-module'}));
  const hiddenNode=audit({'src/core/utility/extra.ts':"import fs from 'node:fs';"});
  expect(hiddenNode.logicalViolations).toContainEqual(expect.objectContaining({rule:'external-dependency',boundary:'utility-foundations'}));
});
test.each(['src/view/example/model.ts','src/view/example/model.ts','src/bridge/client/call.ts','src/bridge/contracts/example.ts'])('浏览器或纯通信文件 %s 不得直接导入 Node/Electron',from=>{
  for(const spec of ['node:fs','fs/promises','electron','electron/main']){
    const result=audit({[from]:`import '${spec}';`});
    expect(result.logicalViolations).toContainEqual(expect.objectContaining({rule:'runtime-environment',file:from}));
    expect(result.ok).toBe(false);
  }
});
test('调度器仅可组合 portable utility 公开入口',()=>{
  const from='src/logic/execution/context/a.ts';
  for(const target of ['utility/index.ts','utility/node.ts','utility/json.ts','utility/graphs.ts','files/index.ts','web/index.ts']){
    const to=foundationFile(target),relative=path.posix.relative(path.posix.dirname(from),to).replace(/\.ts$/,'');
    expect(audit({[from]:`import type {T} from '${relative}';`,[to]:'export type T=string;'}).ok).toBe(target==='utility/index.ts');
  }
});
test('foundations is independent even for type dependencies; Main consumes only public web entries',()=>{
  const foundation='src/core/platform/node/web/index.ts';
  expect(audit({[foundation]:'export const value=1;', 'src/bridge/server/a.ts':"import {value} from '../../core/platform/node/web';"}).ok).toBe(true);
  for(const target of ['logic/knowledge/rules','logic/application','logic/execution/engines','view','bridge/contracts']){
    const relative=path.posix.relative(path.posix.dirname(foundation),`src/${target}/a.ts`);
    const result=audit({[foundation]:`import type {Value} from '${relative}';`,[`src/${target}/a.ts`]:'export interface Value {}'});
    expect(result.unresolved).toEqual([]);
    expect(result.ok).toBe(false);expect(result.violations).not.toEqual([]);
  }
  const privateEntry=audit({'src/core/platform/node/web/page-reader.ts':'export class WebPageReader {}','src/bridge/server/a.ts':"import {WebPageReader} from '../../core/platform/node/web/page-reader';"});
  expect(privateEntry.logicalViolations).toContainEqual(expect.objectContaining({rule:'private-entry',boundary:'web-node'}));
});
afterEach(()=>{for(const root of temporary.splice(0))fs.rmSync(root,{recursive:true,force:true})});
test.each(['utility','files','web'])('合并后的 %s 子库仍不能反向依赖父层约定或业务',(capability)=>{
  const from=foundationFile(`${capability}/index.ts`);
  for(const to of ['src/core/errors.ts','src/logic/execution/ports/identity.ts','src/logic/workspace/ports/paths.ts','src/logic/fixtures/tasks/example.ts']){
    const relative=path.posix.relative(path.posix.dirname(from),to);
    const result=audit({[from]:`export type {Value} from '${relative}';`,[to]:'export type Value=string;'});
    expect(result.unresolved).toEqual([]);expect([...result.violations,...result.logicalViolations]).not.toEqual([]);expect(result.ok).toBe(false);
  }
});
test('Updater 与 Bridge 不因目录合并取得额外 Core 或基础库访问权',()=>{
  for(const [from,to] of [['src/logic/updates/service/example.ts','src/core/errors.ts'],['src/bridge/contracts/example.ts','src/core/platform/node/digest.ts']]){
    const relative=path.posix.relative(path.posix.dirname(from),to);
    const result=audit({[from]:`import type {Value} from '${relative}';`,[to]:'export type Value=string;'});
    expect(result.unresolved).toEqual([]);expect(result.violations).not.toEqual([]);
  }
});
test('前端工具库仅向前端公开，私有实现与跨域依赖被拒绝',()=>{
  const entry='src/view/foundations/utility/index.ts',inner='src/view/foundations/utility/json.ts';
  expect(audit({[entry]:"export {equalJson} from './json';",[inner]:'export const equalJson=()=>true;','src/view/tasks/a.ts':"import {equalJson} from '../foundations/utility';"}).ok).toBe(true);
  const privateImport=audit({[inner]:'export const equalJson=()=>true;','src/view/team/a.ts':"import {equalJson} from '../foundations/utility/json';"});
  expect(privateImport.logicalViolations).toContainEqual(expect.objectContaining({rule:'private-entry',boundary:'frontend-utility'}));
  for(const from of ['src/logic/fixtures/a.ts','src/core/utility/index.ts','src/bridge/contracts/a.ts']){
    const relative=path.posix.relative(path.posix.dirname(from),entry);
    expect(audit({[entry]:'export type Value=string;',[from]:`import type {Value} from '${relative}';`}).ok).toBe(false);
  }
});
test('前端工具库不能反向引用页面、通信契约或后端工具，包含类型与第三方依赖',()=>{
  const inner='src/view/foundations/utility/json.ts';
  for(const target of ['src/view/team/a.ts','src/bridge/contracts/a.ts','src/core/platform/node/digest.ts']){
    const relative=path.posix.relative(path.posix.dirname(inner),target);
    expect(audit({[inner]:`import type {Value} from '${relative}';`,[target]:'export type Value=string;'}).ok).toBe(false);
  }
  const external=audit({[inner]:"import {useState} from 'react';"});
  expect(external.logicalViolations).toContainEqual(expect.objectContaining({rule:'external-dependency',boundary:'frontend-utility'}));
  const crossDomain=audit({'src/view/tasks/a.ts':"export {value} from '../../core/platform/node/digest';",'src/core/platform/node/digest.ts':'export const value=1;'});
  expect(crossDomain.unresolved).toEqual([]);expect(crossDomain.ok).toBe(false);
});
test.each([['files','text-files','file-foundations'],['utility','async','utility-foundations']])('Core 可组合 %s 公开入口，基础库不能反向引用业务或暴露私有实现',(capability,implementation,boundary)=>{
  const entry=foundationFile(`${capability}/index.ts`),inner=foundationFile(`${capability}/${implementation}.ts`);
  const from='src/logic/fixtures/example.ts',main='src/bridge/server/example.ts';
  expect(audit({[entry]:'export const value=1;',[from]:`import {value} from '${path.posix.relative(path.posix.dirname(from),entry)}';`}).ok).toBe(true);
  const reverse=audit({[entry]:`import type {Value} from '${path.posix.relative(path.posix.dirname(entry),from)}';`,[from]:'export interface Value {}'});
  expect(reverse.unresolved).toEqual([]);
  expect(reverse.violations).not.toEqual([]);
  const privateEntry=audit({[inner]:'export const value=1;',[main]:`import {value} from '${path.posix.relative(path.posix.dirname(main),inner)}';`});
  expect(privateEntry.logicalViolations).toContainEqual(expect.objectContaining({rule:'private-entry',boundary}));
});
function audit(files:Record<string,string>){
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'cbim-dependencies-'));temporary.push(root);
  for(const [name,content] of Object.entries(files)){const file=path.join(root,name);fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,content)}
  return auditDependencies(root,{externalLoads:[]});
}

test('utility 通用入口禁止通过重导出连带装载 Node 入口',()=>{
  const result=audit({'src/core/utility/index.ts':"export {sha256} from '../platform/node/digest';",'src/core/platform/node/digest.ts':"export const sha256=()=>'';"});
  expect(result.unresolved).toEqual([]);
  expect(result.violations).not.toEqual([]);
  const direct=audit({'src/core/utility/json.ts':"import {createHash} from 'node:crypto';"});
  expect(direct.logicalViolations).toContainEqual(expect.objectContaining({rule:'external-dependency',boundary:'utility-foundations'}));
});
test('Updater 只组合 utility 通用入口，不能借基础层依赖其他方案或 Node 入口',()=>{
  expect(audit({'src/logic/updates/service/a.ts':"import {value} from '../../../core/utility';",'src/core/utility/index.ts':'export const value=1;'}).ok).toBe(true);
  for(const target of ['utility/node','files','web']){
    const file=foundationFile(target==='utility/node'?target+'.ts':target+'/index.ts');
    const result=audit({'src/logic/updates/service/a.ts':`import {value} from '${path.posix.relative('src/logic/updates/service',file)}';`,[file]:'export const value=1;'});
    expect(result.unresolved).toEqual([]);expect(result.violations).not.toEqual([]);
  }
});

test('fixed bootstrap generated loading remains a real source edge and cannot hide cycles or missing code',()=>{
  const load="import {createRequire} from 'node:module'; const loadApplication=createRequire(import.meta.url); loadApplication(entry);";
  const valid=audit({'src/bridge/server/bootstrap/desktop.ts':load,'src/bridge/server/main.ts':'export function startDesktop(){}'});
  expect(valid.ok).toBe(true);expect(valid.edges).toContainEqual(expect.objectContaining({from:'src/bridge/server/bootstrap/desktop.ts',to:'src/bridge/server/main.ts',kind:'generated-dynamic/require'}));
  expect(audit({'src/bridge/server/bootstrap/desktop.ts':load}).unresolved).not.toEqual([]);
  const reverse=audit({'src/bridge/server/bootstrap/desktop.ts':load,'src/bridge/server/main.ts':"import './bootstrap/desktop';"});expect(reverse.cycles).toHaveLength(1);expect(reverse.ok).toBe(false);
  expect(audit({'src/bridge/server/bootstrap/desktop.ts':load.replace('loadApplication(entry)','loadApplication(other)'),'src/bridge/server/main.ts':''}).dynamic).not.toEqual([]);
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
  for(const file of result.edges.map(edge=>edge.from).filter(file=>file.startsWith('src/view/execution-view/'))){
    expect(reachable(file).filter(value=>value.startsWith('src/view/tasks/')||value.startsWith('src/view/conversation/')||value.startsWith('src/view/team/')),file).toEqual([]);
  }
  for(const file of ['tests/data/knowledge.ts','tests/data/domain-snapshot.ts','tests/core-domains.test.ts']){
    expect(reachable(file).filter(value=>value.startsWith('src/bridge/server/')||value.startsWith('src/logic/scheduling-fixture/')||value==='tests/helpers.ts'),file).toEqual([]);
  }
});

test('read models are accessible through their public entry, not private implementations',()=>{
  const files={
    'src/logic/knowledge/rules/read-models/index.ts':"export {Team} from './team';",
    'src/logic/knowledge/rules/read-models/team.ts':'export class Team {}',
  };
  expect(audit({...files,'src/logic/scheduling-fixture/a.ts':"import {Team} from '../../logic/knowledge/rules/read-models';"}).ok).toBe(true);
  const result=audit({...files,'src/logic/scheduling-fixture/a.ts':"import type {Team} from '../../logic/knowledge/rules/read-models/team';"});
  expect(result.logicalViolations).toContainEqual(expect.objectContaining({rule:'private-entry',boundary:'knowledge-read-models',kind:'type'}));
  expect(result.cycles).toEqual([]);expect(result.ok).toBe(false);
});
test('alias reexports and literal dynamic imports cannot bypass a private entry',()=>{
  const files={
    'tsconfig.json':JSON.stringify({compilerOptions:{baseUrl:'.',paths:{'@knowledge/*':['src/logic/knowledge/rules/*']}}}),
    'src/logic/knowledge/rules/read-models/team.ts':'export class Team {}',
  };
  for(const source of ["export type {Team} from '@knowledge/read-models/team';","export type T=import('@knowledge/read-models/team').Team;","import('../../logic/knowledge/rules/read-models/team');"]){
    const result=audit({...files,'src/logic/scheduling-fixture/a.ts':source});
    expect(result.logicalViolations).toContainEqual(expect.objectContaining({rule:'private-entry'}));expect(result.ok).toBe(false);
  }
});
test('snapshot data and read models reject reverse dependencies on orchestration without needing a file cycle',()=>{
  for(const file of ['src/logic/knowledge/rules/types.ts','src/logic/knowledge/rules/read-models/snapshot.ts']){
    const result=audit({[file]:`import type {Query} from '${file.endsWith('/types.ts')?'./knowledge-queries':'../knowledge-queries'}';`,'src/logic/knowledge/rules/knowledge-queries.ts':'export interface Query {}'});
    expect(result.cycles).toEqual([]);expect(result.logicalViolations).toContainEqual(expect.objectContaining({rule:'logical-direction'}));expect(result.ok).toBe(false);
  }
});

test('P1 narrow boundaries reject restored write access, shared stores and business tool registration',()=>{
  const cases=[
    ['src/logic/knowledge/rules/knowledge-queries.ts','./ports','src/logic/knowledge/rules/ports.ts','knowledge-query-orchestration'],
    ['src/logic/knowledge/rules/knowledge-queries.ts','./knowledge-refresh','src/logic/knowledge/rules/knowledge-refresh.ts','knowledge-query-orchestration'],
    ['src/logic/budget/rules/model-request-budget-storage.ts','../../dispatch/rules/dispatch-storage','src/logic/dispatch/rules/dispatch-storage.ts','request-budget-port'],
    ['src/logic/budget/runtime/model-request-budget-service.ts','../../dispatch/rules/dispatch-storage','src/logic/dispatch/rules/dispatch-storage.ts','request-budget-service'],
    ['src/logic/budget/runtime/model-request-budget-service.ts','./scope-budget-service','src/logic/budget/runtime/scope-budget-service.ts','request-budget-service'],
    ['src/logic/execution/rules/engine-tools.ts','./capabilities/member-tool-capabilities','src/logic/execution/rules/capabilities/member-tool-capabilities.ts','engine-tool-registry'],
  ];
  for(const [file,spec,target,boundary] of cases){
    const result=audit({[file]:`import type {T} from '${spec}';`,[target]:'export interface T {}'});
    expect(result.cycles).toEqual([]);expect(result.logicalViolations).toContainEqual(expect.objectContaining({rule:'logical-direction',boundary}));expect(result.ok).toBe(false);
  }
});
test('test data rejects Application imports and private helper reexports',()=>{
  const direct=audit({'tests/data/knowledge.ts':"import type {App} from '../../src/logic/application/application';",'src/logic/application/application.ts':'export class App {}'});
  expect(direct.logicalViolations).toContainEqual(expect.objectContaining({rule:'logical-direction',boundary:'test-data'}));expect(direct.ok).toBe(false);
  const privateEntry=audit({'tests/data/private.ts':'export const value=1;','tests/sample.ts':"export {value} from './data/private';"});
  expect(privateEntry.logicalViolations).toContainEqual(expect.objectContaining({rule:'private-entry',boundary:'test-data'}));expect(privateEntry.ok).toBe(false);
});
test('a shared pure helper cannot hide an indirect filesystem or SDK dependency',()=>{
  const indirect=audit({
    'tests/data/knowledge.ts':"import {hash} from '../../src/core/platform/node/serialization';",
    'src/core/platform/node/serialization.ts':"import {write} from './files'; export const hash=write;",
    'src/core/platform/node/files.ts':'export const write=()=>{};',
  });
  expect(indirect.logicalViolations).toContainEqual(expect.objectContaining({rule:'logical-direction',boundary:'pure-foundation'}));expect(indirect.ok).toBe(false);
  for(const spec of ['node:fs/promises','@anthropic-ai/claude-agent-sdk']){
    const result=audit({'src/logic/knowledge/rules/read-models/snapshot.ts':`import type * as External from '${spec}';`});
    expect(result.logicalViolations).toContainEqual(expect.objectContaining({rule:'external-dependency',boundary:'knowledge-read-models'}));expect(result.ok).toBe(false);
  }
});
test('relative paths into node_modules cannot hide an external dependency',()=>{
  const result=audit({
    'src/logic/knowledge/rules/read-models/snapshot.ts':"import type {Sdk} from '../../../../../node_modules/private-sdk/index';",
    'node_modules/private-sdk/index.ts':'export interface Sdk {}',
  });
  expect(result.unresolved).toEqual([]);
  expect(result.logicalViolations).toContainEqual(expect.objectContaining({rule:'external-dependency',boundary:'knowledge-read-models',spec:'../../../../../node_modules/private-sdk/index'}));
  expect(result.ok).toBe(false);
});
test('detects the Application to dispatcher reverse type dependency',()=>{
  const result=audit({'src/logic/fixtures/application.ts':"import {dispatch} from './dispatch'; export class App {}",'src/logic/fixtures/dispatch.ts':"import type {App} from './application'; export const dispatch=(app:App)=>app;"});
  expect(result.cycles[0].files).toEqual(['src/logic/fixtures/application.ts','src/logic/fixtures/dispatch.ts']);
  expect(result.cycles[0].edges.some(e=>e.kind==='type'&&e.line===1)).toBe(true);
});
test('detects long cycles through type reexports and import types',()=>{
  const result=audit({'src/logic/fixtures/a.ts':"export type {B} from './b'; export interface A {}",'src/logic/fixtures/b.ts':"export type B=import('./c').C;",'src/logic/fixtures/c.ts':"import {type A} from './a'; export type C=A;"});
  expect(result.cycles[0].files).toEqual(['src/logic/fixtures/a.ts','src/logic/fixtures/b.ts','src/logic/fixtures/c.ts']);
});
test('detects dynamic imports, CommonJS and createRequire aliases',()=>{
  const result=audit({'scripts/a.mjs':"import('./b.cjs');",'scripts/b.cjs':"require('./c.mjs');",'scripts/c.mjs':"import {createRequire} from 'node:module'; const load=createRequire(import.meta.url); load('./a.mjs');"});
  expect(result.cycles[0].files).toHaveLength(3);
});
test('declaration companion cannot hide a JS runtime cycle',()=>{
  const result=audit({'src/logic/fixtures/a.mjs':"import './b.mjs';",'src/logic/fixtures/b.mjs':"import './a.mjs';",'src/logic/fixtures/b.d.mts':'export interface B {}'});
  expect(result.cycles[0].files).toEqual(['src/logic/fixtures/a.mjs','src/logic/fixtures/b.mjs']);
});
test('detects import equals and self cycles',()=>{
  expect(audit({'src/logic/fixtures/a.ts':"import x = require('./a'); export = x;"}).cycles[0].files).toEqual(['src/logic/fixtures/a.ts']);
});
test('includes declaration triple slash path references',()=>{
  const result=audit({'src/logic/fixtures/a.d.ts':'/// <reference path="b.d.ts" />\ninterface A {}','src/logic/fixtures/b.d.ts':'/// <reference path="a.d.ts" />\ninterface B {}'});
  expect(result.cycles[0].files).toEqual(['src/logic/fixtures/a.d.ts','src/logic/fixtures/b.d.ts']);
});
test('resolves tsconfig aliases and index modules',()=>{
  const result=audit({'tsconfig.json':JSON.stringify({compilerOptions:{baseUrl:'.',paths:{'@/*':['src/logic/fixtures/*']}}}),'src/logic/fixtures/a.ts':"import '@/b';",'src/logic/fixtures/b/index.ts':"export * from '../a';"});
  expect(result.cycles[0].files).toEqual(['src/logic/fixtures/a.ts','src/logic/fixtures/b/index.ts']);
});
test('acyclic shared contract passes; unresolvable paths and computed loads fail',()=>{
  expect(audit({'src/logic/fixtures/a.ts':"import type {T} from './contract';",'src/logic/fixtures/b.ts':"import type {T} from './contract';",'src/logic/fixtures/contract.ts':'export type T=string;'}).ok).toBe(true);
  const bad=audit({'src/logic/fixtures/a.ts':"import './missing'; import(target);"});
  expect(bad.ok).toBe(false);expect(bad.unresolved).toHaveLength(1);expect(bad.dynamic).toHaveLength(1);
});
test('cross layer type imports fail even without a cycle',()=>{
  const result=audit({'src/logic/fixtures/a.ts':"import type {T} from '../../bridge/server/b';",'src/bridge/server/b.ts':'export type T=string;'});
  expect(result.violations).toHaveLength(1);expect(result.ok).toBe(false);
});
test('snapshot contracts and domain views reject reverse or private dependencies without a file cycle',()=>{
  const contracts='src/logic/knowledge/rules/types.ts';
  const snapshot='src/logic/knowledge/rules/read-models/snapshot.ts';
  const team='src/logic/knowledge/rules/read-models/team.ts';
  const workspace='src/logic/knowledge/rules/read-models/workspace.ts';
  const port='src/logic/knowledge/rules/ports.ts';
  const query='src/logic/knowledge/rules/knowledge-queries.ts';
  const denied=[
    [contracts,snapshot],[snapshot,team],[team,workspace],[workspace,team],
    [team,port],[query,port],['src/core/json.ts',contracts],
    ['tests/knowledge-data.ts','tests/helpers.ts'],
    ['tests/knowledge-fixture.ts','src/logic/application/application.ts'],
    ['src/logic/budget/rules/model-request-budget-storage.ts','src/logic/dispatch/rules/dispatch-storage.ts'],
    ['src/logic/budget/runtime/model-request-budget-service.ts','src/logic/dispatch/rules/dispatch-storage.ts'],
    ['src/logic/execution/rules/engine-tools.ts','src/logic/evidence/rules/progress-tools.ts'],
    ['src/logic/execution/rules/index.ts','src/logic/execution/engines/pi/engine.ts'],
    ['src/view/execution-view/WorkStatus.tsx','src/view/tasks/useExecutionRecovery.ts'],
    ['src/view/execution-view/ToolTimeline.tsx','src/view/conversation/Conversation.tsx'],
    ['src/view/tasks/MemberRunTranscript.tsx','src/view/conversation/ConversationTurn.tsx'],
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
    'src/logic/knowledge/rules/read-models/index.ts':"export type {T} from './snapshot'; import './team'; import './workspace';",
    [query]:"import type {T} from './read-models';",
  }).ok).toBe(true);
});
test('history persistence rejects workspace and runtime assembly even through type dependencies',()=>{
  const from='src/logic/history/service/file-store.ts';
  for(const to of ['src/logic/workspace/service/workspace.ts','src/logic/workspace/service/agent-history.ts','src/logic/history/runtime/agent-history.ts']){
    const relative=path.posix.relative(path.posix.dirname(from),to);
    const result=audit({[from]:`export type {T} from '${relative}';`,[to]:'export type T=string;'});
    expect(result.cycles).toEqual([]);expect(result.violations).toHaveLength(1);expect(result.ok).toBe(false);
  }
  expect(audit({[from]:"import type {T} from '../../../logic/team/rules/session-history-storage';",'src/logic/team/rules/session-history-storage.ts':'export type T=string;'}).ok).toBe(true);
});

test('updater stays independent of application runtime and business services',()=>{
  const from='src/logic/updates/service/a.ts';
  for(const target of ['src/logic/application/application.ts','src/logic/runtime/monitoring/global-runtime.ts','src/logic/knowledge/rules/types.ts']){
    const result=audit({[from]:`import type {T} from '${path.posix.relative(path.posix.dirname(from),target)}';`,[target]:'export type T=string;'});
    expect(result.violations).toHaveLength(1);
  }
  expect(audit({'src/bridge/server/main.ts':"import type {T} from '../../logic/updates/service/runtime-host';",'src/logic/updates/service/runtime-host.ts':"export type {T} from '../contracts';",'src/logic/updates/contracts.ts':'export type T=string;'}).ok).toBe(true);
});
test('View and Logic can only meet through public Bridge contracts',()=>{
  const fixtures:Record<string,string>[]=[
    {'src/view/a.ts':"import type {T} from '../logic/fixtures/b';",'src/logic/fixtures/b.ts':'export type T=string;'},
    {'src/logic/fixtures/a.ts':"import type {T} from '../../view/b';",'src/view/b.ts':'export type T=string;'},
    {'src/bridge/preload/a.ts':"import type {T} from '../server/b';",'src/bridge/server/b.ts':'export type T=string;'},
  ];
  for(const files of fixtures)expect(audit(files).violations).toHaveLength(1);
  expect(audit({'src/view/a.ts':"import type {T} from '../bridge/contracts/b';",'src/bridge/contracts/b.ts':"export type {T} from '../../logic/knowledge/rules/types';",'src/logic/knowledge/rules/types.ts':'export type T=string;'}).ok).toBe(true);
});


test('P2 shared rendering, IPC contracts and history storage reject business control dependencies',()=>{
  const cases=[
    ['src/view/execution-view/WorkStatus.tsx','../tasks/useExecutionRecovery','src/view/tasks/useExecutionRecovery.ts','execution-view'],
    ['src/view/execution-view/ToolTimeline.tsx','../tasks/ToolActivity','src/view/tasks/ToolActivity.tsx','execution-view'],
    ['src/logic/history/service/file-store.ts','../../workspace/service/workspace','src/logic/workspace/service/workspace.ts','agent-history-file-store'],
    ['src/logic/history/service/file-store.ts','../runtime/agent-history','src/logic/history/runtime/agent-history.ts','agent-history-file-store'],
    ['src/bridge/contracts/agent-history-ipc.ts','../../logic/application/application','src/logic/application/application.ts','ipc-contract'],
    ['src/bridge/contracts/ipc-loop.ts','../../logic/conversation/runtime/execution-manager','src/logic/conversation/runtime/execution-manager.ts','ipc-contract'],
    ['src/bridge/contracts/ipc-desktop.ts','../server/main','src/bridge/server/main.ts','ipc-contract'],
  ];
  for(const [file,spec,target,boundary] of cases){
    const result=audit({[file]:`import type {T} from '${spec}';`,[target]:'export interface T {}'});
    expect(result.cycles).toEqual([]);expect(result.logicalViolations).toContainEqual(expect.objectContaining({rule:'logical-direction',boundary}));expect(result.ok).toBe(false);
  }
});

test('engines may use portable utility but not other foundation capabilities',()=>{
  const from='src/logic/execution/engines/pi/rpc.ts';
  for(const target of ['utility/index.ts','utility/node.ts','utility/strings.ts','utility/graphs.ts','files/index.ts','web/index.ts']){
    const to=foundationFile(target),relative=path.posix.relative(path.posix.dirname(from),to);
    expect(audit({[from]:`import type {T} from '${relative}';`,[to]:'export type T=string;'}).ok).toBe(target==='utility/index.ts');
  }
});

test('concrete engines depend on domain contracts; only execution assembly may select engines',()=>{
  const engine='src/logic/execution/engines/pi/engine.ts',contract='src/logic/execution/rules/types.ts';
  expect(audit({[engine]:"import type {T} from '../../rules/types';",[contract]:'export interface T {}'}).ok).toBe(true);
  const reversed=audit({[contract]:"import type {T} from '../engines/pi/engine';",[engine]:'export interface T {}'});
  expect(reversed.violations).toHaveLength(1);expect(reversed.ok).toBe(false);
  const bypass=audit({'src/logic/application/assembly/entry.ts':"import type {T} from '../../../logic/execution/engines/pi/engine';",[engine]:'export interface T {}'});
  expect(bypass.violations).toHaveLength(1);expect(bypass.ok).toBe(false);
  for(const directory of ['execution/assembly','team/runtime']){
    const from='src/logic/'+directory+'/entry.ts',spec=path.posix.relative(path.posix.dirname(from),engine);
    const result=audit({[from]:`import type {T} from '${spec}';`,[engine]:'export interface T {}'});
    expect(result.ok).toBe(directory==='execution/assembly');
  }
});
