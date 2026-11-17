import {expect,it,vi} from 'vitest';
import {KnowledgeQueries} from '../../../../../src/logic/knowledge/rules/knowledge-queries';
import {KnowledgeRefresh,type KnowledgeRefreshPort} from '../../../../../src/logic/knowledge/rules/knowledge-refresh';
import {Team,BusinessWorkspace} from '../../../../../src/logic/knowledge/rules/read-models/index';
import {domainSnapshot} from './data/domain-snapshot';

it('只提供快照即可查询真实团队及模块，查询不获得任何写入能力',async()=>{
  const data=domainSnapshot(),before=structuredClone(data.snapshot),reader={Snapshot:vi.fn(async()=>data.snapshot)},queries=new KnowledgeQueries(reader);
  expect(await queries.Modules()).toEqual(await new BusinessWorkspace(data.snapshot).Modules());
  expect(await queries.Module(data.moduleId)).toEqual(await new BusinessWorkspace(data.snapshot).Module(data.moduleId));
  expect(await queries.Agents()).toEqual(await new Team(data.snapshot).Agents());
  expect(await queries.Agent(data.agentId)).toEqual(await new Team(data.snapshot).Agent(data.agentId));
  expect(data.snapshot).toEqual(before);expect(reader.Snapshot).toHaveBeenCalledTimes(4);
  expect('refresh' in queries).toBe(false);
  reader.Snapshot.mockRejectedValueOnce(Error('snapshot unavailable'));
  await expect(queries.Modules()).rejects.toThrow('snapshot unavailable');
});

it('刷新以四项端口区分失效快照、旧版本及原成功回执，不因重放重复提交',async()=>{
  const {snapshot}=domainSnapshot(),input={workspaceId:snapshot.workspaceId,instanceId:snapshot.instanceId,revision:snapshot.revision,requestId:'00000000-0000-4000-8000-000000000002'};
  const receipt={...input,state:'committed',revision:'after',changed:['.cbim/workspace/registry.json']};
  const commit=vi.fn(async()=>receipt),read=vi.fn(async()=>snapshot),committedReceipt=vi.fn<KnowledgeRefreshPort['CommittedReceipt']>(async()=>undefined),assert=vi.fn();
  const service=new KnowledgeRefresh({Assert: assert,Snapshot:read,CommittedReceipt: committedReceipt,Commit: commit});
  snapshot.validation!.structural=false;
  expect(await service.Refresh(input)).toMatchObject({state:'invalid',indexesUpdated:false});expect(commit).not.toHaveBeenCalled();
  await expect(service.Refresh({...input,revision:'stale'})).rejects.toMatchObject({code:'CONFLICT'});expect(commit).not.toHaveBeenCalled();
  snapshot.validation!.structural=true;
  expect(await service.Refresh(input)).toMatchObject({state:'refreshed',indexesUpdated:true,changed:receipt.changed});
  expect(commit).toHaveBeenCalledExactlyOnceWith({...input,changes:[]});
  committedReceipt.mockResolvedValue(receipt);snapshot.revision='current-later';snapshot.validation!.structural=false;
  expect(await service.Refresh(input)).toMatchObject({state:'invalid',indexesUpdated:true,revision:'current-later'});
  expect(commit).toHaveBeenCalledTimes(1);expect(assert).toHaveBeenLastCalledWith({...input,changes:[]});
});
