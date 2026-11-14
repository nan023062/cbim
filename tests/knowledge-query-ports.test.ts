import {expect,it,vi} from 'vitest';
import {KnowledgeQueries} from '../src/logic/knowledge/rules/knowledge-queries';
import {KnowledgeRefresh,type KnowledgeRefreshPort} from '../src/logic/knowledge/rules/knowledge-refresh';
import {Team,BusinessWorkspace} from '../src/logic/knowledge/rules/read-models';
import {domainSnapshot} from './data/domain-snapshot';

it('只提供快照即可查询真实团队及模块，查询不获得任何写入能力',async()=>{
  const data=domainSnapshot(),before=structuredClone(data.snapshot),reader={snapshot:vi.fn(async()=>data.snapshot)},queries=new KnowledgeQueries(reader);
  expect(await queries.modules()).toEqual(await new BusinessWorkspace(data.snapshot).modules());
  expect(await queries.module(data.moduleId)).toEqual(await new BusinessWorkspace(data.snapshot).module(data.moduleId));
  expect(await queries.agents()).toEqual(await new Team(data.snapshot).agents());
  expect(await queries.agent(data.agentId)).toEqual(await new Team(data.snapshot).agent(data.agentId));
  expect(data.snapshot).toEqual(before);expect(reader.snapshot).toHaveBeenCalledTimes(4);
  expect('refresh' in queries).toBe(false);
  reader.snapshot.mockRejectedValueOnce(Error('snapshot unavailable'));
  await expect(queries.modules()).rejects.toThrow('snapshot unavailable');
});

it('刷新以四项端口区分失效快照、旧版本及原成功回执，不因重放重复提交',async()=>{
  const {snapshot}=domainSnapshot(),input={workspaceId:snapshot.workspaceId,instanceId:snapshot.instanceId,revision:snapshot.revision,requestId:'00000000-0000-4000-8000-000000000002'};
  const receipt={...input,state:'committed',revision:'after',changed:['.cbim/workspace/registry.json']};
  const commit=vi.fn(async()=>receipt),read=vi.fn(async()=>snapshot),committedReceipt=vi.fn<KnowledgeRefreshPort['committedReceipt']>(async()=>undefined),assert=vi.fn();
  const service=new KnowledgeRefresh({assert,snapshot:read,committedReceipt,commit});
  snapshot.validation!.structural=false;
  expect(await service.refresh(input)).toMatchObject({state:'invalid',indexesUpdated:false});expect(commit).not.toHaveBeenCalled();
  await expect(service.refresh({...input,revision:'stale'})).rejects.toMatchObject({code:'CONFLICT'});expect(commit).not.toHaveBeenCalled();
  snapshot.validation!.structural=true;
  expect(await service.refresh(input)).toMatchObject({state:'refreshed',indexesUpdated:true,changed:receipt.changed});
  expect(commit).toHaveBeenCalledExactlyOnceWith({...input,changes:[]});
  committedReceipt.mockResolvedValue(receipt);snapshot.revision='current-later';snapshot.validation!.structural=false;
  expect(await service.refresh(input)).toMatchObject({state:'invalid',indexesUpdated:true,revision:'current-later'});
  expect(commit).toHaveBeenCalledTimes(1);expect(assert).toHaveBeenLastCalledWith({...input,changes:[]});
});
