import {it,expect,beforeAll,afterAll} from 'vitest';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {transitionFixture,runTransitions,transitionContracts} from './artifact-transition-fixture';
import type {StoredEvent} from '../src/backend/core/brain/types';
import {artifactScopeSchema} from '../src/backend/core/workspace/artifact-scope';
import {ArtifactTransitionProofs} from '../src/frontend/tasks/ArtifactTransitionProofs';

let f:Awaited<ReturnType<typeof transitionFixture>>,events:StoredEvent[];
beforeAll(async()=>{f=await transitionFixture(async c=>{await runTransitions(c)});const summary=await(await f.start()).done;expect(summary.status).toBe('completed');events=summary.events});
afterAll(async()=>{await f?.cleanup()});
type Change=(events:StoredEvent[])=>void;
const prepared=(e:StoredEvent[])=>e.find(x=>x.type==='artifact.transition_prepared')!.data.prepared as any;
const cases:Array<[string,Change]>=[
  ['另一运行',e=>{prepared(e).binding.runId='foreign'}],['另一操作',e=>{prepared(e).operation.path='outputs/a.txt'}],['另一前态',e=>{prepared(e).beforeManifestId='forged'}],['另一前态摘要',e=>{prepared(e).beforeManifestHash='a'.repeat(64)}],['另一文件字节',e=>{prepared(e).before.byteLength++}],['另一授权序号',e=>{prepared(e).allowedSeq++}],['另一进度',e=>{prepared(e).progressVersion++}],['另一知识',e=>{prepared(e).knowledgeRevision='changed'}],['硬链接身份',e=>{prepared(e).fileIdentity.links=2}],
  ['缺 executing',e=>{e.splice(e.findIndex(x=>x.type==='artifact.transition_executing'),1)}],['缺 applied',e=>{e.splice(e.findIndex(x=>x.type==='artifact.transition_applied'),1)}],['重复 prepared',e=>{e.push(structuredClone(e.find(x=>x.type==='artifact.transition_prepared')!))}],
  ['阶段顺序',e=>{e.find(x=>x.type==='artifact.transition_executing')!.seq=1}],['错误阶段引用',e=>{e.find(x=>x.type==='artifact.transition_executing')!.data.preparedSeq=1}],['错误后态',e=>{(e.find(x=>x.type==='artifact.transition_applied')!.data.afterSnapshot as any).entries.pop()}],
  ['原工具失败',e=>{e.find(x=>x.type==='tool.finished'&&x.data.id==='transition-0')!.data.isError=true}],['缺真实契约',e=>{delete e.find(x=>x.type==='tool.allowed'&&x.data.id==='transition-0')!.data.contractVersion}],['坏工具回包',e=>{(e.find(x=>x.type==='tool.finished'&&x.data.id==='transition-0')!.data.result as any).content[0].text='{}'}],
  ['写前采集晚于调用',e=>{e.find(x=>x.type==='tool.finished'&&x.data.id==='before')!.seq=prepared(e).allowedSeq+1}],
];
it.each(cases)('不能以篡改的 %s 为后续清单证明',(_name,change)=>{const value=structuredClone(events);change(value);expect(f.verify(value).records.some(r=>r.manifest.captureToolCallId==='after-1')).toBe(false)});
it('声明拒绝跨界、交叠、同名大小写和知识目录，旧无操作声明保持合法',()=>{
  const scope=transitionContracts()[0].contract.artifactScope!;
  for(const transitions of [[{kind:'delete',path:'outside.txt'}],[{kind:'move',from:'outputs/a.txt',to:'outputs/A.txt'}],[{kind:'delete',path:'outputs/a.txt'},{kind:'move',from:'outputs/a.txt',to:'outputs/b.txt'}],[{kind:'delete',path:'outputs/.git/file'}],[{kind:'delete',path:'outputs/parent'},{kind:'delete',path:'outputs/parent/file'}]])expect(artifactScopeSchema.safeParse({...scope,transitions}).success).toBe(false);
  const {transitions:_transitions,...legacy}=scope;expect(artifactScopeSchema.parse(legacy)).toEqual(legacy);
});
it('共享界面同时显示删除、移动两端、原清单和顺序，且没有重放控件',()=>{
  const operations=f.verify(events).records.at(-1)!.manifest.operations,html=renderToStaticMarkup(createElement(ArtifactTransitionProofs,{operations}));
  for(const text of ['outputs/old.txt','outputs/from.txt','outputs/moved.txt','写前清单','原文件 SHA-256','记录顺序','不会再次执行或自动恢复'])expect(html).toContain(text);expect(html).not.toContain('<button');expect(renderToStaticMarkup(createElement(ArtifactTransitionProofs,{operations:undefined}))).toBe('');
});
