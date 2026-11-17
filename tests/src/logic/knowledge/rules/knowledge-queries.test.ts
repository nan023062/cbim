import {expect,it,vi} from 'vitest';
import {KnowledgeQueries} from '../../../../../src/logic/knowledge/rules/knowledge-queries';
import {KnowledgeRefresh,type KnowledgeRefreshPort as KnowledgeRefreshWorkspace} from '../../../../../src/logic/knowledge/rules/knowledge-refresh';
const refreshKnowledgeIndexes=(workspace:KnowledgeRefreshWorkspace,input:Parameters<KnowledgeRefresh['Refresh']>[0])=>new KnowledgeRefresh(workspace).Refresh(input);
import type {Snapshot} from '../../../../../src/logic/knowledge/rules/types';
import {knowledgeFixture,teamKnowledgeFiles,teamIds} from './support/knowledge-fixture';

it('查询只取得快照端口，保持筛选、Skill 继承、本模块流程与内置根身份',async()=>{
  const f=await knowledgeFixture();try{
    const snapshot=await f.snapshot(teamKnowledgeFiles()),before=structuredClone(snapshot);
    const reader={Snapshot:vi.fn(async()=>snapshot)},queries=new KnowledgeQueries(reader);
    expect((await queries.Modules('game/child')).modules.map((m:any)=>m.id)).toEqual([teamIds.child]);
    expect((await queries.Agents('dev')).groups.flatMap((g:any)=>g.agents.map((a:any)=>a.id))).toEqual([teamIds.agent]);
    expect((await queries.Agent(teamIds.agent)).skills.map(s=>[s.id,s.inherited])).toEqual([[teamIds.own,false],[teamIds.shared,true]]);
    expect((await queries.Module(teamIds.module)).workflows.map((w:any)=>w.id)).toEqual([teamIds.workflow]);
    expect((await queries.Module(teamIds.child)).workflows).toEqual([]);
    expect(await queries.Module('cbim:project')).toMatchObject({source:'builtin',id:'cbim:project',workflows:[]});
    await expect(queries.Agent('missing')).rejects.toMatchObject({code:'OBJECT_NOT_FOUND'});
    await expect(queries.Module('missing')).rejects.toMatchObject({code:'OBJECT_NOT_FOUND'});
    expect(reader.Snapshot).toHaveBeenCalledTimes(8);
    expect(snapshot).toEqual(before);
  }finally{await f.cleanup()}
});

it('每次查询读取当前快照，旧视图不会变成跨版本缓存',async()=>{
  const f=await knowledgeFixture();try{
    const first=await f.snapshot(teamKnowledgeFiles()),next=await f.snapshot();
    const reader={Snapshot:vi.fn().mockResolvedValueOnce(first).mockResolvedValueOnce(next)};
    const queries=new KnowledgeQueries(reader);
    expect((await queries.Modules()).modules).toHaveLength(2);
    const result=await queries.Modules();
    expect(result.modules).toEqual([]);expect(result.revision).toBe(next.revision);
    expect(result.projectRoot.id).toBe('cbim:project');
  }finally{await f.cleanup()}
});

const input={workspaceId:'workspace',instanceId:'6bb5c917-817b-46b8-adb6-685858d53aaa',revision:'original',requestId:'refresh-request'};
function refreshPort(structural=true){
  const snapshot:Snapshot={...input,files:[],validation:{structural,issues:[],indexes:{},tree:{nodes:{},roots:[]},architecture:'review-required',business:'not-run'}};
  const committed={state:'committed',...input,revision:'committed',changed:['.cbim/team/registry.json']};
  const port={
    Assert:vi.fn(),Snapshot:vi.fn(async()=>snapshot),
    CommittedReceipt:vi.fn<KnowledgeRefreshWorkspace['CommittedReceipt']>(async()=>undefined),
    Commit:vi.fn(async()=>committed),
  } satisfies KnowledgeRefreshWorkspace;
  return {snapshot,committed,port};
}

it('刷新先核身份及原回执，结构无效和陈旧版本不提交',async()=>{
  const {port,snapshot}=refreshPort(false);
  expect(await refreshKnowledgeIndexes(port,input)).toMatchObject({state:'invalid',indexesUpdated:false});
  expect(port.Commit).not.toHaveBeenCalled();
  snapshot.revision='newer';
  await expect(refreshKnowledgeIndexes(port,input)).rejects.toMatchObject({code:'CONFLICT'});
  expect(port.Commit).not.toHaveBeenCalled();
  port.Assert.mockImplementationOnce(()=>{throw Object.assign(Error('stale'),{code:'STALE_INSTANCE'})});
  port.CommittedReceipt.mockClear();port.Snapshot.mockClear();
  await expect(refreshKnowledgeIndexes(port,input)).rejects.toMatchObject({code:'STALE_INSTANCE'});
  expect(port.CommittedReceipt).not.toHaveBeenCalled();expect(port.Snapshot).not.toHaveBeenCalled();
});

it('原成功请求不重放，返回当前校验；首次提交后结构变化不伪造成功',async()=>{
  const {port,snapshot,committed}=refreshPort();
  port.CommittedReceipt.mockResolvedValueOnce(committed);
  snapshot.revision='newer';snapshot.validation!.structural=false;
  expect(await refreshKnowledgeIndexes(port,input)).toMatchObject({state:'invalid',indexesUpdated:true,revision:'newer',changed:committed.changed});
  expect(port.Commit).not.toHaveBeenCalled();
  snapshot.revision=input.revision;snapshot.validation!.structural=true;
  port.Commit.mockImplementationOnce(async()=>{snapshot.revision='after';snapshot.validation!.structural=false;return committed});
  expect(await refreshKnowledgeIndexes(port,input)).toMatchObject({state:'invalid',indexesUpdated:true,revision:'after'});
  expect(port.Commit).toHaveBeenCalledExactlyOnceWith({...input,changes:[]});
});

it('提交结果未知时原错误上抛，不生成新请求或重试',async()=>{
  const {port}=refreshPort(),unknown=Error('commit outcome unknown');
  port.Commit.mockRejectedValueOnce(unknown);
  await expect(refreshKnowledgeIndexes(port,input)).rejects.toBe(unknown);
  expect(port.Commit).toHaveBeenCalledExactlyOnceWith({...input,changes:[]});
  expect(port.Snapshot).toHaveBeenCalledTimes(1);
});
