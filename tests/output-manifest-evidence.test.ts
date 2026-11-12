import {it,expect,beforeAll,afterAll} from 'vitest';
import {manifestFixture,manifestInput,verifyManifests} from './output-manifest-fixture';
import {seedProgress,invoke} from './artifact-runtime-fixture';
import {outputManifestToolName as capture,type OutputManifestStaged} from '../src/backend/core/evidence/output-manifest';
import type {StoredEvent} from '../src/backend/core/execution/types';

let f:Awaited<ReturnType<typeof manifestFixture>>,events:StoredEvent[];
beforeAll(async()=>{f=await manifestFixture(async c=>{await seedProgress(c);await invoke(c,capture,'capture',manifestInput)});const summary=await (await f.start()).done;expect(summary.status).toBe('completed');events=summary.events});
afterAll(async()=>{await f?.cleanup()});
type Mutation=(items:StoredEvent[],manifest:OutputManifestStaged)=>void;
const cases:Array<[string,Mutation]>=[
  ['内容哈希',(_e,m)=>{m.manifestHash='a'.repeat(64)}],['范围哈希',(_e,m)=>{m.scopeHash='a'.repeat(64)}],['文件总量',(_e,m)=>{m.byteLength++}],['条目总量',(_e,m)=>{m.entryCount++}],
  ['另一个成员',(_e,m)=>{m.binding.agentSessionId='other'}],['另一个工作流',(_e,m)=>{m.scopes[0].workflowVersion='other'}],['另一个知识',(_e,m)=>{m.knowledgeRevision='other'}],['进度版本',(_e,m)=>{m.progressVersion++}],['影响序号',(_e,m)=>{m.lastEffectSeq++}],
  ['缺成功结束',(e)=>{e.find(item=>item.type==='tool.finished'&&item.data.id==='capture')!.data.isError=true}],
  ['缺契约版本',(e)=>{delete e.find(item=>item.type==='tool.allowed'&&item.data.id==='capture')!.data.contractVersion}],
  ['重复暂存',(e)=>{e.splice(e.length-1,0,structuredClone(e.find(item=>item.type==='artifact.manifest_captured')!));e.forEach((item,i)=>item.seq=i+1)}],
  ['采集中停止',(e)=>{const at=e.findIndex(item=>item.type==='artifact.manifest_captured');e.splice(at,0,{...e[at],type:'run.stop_requested',data:{}});e.forEach((item,i)=>item.seq=i+1)}],
  ['采集中进度变化',(e)=>{const at=e.findIndex(item=>item.type==='artifact.manifest_captured');e.splice(at,0,{...e[at],type:'task.updated',data:{progress:{version:2}}});e.forEach((item,i)=>item.seq=i+1)}],
  ['另一个运行日志',(e)=>{e[2].runId='foreign'}],
];
it.each(cases)('篡改原完整清单证明被拒绝：%s',(_name,mutate)=>{const value=structuredClone(events),manifest=value.find(item=>item.type==='artifact.manifest_captured')!.data.manifest as OutputManifestStaged;mutate(value,manifest);const result=verifyManifests(value);expect(result.refs).toEqual([]);expect(result.issues).not.toEqual([])});
it('后续获准写入或重规划立即失效，坏回包不让旧清单复活，读取不失效',()=>{
  for(const name of ['write','cbim_task_plan','read']){const value=structuredClone(events),last=value.at(-1)!;value.push({...last,seq:last.seq+1,type:'tool.allowed',data:{id:'next',name,effects:name==='write'?['business-write']:['maintenance']}});expect(verifyManifests(value).refs[0].invalidated).toBe(name!=='read')}
});
it('成功回执缺暂存不能补造，超过原运行容量连坏暂存也计入',()=>{
  const absent=events.filter(e=>e.type!=='artifact.manifest_captured');expect(verifyManifests(absent)).toMatchObject({refs:[],records:[]});expect(verifyManifests(absent).issues).not.toEqual([]);
  const excess=structuredClone(events);for(let i=0;i<8;i++)excess.push({...excess.at(-1)!,seq:excess.at(-1)!.seq+1,type:'artifact.manifest_captured',data:{manifest:{}}});expect(verifyManifests(excess).refs).toEqual([]);
});
