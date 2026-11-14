import {expect,it,vi} from 'vitest';
import {KnowledgeQueries} from '../src/logic/knowledge/rules/knowledge-queries';
import {KnowledgeRefresh,type KnowledgeRefreshPort as KnowledgeRefreshWorkspace} from '../src/logic/knowledge/rules/knowledge-refresh';
const refreshKnowledgeIndexes=(workspace:KnowledgeRefreshWorkspace,input:Parameters<KnowledgeRefresh['refresh']>[0])=>new KnowledgeRefresh(workspace).refresh(input);
import type {Snapshot} from '../src/logic/knowledge/rules/types';
import {knowledgeFixture,teamKnowledgeFiles,teamIds} from './knowledge-fixture';

it('查询只取得快照端口，保持筛选、Skill 继承、本模块流程与内置根身份',async()=>{
  const f=await knowledgeFixture();try{
    const snapshot=await f.snapshot(teamKnowledgeFiles()),before=structuredClone(snapshot);
    const reader={snapshot:vi.fn(async()=>snapshot)},queries=new KnowledgeQueries(reader);
    expect((await queries.modules('game/child')).modules.map((m:any)=>m.id)).toEqual([teamIds.child]);
    expect((await queries.agents('dev')).groups.flatMap((g:any)=>g.agents.map((a:any)=>a.id))).toEqual([teamIds.agent]);
    expect((await queries.agent(teamIds.agent)).skills.map(s=>[s.id,s.inherited])).toEqual([[teamIds.own,false],[teamIds.shared,true]]);
    expect((await queries.module(teamIds.module)).workflows.map((w:any)=>w.id)).toEqual([teamIds.workflow]);
    expect((await queries.module(teamIds.child)).workflows).toEqual([]);
    expect(await queries.module('cbim:project')).toMatchObject({source:'builtin',id:'cbim:project',workflows:[]});
    await expect(queries.agent('missing')).rejects.toMatchObject({code:'OBJECT_NOT_FOUND'});
    await expect(queries.module('missing')).rejects.toMatchObject({code:'OBJECT_NOT_FOUND'});
    expect(reader.snapshot).toHaveBeenCalledTimes(8);
    expect(snapshot).toEqual(before);
  }finally{await f.cleanup()}
});

it('每次查询读取当前快照，旧视图不会变成跨版本缓存',async()=>{
  const f=await knowledgeFixture();try{
    const first=await f.snapshot(teamKnowledgeFiles()),next=await f.snapshot();
    const reader={snapshot:vi.fn().mockResolvedValueOnce(first).mockResolvedValueOnce(next)};
    const queries=new KnowledgeQueries(reader);
    expect((await queries.modules()).modules).toHaveLength(2);
    const result=await queries.modules();
    expect(result.modules).toEqual([]);expect(result.revision).toBe(next.revision);
    expect(result.projectRoot.id).toBe('cbim:project');
  }finally{await f.cleanup()}
});

const input={workspaceId:'workspace',instanceId:'6bb5c917-817b-46b8-adb6-685858d53aaa',revision:'original',requestId:'refresh-request'};
function refreshPort(structural=true){
  const snapshot:Snapshot={...input,files:[],validation:{structural,issues:[],indexes:{},tree:{nodes:{},roots:[]},architecture:'review-required',business:'not-run'}};
  const committed={state:'committed',...input,revision:'committed',changed:['.cbim/team/registry.json']};
  const port={
    assert:vi.fn(),snapshot:vi.fn(async()=>snapshot),
    committedReceipt:vi.fn<KnowledgeRefreshWorkspace['committedReceipt']>(async()=>undefined),
    commit:vi.fn(async()=>committed),
  } satisfies KnowledgeRefreshWorkspace;
  return {snapshot,committed,port};
}

it('刷新先核身份及原回执，结构无效和陈旧版本不提交',async()=>{
  const {port,snapshot}=refreshPort(false);
  expect(await refreshKnowledgeIndexes(port,input)).toMatchObject({state:'invalid',indexesUpdated:false});
  expect(port.commit).not.toHaveBeenCalled();
  snapshot.revision='newer';
  await expect(refreshKnowledgeIndexes(port,input)).rejects.toMatchObject({code:'CONFLICT'});
  expect(port.commit).not.toHaveBeenCalled();
  port.assert.mockImplementationOnce(()=>{throw Object.assign(Error('stale'),{code:'STALE_INSTANCE'})});
  port.committedReceipt.mockClear();port.snapshot.mockClear();
  await expect(refreshKnowledgeIndexes(port,input)).rejects.toMatchObject({code:'STALE_INSTANCE'});
  expect(port.committedReceipt).not.toHaveBeenCalled();expect(port.snapshot).not.toHaveBeenCalled();
});

it('原成功请求不重放，返回当前校验；首次提交后结构变化不伪造成功',async()=>{
  const {port,snapshot,committed}=refreshPort();
  port.committedReceipt.mockResolvedValueOnce(committed);
  snapshot.revision='newer';snapshot.validation!.structural=false;
  expect(await refreshKnowledgeIndexes(port,input)).toMatchObject({state:'invalid',indexesUpdated:true,revision:'newer',changed:committed.changed});
  expect(port.commit).not.toHaveBeenCalled();
  snapshot.revision=input.revision;snapshot.validation!.structural=true;
  port.commit.mockImplementationOnce(async()=>{snapshot.revision='after';snapshot.validation!.structural=false;return committed});
  expect(await refreshKnowledgeIndexes(port,input)).toMatchObject({state:'invalid',indexesUpdated:true,revision:'after'});
  expect(port.commit).toHaveBeenCalledExactlyOnceWith({...input,changes:[]});
});

it('提交结果未知时原错误上抛，不生成新请求或重试',async()=>{
  const {port}=refreshPort(),unknown=Error('commit outcome unknown');
  port.commit.mockRejectedValueOnce(unknown);
  await expect(refreshKnowledgeIndexes(port,input)).rejects.toBe(unknown);
  expect(port.commit).toHaveBeenCalledExactlyOnceWith({...input,changes:[]});
  expect(port.snapshot).toHaveBeenCalledTimes(1);
});
